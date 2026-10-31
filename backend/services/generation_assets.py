"""Shared helpers for resolving and saving generated media assets."""
import logging
import os
import uuid
from pathlib import Path

import requests

from constants import PROJECT_FILE_PATH, resolve_cache_path

logger = logging.getLogger(__name__)


def _to_full_url(url: str) -> str:
    """将 /static/projects/... 相对路径转为后端可访问的完整 URL"""
    if url and url.startswith("/static/"):
        backend_port = os.getenv("DENNY_BACKEND_PORT", "8005")
        full = f"http://localhost:{backend_port}{url}"
        logger.info("[API] Resolved relative URL: %s -> %s", url, full)
        return full
    return url


def _resolve_image_data(url: str):
    """解析图片 URL，返回 (data, mime_type, ext)"""
    raw_url = url.split("?")[0]
    logger.info("[API] Resolving image data from %s", raw_url)
    if "/static/projects/" in raw_url:
        relative = raw_url.split("/static/projects/", 1)[1]
        local_path = resolve_cache_path(relative)
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
