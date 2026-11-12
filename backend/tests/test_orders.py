from __future__ import annotations

import re
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest
from postgrest.exceptions import APIError

from app import menu, orders
from app.auth import get_current_user
from app.main import app

KEY = "6f1d2c34-5b6a-4e7f-8a9b-0c1d2e3f4a5b"
ORDER_ID = "0a1b2c3d-0000-4000-8000-000000000001"
HEADERS = {"Authorization": "Bearer test-token"}


class FakeDatabase:
    """Stands in for the per-request PostgREST client used by app.orders."""

    def __init__(self):
        self.rpc_calls = []
        self.rpc_result = ORDER_ID
        self.rpc_error = None
        self.rows = [{
            "id": ORDER_ID, "status": "Received", "swipes": 1, "created_at": "2026-10-19T12:00:00+00:00",
            "order_items": [
                {"menu_item_id": "tea", "name": "Tea", "swipe_type": "Drink", "quantity": 1},
                {"menu_item_id": "burger", "name": "Burger", "swipe_type": "Entry", "quantity": 1},
                {"menu_item_id": "fries", "name": "Fries", "swipe_type": "Side", "quantity": 1},
            ],
        }]

        self.select_error = None
        self.orderings = []
        self.limits = []
        self.lower_than = []
        self.or_filters = []

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        self.mode, self.filter = "rpc", None
        return self

    def from_(self, table):
        self.mode, self.filter, self.cutoff, self.page, self.key_cutoff = "select", None, None, None, None
        self.orderings = []
        return self

    def select(self, columns):
        return self

    def eq(self, column, value):
        self.filter = (column, value)
        return self

    def order(self, column, desc=False):
        self.orderings.append((column, desc))
        return self

    def lt(self, column, value):
        self.lower_than.append((column, value))
        self.cutoff = value
        return self

    def or_(self, filters):
        """Understands only the history cursor: older than (created_at, id)."""
        self.or_filters.append(filters)
        match = re.fullmatch(r'created_at\.lt\."([^"]+)",and\(created_at\.eq\."\1",id\.lt\.([0-9a-f-]+)\)', filters)
        assert match, f"unexpected or filter: {filters}"
        self.key_cutoff = (datetime.fromisoformat(match[1]), match[2])
        return self

    def limit(self, size):
        self.limits.append(size)
        self.page = size
        return self

    def execute(self):
        if self.mode == "rpc":
            if self.rpc_error is not None:
                raise self.rpc_error
            for row in self.rows:
                if row["id"] == self.rpc_result:
                    row["idempotency_key"] = self.rpc_calls[-1][1]["p_idempotency_key"]
            return SimpleNamespace(data=self.rpc_result)
        if self.select_error is not None:
            raise self.select_error
        rows = self.rows
        if self.filter is not None:
            rows = [row for row in rows if row.get(self.filter[0]) == self.filter[1]]
        if self.cutoff is not None:
            cutoff = datetime.fromisoformat(self.cutoff)
            rows = [row for row in rows if datetime.fromisoformat(row["created_at"]) < cutoff]
        if self.key_cutoff is not None:
            stamp, last_id = self.key_cutoff
            rows = [row for row in rows if (datetime.fromisoformat(row["created_at"]), row["id"]) < (stamp, last_id)]
        if self.orderings:
            rows = sorted(rows, key=lambda row: (datetime.fromisoformat(row["created_at"]), row["id"]), reverse=True)
        if self.page is not None:
            rows = rows[:self.page]
        return SimpleNamespace(data=rows)


@pytest.fixture
def catalog():
    return [dict(id=id, name=name, category=kind, swipe_type=kind, available=True)
            for id, name, kind in [("burger", "Burger", "Entry"), ("fries", "Fries", "Side"), ("tea", "Tea", "Drink")]]


@pytest.fixture
def menu_database(monkeypatch, catalog):
    client = MagicMock()
    query = client.table.return_value.select.return_value.order.return_value
    query.execute.return_value = SimpleNamespace(data=catalog)
    monkeypatch.setattr(menu, "get_supabase", lambda: client)
    return client


