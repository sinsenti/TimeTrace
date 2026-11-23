import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlmodel import Session

from timetrace import __version__
from timetrace.config import settings
from timetrace.core.exceptions import AIProviderError, ConflictError, EntityNotFoundError, TimerError, ValidationError
from timetrace.core.idle_detector import get_idle_seconds
from timetrace.db.session import engine, init_db
from timetrace.interfaces.api.routers import api_router
from timetrace.interfaces.api.routers.web import router as web_router
from timetrace.services.timer_service import TimerService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("timetrace")


async def idle_checker_loop():
    while True:
        await asyncio.sleep(10)
        try:
            if settings.idle_detection_enabled:
                idle_secs = get_idle_seconds()
                await asyncio.to_thread(observe_timer_activity, idle_secs)
        except Exception as exc:
            logger.warning(f"Idle loop error: {exc}")


def observe_timer_activity(idle_seconds):
    # Frozen timers still need return observations; every tick crosses reconciliation first.
    with Session(engine) as db:
        TimerService(db).freeze_for_idle(idle_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from timetrace.services.multiple_timer_service import MultipleTimerService

    with Session(engine) as db:
        MultipleTimerService(db).reconcile()
    # init_db() -> run_migrations() -> alembic's env.py calls logging.config.fileConfig() against
    # alembic.ini, which sets the ROOT logger to level=WARN with its own handler+formatter
    # (alembic.ini's [logger_root]/[handler_console] sections) -- silently overriding the INFO
    # level and asctime format set up above, for the rest of the process's life. Confirmed live:
    # every app-level logger.info() call (including the full AI step-by-step trace) went missing
    # after the first daemon startup, while a bare print() still worked, since it's genuinely
    # below the new WARN threshold rather than a stdio/redirection problem. Reassert our config
    # after init_db() runs so this survives every daemon start.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        force=True,
    )
    idle_task = asyncio.create_task(idle_checker_loop())
    yield
    idle_task.cancel()


def create_daemon_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

    # Same-origin only. The dashboard, CLI and TUI all talk to this daemon on its own
    # host:port, so a wildcard bought nothing and -- now that the statistics page can run
    # arbitrary read-only SQL (`POST /analytics/sql`) -- any web page in the browser could
    # have driven that endpoint against the local daemon. `allow_credentials=True` is only
    # legal with a concrete origin list anyway; the two had to change together.
    allowed_origins = [
        f"http://{settings.host}:{settings.port}",
        f"http://127.0.0.1:{settings.port}",
        f"http://localhost:{settings.port}",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(set(allowed_origins)),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(EntityNotFoundError)
    async def entity_not_found_handler(request: Request, exc: EntityNotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(TimerError)
    async def timer_error_handler(request: Request, exc: TimerError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(ValidationError)
    async def validation_error_handler(request: Request, exc: ValidationError):
        content = {"detail": str(exc)}
        if exc.code:
            content["code"] = exc.code
        return JSONResponse(status_code=400, content=content)

    @app.exception_handler(AIProviderError)
    async def ai_provider_error_handler(request: Request, exc: AIProviderError):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def conflict_error_handler(request: Request, exc: ConflictError):
        content = {"detail": str(exc)}
        if exc.code:
            content["code"] = exc.code
        return JSONResponse(status_code=409, content=content)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        # Request bodies can contain prompts, task text, and remembered instructions. Keep the
        # useful validation diagnostics while never copying those values into application logs.
        try:
            body_length = len(await request.body())
            body_summary = f"<{body_length} bytes redacted>"
        except Exception:
            body_summary = "<failed to read body>"

        logger.error("=" * 60)
        logger.error(f"HTTP 422 Validation Error on {request.method} {request.url.path}")
        logger.error(f"Incoming Request Body: {body_summary}")
        validation_summary = [{"loc": error.get("loc"), "type": error.get("type")} for error in exc.errors()]
        logger.error(f"Validation Failure Details: {validation_summary}")
        logger.error("=" * 60)

        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(exc.errors())},
        )

    app.include_router(web_router)
    app.include_router(api_router)

    @app.get("/")
    def root_redirect():
        return RedirectResponse(url="/dashboard")

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
    from timetrace.interfaces.cli.commands import cli_app

    cli_app()


if __name__ == "__main__":
    app()
