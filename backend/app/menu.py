"""Public catalog and authenticated, read-only checkout review (US1 / US2)."""
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user, get_supabase

router = APIRouter()
SwipeType = Literal["Entry", "Side", "Drink"]
StrictQuantity = Annotated[int, Field(strict=True, ge=1, le=10)]


class MenuItem(BaseModel):
    id: str
    name: str
    category: str
    swipeType: SwipeType
    description: str = ""
    portion: str = ""
    label: str = ""
    image: str = ""
    available: bool


def load_menu() -> list[MenuItem]:
    try:
        response = get_supabase().table("menu_items").select(
            "id,name,category,swipe_type,description,portion,label,image,available"
        ).order("sort_order").execute()
        rows = cast(list[dict[str, Any]], response.data)
        return [MenuItem.model_validate({**row, "swipeType": row["swipe_type"]}) for row in rows]
    except Exception as exc:
        # Do not leak database details or credentials to the browser.
        raise HTTPException(503, "Menu is temporarily unavailable. Please try again.") from exc


@router.get("/menu", response_model=list[MenuItem])
def read_menu(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return load_menu()


class CheckoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(min_length=1, max_length=100)]
    quantity: StrictQuantity
    expectedSwipeType: SwipeType
    customizations: Annotated[list[Annotated[str, Field(max_length=40)]], Field(max_length=8)] = []


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    swipes: StrictQuantity
    items: Annotated[list[CheckoutItem], Field(min_length=1, max_length=30)]


@router.post("/checkout/review")
def review_checkout(cart: CheckoutRequest, user=Depends(get_current_user)):
    """Return current database values; this endpoint never creates an order."""
    return review_cart(cart)


_KIND = {"Entry": "entrée", "Side": "side", "Drink": "drink"}
_KINDS = {"Entry": "entrées", "Side": "sides", "Drink": "drinks"}


def _composition_message(kind: str, needed: int, have: int) -> str:
    singular = _KIND[kind]
    plural = _KINDS[kind]
    if needed == 1 and have == 0:
        return f"Add {'an' if kind == 'Entry' else 'a'} {singular} before sending this order."
    if needed == 1:
        return f"This order can only include one {singular}."
    return f"This order needs {needed} {plural}. It has {have}."


def review_cart(cart: CheckoutRequest) -> dict[str, Any]:
    """Check a cart against the current menu. Shared by checkout review and order placement."""
    ids = [item.id for item in cart.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Each menu item must appear only once.")
    catalog = {item.id: item for item in load_menu()}
    counts = {"Entry": 0, "Side": 0, "Drink": 0}
    issues: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for requested in cart.items:
        current = catalog.get(requested.id)
        if current is None:
            issues.append({
                "id": requested.id,
                "code": "unavailable",
                "message": f"{requested.id} is no longer on the menu. Take it off your order.",
            })
            continue
        items.append({**current.model_dump(), "quantity": requested.quantity})
        counts[current.swipeType] += requested.quantity
        if not current.available:
            issues.append({
                "id": current.id,
                "code": "unavailable",
                "message": f"{current.name} is sold out. Pick something else.",
            })
        if current.swipeType != requested.expectedSwipeType:
            issues.append({
                "id": current.id,
                "code": "changed",
                "message": f"{current.name} is now a {_KIND[current.swipeType]}. Look over your order again.",
            })
    for kind, count in counts.items():
        # A side can be skipped. Entrées and drinks still have to match the meal swipes.
        if kind == "Side" and count == 0:
            continue
        if count != cart.swipes:
            issues.append({
                "code": "composition",
                "message": _composition_message(kind, cart.swipes, count),
            })
    return {"items": items, "swipes": cart.swipes, "counts": counts, "issues": issues, "canSubmit": not issues}
