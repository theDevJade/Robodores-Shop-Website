from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Robotics Shop Portal"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7
    database_url: str = "sqlite:///./robotics.db"
    upload_root: Path = Path("uploads")
    google_service_account_file: Path | None = None
    google_sheet_id: str | None = None
    allowed_hosts: list[str] = ["*"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    return settings
