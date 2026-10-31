"""图像处理 API：超分、修补、提示词分析、细化与场景 HDR。"""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH, resolve_cache_path
from services.comfyui_client import get_comfyui_client
from services.generation_assets import _resolve_image_data, _save_comfyui_image, _to_full_url
from services.google_ai_client import GoogleAIClient
from services.llm_vision_service import LLMVisionService

logger = logging.getLogger(__name__)
router = APIRouter()
OUTPUT_DIR = Path(PROJECT_FILE_PATH) / "generation" / "exports"


class InpaintRequest(BaseModel):
    prompt: str
    model: str = "gemini-2.5-flash-image"
    base_image: str = Field(..., description="原图 URL 或 data URL")
    mask_image: str = Field(..., description="遮罩图 data URL（白色=需修复区域）")
    aspect_ratio: str = "1:1"


class ComfyInpaintRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    base_image: str = Field(..., description="原图 URL")
    mask_image: str = Field(..., description="黑底白色蒙版 data URL；白色区域会被重绘")
    model: str = "comfyui-flux2-inpaint"
    width: int = Field(1024, ge=256, le=2048)
    height: int = Field(1024, ge=256, le=2048)
    grow_mask_by: int = Field(8, ge=0, le=64)


class ImageToPromptRequest(BaseModel):
    image: str = Field(..., description="图片 URL 或 data URL")
    model: str = "gemini-2.5-flash"


class SceneHDRRequest(BaseModel):
    image: str = Field(..., description="场景图 URL")
    negative_prompt: str = "people, person, human, character"
    custom_instruction: str = ""
    model: str = "qwen-image-edit"  # qwen-image-edit | flux2-klein | flux3-klein


def _decode_data_url(data_url: str):
    """解析 data URL，返回 (bytes, mime_type)"""
    import base64
    if data_url.startswith("data:"):
        # data:image/png;base64,xxxx
        header, b64data = data_url.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        return base64.b64decode(b64data), mime
    raise ValueError("Not a data URL")


class UpscaleImageRequest(BaseModel):
    image_url: str = Field(..., description="待放大的图片 URL（/static/projects/... 形式）")
    ratio: int = Field(default=2, ge=2, le=4, description="放大倍数 2-4")
    model: str = Field(default="comfyui-seedvr2", description="放大模型")


def _read_image_size(data: bytes) -> tuple:
    """零依赖解析图片字节流，返回 (width, height)。

    支持 PNG / JPEG / WebP / GIF 常见格式。解析失败返回 (0, 0)。
    用于放大接口计算目标分辨率（短边 × 倍数），避免引入 Pillow 依赖。
    """
    import struct
    # PNG: 前 8 字节签名 \x89PNG，IHDR 在第 16-24 字节
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    # JPEG: 扫描 SOFx 标记段读取尺寸
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            # SOF0~SOF3, SOF5~SOF7, SOF9~SOF11, SOF13~SOF15（不含 SOF4/SOF8/SOF12）
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
            i += 2 + seg_len
        return 0, 0
    # WebP: RIFF....WEBP，VP8/VP8L/VP8X 段含尺寸
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if data[12:16] in (b"VP8 ", b"VP8L"):
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return w, h
        if data[12:16] == b"VP8X":
            w = struct.unpack("<I", data[24:27] + b"\x00")[0] + 1
            h = struct.unpack("<I", data[27:30] + b"\x00")[0] + 1
            return w, h
        return 0, 0
    # GIF: 6-10 字节为逻辑屏幕宽高（小端）
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h
    return 0, 0


