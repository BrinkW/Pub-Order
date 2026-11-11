"""Kitchen-triggered order updates sent to the ordering student's email."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import bearer, get_current_user
from app.config import get_settings
from app.orders import access_token, fetch_order, require_kitchen, user_client

router = APIRouter()

STATUS_MESSAGES = {
    "Received": "The Pub received your order and will start preparing it soon.",
    "Preparing": "The Pub is preparing your order now.",
    "Ready": "Your Pub order is ready for pickup. Head to the counter and give staff your order number.",
    "Collected": "Your Pub order was marked as picked up.",
}


def deliver_order_email(recipient: str, order: dict[str, Any]) -> None:
    """Send one plain-text status email through Resend without exposing the API key."""
    settings = get_settings()
    if not settings.email_configured:
        raise HTTPException(503, "Email notifications are not configured.")

    short_id = str(order["id"])[:8].upper()
    status = order["status"]
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.notification_from_email,
                "to": [recipient],
                "subject": f"Pub order {short_id}: {status}",
                "text": f"{STATUS_MESSAGES.get(status, 'There is an update to your Pub order.')}\n\n"
                f"Order number: {short_id}\nStatus: {status}\n\n"
                "This is an automated message from the Pub Order student project.",
            },
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(503, "The email could not be sent. Please try again.") from exc


@router.post("/orders/{order_id}/notification")
def notify_student(
    order_id: UUID,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Email an order update. Only kitchen staff can see the address or trigger delivery."""
    token = access_token(credentials)
    try:
        require_kitchen(token, str(user.id))
        order = fetch_order(user_client(token), str(order_id))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Could not load this order. Please try again.") from exc
    if order is None:
        raise HTTPException(404, "Order not found.")
    recipient = order.get("studentEmail")
    if not recipient:
        raise HTTPException(409, "This order does not have a student email address.")
    deliver_order_email(recipient, order)
    return {"delivered": True}
