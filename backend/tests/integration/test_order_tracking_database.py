"""Integration tests for order confirmation (US4) and pickup tracking (US6).

These go through the real API and real auth into the throwaway local Supabase that CI starts,
with no mocks in between. A status change is written straight to the database with the
service-role client, the way staff updates (US5) will store it, and the student's reads must
then return the stored status. Like the other integration tests, they only run against a
local database.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from postgrest.exceptions import APIError
from supabase import create_client

# Shared helpers and settings from the US3 order integration tests.
from test_orders_database import IS_LOCAL, SERVICE_KEY, SETTINGS, TEST_EMAIL, TEST_PASSWORD, place, sign_in

from app.orders import user_client

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (IS_LOCAL and TEST_EMAIL and TEST_PASSWORD and SERVICE_KEY),
        reason="Local Supabase is not running (start it with `supabase start`; see README)",
    ),
]


@pytest.fixture(scope="module")
def admin():
    """A service-role client, used only to set up and inspect database state."""
    return create_client(SETTINGS.supabase_url, SERVICE_KEY)


@pytest.fixture(scope="module")
def student():
    return sign_in(TEST_EMAIL, TEST_PASSWORD)


@pytest.fixture(scope="module")
def other_student(admin):
    email, password = f"tracking-test-{uuid4().hex[:8]}@example.com", f"pw-{uuid4().hex}"
    user = admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
    yield sign_in(email, password)
    admin.auth.admin.delete_user(user.id)


@pytest.fixture
def order(client, admin, student):
    """A freshly placed order for the test student, deleted afterwards."""
    response = place(client, student[0])
    assert response.status_code == 201
    saved = response.json()
    yield saved
    admin.table("orders").delete().eq("id", saved["id"]).execute()


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def stored_status(admin, order_id):
    return admin.table("orders").select("status").eq("id", order_id).execute().data[0]["status"]


def test_confirmation_reads_back_the_saved_order(client, student, order):
    """US4: refreshing the confirmation page re-reads exactly the order that was saved."""
    response = client.get(f"/orders/{order['id']}", headers=headers(student[0]))

    assert response.status_code == 200
    confirmation = response.json()
    assert confirmation == order
    assert confirmation["status"] == "Received"
    assert [item["name"] for item in confirmation["items"]] == ["Pub Burger", "Straight Cut Fries", "Sweet Tea"]


@pytest.mark.parametrize("status", ["Preparing", "Ready", "Collected"])
def test_student_sees_the_latest_stored_status(client, admin, student, order, status):
    """US6: after the status changes in the database, the order page and list both show it."""
    admin.table("orders").update({"status": status}).eq("id", order["id"]).execute()

    one = client.get(f"/orders/{order['id']}", headers=headers(student[0])).json()
    listed = {row["id"]: row for row in client.get("/orders", headers=headers(student[0])).json()}

    assert one["status"] == status
    assert listed[order["id"]]["status"] == status


def test_another_student_cannot_track_the_order(client, admin, other_student, order):
    """US4/US6 failure path: changing the id in the URL does not reveal someone else's order."""
    admin.table("orders").update({"status": "Ready"}).eq("id", order["id"]).execute()

    response = client.get(f"/orders/{order['id']}", headers=headers(other_student[0]))

    assert response.status_code == 404
    assert response.json() == {"detail": "Order not found."}


def test_student_cannot_change_their_own_order_status(admin, student, order):
    """US6 failure path: only staff may move an order along; the student's token is refused."""
    with pytest.raises(APIError):
        user_client(student[0]).from_("orders").update({"status": "Collected"}).eq("id", order["id"]).execute()

    assert stored_status(admin, order["id"]) == "Received"


def test_database_rejects_an_unknown_status(admin, order):
    """US6: the tracker only ever has to draw the known statuses."""
    with pytest.raises(APIError):
        admin.table("orders").update({"status": "Lost"}).eq("id", order["id"]).execute()

    assert stored_status(admin, order["id"]) == "Received"


def test_guest_cannot_track_an_order(client, order):
    assert client.get(f"/orders/{order['id']}").status_code == 401
    assert client.get("/orders").status_code == 401


def test_student_cancels_a_received_order(client, admin, student, order):
    """US23: cancelling stores Cancelled; repeating the request is harmless."""
    url = f"/orders/{order['id']}/cancel"

    first = client.post(url, headers=headers(student[0]))
    again = client.post(url, headers=headers(student[0]))

    assert first.status_code == 200
    assert first.json()["status"] == "Cancelled"
    assert again.status_code == 200
    assert stored_status(admin, order["id"]) == "Cancelled"


def test_another_student_cannot_cancel_the_order(client, admin, other_student, order):
    """US23 failure path: changing the id in the URL cannot cancel someone else's order."""
    response = client.post(f"/orders/{order['id']}/cancel", headers=headers(other_student[0]))

    assert response.status_code == 404
    assert stored_status(admin, order["id"]) == "Received"


def test_cancel_is_refused_once_the_kitchen_starts(client, admin, student, order):
    """US23 failure path: an order the kitchen is preparing stays in the queue."""
    admin.table("orders").update({"status": "Preparing"}).eq("id", order["id"]).execute()

    response = client.post(f"/orders/{order['id']}/cancel", headers=headers(student[0]))

    assert response.status_code == 409
    assert stored_status(admin, order["id"]) == "Preparing"
