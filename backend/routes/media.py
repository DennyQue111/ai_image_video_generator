"""共享媒体 API：图片/模型上传、文件定位与上传素材清理。"""
import logging
import re as _re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH, resolve_cache_path

logger = logging.getLogger(__name__)
router = APIRouter()
_REF_JSON_DIRS = [
    Path(PROJECT_FILE_PATH) / "freeCanvas" / "jsons",
    Path(PROJECT_FILE_PATH) / "shotBreakdown" / "jsons",
    Path(PROJECT_FILE_PATH) / "shotBreakdown" / "jsons" / "concepts",
]


@router.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """上传图片到临时目录，返回可访问的 URL"""
    logger.info("[API] /api/upload-image called, filename=%s", file.filename)
    try:
        upload_dir = Path(PROJECT_FILE_PATH) / "generation" / "uploads" / "image"
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


@router.post("/api/upload-model")
async def upload_model(file: UploadFile = File(...)):
    """上传可在 Three.js 中预览的 3D 模型；当前优先支持单文件 GLB。"""
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"glb", "gltf", "obj", "fbx", "stl"}:
        raise HTTPException(status_code=400, detail="仅支持 .glb、.gltf、.obj、.fbx、.stl 模型文件；推荐使用单文件 .glb")
    try:
        upload_dir = Path(PROJECT_FILE_PATH) / "freeCanvas" / "uploads" / "model"
        upload_dir.mkdir(parents=True, exist_ok=True)
        filename = f"model_{uuid.uuid4().hex[:8]}.{ext}"
        save_path = upload_dir / filename
        with save_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        relative_path = save_path.relative_to(PROJECT_FILE_PATH).as_posix()
        return {
            "success": True,
            "filename": filename,
            "format": ext,
            "size_bytes": save_path.stat().st_size,
            "url": f"/static/projects/{relative_path}",
        }
    except Exception as e:
        logger.error("[API] Model upload failed: %s", e)
        raise HTTPException(status_code=500, detail=f"模型上传失败: {str(e)}")


class OpenFolderRequest(BaseModel):
    url: str = Field(..., description="图片/视频 URL（/static/projects/... 形式）")


@router.post("/api/open-in-folder")
async def open_in_folder(request: OpenFolderRequest):
    """在系统文件管理器中打开文件所在文件夹并选中文件"""
    raw_url = request.url.split("?")[0]
    if "/static/projects/" not in raw_url:
        raise HTTPException(status_code=400, detail="仅支持本地上传的文件")

    relative = raw_url.split("/static/projects/", 1)[1]
    file_path = resolve_cache_path(relative)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {file_path}")

    try:
        if sys.platform == "win32":
            # explorer /select,"C:\path\to\file.png" 打开文件夹并选中文件
            subprocess.Popen(['explorer', '/select,', str(file_path)])
        elif sys.platform == "darwin":
            subprocess.Popen(['open', '-R', str(file_path)])
        else:
            subprocess.Popen(['xdg-open', str(file_path.parent)])
        logger.info("[API] open-in-folder: %s", file_path)
        return {"success": True}
    except Exception as e:
        logger.error("[API] open-in-folder failed: %s", e)
        raise HTTPException(status_code=500, detail=f"打开文件夹失败: {str(e)}")


def _collect_referenced_rel_paths() -> set:
    """扫描所有镜头表/concepts JSON，收集被引用的文件相对路径（相对 PROJECT_FILE_PATH）。

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
                try:
                    canonical_path = resolve_cache_path(m.group(1))
                    referenced.add(canonical_path.relative_to(Path(PROJECT_FILE_PATH).resolve()).as_posix())
                except ValueError:
                    continue
    return referenced


@router.post("/api/uploads/cleanup")
async def cleanup_uploads():
    """清理 uploads 目录中未被任何画布项目/镜头表引用的孤立文件。

    只清理 generation/uploads/ 子目录，不影响生成结果目录。
    返回删除的文件数和释放的空间。
    """
    upload_dir = Path(PROJECT_FILE_PATH) / "generation" / "uploads" / "image"
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
    upload_dir = Path(PROJECT_FILE_PATH) / "generation" / "uploads" / "image"
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
