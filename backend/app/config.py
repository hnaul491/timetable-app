from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    allowed_emails: str = ""
    supabase_url: str = ""
    cron_secret: str = ""
    token_encryption_key: str = ""
    zeus_ics_key: str = ""
    zeus_base_url: str = "https://zeus.ionis-it.com"

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
