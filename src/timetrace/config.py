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

    model_config = SettingsConfigDict(env_prefix="TIMETRACE_")

    @property
    def database_url(self) -> str:
        self.db_file.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.db_file}"


settings = Settings()
