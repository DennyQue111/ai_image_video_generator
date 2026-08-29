"""
画布项目持久化路由
保存/加载/列出/删除 画布节点+连线的 JSON 文件
不同项目对应不同的 JSON 文件
"""

import logging
import re
import json
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from constants import PROJECT_FILE_PATH

logger = logging.getLogger(__name__)
router = APIRouter()

# 项目 JSON 存储目录
PROJECTS_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(name: str) -> str:
    """把项目名清理为安全的文件名（仅允许中文/字母/数字/下划线/连字符）"""
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", name).strip()
    return cleaned or "untitled"


def _project_path(name: str) -> Path:
    return PROJECTS_DIR / f"{_safe_name(name)}.json"


class SaveProjectRequest(BaseModel):
    name: str = Field(..., description="项目名（不含扩展名）")
    nodes: list = Field(default_factory=list, description="画布节点数组")
    edges: list = Field(default_factory=list, description="画布连线数组")


@router.get("/api/projects")
async def list_projects():
    """列出所有已保存的项目"""
    logger.info("[Projects] list requested")
    files = sorted(PROJECTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    projects = []
    for f in files:
        try:
            stat = f.stat()
            projects.append({
                "name": f.stem,
                "filename": f.name,
                "size": stat.st_size,
                "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            })
        except Exception as e:
            logger.warning("[Projects] skip %s: %s", f, e)
    return {"success": True, "projects": projects}


@router.post("/api/projects/save")
async def save_project(request: SaveProjectRequest):
    """保存项目（同名覆盖）"""
    name = _safe_name(request.name)
    if not name:
        raise HTTPException(status_code=400, detail="项目名不能为空")
    logger.info("[Projects] save name=%s, nodes=%d, edges=%d", name, len(request.nodes), len(request.edges))

    path = _project_path(name)
    data = {
        "name": name,
        "version": 1,
        "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "nodes": request.nodes,
        "edges": request.edges,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[Projects] saved to %s", path)
    return {
        "success": True,
        "name": name,
        "filename": path.name,
        "updated_at": data["saved_at"],
    }


@router.get("/api/projects/{name}")
async def load_project(name: str):
    """加载指定项目"""
    path = _project_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"项目不存在: {name}")
    logger.info("[Projects] load name=%s", name)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"项目文件损坏: {e}")
    return {"success": True, "project": data}


@router.delete("/api/projects/{name}")
async def delete_project(name: str):
    """删除指定项目"""
    path = _project_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"项目不存在: {name}")
    path.unlink()
    logger.info("[Projects] deleted %s", path)
    return {"success": True, "name": name}


class RenameProjectRequest(BaseModel):
    new_name: str


@router.post("/api/projects/{name}/rename")
async def rename_project(name: str, request: RenameProjectRequest):
    """重命名项目"""
    old_path = _project_path(name)
    if not old_path.exists():
        raise HTTPException(status_code=404, detail=f"项目不存在: {name}")
    new_name = _safe_name(request.new_name)
    if not new_name:
        raise HTTPException(status_code=400, detail="新项目名不能为空")
    new_path = _project_path(new_name)
    if new_path.exists() and new_path != old_path:
        raise HTTPException(status_code=409, detail=f"项目名已存在: {new_name}")
    old_path.rename(new_path)
    logger.info("[Projects] renamed %s -> %s", old_path, new_path)
    return {"success": True, "name": new_name, "filename": new_path.name}
