import hmac
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


@dataclass(frozen=True)
class CurrentUser:
    email: str


class AuthError(Exception):
    def __init__(self, message: str, *, forbidden: bool = False) -> None:
        super().__init__(message)
        self.forbidden = forbidden


class TokenVerifier:
    def __init__(self, jwks_client: Any, allowed_emails: set[str], audience: str = "authenticated") -> None:
        self._jwks = jwks_client
        self._allowed = {e.lower() for e in allowed_emails}
        self._audience = audience

    def verify(self, token: str) -> CurrentUser:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, signing_key.key, algorithms=["RS256", "ES256"],
                                audience=self._audience)
        except jwt.PyJWTError:
            raise AuthError("invalid token") from None
        email = str(claims.get("email", "")).lower()
        if not email or email not in self._allowed:
            raise AuthError("this account is not allowed", forbidden=True)
        return CurrentUser(email=email)


@lru_cache
def _verifier_for(supabase_url: str, allowed: frozenset[str]) -> TokenVerifier:
    jwks = jwt.PyJWKClient(f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return TokenVerifier(jwks, set(allowed))


def get_verifier(settings: Settings = Depends(get_settings)) -> TokenVerifier:
    return _verifier_for(settings.supabase_url, frozenset(settings.allowed_email_set))


def require_user(
    authorization: str | None = Header(default=None),
    verifier: TokenVerifier = Depends(get_verifier),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        return verifier.verify(authorization[7:].strip())
    except AuthError as exc:
        raise HTTPException(status_code=403 if exc.forbidden else 401, detail=str(exc)) from None


def require_cron_or_user(
    x_cron_secret: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    verifier: TokenVerifier = Depends(get_verifier),
) -> str:
    if x_cron_secret and settings.cron_secret and hmac.compare_digest(
        x_cron_secret.encode(), settings.cron_secret.encode()
    ):
        return "cron"
    return require_user(authorization, verifier).email
