"""生成提示词和镜头参考分析 API。"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from constants import resolve_cache_path
from routes.shot_breakdown import get_project_shot
from services.face_detection import locate_chin_y
from services.llm_vision_service import LLMVisionService

logger = logging.getLogger(__name__)
router = APIRouter()


class VideoPromptRequest(BaseModel):
    image: str = Field(..., description="参考图片 URL（/static/projects/... 形式）")
    instruction: str = Field("", description="用户对视频的基本要求")


class ShotVideoPromptRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    shot_id: str = Field(..., min_length=1)
    reference_images: list[str] = Field(default_factory=list, description="图片1人物概念图，图片2镜头参考帧")


class ModelViewPromptRequest(BaseModel):
    image: str = Field(..., description="参考图片 URL")
    instruction: str = Field("", description="用户对模型三视图的要求")


class ConceptHeadCropRequest(BaseModel):
    image: str = Field(..., description="单角色正面全身图 URL")


@router.post("/api/generate-video-prompt")
async def generate_video_prompt(request: VideoPromptRequest):
    """用 Qwen3-VL 8B 分析参考图片 + 用户需求，生成 MiniMax H3 视频提示词"""
    logger.info("[API] /api/generate-video-prompt called, instruction=%s", request.instruction[:100])

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
        logger.info("[API] generate-video-prompt: 正在用 LLM 生成视频提示词...")
        prompt = await llm_service.generate_video_prompt(
            image_path=str(image_path),
            user_instruction=request.instruction,
        )
        logger.info("[API] generate-video-prompt: 生成完成: %s...", prompt[:200])
        return {"success": True, "prompt": prompt}
    except Exception as e:
        logger.error("[API] generate-video-prompt: 失败: %s", e)
        raise HTTPException(status_code=500, detail=f"视频提示词生成失败: {str(e)}")


@router.post("/api/shot-video-prompt")
async def generate_shot_video_prompt(request: ShotVideoPromptRequest):
    """读取 project_id + shot_id 的镜头资料，连同两张指定参考图生成 MiniMax 提示词。"""
    if len(request.reference_images) != 2:
        raise HTTPException(status_code=400, detail="镜头表生成需要恰好两张图片：人物概念图和镜头参考帧")
    image_paths = []
    for url in request.reference_images:
        raw_url = url.split("?")[0]
        if not raw_url.startswith("/static/projects/"):
            raise HTTPException(status_code=400, detail="参考图必须是当前项目中的本地图片")
        path = resolve_cache_path(raw_url.removeprefix("/static/projects/"))
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"参考图不存在: {path.name}")
        image_paths.append(str(path))

    data, shot, concepts = get_project_shot(request.project_id, request.shot_id)
    character_ids = set(shot.get("characters") or [])
    location_id = shot.get("location")
    prompt_shot = {**shot, "concept_context": {
        "characters": [{key: item.get(key, "") for key in ("id", "name", "description", "environment")}
                       for item in concepts.get("characters", []) if item.get("id") in character_ids],
        "location": next(({key: item.get(key, "") for key in ("id", "name", "environment", "description")}
                          for item in concepts.get("locations", []) if item.get("id") == location_id), {}),
    }}
    llm_service = LLMVisionService()
    if not llm_service.is_available():
        raise HTTPException(status_code=503, detail="LLM 视觉模型未就绪，请启动 Ollama 并确认 qwen3-vl:8b 已下载")
    try:
        result = await llm_service.generate_shot_video_prompt(
            image_paths=image_paths, shot=prompt_shot, project_name=data.get("project_name", data.get("name", ""))
        )
        return {"success": True, **result, "shot_no": shot.get("shot_no", shot.get("id", ""))}
    except Exception as exc:
        logger.error("[API] shot-video-prompt failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"镜头表视频提示词生成失败: {exc}") from exc


@router.post("/api/model-view-prompt")
async def model_view_prompt(request: ModelViewPromptRequest):
    """用 Qwen3-VL 根据图片和用户要求生成三视图正视图 Flux 提示词。"""
    raw_url = request.image.split("?")[0]
    if "/static/projects/" not in raw_url:
        raise HTTPException(status_code=400, detail="请上传图片（仅支持本地上传的图片）")
    relative = raw_url.split("/static/projects/", 1)[1]
    image_path = resolve_cache_path(relative)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片文件不存在: {image_path}")
    llm_service = LLMVisionService()
    if not llm_service.is_available():
        raise HTTPException(status_code=503, detail="Qwen3-VL 未就绪，请确认 Ollama 已运行并下载模型：ollama pull qwen3-vl:8b")
    try:
        prompt = await llm_service.generate_model_view_prompt(str(image_path), request.instruction)
        return {"success": True, "prompt": prompt}
    except Exception as e:
        logger.error("[API] model-view-prompt failed: %s", e)
        raise HTTPException(status_code=500, detail=f"模型三视图提示词生成失败: {str(e)}")


@router.post("/api/concept-head-crop")
async def concept_head_crop(request: ConceptHeadCropRequest):
    """用本地人脸检测定位正面全身图的下巴，为前端无头身体裁切提供默认位置。"""
    raw_url = request.image.split("?")[0]
    if "/static/projects/" not in raw_url:
        raise HTTPException(status_code=400, detail="仅支持应用内已保存的图片")
    relative = raw_url.split("/static/projects/", 1)[1]
    image_path = resolve_cache_path(relative)
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片文件不存在: {image_path}")
    try:
        import asyncio
        chin_y = await asyncio.to_thread(locate_chin_y, str(image_path))
        return {"success": True, "chin_y": chin_y, "method": "opencv_haar"}
    except Exception as exc:
        logger.error("[API] concept-head-crop face detection failed: %s", exc)
        raise HTTPException(status_code=422, detail=f"本地人脸检测未能定位人脸: {exc}") from exc
