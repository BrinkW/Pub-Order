from types import SimpleNamespace

import pytest

from app import notifications
from app.auth import get_current_user
from app.config import Settings
from app.main import app

ORDER_ID = "0a1b2c3d-0000-4000-8000-000000000001"
HEADERS = {"Authorization": "Bearer test-token"}
ORDER = {
    "id": ORDER_ID,
    "status": "Ready",
    "swipes": 1,
    "createdAt": "2026-11-11T12:00:00+00:00",
    "studentEmail": "student@vanderbilt.edu",
    "items": [],
}


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="kitchen-1")
    yield
    app.dependency_overrides.clear()


def test_kitchen_can_email_the_student_for_an_order(client, signed_in, monkeypatch):
    delivered = []
    monkeypatch.setattr(notifications, "require_kitchen", lambda token, user_id: None)
    monkeypatch.setattr(notifications, "user_client", lambda token: object())
    monkeypatch.setattr(notifications, "fetch_order", lambda db, order_id: ORDER)
    monkeypatch.setattr(
        notifications,
        "deliver_order_email",
        lambda recipient, order: delivered.append((recipient, order)),
    )

    response = client.post(f"/orders/{ORDER_ID}/notification", headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == {"delivered": True}
    assert delivered == [("student@vanderbilt.edu", ORDER)]


def test_student_cannot_trigger_an_email(client, signed_in, monkeypatch):
    def forbidden(token, user_id):
        from fastapi import HTTPException

        raise HTTPException(403, "Kitchen access required.")

    monkeypatch.setattr(notifications, "require_kitchen", forbidden)

    response = client.post(f"/orders/{ORDER_ID}/notification", headers=HEADERS)

    assert response.status_code == 403
    assert response.json() == {"detail": "Kitchen access required."}


def test_order_without_email_is_not_sent(client, signed_in, monkeypatch):
    monkeypatch.setattr(notifications, "require_kitchen", lambda token, user_id: None)
    monkeypatch.setattr(notifications, "user_client", lambda token: object())
    monkeypatch.setattr(notifications, "fetch_order", lambda db, order_id: {**ORDER, "studentEmail": ""})

    response = client.post(f"/orders/{ORDER_ID}/notification", headers=HEADERS)

    assert response.status_code == 409
    assert response.json() == {"detail": "This order does not have a student email address."}


def test_email_delivery_uses_server_side_resend_configuration(monkeypatch):
    request = {}

    class SuccessfulResponse:
        def raise_for_status(self):
            return None

    def post(url, **kwargs):
        request.update(url=url, **kwargs)
        return SuccessfulResponse()

    monkeypatch.setattr(
        notifications,
        "get_settings",
        lambda: Settings("", "", "server-only-key", "Pub Order <orders@example.com>"),
    )
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.deliver_order_email("student@vanderbilt.edu", ORDER)

    assert request["url"] == "https://api.resend.com/emails"
    assert request["headers"] == {"Authorization": "Bearer server-only-key"}
    assert request["json"]["to"] == ["student@vanderbilt.edu"]
    assert "READY" not in request["json"]["subject"]
    assert "Ready" in request["json"]["subject"]


def test_cancelled_order_email_says_it_was_cancelled(monkeypatch):
    request = {}

    class SuccessfulResponse:
        def raise_for_status(self):
            return None

    def post(url, **kwargs):
        request.update(url=url, **kwargs)
        return SuccessfulResponse()

    monkeypatch.setattr(
        notifications,
        "get_settings",
        lambda: Settings("", "", "server-only-key", "Pub Order <orders@example.com>"),
    )
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.deliver_order_email("student@vanderbilt.edu", {**ORDER, "status": "Cancelled"})

    assert request["json"]["text"].startswith("Your Pub order was cancelled")
