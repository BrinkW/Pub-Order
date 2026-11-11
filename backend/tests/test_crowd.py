from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import crowd
from app.auth import get_current_user
from app.main import app

HEADERS = {"Authorization": "Bearer test-token"}


class CrowdDatabase:
    def __init__(self):
        self.level = "moderate"
        self.rpc_calls = []

    def table(self, name):
        return self

    def select(self, columns):
        return self

    def eq(self, column, value):
        return self

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        self.level = params["p_level"]
        return self

    def execute(self):
        return SimpleNamespace(data=[{"level": self.level, "updated_at": "2026-11-11T14:00:00+00:00"}])


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="kitchen-1")
    yield
    app.dependency_overrides.clear()


def test_anyone_can_read_the_staff_reported_level(client, monkeypatch):
    database = CrowdDatabase()
    monkeypatch.setattr(crowd, "get_supabase", lambda: database)

    response = client.get("/crowd")

    assert response.status_code == 200
    assert response.json() == {"level": "moderate", "updatedAt": "2026-11-11T14:00:00+00:00"}
    assert response.headers["cache-control"] == "no-store"


def test_kitchen_staff_choose_the_current_level(client, signed_in, monkeypatch):
    database = CrowdDatabase()
    monkeypatch.setattr(crowd, "get_supabase", lambda: database)
    monkeypatch.setattr(crowd, "user_client", lambda token: database)
    monkeypatch.setattr(crowd, "require_kitchen", lambda token, user_id: None)

    response = client.patch("/crowd", json={"level": "busy"}, headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["level"] == "busy"
    assert database.rpc_calls == [("set_crowd_level", {"p_level": "busy"})]


def test_student_cannot_change_the_level(client, signed_in, monkeypatch):
    def forbidden(token, user_id):
        raise HTTPException(403, "Kitchen access required.")

    monkeypatch.setattr(crowd, "require_kitchen", forbidden)

    response = client.patch("/crowd", json={"level": "low"}, headers=HEADERS)

    assert response.status_code == 403


@pytest.mark.parametrize("level", ["empty", "packed", "", None])
def test_unknown_level_is_rejected(client, signed_in, level):
    response = client.patch("/crowd", json={"level": level}, headers=HEADERS)

    assert response.status_code == 422
