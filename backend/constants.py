from pathlib import Path
from typing import Union

BASE_DIR = Path(__file__).parent.parent
CACHE_ROOT = BASE_DIR / "caches"
PROJECT_FILE_PATH = str(CACHE_ROOT)
OUTPUT_FILE_PATH = str(CACHE_ROOT / "generation" / "exports")


def resolve_cache_path(relative_path: Union[str, Path]) -> Path:
    """Resolve current cache paths and legacy outputs-relative asset references."""
    raw = str(relative_path).replace("\\", "/").lstrip("/")
    legacy_prefixes = {
        "_temp/generator_outputs/editing_uploads/": "editPanel/uploads",
        "editing_uploads/": "editPanel/uploads",
    }
    for old, new in legacy_prefixes.items():
        if raw.startswith(old):
            suffix = raw[len(old):]
            kind = "video" if Path(suffix).suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"} else "image"
            raw = f"{new}/{kind}/{suffix}"
            break
    legacy_export_prefix = "_temp/generator_outputs/editing_exports/"
    if raw.startswith(legacy_export_prefix):
        suffix = raw[len(legacy_export_prefix):]
        kind = "audio" if Path(suffix).suffix.lower() in {".mp3", ".wav", ".aac", ".m4a"} else "video"
        raw = f"editPanel/exports/{kind}/{suffix}"
    aliases = (
        ("_temp/freeCanvas/", "freeCanvas/jsons/"),
        ("_temp/editingStudio/", "editPanel/jsons/"),
        ("_temp/shotbreakdown/", "shotBreakdown/jsons/"),
        ("_temp/concepts/", "shotBreakdown/jsons/concepts/"),
        ("_temp/generator_outputs/uploads/", "generation/uploads/image/"),
        ("_temp/generator_outputs/models/", "freeCanvas/uploads/model/"),
        ("_temp/generator_outputs/", "generation/exports/"),
        ("_temp/", "system/maintenance/"),
        ("uploads/", "generation/uploads/image/"),
    )
    for old, new in aliases:
        if raw.startswith(old):
            raw = new + raw[len(old):]
            break
    return (CACHE_ROOT / raw).resolve()
