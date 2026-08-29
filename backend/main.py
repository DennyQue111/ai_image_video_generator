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

from constants import PROJECT_FILE_PATH
from routes.generation import router as generation_router
from routes.projects import router as projects_router

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

app.mount("/static/projects", StaticFiles(directory=PROJECT_FILE_PATH), name="projects")


@app.get("/")
async def root():
    return {"message": "AI 图片视频生成器 API", "version": "1.0.0"}


app.include_router(generation_router)
app.include_router(projects_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
