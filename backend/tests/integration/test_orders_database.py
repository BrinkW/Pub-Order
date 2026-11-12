"""Integration tests for placing and reading orders (US3) through the real API, real auth,
and a real database. Nothing is mocked: requests go through FastAPI and app/orders.py into
the throwaway local Supabase that CI starts. Like test_local_database.py, these only run
against a local database, so they can never change the team's hosted project.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import urlparse
from uuid import uuid4

import pytest
from postgrest.exceptions import APIError
from supabase import create_client

from app.config import get_settings
from app.orders import user_client

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


def sign_in(email, password):
    session = create_client(SETTINGS.supabase_url, SETTINGS.supabase_key).auth.sign_in_with_password(
        {"email": email, "password": password}
    ).session
    return session.access_token, session.user.id


@pytest.fixture(scope="module")
def admin():
    """A service-role client, used only to set up and inspect database state."""
    return create_client(SETTINGS.supabase_url, SERVICE_KEY)


@pytest.fixture(scope="module")
def student():
    return sign_in(TEST_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def other_student(admin):
    email, password = f"order-test-{uuid4().hex[:8]}@example.com", f"pw-{uuid4().hex}"
    user = admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
    yield sign_in(email, password)
    admin.auth.admin.delete_user(user.id)


@pytest.fixture
def placed(admin):
    """Order ids created by a test; deleted afterwards so reruns start clean."""
    ids: list[str] = []
    yield ids
    for order_id in ids:
        admin.table("orders").delete().eq("id", order_id).execute()


@pytest.fixture
def restore_burger(admin):
    yield
    admin.table("menu_items").update({"available": True}).eq("id", "pub-burger").execute()


def place(client, token, key=None, items=FULL_MEAL, swipes=1):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = {"swipes": swipes, "idempotencyKey": key or str(uuid4()), "items": items}
    return client.post("/orders", json=body, headers=headers)


def stored_orders(admin, key):
    return admin.table("orders").select("*").eq("idempotency_key", key).execute().data


def test_placing_an_order_stores_it_in_the_database(client, admin, student, placed):
    token, user_id = student
    key = str(uuid4())

    response = place(client, token, key)

    assert response.status_code == 201
    placed.append(response.json()["id"])
    [order] = stored_orders(admin, key)
    assert order["id"] == response.json()["id"]
    assert order["user_id"] == user_id
    assert order["status"] == "Received"
    assert order["swipes"] == 1
    items = (admin.table("order_items").select("menu_item_id,name,swipe_type,quantity")
             .eq("order_id", order["id"]).order("menu_item_id").execute().data)
    assert items == [
        {"menu_item_id": "pub-burger", "name": "Pub Burger", "swipe_type": "Entry", "quantity": 1},
        {"menu_item_id": "straight-cut-fries", "name": "Straight Cut Fries", "swipe_type": "Side", "quantity": 1},
        {"menu_item_id": "sweet-tea", "name": "Sweet Tea", "swipe_type": "Drink", "quantity": 1},
    ]


def test_retrying_with_the_same_key_stores_one_order(client, admin, student, placed):
    token, _ = student
    key = str(uuid4())

    first = place(client, token, key)
    second = place(client, token, key)

    assert first.status_code == second.status_code == 201
    placed.append(first.json()["id"])
    assert second.json()["id"] == first.json()["id"]
    assert len(stored_orders(admin, key)) == 1


def test_the_student_can_read_and_list_their_order(client, student, placed):
    token, _ = student
    order = place(client, token).json()
    placed.append(order["id"])
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get(f"/orders/{order['id']}", headers=headers).json() == order
    assert order["id"] in [listed["id"] for listed in client.get("/orders", headers=headers).json()]


def test_another_student_cannot_read_the_order(client, student, other_student, placed):
    order = place(client, student[0]).json()
    placed.append(order["id"])
    headers = {"Authorization": f"Bearer {other_student[0]}"}

    assert client.get(f"/orders/{order['id']}", headers=headers).status_code == 404
    assert order["id"] not in [listed["id"] for listed in client.get("/orders", headers=headers).json()]


def test_unavailable_item_is_refused_and_nothing_is_stored(client, admin, student, restore_burger):
    admin.table("menu_items").update({"available": False}).eq("id", "pub-burger").execute()
    key = str(uuid4())

    response = place(client, student[0], key)

    assert response.status_code == 409
    assert stored_orders(admin, key) == []


def test_guest_cannot_place_an_order(client, admin):
    key = str(uuid4())

    response = place(client, token=None, key=key)

    assert response.status_code == 401
    assert stored_orders(admin, key) == []


def test_student_cannot_insert_an_order_directly(admin, student):
    token, user_id = student
    key = str(uuid4())

    with pytest.raises(APIError):
        user_client(token).from_("orders").insert(
            {"user_id": user_id, "swipes": 1, "idempotency_key": key}
        ).execute()

    assert stored_orders(admin, key) == []


def test_database_function_rechecks_the_meal(admin, student):
    key = str(uuid4())

    with pytest.raises(APIError) as error:
        user_client(student[0]).rpc("place_order", {
            "p_idempotency_key": key, "p_swipes": 1, "p_items": [{"id": "pub-burger", "quantity": 1}],
        }).execute()

    assert error.value.code == "22023"
    assert stored_orders(admin, key) == []



def test_retry_after_menu_change_returns_saved_order(client, admin, student, placed, restore_burger):
    key = str(uuid4())
    first = place(client, student[0], key)
    assert first.status_code == 201
    placed.append(first.json()["id"])
    admin.table("menu_items").update({"available": False}).eq("id", "pub-burger").execute()

    retry = place(client, student[0], key)

    assert retry.status_code == 201
    assert retry.json() == first.json()
    assert len(stored_orders(admin, key)) == 1


def test_retry_keys_are_scoped_to_the_student(client, student, other_student, placed):
    key = str(uuid4())
    first = place(client, student[0], key)
    assert first.status_code == 201
    placed.append(first.json()["id"])
    second = place(client, other_student[0], key)
    assert second.status_code == 201
    placed.append(second.json()["id"])
    assert second.json()["id"] != first.json()["id"]
    assert place(client, student[0], key).json() == first.json()


@pytest.fixture
def fresh_student(admin):
    """A student with no orders yet. Deleting the account also deletes its orders."""
    email, password = f"limit-test-{uuid4().hex[:8]}@vanderbilt.edu", f"pw-{uuid4().hex}"
    user = admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
    yield sign_in(email, password)
    admin.auth.admin.delete_user(user.id)


def test_a_fourth_order_in_progress_is_refused(client, admin, fresh_student):
    """SEC-03 regression: a student can have at most 3 orders in progress, so a script can't
    flood the kitchen. A retry of an order already placed still returns it."""
    token, user_id = fresh_student
    first_key = str(uuid4())
    assert place(client, token, first_key).status_code == 201
    assert place(client, token).status_code == 201
    assert place(client, token).status_code == 201
    key = str(uuid4())

    response = place(client, token, key)

    assert response.status_code == 429
    assert "3 orders in progress" in response.json()["detail"]
    assert stored_orders(admin, key) == []
    assert place(client, token, first_key).status_code == 201
    stored = admin.table("orders").select("id").eq("user_id", user_id).execute().data
    assert len(stored) == 3


def test_retries_sent_together_at_the_limit_return_the_same_order(admin, fresh_student):
    """SEC-03 review on #38: with 2 orders in progress, the same order sent 4 times at once must
    save it once and return it to every request. Before the fix, a retry that arrived while
    the first request was saving counted that order as the third and got a 429."""
    token, user_id = fresh_student
    db = user_client(token)
    meal = [{"id": item["id"], "quantity": 1} for item in FULL_MEAL]
    for _ in range(2):
        db.rpc("place_order", {"p_idempotency_key": str(uuid4()), "p_swipes": 1, "p_items": meal}).execute()
    key = str(uuid4())
    start = Barrier(4)

    def send():
        client = user_client(token)
        start.wait()
        return client.rpc("place_order", {"p_idempotency_key": key, "p_swipes": 1, "p_items": meal}).execute().data

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: send(), range(4)))

    [order] = stored_orders(admin, key)
    assert results == [order["id"]] * 4
    assert len(admin.table("orders").select("id").eq("user_id", user_id).execute().data) == 3