@router.post("/api/upscale-image")
async def upscale_image(request: UpscaleImageRequest):
    """图片超清放大

    使用 ComfyUI SeedVR2 工作流对单张图片进行超清放大。
    根据原图短边 × 放大倍数计算目标分辨率（保持原宽高比）。
    """
    logger.info("[API] /api/upscale-image called, ratio=%s, model=%s", request.ratio, request.model)

    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        logger.error("[API] ComfyUI not running")
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    # 1. 解析源图 URL 并读取真实尺寸，计算目标分辨率（短边像素）
    full_url = _to_full_url(request.image_url)
    try:
        img_data, _, _ = _resolve_image_data(full_url)
    except Exception as e:
        logger.error("[API] upscale resolve image failed: %s", e)
        raise HTTPException(status_code=400, detail=f"无法读取源图: {e}")

    src_w, src_h = _read_image_size(img_data)
    if src_w == 0 or src_h == 0:
        # 尺寸解析失败时退回保守默认（短边 1080），避免阻断流程
        resolution = 1080
        logger.warning("[API] upscale image size parse failed, fallback resolution=%d", resolution)
    else:
        short_edge = min(src_w, src_h)
        resolution = short_edge * request.ratio
        # SeedVR2 要求偶数
        resolution = max(16, resolution - (resolution % 2))
        # 12GB 显存安全上限：目标短边不超过 1536。
        # 实测 1882 短边（3344x1882≈629万像素）导致系统崩溃，
        # 1536 短边对应约 422 万像素，配合 tiled VAE 在安全范围。
        capped = False
        if resolution > 1536:
            resolution = 1536
            capped = True
            logger.warning("[API] upscale resolution capped to 1536 (src=%dx%d, ratio=%d wanted %d)",
                           src_w, src_h, request.ratio, short_edge * request.ratio)
        logger.info("[API] upscale src=%dx%d, ratio=%d, target resolution=%d%s",
                    src_w, src_h, request.ratio, resolution, " (capped)" if capped else "")

    task_folder = OUTPUT_DIR / "upscale"
    try:
        result = await comfyui.generate_seedvr2_upscale_and_wait(
            source_image_url=full_url,
            resolution=resolution,
            seed=42,
            timeout=600,
        )
        images = result.get("images", [])
        if not images:
            logger.error("[API] SeedVR2 returned no images")
            raise HTTPException(status_code=500, detail="SeedVR2 未返回任何图片")

        img = images[0]
        comfyui_url = comfyui.get_image_url(
            img["filename"], img.get("subfolder", ""), img.get("type", "output")
        )
        saved = _save_comfyui_image(comfyui_url, task_folder, "upscale")
        logger.info("[API] upscale success, saved=%s", saved["local_path"])
        return {
            "success": True,
            "model": request.model,
            "images": [saved],
        }
    except TimeoutError as e:
        logger.error("[API] upscale timeout: %s", e)
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] upscale failed: %s", e)
        raise HTTPException(status_code=500, detail=f"放大失败: {str(e)}")


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


@router.post("/api/inpaint-image")
async def comfyui_inpaint(request: ComfyInpaintRequest):
    """使用 ComfyUI FLUX.2 或 FLUX.3 Klein 按前端蒙版局部重绘。"""
    if request.model not in {"comfyui-flux2-inpaint", "comfyui-flux3-inpaint"}:
        raise HTTPException(status_code=400, detail=f"暂不支持的修复模型: {request.model}")
    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    try:
        if request.mask_image.startswith("data:"):
            mask_data, _ = _decode_data_url(request.mask_image)
        else:
            mask_data, _, _ = _resolve_image_data(_to_full_url(request.mask_image))
        if request.model == "comfyui-flux3-inpaint":
            result = await comfyui.generate_flux3_inpaint_and_wait(
                source_image_url=_to_full_url(request.base_image),
                mask_image_data=mask_data,
                edit_prompt=request.prompt,
                width=max(16, round(request.width / 16) * 16),
                height=max(16, round(request.height / 16) * 16),
                grow_mask_by=request.grow_mask_by,
                timeout=900,
            )
        else:
            result = await comfyui.generate_flux2_inpaint_and_wait(
                source_image_url=_to_full_url(request.base_image),
                mask_image_data=mask_data,
                edit_prompt=request.prompt,
                width=request.width,
                height=request.height,
                grow_mask_by=request.grow_mask_by,
                timeout=600,
            )
        images = result.get("images", [])
        if not images:
            raise HTTPException(status_code=500, detail="ComfyUI 未返回修复图片")
        image = images[0]
        comfyui_url = comfyui.get_image_url(
            image["filename"], image.get("subfolder", ""), image.get("type", "output")
        )
        prefix = "flux3_inpaint" if request.model == "comfyui-flux3-inpaint" else "flux2_inpaint"
        saved = _save_comfyui_image(comfyui_url, OUTPUT_DIR / "inpaint", prefix)
        return {"success": True, "model": request.model, "images": [saved]}
    except HTTPException:
        raise
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] ComfyUI inpaint failed: %s", e)
        raise HTTPException(status_code=500, detail=f"{request.model} 局部重绘失败: {str(e)}")


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


class RefineAnalyzeRequest(BaseModel):
    image: str = Field(..., description="待细化的概念图 URL（/static/projects/... 形式）")


class RefineGenerateRequest(BaseModel):
    image: str = Field(..., description="源图 URL（/static/projects/... 形式）")
    prompt: str = Field(..., description="用户确认/编辑后的细化提示词")
    model: str = Field("flux-kontext", description="图生图工作流：flux-kontext 或 flux2-scene")
    width: int = Field(0, ge=0, le=4096)
    height: int = Field(0, ge=0, le=4096)


