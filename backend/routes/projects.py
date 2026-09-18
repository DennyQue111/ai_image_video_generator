"""独立自由画布项目的持久化路由。"""
import json
import logging
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from constants import PROJECT_FILE_PATH

logger = logging.getLogger(__name__)
router = APIRouter()
# 与镜头表、Concepts 分开，避免被误认为影片项目资料。
FREE_CANVAS_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "freeCanvas"
FREE_CANVAS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]", "_", name).strip() or "untitled"


def _path(name: str) -> Path:
    return FREE_CANVAS_DIR / f"{_safe_name(name)}.json"


class SaveProjectRequest(BaseModel):
    name: str
    nodes: list = Field(default_factory=list)
    edges: list = Field(default_factory=list)


@router.get("/api/projects")
async def list_projects():
    projects = []
    for file in sorted(FREE_CANVAS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = file.stat()
        projects.append({"name": file.stem, "filename": file.name, "size": stat.st_size,
                         "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    return {"success": True, "projects": projects}


@router.post("/api/projects/save")
async def save_project(request: SaveProjectRequest):
    name = _safe_name(request.name)
    data = {"name": name, "version": 1, "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "nodes": request.nodes, "edges": request.edges}
    _path(name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"success": True, "name": name, "filename": f"{name}.json", "updated_at": data["saved_at"]}


@router.get("/api/projects/{name}")
async def load_project(name: str):
    path = _path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"自由画布项目不存在: {name}")
    try:
        return {"success": True, "project": json.loads(path.read_text(encoding="utf-8"))}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"自由画布项目文件损坏: {exc}") from exc


@router.delete("/api/projects/{name}")
async def delete_project(name: str):
    path = _path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"自由画布项目不存在: {name}")
    path.unlink()
    return {"success": True, "name": name}