@pytest.fixture
def database(monkeypatch):
    fake = FakeDatabase()
    fake.tokens = []

    def user_client(token):
        fake.tokens.append(token)
        return fake

    monkeypatch.setattr(orders, "user_client", user_client)
    return fake


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="student-1")
    yield
    app.dependency_overrides.clear()


def meal(**changes):
    body = {
        "swipes": 1,
        "idempotencyKey": KEY,
        "items": [dict(id=id, quantity=1, expectedSwipeType=kind)
                  for id, kind in [("burger", "Entry"), ("fries", "Side"), ("tea", "Drink")]],
    }
    return {**body, **changes}


def test_place_order_saves_and_returns_the_order(client, menu_database, database, signed_in):
    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 201
    assert response.json() == {
        "id": ORDER_ID, "status": "Received", "swipes": 1, "createdAt": "2026-10-19T12:00:00+00:00",
        "items": [
            {"id": "burger", "name": "Burger", "swipeType": "Entry", "quantity": 1, "customization": ""},
            {"id": "fries", "name": "Fries", "swipeType": "Side", "quantity": 1, "customization": ""},
            {"id": "tea", "name": "Tea", "swipeType": "Drink", "quantity": 1, "customization": ""},
        ],
    }
    assert database.tokens == ["test-token"]
    assert database.rpc_calls == [("place_order", {
        "p_idempotency_key": KEY,
        "p_swipes": 1,
        "p_items": [
            {"id": "burger", "quantity": 1, "customization": ""},
            {"id": "fries", "quantity": 1, "customization": ""},
            {"id": "tea", "quantity": 1, "customization": ""},
        ],
    })]


def test_a_sauce_is_saved_only_for_the_item_that_offers_it():
    assert orders.customization_text("chicken-tenders", ["ranch", "no-onion"]) == "Ranch"
    assert orders.customization_text("pub-burger", ["no-cheese", "no-onion", "ketchup"]) == (
        "No cheese, No onion, Ketchup"
    )
    assert orders.customization_text("beyond-burger-patty", ["ranch", "no-lettuce"]) == "No lettuce"


def test_unchecked_ingredients_are_saved_as_no_labels(client, menu_database, database, signed_in):
    database.rows[0]["order_items"][1]["customization"] = "No onion, No tomato"
    body = meal()
    body["items"][0]["customizations"] = ["no-onion", "no-tomato", "not-an-option"]

    response = client.post("/orders", json=body, headers=HEADERS)

    assert response.status_code == 201
    assert response.json()["items"][0]["customization"] == "No onion, No tomato"
    assert database.rpc_calls[0][1]["p_items"][0]["customization"] == "No onion, No tomato"
    assert database.rpc_calls[0][1]["p_items"][1]["customization"] == ""


def test_meal_needing_review_is_not_saved(client, menu_database, catalog, database, signed_in):
    catalog[0]["available"] = False

    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 409
    assert response.json()["detail"]["issues"][0]["code"] == "unavailable"
    assert database.rpc_calls == []


def test_incomplete_meal_is_not_saved(client, menu_database, database, signed_in):
    response = client.post("/orders", json=meal(items=[{"id": "burger", "quantity": 1, "expectedSwipeType": "Entry"}]),
                           headers=HEADERS)

    assert response.status_code == 409
    assert {issue["code"] for issue in response.json()["detail"]["issues"]} == {"composition"}
    assert database.rpc_calls == []


def test_guest_cannot_place_an_order(client, menu_database, database):
    response = client.post("/orders", json=meal())

    assert response.status_code == 401
    assert database.rpc_calls == []


@pytest.mark.parametrize("body", [
    {key: value for key, value in meal().items() if key != "idempotencyKey"},
    meal(idempotencyKey="not-a-uuid"),
    meal(total=3),
    meal(swipes=11),
])
def test_invalid_requests_are_rejected(client, menu_database, database, signed_in, body):
    response = client.post("/orders", json=body, headers=HEADERS)

    assert response.status_code == 422
    assert database.rpc_calls == []


