#!/usr/bin/env python3
"""Independent Python verifier for the published v1 crypto vectors.

This intentionally shares no implementation code with the TypeScript package.
It requires the third-party ``cryptography`` package for P-256 and AES-GCM.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


ROOT = Path(__file__).resolve().parents[1]
VECTORS = ROOT / "packages" / "crypto" / "test-vectors" / "v1.json"


def b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def private_key(jwk: dict[str, str]) -> ec.EllipticCurvePrivateKey:
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(b64url(jwk["x"]), "big"),
        int.from_bytes(b64url(jwk["y"]), "big"),
        ec.SECP256R1(),
    )
    return ec.EllipticCurvePrivateNumbers(int.from_bytes(b64url(jwk["d"]), "big"), numbers).private_key()


def public_key(jwk: dict[str, str]) -> ec.EllipticCurvePublicKey:
    return ec.EllipticCurvePublicNumbers(
        int.from_bytes(b64url(jwk["x"]), "big"),
        int.from_bytes(b64url(jwk["y"]), "big"),
        ec.SECP256R1(),
    ).public_key()


def canonical(domain: str, version: int, fields: dict[str, object]) -> bytes:
    record = {"domain": domain, "version": version, **fields}
    return json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def verify() -> None:
    vectors = json.loads(VECTORS.read_text())
    assert vectors["schema"] == "multaiplayer-crypto-test-vectors/v1"

    for vector in vectors["canonicalAuthenticatedRecord"]:
        encoded = canonical(vector["domain"], vector["version"], vector["fields"])
        assert encoded.decode() == vector["utf8"], vector["name"]
        assert encoded.hex() == vector["hex"], vector["name"]

    vector = vectors["authenticatedRoomSecretWrap"]
    fields = {**vector["context"], "operationId": None, "previousEpoch": None, "newEpoch": None}
    aad = canonical(vector["domain"], 1, fields)
    assert aad.decode() == vector["aadUtf8"]
    assert aad.hex() == vector["aadHex"]

    shared = private_key(vector["senderPrivateKeyJwk"]).exchange(
        ec.ECDH(), public_key(vector["recipientPublicKeyJwk"])
    )
    assert shared.hex() == vector["sharedSecretHex"]
    salt = hashlib.sha256(aad).digest()
    assert salt.hex() == vector["hkdfSaltHex"]
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=vector["domain"].encode()).derive(shared)
    ciphertext = AESGCM(key).encrypt(
        base64.b64decode(vector["nonceBase64"]), vector["plaintextUtf8"].encode(), aad
    )
    assert base64.b64encode(ciphertext).decode() == vector["ciphertextBase64"]

    recipient_shared = private_key(vector["recipientPrivateKeyJwk"]).exchange(
        ec.ECDH(), public_key(vector["senderPublicKeyJwk"])
    )
    assert recipient_shared == shared
    plaintext = AESGCM(
        HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=vector["domain"].encode()).derive(recipient_shared)
    ).decrypt(base64.b64decode(vector["nonceBase64"]), ciphertext, aad)
    assert plaintext.decode() == vector["plaintextUtf8"]


if __name__ == "__main__":
    try:
        verify()
    except (AssertionError, ValueError, KeyError) as error:
        print(f"crypto vector verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print("independent Python crypto vector verification passed")
