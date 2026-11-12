"""Public crowd level with kitchen-only updates."""

from __future__ import annotations

from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict

from app.auth import bearer, get_current_user, get_supabase
from app.orders import access_token, require_kitchen, user_client

router = APIRouter()
CrowdLevel = Literal["low", "moderate", "busy"]


class CrowdUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: CrowdLevel


def load_crowd() -> dict[str, Any]:
    try:
        rows = cast(
            list[dict[str, Any]],
            get_supabase().table("crowd_status").select("level,updated_at").eq("id", True).execute().data,
        )
    except Exception as exc:
        raise HTTPException(503, "Crowd level is temporarily unavailable.") from exc
    if not rows:
        return {"level": "not_reported", "updatedAt": None}
    return {"level": rows[0]["level"], "updatedAt": rows[0]["updated_at"]}


@router.get("/crowd")
def read_crowd(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return load_crowd()


@router.patch("/crowd")
def update_crowd(
    change: CrowdUpdate,
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    token = access_token(credentials)
    try:
        require_kitchen(token, str(user.id))
        user_client(token).rpc("set_crowd_level", {"p_level": change.level}).execute()
    except APIError as exc:
        if exc.code == "42501":
            raise HTTPException(403, "Kitchen access required.") from exc
        if exc.code == "22023":
            raise HTTPException(422, "Choose Low, Moderate, or Busy.") from exc
        raise HTTPException(503, "Could not update the crowd level. Please try again.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Could not update the crowd level. Please try again.") from exc
    return load_crowd()
