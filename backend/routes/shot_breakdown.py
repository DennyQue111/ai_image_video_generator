"""镜头表与 concepts 的持久化路由。两类 JSON 用 project_id 关联。"""
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
SHOT_BREAKDOWN_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "shotbreakdown"
CONCEPTS_DIR = Path(PROJECT_FILE_PATH) / "_temp" / "concepts"
SHOT_BREAKDOWN_DIR.mkdir(parents=True, exist_ok=True)
CONCEPTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]", "_", name).strip() or "untitled"


def _path(directory: Path, name: str) -> Path:
    return directory / f"{_safe_name(name)}.json"


def _read(path: Path, label: str) -> dict:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{label}不存在: {path.stem}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{label}文件损坏: {exc}") from exc


def _write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _find_concepts(project_id: str | None, concepts_file: str | None = None):
    if concepts_file:
        path = _path(CONCEPTS_DIR, concepts_file)
        if path.exists():
            return _read(path, "Concepts"), path.stem
    for path in CONCEPTS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if project_id and data.get("project_id") == project_id:
            return data, path.stem
    return None, None


def _legacy_concepts_name(shot_name: str):
    candidate = re.sub(r"(?:_|-)?shot(?:_|-)?breakdown$", "_concepts", shot_name, flags=re.I)
    return candidate if candidate != shot_name and _path(CONCEPTS_DIR, candidate).exists() else None


def _find_breakdown_by_project_id(project_id: str) -> tuple[dict, Path]:
    """按 project_id 找镜头表；兼容旧文件的 legacy:<镜头表名> 标识。"""
    legacy_name = project_id.removeprefix("legacy:") if project_id.startswith("legacy:") else None
    for path in SHOT_BREAKDOWN_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("project_id") == project_id or (legacy_name and path.stem == legacy_name):
            return data, path
    raise HTTPException(status_code=404, detail=f"未找到 project_id 对应的镜头表: {project_id}")


def get_project_shot(project_id: str, shot_id: str) -> tuple[dict, dict, dict]:
    """供视频提示词接口复用：返回镜头表、镜头和关联的 Concepts。"""
    data, path = _find_breakdown_by_project_id(project_id)
    shot = _get_shot(data, shot_id)
    concepts, _ = _find_concepts(data.get("project_id"), data.get("concepts_file"))
    if concepts is None:
        concepts, _ = _find_concepts(None, _legacy_concepts_name(path.stem))
    return data, shot, concepts or {}


class SaveShotBreakdownRequest(BaseModel):
    name: str
    schema_version: int = 2
    project_id: str | None = None
    project_code: str | None = None
    project_name: str | None = None
    concepts_file: str | None = None
    shots: list = Field(default_factory=list)
    characters: list = Field(default_factory=list)
    locations: list = Field(default_factory=list)
    props: list = Field(default_factory=list)


class SaveConceptsRequest(BaseModel):
    name: str
    schema_version: int = 2
    project_id: str
    project_code: str | None = None
    project_name: str | None = None
    characters: list = Field(default_factory=list)
    locations: list = Field(default_factory=list)
    props: list = Field(default_factory=list)


class SaveCanvasRequest(BaseModel):
    nodes: list = Field(default_factory=list)
    edges: list = Field(default_factory=list)


