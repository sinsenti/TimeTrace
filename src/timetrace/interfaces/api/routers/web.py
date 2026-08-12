import os
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["Web Pages"])
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

templates = Jinja2Templates(directory=TEMPLATES_DIR)


@router.get("/dashboard")
def get_web_dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={"active_page": "dashboard"}
    )


@router.get("/stats")
def get_stats_dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="stats.html",
        context={"active_page": "stats"}
    )


@router.get("/habits-view")
def get_habits_dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="habits.html",
        context={"active_page": "habits"}
    )


@router.get("/revision")
def get_revision_dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="revision.html",
        context={"active_page": "revision"}
    )


@router.get("/static/{file_path:path}")
def get_static_file(file_path: str):
    full_path = os.path.join(STATIC_DIR, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    raise HTTPException(status_code=404, detail="Static asset not found")
