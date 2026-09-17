"""Private process-local configuration, never returned as application settings."""
import secrets

from fastapi.responses import JSONResponse

session_token = None
host = None
state_directory = None


def protect(request):
    if session_token is None:
        return None
    if request.headers.get("host") != host:
        return JSONResponse({"detail": "Invalid local service host"}, status_code=403)
    public = request.method in {"GET", "HEAD"} and (
        request.url.path == "/" or request.url.path.startswith("/static/")
    )
    if not public and not secrets.compare_digest(
        request.headers.get("authorization", ""), "Bearer " + session_token
    ):
        return JSONResponse(
            {"detail": "Open this console from DynamoDB Tools or VS Code."},
            status_code=401,
        )
    return None
