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
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH, resolve_cache_path
from services.comfyui_client import get_comfyui_client
from services.google_ai_client import GoogleAIClient
from services.style_config import StyleConfig
from services.generation_assets import _resolve_image_data, _save_comfyui_image, _to_full_url

logger = logging.getLogger(__name__)
router = APIRouter()
style_config = StyleConfig()

OUTPUT_DIR = Path(PROJECT_FILE_PATH) / "generation" / "exports"
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

class CameraAngleRequest(BaseModel):
    image_url: str = Field(..., description="输入场景或主体图片 URL")
    yaw: float = Field(0, ge=-360, le=360, description="水平旋转角度")
    pitch: float = Field(0, ge=-90, le=90, description="垂直俯仰角度")
    distance: float = Field(1.0, ge=0.3, le=3.0, description="相机距离系数")
    width: int = Field(1024, ge=512, le=2048)
    height: int = Field(1024, ge=512, le=2048)

class ImageToVideoRequest(BaseModel):
    prompt: str = Field(..., description="视频画面描述（英文）")
    first_frame_image: str = Field("", description="首帧图片 URL（LTX 必填；MiniMax H3 可与普通参考图组合）")
    last_frame_image: str = Field("", description="尾帧图片 URL（MiniMax H3 可选；首尾帧锁定模式不与普通参考图组合）")
    reference_images: list = Field(default=[], description="参考图片 URL 列表（MiniMax H3 用，1-9 张）")
    model: str = "comfyui-ltx"
    dialogue: str = ""
    voice_instruct: str = ""
    duration: float = 0
    fps: int = 24
    width: int = 0
    height: int = 0
    workflow_type: str = "int8"  # MiniMax H3 默认完整 int8 版；显式传 pruned 才使用截肢版

class YoloSplitRequest(BaseModel):
    image: str = Field(..., description="待拆分图片 URL")
    classes: List[str] = Field(default_factory=lambda: ["person"], description="要提取的目标类别")
    confidence: float = Field(0.25, ge=0.05, le=0.95)

# ============ 辅助函数 ============

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

def _nearest(value: float, choices: list[float]) -> float:
    return min(choices, key=lambda option: abs(value - option))

def _build_multiangle_prompt(yaw: float, pitch: float, distance: float) -> tuple[str, dict]:
    """将自由相机参数映射为 Multiple-Angles LoRA 训练过的 96 个标准机位。"""
    azimuths = {
        0: "front view",
        45: "front-right quarter view",
        90: "right side view",
        135: "back-right quarter view",
        180: "back view",
        225: "back-left quarter view",
        270: "left side view",
        315: "front-left quarter view",
    }
    elevations = {-30: "low-angle shot", 0: "eye-level shot", 30: "elevated shot", 60: "high-angle shot"}
    distances = {0.6: "close-up", 1.0: "medium shot", 1.8: "wide shot"}

    snapped_yaw = int(_nearest(yaw % 360, list(azimuths)))
    snapped_pitch = int(_nearest(pitch, list(elevations)))
    snapped_distance = _nearest(distance, list(distances))
    prompt = f"<sks> {azimuths[snapped_yaw]} {elevations[snapped_pitch]} {distances[snapped_distance]}"
    return prompt, {
        "yaw": snapped_yaw,
        "pitch": snapped_pitch,
        "distance": snapped_distance,
        "label": f"{azimuths[snapped_yaw]} · {elevations[snapped_pitch]} · {distances[snapped_distance]}",
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

@router.post("/api/yolo-split")
async def yolo_split(request: YoloSplitRequest):
    """使用 YOLO 分割目标，并返回透明前景与透明背景两张图。"""
    try:
        from PIL import Image
        import numpy as np
        from ultralytics import YOLO
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="YOLO 尚未安装。请在 backend 环境执行：pip install ultralytics pillow",
        )

    try:
        data, _, _ = _resolve_image_data(_to_full_url(request.image))
        source = Image.open(__import__('io').BytesIO(data)).convert("RGBA")
        # 首次调用会自动下载轻量的 YOLOv8 分割权重 yolov8n-seg.pt。
        model = YOLO("yolov8n-seg.pt")
        result = model.predict(source=np.array(source.convert("RGB")), conf=request.confidence, verbose=False)[0]
        names = result.names
        wanted = {name.lower() for name in request.classes}
        mask = np.zeros((source.height, source.width), dtype=np.uint8)
        if result.masks is not None and result.boxes is not None:
            for idx, cls_id in enumerate(result.boxes.cls.tolist()):
                label = str(names[int(cls_id)]).lower()
                if label in wanted:
                    polygon = result.masks.data[idx].cpu().numpy()
                    polygon_img = Image.fromarray((polygon * 255).astype("uint8")).resize(source.size, Image.Resampling.NEAREST)
                    mask = np.maximum(mask, np.asarray(polygon_img))
        if not mask.any():
            raise HTTPException(status_code=422, detail="YOLO 没有检测到目标。可降低置信度或更换图片。")

        rgba = np.asarray(source).copy()
        foreground = rgba.copy()
        background = rgba.copy()
        foreground[:, :, 3] = mask
        background[:, :, 3] = 255 - mask
        task_folder = OUTPUT_DIR / "yolo_split"
        task_folder.mkdir(parents=True, exist_ok=True)
        result_items = []
        for label, pixels in (("foreground", foreground), ("background", background)):
            filename = f"yolo_{label}_{uuid.uuid4().hex[:8]}.png"
            path = task_folder / filename
            Image.fromarray(pixels, "RGBA").save(path, "PNG")
            relative = path.relative_to(PROJECT_FILE_PATH).as_posix()
            result_items.append({"filename": filename, "label": label, "local_path": str(path), "url": f"/static/projects/{relative}"})
        return {"success": True, "model": "yolov8n-seg", "images": result_items}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[API] YOLO split failed")
        raise HTTPException(status_code=500, detail=f"YOLO 拆分失败: {str(e)}")

