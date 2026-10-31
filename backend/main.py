import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from constants import PROJECT_FILE_PATH, resolve_cache_path
from routes.editing_studio import router as editing_studio_router
from routes.generation import router as generation_router
from routes.image_tools import router as image_tools_router
from routes.media import router as media_router
from routes.projects import router as projects_router
from routes.prompt_tools import router as prompt_tools_router
from routes.shot_breakdown import router as shot_breakdown_router

app = FastAPI(title="AI 图片视频生成器", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        resolved = resolve_cache_path(path)
        try:
            resolved.relative_to(Path(PROJECT_FILE_PATH).resolve())
        except ValueError:
            raise StarletteHTTPException(status_code=404)
        if not resolved.is_file():
            raise StarletteHTTPException(status_code=404)
        return FileResponse(resolved)


app.mount("/static/projects", CacheStaticFiles(directory=PROJECT_FILE_PATH), name="projects")


@app.get("/")
async def root():
    return {"message": "AI 图片视频生成器 API", "version": "1.0.0"}


app.include_router(generation_router)
app.include_router(image_tools_router)
app.include_router(prompt_tools_router)
app.include_router(editing_studio_router)
app.include_router(media_router)
app.include_router(projects_router)
app.include_router(shot_breakdown_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("DENNY_BACKEND_PORT", "8005")))