def test_database_rejecting_the_meal_becomes_409(client, menu_database, database, signed_in):
    database.rpc_error = APIError({"message": "place_order: an item is unavailable", "code": "22023"})

    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 409
    assert "menu changed" in response.json()["detail"]["message"]


@pytest.mark.parametrize(("details", "message"), [
    ("open_orders", "You already have 3 orders in progress."),
    ("recent_orders", "You've placed 5 orders in the last 10 minutes."),
    (None, "You already have 3 orders in progress."),
])
def test_order_limit_becomes_429_with_the_reason(client, menu_database, database, signed_in, details, message):
    """SEC-03: the database refuses an order over a student's limit; the API says which limit."""
    database.rpc_error = APIError({"message": "place_order: private", "code": "PT429", "details": details})

    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 429
    assert response.json()["detail"].startswith(message)
    assert "private" not in response.text


@pytest.mark.parametrize("error", [
    APIError({"message": "private database details", "code": "XX000"}),
    httpx.ConnectError("private connection details"),
])
def test_database_failures_are_sanitized(client, menu_database, database, signed_in, error):
    database.rpc_error = error

    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 503
    assert "private" not in response.text
    assert "cart is still here" in response.json()["detail"]


def test_order_that_cannot_be_read_back_is_503(client, menu_database, database, signed_in):
    database.rows = []

    response = client.post("/orders", json=meal(), headers=HEADERS)

    assert response.status_code == 503


def test_user_client_acts_as_the_student(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "anon-key")

    db = orders.user_client("student-token")

    assert str(db.base_url).rstrip("/") == "https://example.supabase.co/rest/v1"
    assert db.headers["Authorization"] == "Bearer student-token"
    assert db.headers["apikey"] == "anon-key"
    assert db.headers["Accept"] == "application/json"


OLDER = {"id": "0a1b2c3d-0000-4000-8000-000000000002", "status": "Collected", "swipes": 1,
         "created_at": "2026-10-18T09:00:00+00:00", "order_items": []}


def test_lists_the_students_orders_newest_first(client, database, signed_in):
    database.rows = [database.rows[0], OLDER]

    response = client.get("/orders", headers=HEADERS)

    assert response.status_code == 200
    assert [order["id"] for order in response.json()] == [ORDER_ID, OLDER["id"]]
    assert database.orderings == [("created_at", True), ("id", True)]
    assert database.tokens == ["test-token"]


def test_history_is_capped_at_one_page(client, database, signed_in):
    """US2 / A04: one request never returns a student's whole history."""
    response = client.get("/orders", headers=HEADERS)

    assert response.status_code == 200
    assert database.limits == [orders.MAX_ORDER_PAGE]
    assert database.lower_than == []


def test_history_pages_back_from_the_last_order_shown(client, database, signed_in):
    """US2: "Load older orders" asks for orders placed before the oldest one on screen."""
    database.rows = [database.rows[0], OLDER]

    response = client.get(
        "/orders", params={"limit": 20, "before": "2026-10-19T12:00:00+00:00"}, headers=HEADERS,
    )

    assert response.status_code == 200
    assert [order["id"] for order in response.json()] == [OLDER["id"]]
    assert database.limits == [20]
    assert database.lower_than == [("created_at", "2026-10-19T12:00:00+00:00")]


