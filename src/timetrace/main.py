import typer
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from timetrace.db.session import init_db
from timetrace.interfaces.api.routers import api_router

app = typer.Typer(
    name="timetrace",
    help="TimeTrace - Lightweight Time Tracking & Retrospective Engine",
    add_completion=False,
)


def create_daemon_app() -> FastAPI:
    init_db()

    daemon_app = FastAPI(
        title="TimeTrace API Engine",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    daemon_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount master aggregated router under /api/v1
    daemon_app.include_router(api_router, prefix="/api/v1")
    return daemon_app


@app.command()
def daemon(
    host: str = typer.Option("127.0.0.1", "--host", "-h", help="Host address to bind"),
    port: int = typer.Option(8002, "--port", "-p", help="Port number to bind"),
    reload: bool = typer.Option(
        False, "--reload", help="Enable auto-reload on code changes"
    ),
):
    """Starts the TimeTrace daemon web server."""
    typer.echo(f"🚀 Starting TimeTrace Daemon at http://{host}:{port}/api/v1/dashboard")
    uvicorn.run("timetrace.main:daemon_app", host=host, port=port, reload=reload)


daemon_app = create_daemon_app()

if __name__ == "__main__":
    app()
