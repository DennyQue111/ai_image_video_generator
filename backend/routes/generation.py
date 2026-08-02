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
    first_frame_image: str = Field(..., description="首帧图片 URL")
    model: str = "comfyui-ltx"
    dialogue: str = ""
    voice_instruct: str = ""
    duration: float = 0
    fps: int = 24


# ============ 辅助函数 ============

def _to_full_url(url: str) -> str:
    """将 /static/projects/... 相对路径转为后端可访问的完整 URL"""
    if url and url.startswith("/static/"):
        full = f"http://localhost:8001{url}"
        logger.info("[API] Resolved relative URL: %s -> %s", url, full)
        return full
    return url


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
    if raw_url.startswith("/static/projects/"):
        relative = raw_url.replace("/static/projects/", "", 1)
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
            result = await comfyui.generate_concept_image_and_wait(
                prompt=full_prompt,
                width=request.width,
                height=request.height,
                steps=request.steps,
                cfg=request.cfg,
                seed=request.seed,
            )
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

    elif request.model.startswith("gemini"):
        try:
            client = GoogleAIClient()
        except ValueError as e:
            logger.error("[API] Gemini client init failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

        try:
            result = await client.generate_and_save(
                prompt=full_prompt,
                model=request.model,
                save_dir=task_folder,
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

        # 当前先支持单图编辑；多图 QwenImage 链式合成可后续扩展
        first_image = request.images[0]
        full_source_url = _to_full_url(first_image.url)
        logger.info("[API] image-to-image using ComfyUI, source_url=%s", full_source_url)

        try:
            result = await comfyui.generate_character_variant_and_wait(
                source_image_url=full_source_url,
                variant_prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                timeout=300,
            )
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

    elif request.model.startswith("gemini"):
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

            result = await client.generate_with_images_and_save(
                overall_prompt=request.prompt,
                image_descriptions=loaded_images,
                model=request.model,
                save_dir=task_folder,
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
    - comfyui-ltx: 调用 ComfyUI LTX 2.3 工作流
    """
    logger.info("[API] /api/image-to-video called, model=%s, fps=%s, duration=%s, has_dialogue=%s",
                request.model, request.fps, request.duration, bool(request.dialogue))
    if not request.prompt.strip():
        logger.warning("[API] image-to-video prompt is empty")
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    if not request.first_frame_image:
        logger.warning("[API] image-to-video first frame is empty")
        raise HTTPException(status_code=400, detail="首帧图片 URL 不能为空")

    if not request.model.startswith("comfyui"):
        logger.warning("[API] image-to-video unsupported model: %s", request.model)
        raise HTTPException(status_code=400, detail=f"不支持的模型: {request.model}")

    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        logger.error("[API] ComfyUI not running")
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    first_frame_url = _to_full_url(request.first_frame_image)
    task_folder = OUTPUT_DIR / "image_to_video"
    logger.info("[API] image-to-video first_frame=%s", first_frame_url)

    try:
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
