"""US23: a student cancels their own order while it is still Received.

The ownership and status checks live in the cancel_order() database function (covered by the
integration tests); these check how the route calls it and maps its errors."""

from __future__ import annotations

import pytest
from postgrest.exceptions import APIError
from test_kitchen import HEADERS, ORDER, ORDER_ID, database, signed_in  # noqa: F401 (fixtures)

from app import orders


def test_student_can_cancel_their_order(client, database, signed_in):  # noqa: F811
    database.row = {**ORDER, "status": "Cancelled"}

    response = client.post(f"/orders/{ORDER_ID}/cancel", headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["status"] == "Cancelled"
    assert database.rpc_calls == [("cancel_order", {"p_order_id": ORDER_ID})]


@pytest.mark.parametrize(
    ("code", "status", "detail"),
    [
        ("P0002", 404, "Order not found."),
        ("55000", 409, "The kitchen has already started this order, so it can't be cancelled."),
        ("XX000", 503, "Could not cancel this order. Please try again."),
    ],
)
def test_cancel_errors_are_mapped(client, database, signed_in, code, status, detail):  # noqa: F811
    database.rpc_error = APIError({"message": "cancel_order: internal detail", "code": code})

    response = client.post(f"/orders/{ORDER_ID}/cancel", headers=HEADERS)

    assert response.status_code == status
    assert response.json() == {"detail": detail}


def test_cancel_requires_a_token(client, database, signed_in):  # noqa: F811
    response = client.post(f"/orders/{ORDER_ID}/cancel")

    assert response.status_code == 401
    assert database.rpc_calls == []


def test_cancel_rejects_a_malformed_order_id(client, database, signed_in):  # noqa: F811
    response = client.post("/orders/not-an-id/cancel", headers=HEADERS)

    assert response.status_code == 422
    assert database.rpc_calls == []


def test_kitchen_cannot_reopen_a_cancelled_order(client, database, signed_in, monkeypatch):  # noqa: F811
    monkeypatch.setattr(orders, "fetch_role", lambda token, user_id: "kitchen")
    database.rpc_error = APIError({"message": "set_order_status: the order was cancelled", "code": "55000"})

    response = client.patch(f"/orders/{ORDER_ID}", json={"status": "Preparing"}, headers=HEADERS)

    assert response.status_code == 409
    assert response.json() == {"detail": "This order was cancelled by the student."}
