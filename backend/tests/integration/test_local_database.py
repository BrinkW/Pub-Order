"""Integration tests through the real API, real auth, and a real database.

Nothing is mocked: requests go through FastAPI, `get_current_user` and `app/menu.py` into a
throwaway local Supabase (Postgres + Auth + REST) that CI starts with
.github/scripts/start-local-supabase.sh. Tests that change data only run against a local
database (127.0.0.1 / localhost), so they can never modify the team's hosted project.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import pytest
from postgrest.exceptions import APIError
from supabase import create_client

from app.config import get_settings

TEST_EMAIL = os.environ.get("PUB_ORDER_TEST_EMAIL", "").strip()
TEST_PASSWORD = os.environ.get("PUB_ORDER_TEST_PASSWORD", "")
SERVICE_KEY = os.environ.get("PUB_ORDER_TEST_SERVICE_KEY", "").strip()
SETTINGS = get_settings()
IS_LOCAL = urlparse(SETTINGS.supabase_url).hostname in {"127.0.0.1", "localhost"}

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (IS_LOCAL and TEST_EMAIL and TEST_PASSWORD and SERVICE_KEY),
        reason="Local Supabase is not running (start it with `supabase start`; see README)",
    ),
]

FULL_MEAL = [
    {"id": "pub-burger", "quantity": 1, "expectedSwipeType": "Entry"},
    {"id": "straight-cut-fries", "quantity": 1, "expectedSwipeType": "Side"},
    {"id": "sweet-tea", "quantity": 1, "expectedSwipeType": "Drink"},
]


@pytest.fixture(scope="module")
def admin():
    """A service-role client, used only to set up and inspect database state."""
    return create_client(SETTINGS.supabase_url, SERVICE_KEY)


@pytest.fixture(scope="module")
def access_token():
    supabase = create_client(SETTINGS.supabase_url, SETTINGS.supabase_key)
    response = supabase.auth.sign_in_with_password({"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return response.session.access_token


@pytest.fixture
def restore_burger(admin):
    yield
    admin.table("menu_items").update({"available": True}).eq("id", "pub-burger").execute()


def menu_rows(admin):
    return admin.table("menu_items").select("*").order("id").execute().data


def review(client, token, items=FULL_MEAL, swipes=1):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post("/checkout/review", json={"swipes": swipes, "items": items}, headers=headers)


def test_menu_reads_seeded_rows_from_database(client, admin):
    stored = admin.table("menu_items").select("id").order("sort_order").execute().data

    response = client.get("/menu")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [row["id"] for row in stored]
    assert len(stored) == 22
    assert response.json()[0] == {
        "id": "beyond-burger-patty", "name": "Beyond Burger Patty", "category": "Grill Main",
        "swipeType": "Entry", "description": "", "portion": "1 patty", "label": "Vegan",
        "markers": ["Vegan"],
        "image": "beyond-burger-patty.jpg", "available": True,
    }


def test_menu_reflects_a_database_change(client, admin, restore_burger):
    admin.table("menu_items").update({"available": False}).eq("id", "pub-burger").execute()

    burger = next(item for item in client.get("/menu").json() if item["id"] == "pub-burger")

    assert burger["available"] is False


def test_checkout_review_with_real_login(client, access_token):
    response = review(client, access_token)

    assert response.status_code == 200
    body = response.json()
    assert body["canSubmit"] is True
    assert body["counts"] == {"Entry": 1, "Side": 1, "Drink": 1}
    assert [item["name"] for item in body["items"]] == ["Pub Burger", "Straight Cut Fries", "Sweet Tea"]


def test_checkout_review_flags_item_unavailable_in_database(client, admin, access_token, restore_burger):
    admin.table("menu_items").update({"available": False}).eq("id", "pub-burger").execute()

    body = review(client, access_token).json()

    assert body["canSubmit"] is False
    assert {"id": "pub-burger", "code": "unavailable"}.items() <= body["issues"][0].items()


def test_checkout_review_rejects_guest(client):
    response = review(client, token=None)

    assert response.status_code == 401


def test_checkout_review_never_writes_to_the_database(client, admin, access_token):
    before = menu_rows(admin)

    review(client, access_token)

    assert menu_rows(admin) == before


def test_guest_cannot_change_the_menu(admin):
    guest = create_client(SETTINGS.supabase_url, SETTINGS.supabase_key)

    with pytest.raises(APIError):
        guest.table("menu_items").update({"available": False}).eq("id", "pub-burger").execute()

    burger = admin.table("menu_items").select("available").eq("id", "pub-burger").execute().data
    assert burger == [{"available": True}]