@router.post("/api/refine-analyze")
async def refine_analyze(request: RefineAnalyzeRequest):
    """第一步：用 Qwen3-VL 8B 分析概念图，返回细化提示词（不生图）"""
    logger.info("[API] /api/refine-analyze called")

    raw_url = request.image.split("?")[0]
    if "/static/projects/" not in raw_url:
        raise HTTPException(status_code=400, detail="请上传图片（仅支持本地上传的图片）")

    relative = raw_url.split("/static/projects/", 1)[1]
    image_path = resolve_cache_path(relative)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片文件不存在: {image_path}")

    llm_service = LLMVisionService()
    if not llm_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="LLM 视觉模型未就绪。请确认 Ollama 已运行并下载模型：ollama pull qwen3-vl:8b"
        )

    try:
        logger.info("[API] refine-analyze: 正在用 LLM 分析概念图...")
        refine_prompt = await llm_service.analyze_midjourney_refine(
            image_path=str(image_path),
        )
        logger.info("[API] refine-analyze: LLM 生成提示词: %s...", refine_prompt[:200])
        return {"success": True, "prompt": refine_prompt}
    except Exception as e:
        logger.error("[API] refine-analyze: LLM 分析失败: %s", e)
        raise HTTPException(status_code=500, detail=f"概念图分析失败: {str(e)}")


@router.post("/api/refine-generate")
async def refine_generate(request: RefineGenerateRequest):
    """第二步：用 Flux.2 Klein 9B 图生图，根据用户确认的提示词细化"""
    logger.info("[API] /api/refine-generate called, prompt=%s...", request.prompt[:100])

    # 读取原图尺寸（保持分辨率一致）
    raw_url = request.image.split("?")[0]
    img_data, _, _ = _resolve_image_data(raw_url)
    src_w, src_h = _read_image_size(img_data)
    if src_w == 0 or src_h == 0:
        src_w, src_h = 1024, 1024
        logger.warning("[API] refine-generate: 尺寸解析失败，回退到 1024x1024")
    if request.width and request.height:
        src_w, src_h = request.width, request.height
    src_w = max(16, src_w - (src_w % 16))
    src_h = max(16, src_h - (src_h % 16))
    logger.info("[API] refine-generate: 源图尺寸 %dx%d (对齐 16)", src_w, src_h)

    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    source_image_url = _to_full_url(request.image)
    task_folder = OUTPUT_DIR / "refine"

    try:
        logger.info("[API] refine-generate: workflow=%s prompt=%s", request.model, request.prompt[:500])
        if request.model == "flux-kontext":
            # 使用与图生图预设相同的 Flux.2 Kontext 参考图工作流，
            # 该工作流包含 FluxGuidance + ReferenceLatent，提示词对图像编辑更稳定。
            result = await comfyui.generate_flux_kontext_i2i_and_wait(
                source_image_urls=[source_image_url],
                edit_prompt=request.prompt,
                negative_prompt="",
                steps=20,
                cfg=1.0,
                guidance=4.0,
                seed=-1,
                width=src_w,
                height=src_h,
                timeout=600,
            )
        else:
            result = await comfyui.generate_flux2_scene_hdr_and_wait(
                source_image_url=source_image_url,
                edit_prompt=request.prompt,
                negative_prompt="",
                steps=8,
                cfg=4.0,
                seed=-1,
                width=src_w,
                height=src_h,
                denoise=0.4,
                timeout=600,
            )
        images = result.get("images", [])
        if not images:
            raise HTTPException(status_code=500, detail="ComfyUI 未返回任何图片")

        img = images[0]
        comfyui_url = comfyui.get_image_url(
            img["filename"], img.get("subfolder", ""), img.get("type", "output")
        )
        saved = _save_comfyui_image(comfyui_url, task_folder, "refine")
        logger.info("[API] refine-generate: 细化成功, saved=%s", saved["local_path"])
        return {"success": True, "model": "flux2-klein-refine", "images": [saved]}
    except TimeoutError as e:
        logger.error("[API] refine-generate: 超时: %s", e)
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] refine-generate: 失败: %s", e)
        raise HTTPException(status_code=500, detail=f"细化失败: {str(e)}")


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
    scene_image_path = resolve_cache_path(relative)
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
        elif request.model == "flux3-klein":
            logger.info("[API] scene-hdr: 调用 FLUX.3 Klein 图生图生成...")
            result = await comfyui.generate_flux3_i2i_and_wait(
                source_image_url=source_image_url,
                edit_prompt=hdr_prompt,
                width=1024,
                height=1024,
                steps=30,
                guidance=3.5,
                denoise=0.65,
                timeout=900,
            )
            result_model = "flux3-klein-base"
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
