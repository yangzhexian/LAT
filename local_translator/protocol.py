"""Local gateway identity and separate desktop / translation credentials."""
import hashlib
import secrets
import uuid

PROTOCOL_VERSION = 2
DESKTOP_ORIGINS = frozenset({"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
                             "http://127.0.0.1:1420", "http://localhost:1420"})


class GatewayIdentity:
    def __init__(self, settings):
        self.instance_id = settings.gateway_instance_id or uuid.uuid4().hex
        self.admin_token = settings.admin_token or secrets.token_urlsafe(32)
        self.api_key = settings.api_key

    def authorize(self, authorization: str, *, admin: bool) -> str | None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return None
        candidates = [self.admin_token] if admin else [self.admin_token, self.api_key]
        if any(value and secrets.compare_digest(token.encode(), value.encode()) for value in candidates):
            return hashlib.sha256(token.encode()).hexdigest()
        return None