@router.post("/api/text-to-image")
async def text_to_image(request: TextToImageRequest):
    """
    文生图
    - comfyui-qwen-image: 调用 ComfyUI Qwen_Image_2512 工作流
    - comfyui-z-image-turbo: 调用官方 Z-Image-Turbo 文生图工作流
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
            elif request.model == "comfyui-flux3":
                result = await comfyui.generate_flux3_t2i_and_wait(
                    prompt=full_prompt,
                    width=max(16, round(request.width / 16) * 16),
                    height=max(16, round(request.height / 16) * 16),
                    steps=request.steps or 50,
                    guidance=3.5,
                    seed=request.seed,
                    timeout=900,
                )
            elif request.model == "comfyui-z-image-turbo":
                result = await comfyui.generate_z_image_turbo_t2i_and_wait(
                    prompt=full_prompt,
                    width=request.width,
                    height=request.height,
                    steps=request.steps or 8,
                    cfg=request.cfg if request.cfg is not None else 1.0,
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
        if request.model == "comfyui-flux3" and len(source_image_urls) != 1:
            raise HTTPException(status_code=400, detail="FLUX.3 Klein 图生图目前仅支持一张参考图；多图融合请使用 FLUX.2 Klein")

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
            elif request.model == "comfyui-flux3":
                full_prompt = _apply_style(request.prompt, request.style)
                result = await comfyui.generate_flux3_i2i_and_wait(
                    source_image_url=full_source_url,
                    edit_prompt=full_prompt,
                    width=max(16, round(request.width / 16) * 16),
                    height=max(16, round(request.height / 16) * 16),
                    steps=30,
                    guidance=3.5,
                    denoise=0.65,
                    timeout=900,
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

@router.post("/api/camera-angle")
async def generate_camera_angle(request: CameraAngleRequest):
    """用 Qwen Image Edit 2511 Multiple-Angles LoRA 生成指定相机机位。"""
    comfyui = get_comfyui_client()
    if not await comfyui.check_connection():
        raise HTTPException(status_code=503, detail="ComfyUI 未运行，请先启动 ComfyUI")

    camera_prompt, snapped = _build_multiangle_prompt(request.yaw, request.pitch, request.distance)
    logger.info("[API] camera-angle requested=(%s,%s,%s), snapped=%s", request.yaw, request.pitch, request.distance, snapped)
    try:
        result = await comfyui.generate_qwen_multiangle_and_wait(
            source_image_url=_to_full_url(request.image_url),
            camera_prompt=camera_prompt,
            width=request.width,
            height=request.height,
            timeout=300,
        )
        images = result.get("images", [])
        if not images:
            raise HTTPException(status_code=500, detail="ComfyUI 未返回相机角度图片")
        image = images[0]
        comfyui_url = comfyui.get_image_url(
            image["filename"], image.get("subfolder", ""), image.get("type", "output")
        )
        saved = _save_comfyui_image(comfyui_url, OUTPUT_DIR / "camera_angle", "camera")
        return {"success": True, "images": [saved], "prompt": camera_prompt, "camera": snapped}
    except HTTPException:
        raise
    except TimeoutError as e:
        logger.error("[API] camera-angle timeout: %s", e)
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error("[API] camera-angle failed: %s", e)
        raise HTTPException(status_code=500, detail=f"相机角度生成失败: {str(e)}")

@router.post("/api/image-to-video")
async def image_to_video(request: ImageToVideoRequest):
    """
    图生视频
    - comfyui-ltx: 调用 ComfyUI LTX 2.3 工作流（首帧图生视频）
    - comfyui-minimax: 首帧+多参走 Ref2VA/AddGuide；首尾锁定单独走 FL2VA；纯多参走 Ref2VA
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
            # Use separate supported paths; native last-frame locking cannot be combined with refs.
            ref_urls = [_to_full_url(u) for u in request.reference_images if u]
            first_frame_url = _to_full_url(request.first_frame_image) if request.first_frame_image else ""
            last_frame_url = _to_full_url(request.last_frame_image) if request.last_frame_image else ""
            if last_frame_url and ref_urls:
                raise HTTPException(
                    status_code=400,
                    detail="首尾帧锁定与多参考图是两种独立模式；请清空参考图，或改用首帧+多参考图。",
                )
            if not ref_urls and not first_frame_url and not last_frame_url:
                raise HTTPException(status_code=400, detail="MiniMax 需要首帧、尾帧图片或至少 1 张参考图片")
            # AddGuide consumes a Picture slot only for first-frame + refs without a tail frame.
            # Native Hybrid keeps first/last anchors separate from its reference images.
            max_ref_urls = 8 if first_frame_url and ref_urls and not last_frame_url else 9
            if len(ref_urls) > max_ref_urls:
                raise HTTPException(
                    status_code=400,
                    detail=f"MiniMax 最多支持 9 张参考图；首帧会占用 1 个 Picture 槽位，因此提供首帧时人物/外观参考最多 {max_ref_urls} 张",
                )

            width = request.width or 1344
            height = request.height or 768
            duration = request.duration if request.duration > 0 else 8

            logger.info("[API] image-to-video MiniMax H3, refs=%d, first_frame=%s, %dx%d, duration=%ss",
                        len(ref_urls), bool(first_frame_url), width, height, duration)

            result = await comfyui.generate_minimax_h3_video_and_wait(
                prompt=request.prompt,
                reference_image_urls=ref_urls,
                first_frame_image_url=first_frame_url,
                last_frame_image_url=last_frame_url,
                width=width,
                height=height,
                duration_seconds=duration,
                fps=request.fps,
                save_prefix=f"video/MiniMax_H3_{uuid.uuid4().hex[:8]}",
                timeout=7200,
                workflow_type=request.workflow_type,
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

# ============ 打开文件所在文件夹 ============

# ============ Gemini 图像修复 (Inpainting) ============

# ============ 图片超清放大（SeedVR2） ============

# ============ Gemini 图生提示词 (Image-to-Prompt) ============

# ============ Midjourney 概念图细化 (Refine) ============

# ============ 视频提示词生成 (Video Prompt) ============

# ============ Midjourney 概念图细化路由 ============

# ============ 场景图 HDR 生成 (Scene HDR) ============

# ============ 上传文件清理 ============

# /static/projects/<相对路径> 的引用前缀

# 存放引用 uploads 文件的 JSON 目录（独立自由画布 + 镜头表内嵌画布 + concepts）
