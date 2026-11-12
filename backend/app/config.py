from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_key: str
    resend_api_key: str = ""
    notification_from_email: str = ""

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def email_configured(self) -> bool:
        return bool(self.resend_api_key and self.notification_from_email)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "").strip(),
        supabase_key=os.environ.get("SUPABASE_KEY", "").strip(),
        resend_api_key=os.environ.get("RESEND_API_KEY", "").strip(),
        notification_from_email=os.environ.get("NOTIFICATION_FROM_EMAIL", "").strip(),
    )
