from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session as DBSession

from timetrace.db.models import Task, TaskReview, TaskStatus
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import (
    TaskCreate,
    TaskReviewCreate,
    TaskStatusCreate,
    TaskStatusUpdate,
    TaskUpdate,
)
from timetrace.services import TaskService

router = APIRouter(prefix="/tasks", tags=["Tasks"])


# ============================================================
# 1. STATIC ROUTES
# ============================================================

@router.get("/statuses", response_model=list[TaskStatus])
def list_task_statuses(db: DBSession = Depends(get_session)):
    return TaskService(db).list_statuses()


@router.post("/statuses", response_model=TaskStatus, status_code=status.HTTP_201_CREATED)
def create_task_status(req: TaskStatusCreate, db: DBSession = Depends(get_session)):
    return TaskService(db).create_status(req)


@router.put("/statuses/{status_id}", response_model=TaskStatus)
def update_task_status(status_id: int, req: TaskStatusUpdate, db: DBSession = Depends(get_session)):
    return TaskService(db).update_status(status_id, req)


@router.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_status(status_id: int, db: DBSession = Depends(get_session)):
    TaskService(db).delete_status(status_id)
    return None


@router.delete("/completed", status_code=status.HTTP_200_OK)
def delete_completed_tasks(db: DBSession = Depends(get_session)):
    count = TaskService(db).delete_completed_tasks()
    return {"status": "success", "deleted_count": count}


# ============================================================
# 2. ROOT COLLECTION ROUTES
# ============================================================

@router.post("", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(task: TaskCreate, db: DBSession = Depends(get_session)):
    return TaskService(db).create_task(task)


@router.get("", response_model=list[Task])
def list_tasks(
    status_filter: str | None = Query(None, alias="status"),
    category_filter: str | None = Query(None, alias="category"),
    assigned_date: str | None = Query(None, alias="assigned_date"),
    due_before: str | None = Query(None, alias="due_before"),
    sort_by: str | None = Query("smart_gap_filler", alias="sort"),
    db: DBSession = Depends(get_session)
):
    return TaskService(db).list_tasks(
        status_filter=status_filter,
        sort_by=sort_by or "smart_gap_filler",
        category_filter=category_filter,
        assigned_date=assigned_date,
        due_before=due_before
    )


# ============================================================
# 3. DYNAMIC PARAMETER ROUTES
# ============================================================

@router.get("/{task_id}", response_model=Task)
def get_task_by_id(task_id: int, db: DBSession = Depends(get_session)):
    stats = TaskService(db).get_task_statistics(task_id)
    return stats["task"]


@router.get("/{task_id}/tree")
def get_task_tree(task_id: int, db: DBSession = Depends(get_session)):
    return TaskService(db).get_task_tree(task_id)


@router.get("/{task_id}/stats")
def get_task_statistics(task_id: int, db: DBSession = Depends(get_session)):
    return TaskService(db).get_task_statistics(task_id)


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, task_data: TaskUpdate, db: DBSession = Depends(get_session)):
    return TaskService(db).update_task(task_id, task_data)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: DBSession = Depends(get_session)):
    TaskService(db).delete_task(task_id)
    return None


# Task Review Sub-Router
task_reviews_router = APIRouter(prefix="/task-reviews", tags=["Task Reviews"])


@task_reviews_router.post("", response_model=TaskReview, status_code=status.HTTP_201_CREATED)
def create_or_update_task_review(req: TaskReviewCreate, db: DBSession = Depends(get_session)):
    return TaskService(db).create_or_update_task_review(req)


@task_reviews_router.get("/{task_id}")
def get_task_review(task_id: int, db: DBSession = Depends(get_session)):
    return TaskService(db).get_task_review(task_id)
