import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import AuthError, CurrentUser, TokenVerifier

PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJWKS:
    def __init__(self, key):
        self.key = key

    def get_signing_key_from_jwt(self, token):
        return self


def token(email="me@example.com", aud="authenticated", key=PRIVATE, expires_in=3600):
    claims = {"sub": "user-1", "email": email, "aud": aud, "exp": int(time.time()) + expires_in}
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def verifier():
    return TokenVerifier(FakeJWKS(PRIVATE.public_key()), {"me@example.com"})


def test_valid_token_for_allowed_email(verifier):
    assert verifier.verify(token(email="Me@Example.com")) == CurrentUser(email="me@example.com")


def test_other_email_is_forbidden(verifier):
    with pytest.raises(AuthError) as info:
        verifier.verify(token(email="stranger@example.com"))
    assert info.value.forbidden is True


@pytest.mark.parametrize(
    "bad",
    [
        lambda: token(expires_in=-10),
        lambda: token(aud="anon"),
        lambda: token(key=OTHER_PRIVATE),
        lambda: "not-a-jwt",
    ],
)
def test_invalid_tokens_are_rejected(verifier, bad):
    with pytest.raises(AuthError) as info:
        verifier.verify(bad())
    assert info.value.forbidden is False