def test_history_paging_never_skips_orders_placed_at_the_same_instant(client, database, signed_in):
    """US2 review: a page that ends in the middle of a timestamp tie picks up where it left off."""
    same = "2026-10-19T12:00:00+00:00"
    ids = [f"0a1b2c3d-0000-4000-8000-00000000000{n}" for n in range(1, 6)]
    database.rows = [{**OLDER, "id": order_id, "created_at": same} for order_id in ids]

    seen, cursor = [], {}
    for _ in range(3):
        page = client.get("/orders", params={"limit": 2, **cursor}, headers=HEADERS).json()
        seen += [order["id"] for order in page]
        if page:
            cursor = {"before": page[-1]["createdAt"], "beforeId": page[-1]["id"]}

    assert seen == sorted(ids, reverse=True)
    assert database.or_filters[0] == (
        f'created_at.lt."2026-10-19T12:00:00+00:00",and(created_at.eq."2026-10-19T12:00:00+00:00",id.lt.{ids[3]})'
    )


def test_history_cursor_is_compared_in_utc():
    cursor = orders.history_cursor(datetime.fromisoformat("2026-10-19T07:00:00-05:00"), UUID(ORDER_ID))

    noon = "2026-10-19T12:00:00+00:00"
    assert cursor == f'created_at.lt."{noon}",and(created_at.eq."{noon}",id.lt.{ORDER_ID})'


def test_history_needs_a_time_with_an_id(client, database, signed_in):
    response = client.get("/orders", params={"beforeId": ORDER_ID}, headers=HEADERS)

    assert response.status_code == 422
    assert database.tokens == []


@pytest.mark.parametrize("params", [
    {"limit": 0}, {"limit": orders.MAX_ORDER_PAGE + 1}, {"limit": "all"}, {"before": "yesterday"},
    {"before": "2026-10-19T12:00:00+00:00", "beforeId": "not-an-id"},
])
def test_history_rejects_bad_paging(client, database, signed_in, params):
    response = client.get("/orders", params=params, headers=HEADERS)

    assert response.status_code == 422
    assert database.tokens == []


def test_reads_one_of_the_students_orders(client, database, signed_in):
    response = client.get(f"/orders/{ORDER_ID}", headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["id"] == ORDER_ID
    assert [item["swipeType"] for item in response.json()["items"]] == ["Entry", "Side", "Drink"]


def test_an_order_the_student_cannot_see_is_404(client, database, signed_in):
    response = client.get("/orders/0a1b2c3d-0000-4000-8000-0000000000ff", headers=HEADERS)

    assert response.status_code == 404
    assert response.json() == {"detail": "Order not found."}


def test_an_invalid_order_id_is_422(client, database, signed_in):
    assert client.get("/orders/not-an-id", headers=HEADERS).status_code == 422


@pytest.mark.parametrize("path", ["/orders", f"/orders/{ORDER_ID}"])
def test_guest_cannot_read_orders(client, database, path):
    response = client.get(path)

    assert response.status_code == 401
    assert database.tokens == []


@pytest.mark.parametrize("path", ["/orders", f"/orders/{ORDER_ID}"])
def test_read_failures_are_sanitized(client, database, signed_in, path):
    database.select_error = APIError({"message": "private database details", "code": "XX000"})

    response = client.get(path, headers=HEADERS)

    assert response.status_code == 503
    assert "private" not in response.text


@pytest.mark.parametrize("menu_offline", [False, True])
def test_retry_returns_saved_order_without_revalidating_menu(
    client, menu_database, catalog, database, signed_in, menu_offline,
):
    first = client.post("/orders", json=meal(), headers=HEADERS)
    assert first.status_code == 201
    catalog[0]["available"] = False
    query = menu_database.table.return_value.select.return_value.order.return_value
    if menu_offline:
        query.execute.side_effect = RuntimeError("Menu offline")
    query.execute.reset_mock()

    retry = client.post("/orders", json=meal(), headers=HEADERS)

    assert retry.status_code == 201
    assert retry.json() == first.json()
    assert len(database.rpc_calls) == 1
    query.execute.assert_not_called()


def test_failed_retry_lookup_does_not_create_an_order(client, menu_database, database, signed_in):
    database.select_error = RuntimeError("private database details")
    response = client.post("/orders", json=meal(), headers=HEADERS)
    assert response.status_code == 503
    assert "private" not in response.text
    assert database.rpc_calls == []
