import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from timetrace.config import settings
from timetrace.db.session import init_db
from timetrace.interfaces.api.router import router
from timetrace.interfaces.cli.commands import cli_app


def create_daemon_app() -> FastAPI:
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()
        yield

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
        from timetrace.interfaces.tui.app import TimeTraceTUI
        tui = TimeTraceTUI()
        tui.run()
    else:
        cli_app()


if __name__ == "__main__":
    app()
