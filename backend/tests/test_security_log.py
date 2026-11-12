"""SEC-04 / OWASP A09: refused requests are logged, without the token that was sent."""

from __future__ import annotations

import logging
from types import SimpleNamespace

from supabase_auth.errors import AuthApiError

from app import orders
from app.auth import get_current_user
from app.main import app

SECRET_TOKEN = "eyJ-not-a-real-token-but-it-must-never-be-logged"
ORDER_ID = "0a1b2c3d-0000-4000-8000-000000000001"


def security_records(caplog):
    return [record for record in caplog.records if record.name == "pub_order.security"]


def test_missing_sign_in_is_logged(client, caplog):
    caplog.set_level(logging.WARNING, logger="pub_order.security")

    response = client.get("/orders")

    assert response.status_code == 401
    [record] = security_records(caplog)
    assert "status=401" in record.getMessage()
    assert "method=GET path=/orders" in record.getMessage()


def test_a_bad_token_is_logged_without_the_token(client, fake_auth, caplog):
    caplog.set_level(logging.WARNING, logger="pub_order.security")
    fake_auth.result = AuthApiError("invalid JWT", 401, "bad_jwt")

    response = client.get(
        f"/orders/{ORDER_ID}?token={SECRET_TOKEN}", headers={"Authorization": f"Bearer {SECRET_TOKEN}"},
    )

    assert response.status_code == 401
    [record] = security_records(caplog)
    assert f"path=/orders/{ORDER_ID}" in record.getMessage()
    assert SECRET_TOKEN not in caplog.text
    assert "Bearer" not in caplog.text


def test_a_student_calling_a_kitchen_route_is_logged(client, caplog, monkeypatch):
    caplog.set_level(logging.WARNING, logger="pub_order.security")
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="student-1")
    monkeypatch.setattr(orders, "fetch_role", lambda token, user_id: "student")
    try:
        response = client.patch(
            f"/orders/{ORDER_ID}", json={"status": "Ready"}, headers={"Authorization": f"Bearer {SECRET_TOKEN}"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    [record] = security_records(caplog)
    assert "status=403 reason=not allowed method=PATCH" in record.getMessage()
    assert SECRET_TOKEN not in caplog.text


def test_allowed_requests_are_not_logged(client, caplog):
    caplog.set_level(logging.WARNING, logger="pub_order.security")

    client.options("/me", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})

    assert security_records(caplog) == []
