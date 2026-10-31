"""剪辑台 API：导入素材、素材库、帧率读取与时间线导出。"""
import json
import logging
import shutil
import subprocess
import uuid
from fractions import Fraction
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH, resolve_cache_path

logger = logging.getLogger(__name__)
router = APIRouter()
EDITING_EXPORT_DIR = Path(PROJECT_FILE_PATH) / "editPanel" / "exports"
EDITING_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
EDITING_VIDEO_EXPORT_DIR = EDITING_EXPORT_DIR / "video"
EDITING_AUDIO_EXPORT_DIR = EDITING_EXPORT_DIR / "audio"
EDITING_VIDEO_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
EDITING_AUDIO_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
_EDITING_EXPORTS = {}


class EditingExportRequest(BaseModel):
    clips: list = Field(default_factory=list)
    video_clips: list = Field(default_factory=list)
    audio_clips: list = Field(default_factory=list)
    mode: str = "video"
    filename: str = "剪辑台导出"
    format: str = "mp4"
    resolution: str = "source"
    quality: str = "high"
    frame_rate: float = 24


def _run_editing_export(export_id: str, request_data: dict):
    state = _EDITING_EXPORTS[export_id]
    work_dir = EDITING_EXPORT_DIR / export_id
    work_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        state.update(status="error", error="未找到 FFmpeg，无法导出视频")
        return
    try:
        mode = request_data.get("mode")
        preferred = request_data.get("video_clips") if mode == "video" else request_data.get("audio_clips")
        raw_clips = preferred if preferred is not None else request_data.get("clips", [])
        clips = sorted(raw_clips, key=lambda item: float(item.get("timelineStart", 0)))
        if not clips:
            raise ValueError("时间线上没有可导出的片段")
        fps = max(1, min(120, float(request_data.get("frame_rate") or 24)))
        inputs, filters, video_segments, audio_segments = [], [], [], []
        cursor = 0.0
        width, height = 1920, 1080
        resolution = request_data.get("resolution", "source")
        if resolution in {"1080p", "720p", "480p"}:
            height = int(resolution[:-1])
            width = round(height * 16 / 9)
        quality = request_data.get("quality", "high")
        crf = {"high": 18, "medium": 23, "low": 28}.get(quality, 18)
        video_mode = request_data.get("mode") == "video"
        include_audio = video_mode and request_data.get("audio", True)
        if resolution == "source" and mode == "video":
            for clip in clips:
                if clip.get("type") not in {"video", "image"}: continue
                candidate = resolve_cache_path(str(clip.get("assetId") or ""))
                probe = shutil.which("ffprobe")
                if not probe or not candidate.is_file(): continue
                probe_result = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(candidate)], capture_output=True, text=True, timeout=15)
                streams = json.loads(probe_result.stdout).get("streams", []) if probe_result.returncode == 0 else []
                if streams:
                    width = min(1920, max(2, int(streams[0].get("width", width))))
                    height = min(1080, max(2, int(streams[0].get("height", height))))
                    width -= width % 2; height -= height % 2
                    break
        for index, clip in enumerate(clips):
            duration = max(0.04, float(clip.get("end", 0)) - float(clip.get("start", 0)))
            start = max(cursor, float(clip.get("timelineStart", cursor)))
            if start > cursor:
                gap_index = sum(1 for token in inputs if token == "-i")
                inputs.extend(["-f", "lavfi", "-t", str(start - cursor), "-i", f"color=c=black:s={width}x{height}:r={fps}"])
                if video_mode:
                    filters.append(f"[{gap_index}:v]setsar=1,fps={fps},format=yuv420p,setpts=PTS-STARTPTS[v{gap_index}]")
                    video_segments.append(f"[v{gap_index}]")
                if include_audio:
                    filters.append(f"anullsrc=r=48000:cl=stereo:d={start - cursor},asetpts=PTS-STARTPTS[a{gap_index}]")
                    audio_segments.append(f"[a{gap_index}]")
                cursor = start
            asset_id = str(clip.get("assetId") or "")
            source = resolve_cache_path(asset_id)
            try:
                source.relative_to(Path(PROJECT_FILE_PATH).resolve())
            except ValueError as exc:
                raise ValueError("片段素材路径无效") from exc
            if not source.is_file():
                raise ValueError(f"找不到素材：{clip.get('name', asset_id)}")
            input_index = sum(1 for token in inputs if token == "-i")
            if clip.get("type") == "image":
                inputs.extend(["-loop", "1", "-t", str(duration), "-i", str(source)])
            else:
                inputs.extend(["-i", str(source)])
            if video_mode and clip.get("type") == "image":
                filters.append(f"[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p,setpts=PTS-STARTPTS[v{index}]")
                video_segments.append(f"[v{index}]")
            elif video_mode:
                source_start = float(clip.get("start", 0))
                filters.append(f"[{input_index}:v]trim=start={source_start}:duration={duration},scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p,setpts=PTS-STARTPTS[v{index}]")
                video_segments.append(f"[v{index}]")
            if mode == "audio" and clip.get("type") == "audio":
                source_start = float(clip.get("start", 0))
                filters.append(f"[{input_index}:a]atrim=start={source_start}:duration={duration},asetpts=PTS-STARTPTS[a{index}]")
                audio_segments.append(f"[a{index}]")
            elif include_audio and clip.get("type") == "video":
                probe = shutil.which("ffprobe")
                has_audio = False
                if probe:
                    probe_result = subprocess.run([probe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(source)], capture_output=True, text=True, timeout=15)
                    has_audio = probe_result.returncode == 0 and bool(probe_result.stdout.strip())
                if has_audio:
                    filters.append(f"[{input_index}:a]atrim=start={float(clip.get('start', 0))}:duration={duration},asetpts=PTS-STARTPTS[a{index}]")
                else:
                    filters.append(f"anullsrc=r=48000:cl=stereo:d={duration},asetpts=PTS-STARTPTS[a{index}]")
                audio_segments.append(f"[a{index}]")
            elif include_audio:
                filters.append(f"anullsrc=r=48000:cl=stereo:d={duration},asetpts=PTS-STARTPTS[a{index}]")
                audio_segments.append(f"[a{index}]")
            cursor = start + duration
        ext = request_data.get("format", "mp4")
        export_dir = EDITING_AUDIO_EXPORT_DIR if mode == "audio" else EDITING_VIDEO_EXPORT_DIR
        output = export_dir / f"{export_id}.{ext}"
        if mode == "audio":
            if not audio_segments:
                raise ValueError("时间线中的视频没有可用音轨，无法导出音频")
            filters.append(f"{''.join(audio_segments)}concat=n={len(audio_segments)}:v=0:a=1[outa]")
            maps = ["-map", "[outa]"]
        else:
            filters.append(f"{''.join(video_segments)}concat=n={len(video_segments)}:v=1:a=0[outv]")
            maps = ["-map", "[outv]"]
            if request_data.get("audio", True):
                if audio_segments:
                    filters.append(f"{''.join(audio_segments)}concat=n={len(audio_segments)}:v=0:a=1[outa]")
                    maps.extend(["-map", "[outa]"])
        command = [ffmpeg, "-y", *inputs, "-filter_complex", ";".join(filters), *maps]
        if mode == "audio":
            codecs = {"mp3": ["-c:a", "libmp3lame", "-q:a", "2"], "wav": ["-c:a", "pcm_s16le"], "aac": ["-c:a", "aac", "-b:a", "192k"], "m4a": ["-c:a", "aac", "-b:a", "192k"]}
            command.extend(codecs.get(ext, codecs["mp3"]))
        else:
            command.extend(["-c:v", "libx264", "-crf", str(crf), "-preset", "medium", "-r", str(fps)])
            if request_data.get("audio", True):
                command.extend(["-c:a", "aac", "-b:a", "192k"])
            if ext == "webm": command.extend(["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0", "-c:a", "libopus"])
            if ext == "mov": command.extend(["-movflags", "+faststart"])
        command.append(str(output))
        state.update(status="processing", progress=5)
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        _, stderr = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(stderr[-1800:] or "FFmpeg 导出失败")
        state.update(status="completed", progress=100, filename=output.name, path=str(output))
    except Exception as exc:
        logger.exception("Editing export failed")
        state.update(status="error", error=str(exc))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/api/editing-media/upload")
