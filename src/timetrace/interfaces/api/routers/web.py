import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["Web Pages"])
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


@router.get("/dashboard", response_class=FileResponse)
def get_web_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.get("/stats", response_class=FileResponse)
def get_stats_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "stats.html"))


@router.get("/habits-view", response_class=FileResponse)
def get_habits_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "habits.html"))


@router.get("/revision", response_class=FileResponse)
def get_revision_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "revision.html"))


@router.get("/static/{file_path:path}")
def get_static_file(file_path: str):
    full_path = os.path.join(STATIC_DIR, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    raise HTTPException(status_code=404, detail="Static asset not found")
