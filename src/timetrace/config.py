from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "TimeTrace"
    db_file: Path = Path.home() / ".timetrace" / "timetrace.db"
    host: str = "127.0.0.1"
    port: int = 8000

    model_config = SettingsConfigDict(env_prefix="TIMETRACE_")


settings = Settings()