async def upload_editing_media(file: UploadFile = File(...)):
    """Store a user-imported image or video for persistent editing projects."""
    ext = Path(file.filename or "").suffix.lower()
    supported = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov", ".mkv"}
    if ext not in supported:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPG、WEBP、MP4、WEBM、MOV 或 MKV 文件")
    media_kind = "video" if ext in {".mp4", ".webm", ".mov", ".mkv"} else "image"
    upload_dir = Path(PROJECT_FILE_PATH) / "editPanel" / "uploads" / media_kind
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"editing_{uuid.uuid4().hex[:12]}{ext}"
    save_path = upload_dir / filename
    try:
        with save_path.open("wb") as target:
            shutil.copyfileobj(file.file, target)
        relative_path = save_path.relative_to(PROJECT_FILE_PATH)
        return {"success": True, "filename": file.filename or filename,
                "url": f"/static/projects/{relative_path.as_posix()}",
                "asset_id": relative_path.as_posix(),
                "type": "video" if ext in {".mp4", ".webm", ".mov", ".mkv"} else "image"}
    except Exception as exc:
        save_path.unlink(missing_ok=True)
        logger.exception("[API] Editing media upload failed")
        raise HTTPException(status_code=500, detail=f"素材上传失败: {exc}") from exc


@router.get("/api/editing-media/frame-rate")
async def get_editing_media_frame_rate(asset_id: str):
    """Read a video asset's source frame rate with ffprobe when available."""
    output_root = (Path(PROJECT_FILE_PATH) / "editPanel" / "uploads").resolve()
    media_path = resolve_cache_path(asset_id)
    try:
        media_path.relative_to(output_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="素材路径无效") from exc
    if not media_path.is_file():
        raise HTTPException(status_code=404, detail="视频素材不存在")
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {"success": True, "fps": None}


