"""SEC-02 through real Supabase Auth: only @vanderbilt.edu addresses can sign up.

Sign-up goes from the browser straight to Supabase Auth, never through our API, so these
tests call Auth the same way, with the public key. Like the other database tests they only
run against the throwaway local Supabase, and they delete any account they create.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse
from uuid import uuid4

import pytest
from supabase import create_client
from supabase_auth.errors import AuthApiError

from app.config import get_settings

SERVICE_KEY = os.environ.get("PUB_ORDER_TEST_SERVICE_KEY", "").strip()
SETTINGS = get_settings()
IS_LOCAL = urlparse(SETTINGS.supabase_url).hostname in {"127.0.0.1", "localhost"}

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (IS_LOCAL and SERVICE_KEY),
        reason="Local Supabase is not running (start it with `supabase start`; see README)",
    ),
]


@pytest.fixture(scope="module")
def admin():
    """A service-role client, used only to inspect and clean up accounts."""
    return create_client(SETTINGS.supabase_url, SERVICE_KEY)


@pytest.fixture
def new_email(admin):
    """Hands out unique addresses and deletes any account made with them afterwards."""
    emails: list[str] = []

    def make(domain: str) -> str:
        emails.append(f"signup-test-{uuid4().hex[:8]}@{domain}")
        return emails[-1]

    yield make
    for user in admin.auth.admin.list_users():
        if user.email in emails:
            admin.auth.admin.delete_user(user.id)


def sign_up(email: str):
    auth = create_client(SETTINGS.supabase_url, SETTINGS.supabase_key).auth
    return auth.sign_up({"email": email, "password": f"pw-{uuid4().hex}"})


def test_signup_with_a_non_vanderbilt_email_is_refused(admin, new_email):
    email = new_email("gmail.com")

    with pytest.raises(AuthApiError):
        sign_up(email)

    assert email not in {user.email for user in admin.auth.admin.list_users()}


def test_signup_with_a_vanderbilt_email_creates_a_student(admin, new_email):
    email = new_email("vanderbilt.edu")

    user = sign_up(email).user

    assert user is not None and user.email == email
    roles = admin.table("profiles").select("role").eq("user_id", user.id).execute().data
    assert roles == [{"role": "student"}]
