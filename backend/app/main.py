from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import bearer, get_current_user
from app.crowd import router as crowd_router
from app.menu import router as menu_router
from app.notifications import router as notifications_router
from app.orders import access_token, fetch_role
from app.orders import router as orders_router

app = FastAPI()
app.include_router(menu_router)
app.include_router(orders_router)
app.include_router(crowd_router)
app.include_router(notifications_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/me")
def read_me(
    user=Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    try:
        role = fetch_role(access_token(credentials), str(user.id))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Could not load your account. Please try again.") from exc
    return {"id": str(user.id), "email": user.email, "role": role}
