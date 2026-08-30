"""
统一生成路由：文生图、图生图、图生视频
支持 ComfyUI 工作流与 Gemini 模型选择
"""

import logging
import uuid
import shutil
import requests
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH
from services.comfyui_client import get_comfyui_client
from services.google_ai_client import GoogleAIClient
from services.llm_vision_service import LLMVisionService
from services.style_config import StyleConfig

logger = logging.getLogger(__name__)
router = APIRouter()
style_config = StyleConfig()

OUTPUT_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "generator_outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============ 请求模型 ============

class TextToImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    model: str = "comfyui-qwen-image"
    style: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 8
    cfg: float = 1.0
    seed: int = -1


class ImageInput(BaseModel):
    url: str
    description: str = ""


class ImageToImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    model: str = "comfyui-qwen-image-edit"
    images: List[ImageInput] = Field(default_factory=list)
    style: str = ""
    width: int = 1024
    height: int = 1024


class ImageToVideoRequest(BaseModel):
    prompt: str = Field(..., description="视频画面描述（英文）")
    first_frame_image: str = Field("", description="首帧图片 URL（LTX 必填，MiniMax 用 reference_images）")
    reference_images: list = Field(default=[], description="参考图片 URL 列表（MiniMax H3 用，1-9 张）")
    model: str = "comfyui-ltx"
    dialogue: str = ""
    voice_instruct: str = ""
    duration: float = 0
    fps: int = 24
    width: int = 0
    height: int = 0


class InpaintRequest(BaseModel):
    prompt: str
    model: str = "gemini-2.5-flash-image"
    base_image: str = Field(..., description="原图 URL 或 data URL")
    mask_image: str = Field(..., description="遮罩图 data URL（白色=需修复区域）")
    aspect_ratio: str = "1:1"


class ImageToPromptRequest(BaseModel):
    image: str = Field(..., description="图片 URL 或 data URL")
    model: str = "gemini-2.5-flash"


class SceneHDRRequest(BaseModel):
    image: str = Field(..., description="场景图 URL")
    negative_prompt: str = "people, person, human, character"
    custom_instruction: str = ""
    model: str = "qwen-image-edit"  # qwen-image-edit | flux2-klein


# ============ 辅助函数 ============

def _to_full_url(url: str) -> str:
    """将 /static/projects/... 相对路径转为后端可访问的完整 URL"""
    if url and url.startswith("/static/"):
        full = f"http://localhost:8001{url}"
        logger.info("[API] Resolved relative URL: %s -> %s", url, full)
        return full
    return url


def _compute_aspect_ratio(width: int, height: int) -> str:
    """根据宽高计算最接近的标准 aspect ratio 字符串"""
    from math import gcd
    g = gcd(width, height)
    w = width // g
    h = height // g
    # 匹配 Gemini 支持的标准比例
    standard = {
        (1, 1): "1:1",
        (16, 9): "16:9",
        (9, 16): "9:16",
        (4, 3): "4:3",
        (3, 4): "3:4",
    }
    return standard.get((w, h), f"{w}:{h}")


def _apply_style(prompt: str, style: str) -> str:
    """在 prompt 前追加风格提示词"""
    style_prompt = style_config.get_style_prompt(style)
    if style_prompt:
        return f"{style_prompt}, {prompt}"
    logger.debug("[API] No style prompt found for style=%s", style)
    return prompt


def _resolve_image_data(url: str):
    """解析图片 URL，返回 (data, mime_type, ext)"""
    raw_url = url.split("?")[0]
    logger.info("[API] Resolving image data from %s", raw_url)
    if "/static/projects/" in raw_url:
        relative = raw_url.split("/static/projects/", 1)[1]
        local_path = Path(PROJECT_FILE_PATH) / relative
        if not local_path.exists():
            logger.error("[API] Local image not found: %s", local_path)
            raise FileNotFoundError(f"图片文件不存在: {local_path}")
        data = local_path.read_bytes()
        logger.info("[API] Loaded local image, size=%d bytes", len(data))
    else:
        resp = requests.get(raw_url, timeout=60)
        resp.raise_for_status()
        data = resp.content
        logger.info("[API] Downloaded remote image, size=%d bytes", len(data))

    ext = raw_url.rsplit(".", 1)[-1].lower()
    ext = "jpeg" if ext in ("jpg", "jpeg") else ext if ext in ("png", "webp") else "png"
    mime = f"image/{'jpeg' if ext == 'jpg' else ext}"
    return data, mime, ext


