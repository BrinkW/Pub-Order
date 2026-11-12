from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import menu
from app.auth import get_current_user
from app.main import app


@pytest.fixture
def catalog():
    return [dict(id=id, name=name, category=kind, swipe_type=kind, available=True)
            for id, name, kind in [("burger", "Burger", "Entry"), ("fries", "Fries", "Side"), ("tea", "Tea", "Drink")]]


@pytest.fixture
def database(monkeypatch, catalog):
    client = MagicMock()
    query = client.table.return_value.select.return_value.order.return_value
    query.execute.return_value = SimpleNamespace(data=catalog)
    monkeypatch.setattr(menu, "get_supabase", lambda: client)
    return client


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="student-1")
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def cart():
    return {"swipes": 1, "items": [dict(id=id, quantity=1, expectedSwipeType=kind)
            for id, kind in [("burger", "Entry"), ("fries", "Side"), ("tea", "Drink")]]}


def test_public_menu_reads_database_and_maps_fields(client, database):
    response = client.get('/menu')
    assert response.status_code == 200
    assert response.json()[0] == dict(
        id="burger", name="Burger", category="Entry", swipeType="Entry", available=True,
        description="", portion="", label="", markers=[], image="",
    )
    database.table.assert_called_once_with('menu_items')


def test_menu_returns_every_marker_for_an_item(client, database, catalog):
    catalog[0]['markers'] = ['Gluten', 'Sesame', 'Features Local Ingredient']

    assert client.get('/menu').json()[0]['markers'] == ['Gluten', 'Sesame', 'Features Local Ingredient']


def test_empty_menu(client, database, catalog):
    catalog.clear()
    assert client.get('/menu').json() == []


def test_unavailable_items_remain_visible(client, database, catalog):
    catalog[0]['available'] = False
    assert client.get('/menu').json()[0]['available'] is False


def test_database_failure_is_sanitized(client, database):
    database.table.side_effect = RuntimeError('private database details')
    response = client.get('/menu')
    assert response.status_code == 503
    assert 'private' not in response.text


def test_malformed_catalog_fails_closed(client, database, catalog):
    catalog[0]['swipe_type'] = 'Invalid'
    assert client.get('/menu').status_code == 503


def test_unknown_marker_fails_closed(client, database, catalog):
    catalog[0]['markers'] = ['Made Up Marker']

    assert client.get('/menu').status_code == 503


def test_guest_cannot_review(client, database, cart):
    assert client.post('/checkout/review', json=cart).status_code == 401
    database.table.assert_not_called()


def test_invalid_token_cannot_review(client, database, cart, fake_auth):
    fake_auth.result = SimpleNamespace(user=None)
    assert client.post('/checkout/review', json=cart, headers={'Authorization': 'Bearer invalid'}).status_code == 401
    database.table.assert_not_called()


def test_valid_meal_uses_database_values_and_never_writes(client, database, signed_in, cart):
    response = client.post('/checkout/review', json=cart)
    assert response.status_code == 200
    body = response.json()
    assert body['canSubmit'] is True
    assert body['swipes'] == 1
    assert body['counts'] == dict(Entry=1, Side=1, Drink=1)
    assert body['items'][0]['name'] == 'Burger'
    assert body['items'][0]['quantity'] == 1
    assert body['issues'] == []
    database.table.return_value.insert.assert_not_called()
    database.table.return_value.update.assert_not_called()


@pytest.mark.parametrize('value', [0, -1, 1.5, '1', True, 11, None])
def test_invalid_quantities(client, database, signed_in, cart, value):
    cart['items'][0]['quantity'] = value
    assert client.post('/checkout/review', json=cart).status_code == 422
    database.table.assert_not_called()


@pytest.mark.parametrize('value', [0, -1, 1.5, '1', True, 11, None])
def test_invalid_swipe_counts(client, database, signed_in, cart, value):
    cart['swipes'] = value
    assert client.post('/checkout/review', json=cart).status_code == 422


def test_empty_and_duplicate_carts(client, database, signed_in, cart):
    assert client.post('/checkout/review', json={**cart, 'items': []}).status_code == 422
    cart['items'].append(deepcopy(cart['items'][0]))
    assert client.post('/checkout/review', json=cart).status_code == 422


@pytest.mark.parametrize('mutation', ['deleted', 'unavailable', 'changed'])
def test_catalog_changes_block_checkout(client, database, catalog, signed_in, cart, mutation):
    if mutation == 'deleted':
        catalog.pop(0)
    elif mutation == 'unavailable':
        catalog[0]['available'] = False
    else:
        catalog[0]['swipe_type'] = 'Side'
    body = client.post('/checkout/review', json=cart).json()
    assert body['canSubmit'] is False
    assert any(issue.get('id') == 'burger' for issue in body['issues'])


def test_complete_two_swipe_meal(client, database, signed_in, cart):
    cart['swipes'] = 2
    for item in cart['items']:
        item['quantity'] = 2
    assert client.post('/checkout/review', json=cart).json()['canSubmit'] is True


def test_a_meal_can_skip_the_side(client, database, signed_in, cart):
    cart["items"] = [item for item in cart["items"] if item["id"] != "fries"]
    body = client.post("/checkout/review", json=cart).json()
    assert body["canSubmit"] is True
    assert body["counts"] == {"Entry": 1, "Side": 0, "Drink": 1}


def test_under_and_over_filled_meals(client, database, signed_in, cart):
    for quantity in [1, 3]:
        cart['swipes'] = 2
        cart['items'][0]['quantity'] = quantity
        body = client.post('/checkout/review', json=cart).json()
        assert body['canSubmit'] is False
        assert any(issue['code'] == 'composition' for issue in body['issues'])


def test_review_fails_without_database(client, database, signed_in, cart):
    database.table.side_effect = RuntimeError('offline')
    assert client.post('/checkout/review', json=cart).status_code == 503


def test_extra_client_fields_rejected(client, database, signed_in, cart):
    cart['items'][0]['available'] = True
    assert client.post('/checkout/review', json=cart).status_code == 422
