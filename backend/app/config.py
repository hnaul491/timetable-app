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
    google_client_id: str = ""
    google_client_secret: str = ""
    app_url: str = "https://timetable-app-lake.vercel.app"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.token_encryption_key)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
