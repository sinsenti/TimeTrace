import sys
from timetrace.config import settings


def create_daemon_app():
    """Creates and configures the FastAPI daemon application."""
    import asyncio
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import RedirectResponse
    from contextlib import asynccontextmanager

    from timetrace.db.session import init_db
    from timetrace.core.timer import timer_manager
    from timetrace.core.idle_detector import get_idle_seconds
    from timetrace.interfaces.api.router import router

    async def idle_checker_loop():
        while True:
            await asyncio.sleep(10)
            try:
                if settings.idle_detection_enabled and timer_manager.idle_detection_enabled and timer_manager.is_running:
                    idle_secs = get_idle_seconds()
                    if idle_secs >= timer_manager.idle_threshold_seconds:
                        timer_manager.freeze_for_idle(idle_secs)
            except Exception as exc:
                print(f"Warning: Idle loop error: {exc}")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()
        idle_task = asyncio.create_task(idle_checker_loop())
        yield
        idle_task.cancel()

    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/api/v1")

    @app.get("/")
    def root_redirect():
        return RedirectResponse(url="/api/v1/dashboard")

    @app.get("/health")
    def health_check():
        return {"status": "ok", "app": settings.app_name}

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