@router.post("/api/editing-exports")
async def create_editing_export(request: EditingExportRequest, background_tasks: BackgroundTasks):
    mode = request.mode.lower()
    video_formats = {"mp4", "mov", "webm"}
    audio_formats = {"mp3", "wav", "aac", "m4a"}
    allowed = audio_formats if mode == "audio" else video_formats
    extension = request.format.lower().lstrip(".")
    if mode not in {"video", "audio"} or extension not in allowed:
        raise HTTPException(status_code=400, detail="导出类型或格式不支持")
    if not request.clips:
        raise HTTPException(status_code=400, detail="时间线上没有可导出的片段")
    export_id = uuid.uuid4().hex
    _EDITING_EXPORTS[export_id] = {"status": "queued", "progress": 0, "error": None}
    background_tasks.add_task(_run_editing_export, export_id, request.model_dump() if hasattr(request, "model_dump") else request.dict())
    return {"success": True, "export_id": export_id}


@router.get("/api/editing-exports/{export_id}")
async def get_editing_export(export_id: str):
    state = _EDITING_EXPORTS.get(export_id)
    if not state:
        raise HTTPException(status_code=404, detail="导出任务不存在")
    return {key: value for key, value in state.items() if key != "path"}


@router.get("/api/editing-exports/{export_id}/download")
async def download_editing_export(export_id: str):
    state = _EDITING_EXPORTS.get(export_id)
    if not state or state.get("status") != "completed":
        raise HTTPException(status_code=404, detail="导出文件尚未完成")
    path = Path(state.get("path", "")).resolve()
    try:
        path.relative_to(EDITING_EXPORT_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="导出文件路径无效") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="导出文件不存在")
    return FileResponse(path, filename=path.name)
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", str(media_path)],
            capture_output=True, text=True, check=True, timeout=20,
        )
        streams = json.loads(result.stdout).get("streams", [])
        if not streams:
            return {"success": True, "fps": None}
        stream = streams[0]
        for key in ("avg_frame_rate", "r_frame_rate"):
            rate = stream.get(key)
            if rate and rate != "0/0":
                fps = float(Fraction(rate))
                if fps > 0:
                    return {"success": True, "fps": fps}
        return {"success": True, "fps": None}
    except (subprocess.SubprocessError, OSError, ValueError, ZeroDivisionError, json.JSONDecodeError) as exc:
        logger.warning("[API] Could not read frame rate for %s: %s", media_path, exc)
        return {"success": True, "fps": None}


@router.get("/api/media-library")
async def list_generated_media():
    """List generated image/video assets for the editing studio media bin."""
    supported = {".mp4", ".webm", ".mov", ".mkv", ".png", ".jpg", ".jpeg", ".webp"}
    media_roots = [Path(PROJECT_FILE_PATH) / "editPanel" / "uploads"]
    assets = []
    for media_root in media_roots:
        if not media_root.exists():
            continue
        for path in media_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in supported:
                continue
            try:
                stat = path.stat()
                relative = path.relative_to(PROJECT_FILE_PATH).as_posix()
                assets.append({
                    "id": relative,
                    "filename": path.name,
                    "type": "video" if path.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"} else "image",
                    "url": f"/static/projects/{relative}",
                    "size": stat.st_size,
                    "modified_at": stat.st_mtime,
                })
            except OSError:
                logger.warning("[API] Could not read media asset: %s", path)

    assets.sort(key=lambda asset: asset["modified_at"], reverse=True)
    return {"success": True, "assets": assets[:500]}