def _save_comfyui_image(comfyui_url: str, task_folder: Path, prefix: str = "output") -> dict:
    """从 ComfyUI HTTP URL 下载图片并保存到本地"""
    logger.info("[API] Saving ComfyUI image from %s", comfyui_url)
    resp = requests.get(comfyui_url, timeout=60)
    resp.raise_for_status()
    data = resp.content

    ext = "png"
    mime = resp.headers.get("content-type", "image/png")
    if "jpeg" in mime or "jpg" in mime:
        ext = "jpg"
    elif "webp" in mime:
        ext = "webp"

    filename = f"{prefix}_{uuid.uuid4().hex[:8]}.{ext}"
    task_folder.mkdir(parents=True, exist_ok=True)
    save_path = task_folder / filename
    save_path.write_bytes(data)

    logger.info("[API] ComfyUI image saved to %s, size=%d bytes", save_path, len(data))
    relative_path = save_path.relative_to(PROJECT_FILE_PATH)
    return {
        "filename": filename,
        "local_path": str(save_path),
        "url": f"/static/projects/{relative_path.as_posix()}",
    }


# ============ 接口 ============

@router.get("/api/status")
async def api_status():
    """检查后端及各服务状态"""
    logger.info("[API] /api/status requested")
    comfyui = get_comfyui_client()
    comfyui_connected = await comfyui.check_connection()
    gemini_available = False
    try:
        gemini_client = GoogleAIClient()
        gemini_available = gemini_client.is_available()
    except Exception as e:
        logger.warning("[API] Gemini not available: %s", e)
        gemini_available = False

    logger.info("[API] status: comfyui_connected=%s, gemini_available=%s", comfyui_connected, gemini_available)
    return {
        "success": True,
        "comfyui_connected": comfyui_connected,
        "gemini_available": gemini_available,
    }


@router.get("/api/styles")
async def api_styles():
    """获取所有可用风格列表"""
    return {"success": True, "styles": style_config.get_all_styles()}


@router.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """上传图片到临时目录，返回可访问的 URL"""
    logger.info("[API] /api/upload-image called, filename=%s", file.filename)
    try:
        upload_dir = OUTPUT_DIR / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)

        ext = (file.filename or "png").rsplit(".", 1)[-1].lower()
        ext = ext if ext in ("png", "jpg", "jpeg", "webp") else "png"
        filename = f"upload_{uuid.uuid4().hex[:8]}.{ext}"
        save_path = upload_dir / filename

        with save_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        relative_path = save_path.relative_to(PROJECT_FILE_PATH)
        url = f"/static/projects/{relative_path.as_posix()}"
        logger.info("[API] Image uploaded to %s", save_path)
        return {
            "success": True,
            "filename": filename,
            "url": url,
        }
    except Exception as e:
        logger.error("[API] Upload failed: %s", e)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.post("/api/text-to-image")
