import sys
import asyncio
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from contextlib import asynccontextmanager

from timetrace.config import settings
from timetrace.db.session import init_db
from timetrace.core.timer import timer_manager
from timetrace.core.idle_detector import get_idle_seconds
from timetrace.interfaces.api.routers import api_router

# Configure logging format
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("timetrace")


async def idle_checker_loop():
    while True:
        await asyncio.sleep(10)
        try:
            if (
                settings.idle_detection_enabled
                and timer_manager.idle_detection_enabled
                and timer_manager.is_running
            ):
                idle_secs = get_idle_seconds()
                if idle_secs >= timer_manager.idle_threshold_seconds:
                    timer_manager.freeze_for_idle(idle_secs)
        except Exception as exc:
            logger.warning(f"Idle loop error: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    idle_task = asyncio.create_task(idle_checker_loop())
    yield
    idle_task.cancel()


def create_daemon_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 422 Validation Error Logger Middleware
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        try:
            body = await request.body()
            body_str = body.decode("utf-8")
        except Exception:
            body_str = "<failed to read body>"

        logger.error("=" * 60)
        logger.error(f"HTTP 422 Validation Error on {request.method} {request.url.path}")
        logger.error(f"Incoming Request Body: {body_str}")
        logger.error(f"Validation Failure Details: {exc.errors()}")
        logger.error("=" * 60)

        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(exc.errors())},
        )

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/")
    def root_redirect():
        return RedirectResponse(url="/api/v1/dashboard")

    @app.get("/health")
    def health_check():
        return {
            "status": "ok",
            "app": settings.app_name,
            "port": settings.port,
            "db_file": str(settings.db_file),
        }

    return app


daemon_app = create_daemon_app()


def app():
    if len(sys.argv) == 1:
        from timetrace.interfaces.cli.client import ensure_daemon_running

        ensure_daemon_running()

        from timetrace.interfaces.tui.app import TimeTraceTUI

        tui = TimeTraceTUI()
        tui.run()
    else:
        from timetrace.interfaces.cli.commands import cli_app

        cli_app()


if __name__ == "__main__":
    app()
