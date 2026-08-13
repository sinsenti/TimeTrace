
from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session as DBSession

from timetrace.db.models import Task, TaskReview
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import TaskCreate, TaskReviewCreate, TaskUpdate
from timetrace.services import TaskService

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.post("", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(task: TaskCreate, db: DBSession = Depends(get_session)):
    return TaskService(db).create_task(task)


@router.get("", response_model=list[Task])
def list_tasks(
    status_filter: str | None = Query(None, alias="status"),
    sort_by: str | None = Query("priority", alias="sort"),
    db: DBSession = Depends(get_session)
):
    return TaskService(db).list_tasks(status_filter=status_filter, sort_by=sort_by or "priority")


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, task_data: TaskUpdate, db: DBSession = Depends(get_session)):
    return TaskService(db).update_task(task_id, task_data)


@router.delete("/completed", status_code=status.HTTP_200_OK)
def delete_completed_tasks(db: DBSession = Depends(get_session)):
    count = TaskService(db).delete_completed_tasks()
    return {"status": "success", "deleted_count": count}


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: DBSession = Depends(get_session)):
    TaskService(db).delete_task(task_id)
    return None


@router.get("/{task_id}/stats")
def get_task_statistics(task_id: int, db: DBSession = Depends(get_session)):
    return TaskService(db).get_task_statistics(task_id)


# Task Review Sub-Router
task_reviews_router = APIRouter(prefix="/task-reviews", tags=["Task Reviews"])


@task_reviews_router.post("", response_model=TaskReview, status_code=status.HTTP_201_CREATED)
def create_or_update_task_review(req: TaskReviewCreate, db: DBSession = Depends(get_session)):
    return TaskService(db).create_or_update_task_review(req)


@task_reviews_router.get("/{task_id}")
def get_task_review(task_id: int, db: DBSession = Depends(get_session)):
    return TaskService(db).get_task_review(task_id)
