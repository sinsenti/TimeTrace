from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "TimeTrace"
    db_file: Path = Path.home() / ".timetrace" / "timetrace.db"
    host: str = "127.0.0.1"
    port: int = 8002

    # Inactivity / Idle Detection Settings
    idle_detection_enabled: bool = True
    idle_threshold_seconds: int = 600  # 10 minutes

    # Read-only SQL widgets (statistics dashboards, slice 3).
    # OFF by default: the sandbox (a read-only VFS handle + `PRAGMA query_only` + a
    # default-DENY sqlite3 authorizer, see `core/sql_guard.py`) is defence in depth, but an
    # arbitrary-SQL surface is still opt-in, not something a fresh install exposes.
    sql_widgets_enabled: bool = False
    sql_query_timeout_ms: int = 2000
    sql_max_rows: int = 1000
    sql_max_length: int = 4000

    model_config = SettingsConfigDict(env_prefix="TIMETRACE_")

    @property
    def database_url(self) -> str:
        self.db_file.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.db_file}"


settings = Settings()
