"""Placing and reading a student's orders (US3; the read endpoints also serve US4 and US6).

The database only accepts orders through the place_order() function, which re-checks the
meal and saves the order with its items in one transaction. Requests act as the signed-in
student, so row-level security applies."""

from __future__ import annotations

from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from postgrest import SyncPostgrestClient
from postgrest.constants import DEFAULT_POSTGREST_CLIENT_HEADERS
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field

from app.auth import bearer, get_current_user
from app.config import get_settings
from app.customizations import customization_text
from app.menu import CheckoutRequest, review_cart

router = APIRouter()

ORDER_COLUMNS = "id,status,swipes,created_at,order_items(menu_item_id,name,swipe_type,quantity,customization)"
TYPE_ORDER = ["Entry", "Side", "Drink"]
INVALID_ORDER = "22023"  # errcode raised by place_order() for a meal it won't accept
WRONG_STATE = "55000"  # errcode for a cancel that is too late, or a status change to a cancelled order


class PlaceOrderRequest(CheckoutRequest):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: UUID


class OrderStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["Received", "Preparing", "Ready", "Collected"]


class AvailabilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    available: bool


def user_client(token: str) -> SyncPostgrestClient:
    """A database client that acts as the signed-in student."""
    settings = get_settings()
    return SyncPostgrestClient(
        f"{settings.supabase_url}/rest/v1",
        headers={
            **DEFAULT_POSTGREST_CLIENT_HEADERS,
            "apikey": settings.supabase_key,
            "Authorization": f"Bearer {token}",
        },
    )


def access_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None:
        raise HTTPException(401, "Sign in required.")
    return credentials.credentials


def fetch_role(token: str, user_id: str) -> str:
    """The account's role. A missing profile is a student; only the profiles table can say kitchen."""
    try:
        rows = cast(
            list[dict[str, Any]],
            user_client(token).from_("profiles").select("role").eq("user_id", user_id).execute().data,
        )
    except APIError as exc:
        # The role table is added by migration. Until that runs, every account stays a student.
        if exc.code in {"42P01", "PGRST205"}:
            return "student"
        raise
    return "kitchen" if rows and rows[0].get("role") == "kitchen" else "student"


def require_kitchen(token: str, user_id: str) -> None:
    if fetch_role(token, user_id) != "kitchen":
        raise HTTPException(403, "Kitchen access required.")


def order_json(row: dict[str, Any]) -> dict[str, Any]:
    items = sorted(
        row.get("order_items") or [],
        key=lambda item: (TYPE_ORDER.index(item["swipe_type"]), item["name"]),
    )
    return {
        "id": row["id"],
        "status": row["status"],
        "swipes": row["swipes"],
        "createdAt": row["created_at"],
        "items": [
            {"id": item["menu_item_id"], "name": item["name"], "swipeType": item["swipe_type"],
             "quantity": item["quantity"], "customization": item.get("customization") or ""}
            for item in items
        ],
    }


def fetch_order(db: SyncPostgrestClient, value: str, column: str = "id") -> dict[str, Any] | None:
    rows = cast(list[dict[str, Any]], db.from_("orders").select(ORDER_COLUMNS).eq(column, value).execute().data)
    return order_json(rows[0]) if rows else None