async def text_to_image(request: TextToImageRequest):
    """
    文生图
    - comfyui-qwen-image: 调用 ComfyUI Qwen_Image_2512 工作流
    - gemini-2.5-flash-image: 调用 Google AI Studio Gemini
    """
    logger.info("[API] /api/text-to-image called, model=%s, style=%s, width=%d, height=%d",
                request.model, request.style, request.width, request.height)
    if not request.prompt.strip():
        logger.warning("[API] text-to-image prompt is empty")
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    full_prompt = _apply_style(request.prompt, request.style)
    task_folder = OUTPUT_DIR / "text_to_image"
    logger.info("[API] text-to-image prompt after style: %s", full_prompt[:200])

    if request.model.startswith("comfyui"):
        comfyui = get_comfyui_client()
        if not await comfyui.check_connection():
            logger.error("[API] ComfyUI not running")
            raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

        try:
            if request.model == "comfyui-flux2":
                result = await comfyui.generate_flux_t2i_and_wait(
                    prompt=full_prompt,
                    width=request.width,
                    height=request.height,
                    steps=request.steps or 20,
                    guidance=request.cfg if request.cfg is not None else 3.5,
                    seed=request.seed,
                    timeout=600,
                )
            elif request.model.startswith("comfyui-qwen"):
                # 现有的 Qwen 逻辑
                result = await comfyui.generate_concept_image_and_wait(
                    prompt=full_prompt,
                    width=request.width,
                    height=request.height,
                    steps=request.steps,
                    cfg=request.cfg,
                    seed=request.seed,
                )
            else:
                logger.warning("[API] Unsupported ComfyUI model: %s", request.model)
                raise HTTPException(status_code=400, detail=f"不支持的 ComfyUI 模型: {request.model}")

            images = result.get("images", [])
            if not images:
                logger.error("[API] ComfyUI returned no images")
                raise HTTPException(status_code=500, detail="ComfyUI 未返回任何图片")

            img = images[0]
            comfyui_url = comfyui.get_image_url(
                img["filename"], img.get("subfolder", ""), img.get("type", "output")
            )
            saved = _save_comfyui_image(comfyui_url, task_folder, "txt2img")
            logger.info("[API] text-to-image success, saved=%s", saved["local_path"])
            return {
                "success": True,
                "model": request.model,
                "images": [saved],
            }
        except TimeoutError as e:
            logger.error("[API] text-to-image timeout: %s", e)
            raise HTTPException(status_code=504, detail=str(e))
        except Exception as e:
            logger.error("[API] text-to-image failed: %s", e)
            raise HTTPException(status_code=500, detail=f"图片生成失败: {str(e)}")

    elif request.model.startswith("gemini") or request.model.startswith("imagen"):
        try:
            client = GoogleAIClient()
        except ValueError as e:
            logger.error("[API] Gemini client init failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

        try:
            aspect_ratio = _compute_aspect_ratio(request.width, request.height)
            result = await client.generate_and_save(
                prompt=full_prompt,
                model=request.model,
                save_dir=task_folder,
                aspect_ratio=aspect_ratio,
            )
            relative_path = result["local_path"].relative_to(PROJECT_FILE_PATH)
            logger.info("[API] Gemini text-to-image success, saved=%s", result["local_path"])
            return {
                "success": True,
                "model": request.model,
                "images": [
                    {
                        "filename": result["filename"],
                        "local_path": str(result["local_path"]),
                        "url": f"/static/projects/{relative_path.as_posix()}",
                    }
                ],
            }
        except Exception as e:
            logger.error("[API] Gemini text-to-image failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Gemini 图片生成失败: {str(e)}")

    else:
        logger.warning("[API] Unsupported model: %s", request.model)
        raise HTTPException(status_code=400, detail=f"不支持的模型: {request.model}")


@router.post("/api/image-to-image")
async def image_to_image(request: ImageToImageRequest):
    """
    图生图
    - comfyui-qwen-image-edit: 使用 ComfyUI QwenImage Edit 工作流（单图编辑）
    - gemini-2.5-flash-image: 使用 Gemini 多图输入生成合成图
    """
    logger.info("[API] /api/image-to-image called, model=%s, num_images=%d", request.model, len(request.images))
    if not request.prompt.strip():
        logger.warning("[API] image-to-image prompt is empty")
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    if not request.images:
        logger.warning("[API] image-to-image no reference images")
        raise HTTPException(status_code=400, detail="至少需要一张参考图片")

    task_folder = OUTPUT_DIR / "image_to_image"

    if request.model.startswith("comfyui"):
        comfyui = get_comfyui_client()
        if not await comfyui.check_connection():
            logger.error("[API] ComfyUI not running")
            raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

        # QwenImage 单图编辑仍用 first_image；Flux Kontext 支持多图
        first_image = request.images[0]
        full_source_url = _to_full_url(first_image.url)
        source_image_urls = [_to_full_url(img.url) for img in request.images if img.url]
        logger.info("[API] image-to-image using ComfyUI, model=%s, num_images=%d", request.model, len(source_image_urls))

        try:
            if request.model == "comfyui-flux-kontext":
                # 应用风格到 prompt
                full_prompt = _apply_style(request.prompt, request.style)
                result = await comfyui.generate_flux_kontext_i2i_and_wait(
                    source_image_urls=source_image_urls,
                    edit_prompt=full_prompt,
                    negative_prompt=request.negative_prompt,
                    steps=20,
                    guidance=4.0,
                    seed=-1,
                    width=request.width,
                    height=request.height,
                    timeout=600,
                )
            elif request.model.startswith("comfyui-qwen"):
                # 现有 QwenImage Edit 逻辑
                result = await comfyui.generate_character_variant_and_wait(
                    source_image_url=full_source_url,
                    variant_prompt=request.prompt,
                    negative_prompt=request.negative_prompt,
                    timeout=300,
                )
            else:
                logger.warning("[API] Unsupported ComfyUI model: %s", request.model)
                raise HTTPException(status_code=400, detail=f"不支持的 ComfyUI 模型: {request.model}")

            images = result.get("images", [])
            if not images:
                logger.error("[API] ComfyUI returned no images for img2img")
                raise HTTPException(status_code=500, detail="ComfyUI 未返回任何图片")

            img = images[0]
            comfyui_url = comfyui.get_image_url(
                img["filename"], img.get("subfolder", ""), img.get("type", "output")
            )
            saved = _save_comfyui_image(comfyui_url, task_folder, "img2img")
            logger.info("[API] image-to-image success, saved=%s", saved["local_path"])
            return {
                "success": True,
                "model": request.model,
                "images": [saved],
            }
        except TimeoutError as e:
            logger.error("[API] image-to-image timeout: %s", e)
            raise HTTPException(status_code=504, detail=str(e))
        except Exception as e:
            logger.error("[API] image-to-image failed: %s", e)
            raise HTTPException(status_code=500, detail=f"图生图生成失败: {str(e)}")

    elif request.model.startswith("gemini") or request.model.startswith("imagen"):
        try:
            client = GoogleAIClient()
        except ValueError as e:
            logger.error("[API] Gemini client init failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

        try:
            loaded_images = []
            for idx, img in enumerate(request.images):
                data, mime, _ = _resolve_image_data(_to_full_url(img.url))
                loaded_images.append({
                    "data": data,
                    "mime_type": mime,
                    "description": img.description,
                })
                logger.info("[API] image-to-image loaded reference image %d, mime=%s", idx + 1, mime)

            aspect_ratio = _compute_aspect_ratio(request.width, request.height)
            result = await client.generate_with_images_and_save(
                overall_prompt=request.prompt,
                image_descriptions=loaded_images,
                model=request.model,
                save_dir=task_folder,
                aspect_ratio=aspect_ratio,
            )
            relative_path = result["local_path"].relative_to(PROJECT_FILE_PATH)
            logger.info("[API] Gemini image-to-image success, saved=%s", result["local_path"])
            return {
                "success": True,
                "model": request.model,
                "images": [
                    {
                        "filename": result["filename"],
                        "local_path": str(result["local_path"]),
                        "url": f"/static/projects/{relative_path.as_posix()}",
                    }
                ],
            }
        except Exception as e:
            logger.error("[API] Gemini image-to-image failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Gemini 图生图生成失败: {str(e)}")

    else:
        logger.warning("[API] Unsupported model: %s", request.model)
        raise HTTPException(status_code=400, detail=f"不支持的模型: {request.model}")


@router.post("/api/image-to-video")
async def image_to_video(request: ImageToVideoRequest):
    """
    图生视频
    - comfyui-ltx: 调用 ComfyUI LTX 2.3 工作流（首帧图生视频）
    - comfyui-minimax: 调用 ComfyUI MiniMax H3 Ref2VA 工作流（多图参考生视频）
    """
    logger.info("[API] /api/image-to-video called, model=%s, fps=%s, duration=%s, has_dialogue=%s",
                request.model, request.fps, request.duration, bool(request.dialogue))
    if not request.prompt.strip():
        logger.warning("[API] image-to-video prompt is empty")
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    if not request.model.startswith("comfyui"):
        logger.warning("[API] image-to-video unsupported model: %s", request.model)
        raise HTTPException(status_code=400, detail=f"不支持的模型: {request.model}")

    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        logger.error("[API] ComfyUI not running")
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    task_folder = OUTPUT_DIR / "image_to_video"

    try:
        if request.model == "comfyui-minimax":
            # MiniMax H3 Ref2VA 工作流
            ref_urls = [_to_full_url(u) for u in request.reference_images if u]
            if not ref_urls:
                raise HTTPException(status_code=400, detail="MiniMax 需要至少 1 张参考图片")
            if len(ref_urls) > 9:
                raise HTTPException(status_code=400, detail="MiniMax 最多支持 9 张参考图片")

            width = request.width or 1344
            height = request.height or 768
            duration = request.duration if request.duration > 0 else 8

            logger.info("[API] image-to-video MiniMax H3, images=%d, %dx%d, duration=%ss",
                        len(ref_urls), width, height, duration)

            result = await comfyui.generate_minimax_h3_video_and_wait(
                prompt=request.prompt,
                reference_image_urls=ref_urls,
                width=width,
                height=height,
                duration_seconds=duration,
                fps=request.fps,
                save_prefix=f"video/MiniMax_H3_{uuid.uuid4().hex[:8]}",
                timeout=7200,
            )
        else:
            # LTX 工作流
            if not request.first_frame_image:
                raise HTTPException(status_code=400, detail="LTX 需要首帧图片")
            first_frame_url = _to_full_url(request.first_frame_image)
            logger.info("[API] image-to-video LTX first_frame=%s", first_frame_url)

            result = await comfyui.generate_ltx_video_and_wait(
                first_frame_image_url=first_frame_url,
                video_prompt=request.prompt,
                dialogue=request.dialogue,
                voice_instruct=request.voice_instruct,
                save_prefix=f"video/LTX_{uuid.uuid4().hex[:8]}",
                fps=request.fps,
                duration_seconds=request.duration,
                timeout=1200,
            )

        videos = result.get("videos", [])
        if not videos:
            logger.error("[API] ComfyUI returned no videos")
            raise HTTPException(status_code=500, detail="ComfyUI 未返回任何视频")

        first_video = videos[0]
        local_path = first_video.get("_local_path")

        task_folder.mkdir(parents=True, exist_ok=True)
        ext = ".mp4"
        filename = f"img2video_{uuid.uuid4().hex[:8]}{ext}"
        des_path = task_folder / filename

        if local_path and Path(local_path).exists():
            logger.info("[API] image-to-video copying from disk: %s -> %s", local_path, des_path)
            shutil.copy2(local_path, des_path)
        else:
            comfyui_video_url = comfyui.get_video_url(
                first_video["filename"],
                first_video.get("subfolder", ""),
                first_video.get("type", "output"),
            )
            logger.info("[API] image-to-video downloading from ComfyUI: %s", comfyui_video_url)
            resp = requests.get(comfyui_video_url, timeout=120)
            resp.raise_for_status()
            des_path.write_bytes(resp.content)

        relative_path = des_path.relative_to(PROJECT_FILE_PATH)
        logger.info("[API] image-to-video success, saved=%s", des_path)
        return {
            "success": True,
            "model": request.model,
            "videos": [
                {
                    "filename": filename,
                    "local_path": str(des_path),
                    "url": f"/static/projects/{relative_path.as_posix()}",
                }
            ],
        }

    except TimeoutError as e:
        logger.error("[API] image-to-video timeout: %s", e)
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] image-to-video failed: %s", e)
        raise HTTPException(status_code=500, detail=f"视频生成失败: {str(e)}")


# ============ Gemini 图像修复 (Inpainting) ============

def _decode_data_url(data_url: str):
    """解析 data URL，返回 (bytes, mime_type)"""
    import base64
    if data_url.startswith("data:"):
        # data:image/png;base64,xxxx
        header, b64data = data_url.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        return base64.b64decode(b64data), mime
    raise ValueError("Not a data URL")


@router.post("/api/gemini-inpaint")
async def gemini_inpaint(request: InpaintRequest):
    """Gemini 图像修复：base image + mask + prompt → new image"""
    logger.info("[API] /api/gemini-inpaint called, model=%s", request.model)

    try:
        client = GoogleAIClient()
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        # 解析 base image
        if request.base_image.startswith("data:"):
            base_data, base_mime = _decode_data_url(request.base_image)
        else:
            base_data, base_mime, _ = _resolve_image_data(_to_full_url(request.base_image))

        # 解析 mask image
        if request.mask_image.startswith("data:"):
            mask_data, _ = _decode_data_url(request.mask_image)
        else:
            mask_data, _, _ = _resolve_image_data(_to_full_url(request.mask_image))

        task_folder = OUTPUT_DIR / "inpaint"
        result = await client.generate_inpaint_and_save(
            prompt=request.prompt,
            base_image_data=base_data,
            base_image_mime=base_mime,
            mask_image_data=mask_data,
            model=request.model,
            save_dir=task_folder,
            aspect_ratio=request.aspect_ratio,
        )
        relative_path = result["local_path"].relative_to(PROJECT_FILE_PATH)
        logger.info("[API] gemini-inpaint success, saved=%s", result["local_path"])
        return {
            "success": True,
            "model": request.model,
            "images": [
                {
                    "filename": result["filename"],
                    "local_path": str(result["local_path"]),
                    "url": f"/static/projects/{relative_path.as_posix()}",
                }
            ],
        }
    except Exception as e:
        logger.error("[API] gemini-inpaint failed: %s", e)
        raise HTTPException(status_code=500, detail=f"图像修复失败: {str(e)}")


# ============ Gemini 图生提示词 (Image-to-Prompt) ============

@router.post("/api/gemini-image-to-prompt")
async def gemini_image_to_prompt(request: ImageToPromptRequest):
    """Gemini 图生提示词：分析图片，提取结构化风格信息"""
    logger.info("[API] /api/gemini-image-to-prompt called, model=%s", request.model)

    try:
        client = GoogleAIClient()
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        if request.image.startswith("data:"):
            img_data, img_mime = _decode_data_url(request.image)
        else:
            img_data, img_mime, _ = _resolve_image_data(_to_full_url(request.image))

        result = await client.image_to_prompt(
            image_data=img_data,
            image_mime=img_mime,
            model=request.model,
        )
        logger.info("[API] gemini-image-to-prompt success")
        return {
            "success": True,
            "data": result,
        }
    except Exception as e:
        logger.error("[API] gemini-image-to-prompt failed: %s", e)
        raise HTTPException(status_code=500, detail=f"图片分析失败: {str(e)}")


# ============ 场景图 HDR 生成 (Scene HDR) ============

@router.post("/api/scene-hdr")
async def scene_hdr(request: SceneHDRRequest):
    """
    场景图 HDR 生成：
    1. 用本地 qwen3-vl:8b 多模态 LLM 分析场景图
    2. LLM 生成"去人物 + 2×2 网格 4 角度"的提示词
    3. 根据所选模型（QwenImage Edit / Flux.2 Klein 9B）生成 2×2 网格图
    """
    logger.info("[API] /api/scene-hdr called")

    # 1. 解析场景图本地路径
    raw_url = request.image.split("?")[0]
    if "/static/projects/" not in raw_url:
        raise HTTPException(status_code=400, detail="请上传场景图（仅支持本地上传的图片）")

    relative = raw_url.split("/static/projects/", 1)[1]
    scene_image_path = Path(PROJECT_FILE_PATH) / relative
    if not scene_image_path.exists():
        raise HTTPException(status_code=404, detail=f"场景图文件不存在: {scene_image_path}")

    logger.info("[API] scene-hdr: 场景图路径=%s", scene_image_path)

    # 2. 用 LLM 分析场景图并生成提示词
    llm_service = LLMVisionService()
    if not llm_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="LLM 视觉模型未就绪。请确认 Ollama 已运行并下载模型：ollama pull qwen3-vl:8b"
        )

    try:
        logger.info("[API] scene-hdr: 正在用 LLM 分析场景图...")
        hdr_prompt = await llm_service.analyze_scene_for_hdr(
            image_path=str(scene_image_path),
            custom_instruction=request.custom_instruction,
        )
        logger.info("[API] scene-hdr: LLM 生成提示词: %s...", hdr_prompt[:200])
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"依赖缺失: {e}")
    except Exception as e:
        logger.error("[API] scene-hdr: LLM 分析失败: %s", e)
        raise HTTPException(status_code=500, detail=f"场景图分析失败: {str(e)}")

    # 3. 根据所选模型生成 2×2 网格图
    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    task_folder = OUTPUT_DIR / "scene_hdr"
    source_image_url = _to_full_url(request.image)

    try:
        if request.model == "flux2-klein":
            logger.info("[API] scene-hdr: 调用 Flux.2 Klein 9B 图生图生成...")
            result = await comfyui.generate_flux2_scene_hdr_and_wait(
                source_image_url=source_image_url,
                edit_prompt=hdr_prompt,
                negative_prompt=request.negative_prompt,
                timeout=600,
            )
            result_model = "flux2-klein-9b"
        else:
            logger.info("[API] scene-hdr: 调用 QwenImage Edit 生成 2×2 网格图...")
            result = await comfyui.generate_character_variant_and_wait(
                source_image_url=source_image_url,
                variant_prompt=hdr_prompt,
                negative_prompt=request.negative_prompt,
                timeout=600,
            )
            result_model = "qwen-image-edit-hdr"

        images = result.get("images", [])
        if not images:
            raise HTTPException(status_code=500, detail="ComfyUI 未返回任何图片")

        img = images[0]
        comfyui_url = comfyui.get_image_url(
            img["filename"], img.get("subfolder", ""), img.get("type", "output")
        )
        saved = _save_comfyui_image(comfyui_url, task_folder, "scene_hdr")
        logger.info("[API] scene-hdr: 生成成功, saved=%s", saved["local_path"])

        return {
            "success": True,
            "model": result_model,
            "images": [saved],
            "llm_prompt": hdr_prompt,
        }
    except TimeoutError as e:
        logger.error("[API] scene-hdr: 生成超时: %s", e)
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] scene-hdr: 生成失败: %s", e)
        raise HTTPException(status_code=500, detail=f"场景图 HDR 生成失败: {str(e)}")


