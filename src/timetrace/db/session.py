from sqlmodel import SQLModel, create_engine, Session, text
from timetrace.config import settings

settings.db_file.parent.mkdir(parents=True, exist_ok=True)

sqlite_url = f"sqlite:///{settings.db_file}"
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        # Safeguard migrations for existing DBs
        try:
            session.exec(text("ALTER TABLE task ADD COLUMN tags TEXT DEFAULT '';"))
            session.commit()
        except Exception:
            pass


def get_session():
    with Session(engine) as session:
        yield session