@router.post("/orders", status_code=201)
def place_order(
    order: PlaceOrderRequest,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Save a reviewed meal as an order. Repeating the same idempotencyKey returns the same order."""
    db = user_client(access_token(credentials))
    # A retry acknowledges the saved order even if today's menu has changed or is offline.
    # This client uses the student's token, so RLS also applies to the key lookup.
    try:
        existing = fetch_order(db, str(order.idempotencyKey), "idempotency_key")
    except Exception as exc:
        raise HTTPException(503, "Could not check your order. Your cart is still here; please try again.") from exc
    if existing is not None:
        return existing

    review = review_cart(order)
    if not review["canSubmit"]:
        raise HTTPException(409, {"message": "Your meal needs review before ordering.", "issues": review["issues"]})

    params: Any = {
        "p_idempotency_key": str(order.idempotencyKey),
        "p_swipes": order.swipes,
        "p_items": [{
            "id": item.id,
            "quantity": item.quantity,
            "customization": customization_text(item.id, item.customizations),
        } for item in order.items],
    }
    try:
        order_id = db.rpc("place_order", params).execute().data
        saved = fetch_order(db, str(order_id))
    except APIError as exc:
        if exc.code == INVALID_ORDER:
            raise HTTPException(409, {
                "message": "The menu changed while you were ordering. Review your meal and try again.",
                "issues": [],
            }) from exc
        raise HTTPException(503, "Could not save your order. Your cart is still here; please try again.") from exc
    except Exception as exc:
        # Do not leak database details or credentials to the browser.
        raise HTTPException(503, "Could not save your order. Your cart is still here; please try again.") from exc
    if saved is None:
        raise HTTPException(503, "Could not save your order. Your cart is still here; please try again.")
    return saved


@router.get("/orders")
def list_orders(
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """The signed-in student's orders, newest first. Row-level security hides everyone else's."""
    db = user_client(access_token(credentials))
    try:
        rows = cast(
            list[dict[str, Any]],
            db.from_("orders").select(ORDER_COLUMNS).order("created_at", desc=True).execute().data,
        )
    except Exception as exc:
        raise HTTPException(503, "Could not load your orders. Please try again.") from exc
    return [order_json(row) for row in rows]


@router.get("/orders/{order_id}")
def read_order(
    order_id: UUID,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """One of the signed-in student's orders. Someone else's order looks the same as a missing one."""
    db = user_client(access_token(credentials))
    try:
        saved = fetch_order(db, str(order_id))
    except Exception as exc:
        raise HTTPException(503, "Could not load this order. Please try again.") from exc
    if saved is None:
        raise HTTPException(404, "Order not found.")
    return saved


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: UUID,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Cancel one of the signed-in student's orders while the kitchen hasn't started it (US23).

    The database function checks ownership and status in one update, so this route can't
    cancel someone else's order or race with a kitchen status change."""
    db = user_client(access_token(credentials))
    try:
        db.rpc("cancel_order", {"p_order_id": str(order_id)}).execute()
        saved = fetch_order(db, str(order_id))
    except APIError as exc:
        if exc.code == "P0002":
            raise HTTPException(404, "Order not found.") from exc
        if exc.code == WRONG_STATE:
            raise HTTPException(409, "The kitchen has already started this order, so it can't be cancelled.") from exc
        raise HTTPException(503, "Could not cancel this order. Please try again.") from exc
    except Exception as exc:
        raise HTTPException(503, "Could not cancel this order. Please try again.") from exc
    if saved is None:
        raise HTTPException(404, "Order not found.")
    return saved


@router.patch("/orders/{order_id}")
def update_order_status(
    order_id: UUID,
    change: OrderStatusUpdate,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Move any order to a new status. Students cannot call this; the database checks again."""
    token = access_token(credentials)
    db = user_client(token)
    try:
        require_kitchen(token, str(user.id))
        db.rpc("set_order_status", {"p_order_id": str(order_id), "p_status": change.status}).execute()
        saved = fetch_order(db, str(order_id))
    except APIError as exc:
        if exc.code == "42501":
            raise HTTPException(403, "Kitchen access required.") from exc
        if exc.code == "P0002":
            raise HTTPException(404, "Order not found.") from exc
        if exc.code == "22023":
            raise HTTPException(422, "That status is not allowed.") from exc
        if exc.code == WRONG_STATE:
            raise HTTPException(409, "This order was cancelled by the student.") from exc
        raise HTTPException(503, "Could not update this order. Please try again.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Could not update this order. Please try again.") from exc
    if saved is None:
        raise HTTPException(404, "Order not found.")
    return saved


@router.patch("/menu/{item_id}")
def update_item_availability(
    item_id: Annotated[str, Field(min_length=1, max_length=100)],
    change: AvailabilityUpdate,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Mark a menu item sold out or available. Students cannot call this."""
    token = access_token(credentials)
    db = user_client(token)
    try:
        require_kitchen(token, str(user.id))
        params: Any = {"p_id": item_id, "p_available": change.available}
        db.rpc("set_item_availability", params).execute()
    except APIError as exc:
        if exc.code == "42501":
            raise HTTPException(403, "Kitchen access required.") from exc
        if exc.code == "P0002":
            raise HTTPException(404, "Menu item not found.") from exc
        raise HTTPException(503, "Could not update this item. Please try again.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Could not update this item. Please try again.") from exc
    return {"id": item_id, "available": change.available}
