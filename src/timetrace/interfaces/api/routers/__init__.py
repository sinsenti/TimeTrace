from fastapi import APIRouter

from timetrace.interfaces.api.routers.analytics import router as analytics_router
from timetrace.interfaces.api.routers.habits import router as habits_router
from timetrace.interfaces.api.routers.ratings import router as ratings_router
from timetrace.interfaces.api.routers.revision import router as revision_router
from timetrace.interfaces.api.routers.sessions import router as sessions_router
from timetrace.interfaces.api.routers.tasks import router as tasks_router
from timetrace.interfaces.api.routers.tasks import task_reviews_router
from timetrace.interfaces.api.routers.timer import idle_router
from timetrace.interfaces.api.routers.timer import router as timer_router

api_router = APIRouter()

# Register JSON REST API endpoints
api_router.include_router(tasks_router)
api_router.include_router(task_reviews_router)
api_router.include_router(sessions_router)
api_router.include_router(timer_router)
api_router.include_router(idle_router)
api_router.include_router(revision_router)
api_router.include_router(ratings_router)
api_router.include_router(habits_router)
api_router.include_router(analytics_router)
