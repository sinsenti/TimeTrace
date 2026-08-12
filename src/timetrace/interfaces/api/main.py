from fastapi import FastAPI
from timetrace.interfaces.api.routers import api_router

app = FastAPI(
    title="TimeTrace API", version="1.0.0", docs_url="/docs", redoc_url="/redoc"
)

# Register master aggregated router
app.include_router(api_router, prefix="/api/v1")