# ============ 上传文件清理 ============

import re as _re

# /static/projects/<相对路径> 的引用前缀
_STATIC_PREFIX = "/static/projects/"

# 存放引用 uploads 文件的 JSON 目录（画布项目 + 镜头表）
_REF_JSON_DIRS = [
    Path(PROJECT_FILE_PATH) / "_temp" / "projects",
    Path(PROJECT_FILE_PATH) / "_temp" / "shotbreakdown",
]


def _collect_referenced_rel_paths() -> set:
    """扫描所有画布项目/镜头表 JSON，收集被引用的文件相对路径（相对 PROJECT_FILE_PATH）。

    匹配 JSON 文本里所有 /static/projects/xxx 形式的字符串，提取 xxx 部分。
    """
    referenced = set()
    for d in _REF_JSON_DIRS:
        if not d.exists():
            continue
        for json_path in d.glob("*.json"):
            try:
                text = json_path.read_text(encoding="utf-8")
            except Exception:
                continue
            for m in _re.finditer(r"/static/projects/([^\s\"',\]\}]+)", text):
                referenced.add(m.group(1))
    return referenced


@router.post("/api/uploads/cleanup")
async def cleanup_uploads():
    """清理 uploads 目录中未被任何画布项目/镜头表引用的孤立文件。

    只清理 generator_outputs/uploads/ 子目录，不影响生成结果目录。
    返回删除的文件数和释放的空间。
    """
    upload_dir = OUTPUT_DIR / "uploads"
    if not upload_dir.exists():
        return {"success": True, "deleted": 0, "freed_bytes": 0, "message": "uploads 目录不存在"}

    referenced = _collect_referenced_rel_paths()
    deleted_files = []
    freed_bytes = 0

    for f in upload_dir.iterdir():
        if not f.is_file():
            continue
        try:
            rel = f.relative_to(PROJECT_FILE_PATH).as_posix()
        except ValueError:
            continue
        # 不在引用集合中 => 孤立文件，删除
        if rel not in referenced:
            try:
                size = f.stat().st_size
                f.unlink()
                deleted_files.append(f.name)
                freed_bytes += size
            except Exception as e:
                logger.warning("[Cleanup] 删除失败 %s: %s", f, e)

    logger.info("[Cleanup] uploads 清理完成: 删除 %d 个文件, 释放 %.2f KB",
                len(deleted_files), freed_bytes / 1024)
    return {
        "success": True,
        "deleted": len(deleted_files),
        "freed_bytes": freed_bytes,
        "freed_kb": round(freed_bytes / 1024, 2),
        "deleted_files": deleted_files[:50],  # 最多返回前 50 个文件名
    }


@router.get("/api/uploads/orphans")
async def list_orphans():
    """列出 uploads 目录中未被引用的孤立文件（不删除，仅预览）。"""
    upload_dir = OUTPUT_DIR / "uploads"
    if not upload_dir.exists():
        return {"success": True, "orphans": [], "total_size_bytes": 0}

    referenced = _collect_referenced_rel_paths()
    orphans = []
    total_size = 0

    for f in upload_dir.iterdir():
        if not f.is_file():
            continue
        try:
            rel = f.relative_to(PROJECT_FILE_PATH).as_posix()
        except ValueError:
            continue
        if rel not in referenced:
            try:
                size = f.stat().st_size
                orphans.append({
                    "filename": f.name,
                    "size_bytes": size,
                    "size_kb": round(size / 1024, 2),
                })
                total_size += size
            except Exception:
                pass

    return {
        "success": True,
        "orphans": orphans,
        "count": len(orphans),
        "total_size_bytes": total_size,
        "total_size_kb": round(total_size / 1024, 2),
    }
