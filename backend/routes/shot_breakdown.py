"""
镜头表持久化路由
保存/加载/列出/删除镜头表 JSON 文件
每个镜头：{id, shot_no, duration, prompt, reference_images:[url...]}
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

# 镜头表 JSON 存储目录
SHOT_BREAKDOWN_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "shotbreakdown"
SHOT_BREAKDOWN_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(name: str) -> str:
    """把项目名清理为安全的文件名（仅允许中文/字母/数字/下划线/连字符）"""
    cleaned = re.sub(r"[\\/:*?\"<>|]", "_", name).strip()
    return cleaned or "untitled"


def _shot_breakdown_path(name: str) -> Path:
    return SHOT_BREAKDOWN_DIR / f"{_safe_name(name)}.json"


class SaveShotBreakdownRequest(BaseModel):
    name: str = Field(..., description="镜头表名（不含扩展名）")
    shots: list = Field(default_factory=list, description="镜头数组")
    concepts: dict = Field(default_factory=dict, description="角色、场景与道具概念数据")


@router.get("/api/shot_breakdowns")
async def list_shot_breakdowns():
    """列出所有已保存的镜头表"""
    logger.info("[ShotBreakdown] list requested")
    files = sorted(SHOT_BREAKDOWN_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    items = []
    for f in files:
        try:
            stat = f.stat()
            items.append({
                "name": f.stem,
                "filename": f.name,
                "size": stat.st_size,
                "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            })
        except Exception as e:
            logger.warning("[ShotBreakdown] skip %s: %s", f, e)
    return {"success": True, "shot_breakdowns": items}


@router.post("/api/shot_breakdowns/save")
async def save_shot_breakdown(request: SaveShotBreakdownRequest):
    """保存镜头表（同名覆盖）"""
    name = _safe_name(request.name)
    if not name:
        raise HTTPException(status_code=400, detail="镜头表名不能为空")
    logger.info("[ShotBreakdown] save name=%s, shots=%d", name, len(request.shots))

    path = _shot_breakdown_path(name)
    data = {
        "name": name,
        "version": 1,
        "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "shots": request.shots,
        "concepts": request.concepts,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[ShotBreakdown] saved to %s", path)
    return {
        "success": True,
        "name": name,
        "filename": path.name,
        "updated_at": data["saved_at"],
    }


@router.get("/api/shot_breakdowns/{name}")
async def load_shot_breakdown(name: str):
    """加载指定镜头表"""
    path = _shot_breakdown_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"镜头表不存在: {name}")
    logger.info("[ShotBreakdown] load name=%s", name)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"镜头表文件损坏: {e}")
    return {"success": True, "shot_breakdown": data}


@router.delete("/api/shot_breakdowns/{name}")
async def delete_shot_breakdown(name: str):
    """删除指定镜头表"""
    path = _shot_breakdown_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"镜头表不存在: {name}")
    path.unlink()
    logger.info("[ShotBreakdown] deleted %s", path)
    return {"success": True, "name": name}