@router.get("/api/shot_breakdowns")
async def list_shot_breakdowns():
    items = []
    for file in sorted(SHOT_BREAKDOWN_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = file.stat()
        items.append({"name": file.stem, "filename": file.name, "size": stat.st_size,
                      "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    return {"success": True, "shot_breakdowns": items}


@router.get("/api/shot_breakdowns/projects")
async def list_shot_projects():
    """供镜头表生成视频选择器使用，返回每个镜头表的 project_id。"""
    projects = []
    for path in SHOT_BREAKDOWN_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        project_id = data.get("project_id") or f"legacy:{path.stem}"
        projects.append({"project_id": project_id, "project_name": data.get("project_name") or data.get("name", path.stem),
                         "project_code": data.get("project_code", ""), "shot_breakdown": path.stem,
                         "shot_count": len(data.get("shots", []))})
    return {"success": True, "projects": projects}


@router.get("/api/shot_breakdowns/projects/{project_id}/shots")
async def list_project_shots(project_id: str):
    data, _ = _find_breakdown_by_project_id(project_id)
    shots = [{"id": item.get("id", ""), "shot_no": item.get("shot_no", item.get("id", "")),
              "scene": item.get("scene", ""), "duration": item.get("duration", "")} for item in data.get("shots", [])]
    return {"success": True, "project_id": project_id, "shots": shots}


@router.get("/api/concepts")
async def list_concepts():
    items = []
    for file in sorted(CONCEPTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = file.stat()
        items.append({"name": file.stem, "filename": file.name, "size": stat.st_size,
                      "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    return {"success": True, "concepts": items}


@router.post("/api/concepts/save")
async def save_concepts(request: SaveConceptsRequest):
    name = _safe_name(request.name)
    data = {"name": name, "schema_version": request.schema_version, "project_id": request.project_id,
            "project_code": request.project_code, "project_name": request.project_name,
            "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "characters": request.characters, "locations": request.locations, "props": request.props}
    _write(_path(CONCEPTS_DIR, name), data)
    return {"success": True, "name": name, "filename": f"{name}.json", "updated_at": data["saved_at"]}


@router.get("/api/concepts/{name}")
async def load_concepts(name: str):
    return {"success": True, "concepts": _read(_path(CONCEPTS_DIR, name), "Concepts")}


@router.delete("/api/concepts/{name}")
async def delete_concepts(name: str):
    path = _path(CONCEPTS_DIR, name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Concepts不存在: {name}")
    path.unlink()
    return {"success": True, "name": name}


@router.post("/api/shot_breakdowns/save")
async def save_shot_breakdown(request: SaveShotBreakdownRequest):
    name = _safe_name(request.name)
    project_code = request.project_code or re.sub(r"[^A-Za-z0-9]+", "", name).upper()[:16] or "PROJECT"
    project_id = request.project_id or f"{datetime.now():%Y%m%d}_{project_code}"
    concepts_name = _safe_name(request.concepts_file or f"{project_code}_concepts")
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    concepts_data = {"name": concepts_name, "schema_version": request.schema_version, "project_id": project_id,
                     "project_code": project_code, "project_name": request.project_name or name, "saved_at": stamp,
                     "characters": request.characters, "locations": request.locations, "props": request.props}
    _write(_path(CONCEPTS_DIR, concepts_name), concepts_data)
    data = {"name": name, "schema_version": request.schema_version, "project_id": project_id,
            "project_code": project_code, "project_name": request.project_name or name,
            "concepts_file": concepts_name, "saved_at": stamp, "shots": request.shots}
    _write(_path(SHOT_BREAKDOWN_DIR, name), data)
    return {"success": True, "name": name, "project_id": project_id, "concepts_file": concepts_name,
            "filename": f"{name}.json", "updated_at": stamp}


def _get_shot(data: dict, shot_id: str):
    shot = next((item for item in data.get("shots", []) if item.get("id") == shot_id or item.get("shot_no") == shot_id), None)
    if not shot:
        raise HTTPException(status_code=404, detail=f"镜头不存在: {shot_id}")
    return shot


@router.get("/api/shot_breakdowns/{name}/shots/{shot_id}/canvas")
async def load_shot_canvas(name: str, shot_id: str):
    data = _read(_path(SHOT_BREAKDOWN_DIR, name), "镜头表")
    shot = _get_shot(data, shot_id)
    return {"success": True, "canvas": shot.get("canvas") or {"nodes": [], "edges": []}, "shot": shot,
            "project_id": data.get("project_id"), "shot_breakdown": data.get("name", name)}


@router.post("/api/shot_breakdowns/{name}/shots/{shot_id}/canvas/ensure")
async def ensure_shot_canvas(name: str, shot_id: str):
    path = _path(SHOT_BREAKDOWN_DIR, name)
    data = _read(path, "镜头表")
    shot = _get_shot(data, shot_id)
    if shot.get("canvas") is not None:
        return {"success": True, "created": False, "canvas": shot["canvas"]}
    concepts, concepts_name = _find_concepts(data.get("project_id"), data.get("concepts_file"))
    if concepts is None:
        concepts, concepts_name = _find_concepts(None, _legacy_concepts_name(name))
    concepts = concepts or {}
    character_ids = set(shot.get("characters") or [])
    characters = [item for item in concepts.get("characters", []) if item.get("id") in character_ids or item.get("name") in character_ids]
    location_id = shot.get("location")
    location = next((item for item in concepts.get("locations", []) if item.get("id") == location_id or item.get("name") == location_id), None)
    items = [("角色", item) for item in characters]
    if location:
        items.append(("Location", location))
    items.append(("镜头参考", {"name": shot.get("shot_no", shot_id), "reference_images": shot.get("reference_images") or []}))
    seen, nodes = set(), []
    for group_index, (kind, item) in enumerate(items):
        for image_index, src in enumerate(item.get("reference_images") or []):
            if not src or src in seen:
                continue
            seen.add(src)
            nodes.append({"id": f"shot_{shot_id}_{group_index}_{image_index}", "type": "imageNode",
                          "position": {"x": 80 + group_index * 340, "y": 100 + image_index * 290},
                          "data": {"src": src, "width": 256, "height": 256, "mediaType": "image",
                                   "sourceKind": kind, "sourceName": item.get("name", "")}})
    canvas = {"nodes": nodes, "edges": [], "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    shot["canvas"] = canvas
    data["saved_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _write(path, data)
    return {"success": True, "created": True, "canvas": canvas, "concepts_file": concepts_name}


@router.put("/api/shot_breakdowns/{name}/shots/{shot_id}/canvas")
async def save_shot_canvas(name: str, shot_id: str, request: SaveCanvasRequest):
    path = _path(SHOT_BREAKDOWN_DIR, name)
    data = _read(path, "镜头表")
    shot = _get_shot(data, shot_id)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    shot["canvas"] = {"nodes": request.nodes, "edges": request.edges, "saved_at": stamp}
    data["saved_at"] = stamp
    _write(path, data)
    return {"success": True, "updated_at": stamp}


@router.get("/api/shot_breakdowns/{name}")
async def load_shot_breakdown(name: str):
    data = _read(_path(SHOT_BREAKDOWN_DIR, name), "镜头表")
    concepts, concepts_name = _find_concepts(data.get("project_id"), data.get("concepts_file"))
    if concepts is None:
        concepts, concepts_name = _find_concepts(None, _legacy_concepts_name(name))
    if concepts:
        data["concepts"] = concepts
        data["concepts_file"] = data.get("concepts_file") or concepts_name
    return {"success": True, "shot_breakdown": data}


@router.delete("/api/shot_breakdowns/{name}")
async def delete_shot_breakdown(name: str):
    path = _path(SHOT_BREAKDOWN_DIR, name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"镜头表不存在: {name}")
    path.unlink()
    return {"success": True, "name": name}
