import base64
import hashlib
import re
import uuid

def _get_system_salt() -> bytes:
    """Generate a machine-bound salt for API key encryption."""
    node_id = str(uuid.getnode())
    return hashlib.sha256(f"yuki_secret_salt_key_{node_id}".encode()).digest()

def _encrypt_single_key(plain_key: str) -> str:
    if not plain_key or not plain_key.strip():
        return ""
    plain_key = plain_key.strip()
    if plain_key.startswith("enc_v1:"):
        return plain_key  # Already encrypted
    salt = _get_system_salt()
    key_bytes = plain_key.encode('utf-8')
    enc_bytes = bytearray()
    for i, b in enumerate(key_bytes):
        enc_bytes.append(b ^ salt[i % len(salt)])
    encoded = base64.b64encode(enc_bytes).decode('ascii')
    return f"enc_v1:{encoded}"

def _decrypt_single_key(encrypted_key: str) -> str:
    if not encrypted_key or not encrypted_key.strip():
        return ""
    encrypted_key = encrypted_key.strip()
    if not encrypted_key.startswith("enc_v1:"):
        return encrypted_key  # Fallback for plain keys
    encoded = encrypted_key[7:]
    try:
        enc_bytes = base64.b64decode(encoded.encode('ascii'))
        salt = _get_system_salt()
        dec_bytes = bytearray()
        for i, b in enumerate(enc_bytes):
            dec_bytes.append(b ^ salt[i % len(salt)])
        return dec_bytes.decode('utf-8')
    except Exception as e:
        print(f"[Security] Failed to decrypt API key: {e}")
        return ""

def _mask_single_key(key: str) -> str:
    decrypted = _decrypt_single_key(key) if key.startswith("enc_v1:") else key
    if not decrypted:
        return ""
    if len(decrypted) > 8:
        return decrypted[:4] + "..." + decrypted[-4:]
    return "****"

def encrypt_api_key(plain_key: str) -> str:
    """Encrypt plain API key string (or comma-separated pool) into enc_v1 token(s)."""
    if not plain_key or not plain_key.strip():
        return ""
    keys = [k.strip() for k in re.split(r'[,;\s]+', str(plain_key)) if k.strip()]
    if not keys:
        return ""
    return ", ".join(_encrypt_single_key(k) for k in keys)

def decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt enc_v1 token(s) back to plain API key string (or comma-separated pool)."""
    if not encrypted_key or not encrypted_key.strip():
        return ""
    keys = [k.strip() for k in re.split(r'[,;\s]+', str(encrypted_key)) if k.strip()]
    if not keys:
        return ""
    return ", ".join(_decrypt_single_key(k) for k in keys)

def mask_api_key(key: str) -> str:
    """Mask API key string (or comma-separated pool) for safe UI display (e.g. AIza...1234, AIza...5678)."""
    if not key or not key.strip():
        return ""
    decrypted = decrypt_api_key(key)
    keys = [k.strip() for k in re.split(r'[,;\s]+', str(decrypted)) if k.strip()]
    if not keys:
        return ""
    return ", ".join(_mask_single_key(k) for k in keys)
