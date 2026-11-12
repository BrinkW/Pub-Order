"""Security logging (OWASP A09, finding SEC-04): record every refused request.

Each 401 (not signed in, or a bad token) and 403 (signed in, but not allowed, like a student
calling a kitchen route) is logged with the method, path and client address only. Headers,
query strings and bodies are never logged, so access tokens and passwords can't end up in the
logs. Failed sign-ins happen in Supabase Auth, not here, and show up in Supabase's auth logs.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

logger = logging.getLogger("pub_order.security")
REFUSED = {401: "not signed in or invalid token", 403: "not allowed"}


async def log_refused_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    reason = REFUSED.get(response.status_code)
    if reason:
        client = request.client.host if request.client else "-"
        logger.warning(
            "refused request: status=%s reason=%s method=%s path=%s client=%s",
            response.status_code, reason, request.method, request.url.path, client,
        )
    return response
