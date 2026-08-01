"""
Attachment Manager Utility for Project Yuki.
Handles workspace file/image attachment uploads, text extraction for documents/code,
base64 data URL generation for multimodal vision models, and file cleanup.
"""

import os
import re
import base64
import mimetypes
from typing import Dict, Any, List, Optional, Tuple

ATTACHMENT_DIR_NAME = ".yuki_attachments"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}

# Images larger than this are re-encoded as downscaled WebP to keep LLM payloads small.
COMPRESS_THRESHOLD_BYTES = 1_048_576  # 1 MB
MAX_IMAGE_DIMENSION = 1280
WEBP_QUALITY = 90
TEXT_EXTENSIONS = {
    ".txt", ".md", ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".json",
    ".csv", ".yaml", ".yml", ".c", ".cpp", ".h", ".hpp", ".rs", ".go", ".java",
    ".sh", ".ps1", ".bat", ".sql", ".env", ".log", ".xml", ".ini", ".toml"
}


def get_attachment_directory(workspace_dir: Optional[str] = None) -> str:
    """Returns absolute path to the workspace attachment cache directory."""
    if not workspace_dir or not os.path.exists(workspace_dir):
        from app.tools.system import get_active_workspace_directory
        workspace_dir = get_active_workspace_directory()
    if not workspace_dir or not os.path.exists(workspace_dir):
        workspace_dir = os.getcwd()

    target_dir = os.path.join(workspace_dir, ATTACHMENT_DIR_NAME)
    os.makedirs(target_dir, exist_ok=True)
    return target_dir


def sanitize_filename(filename: str) -> str:
    """Sanitizes uploaded filename to prevent directory traversal and unsafe chars."""
    basename = os.path.basename(filename)
    clean = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', basename)
    return clean or "uploaded_file"


def is_image_file(file_path_or_name: str) -> bool:
    """Checks if a file path or name represents an image format."""
    ext = os.path.splitext(file_path_or_name)[1].lower()
    return ext in IMAGE_EXTENSIONS


def is_text_file(file_path_or_name: str) -> bool:
    """Checks if a file path or name represents a text/code document."""
    ext = os.path.splitext(file_path_or_name)[1].lower()
    return ext in TEXT_EXTENSIONS


def encode_image_to_base64_url(image_path: str) -> Optional[str]:
    """Encodes a local image file into a base64 Data URL for LLM vision payloads."""
    if not os.path.exists(image_path):
        return None
    
    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type or not mime_type.startswith("image/"):
        ext = os.path.splitext(image_path)[1].lower()
        mime_type = f"image/{ext.replace('.', '')}" if ext else "image/png"
        if mime_type == "image/jpg":
            mime_type = "image/jpeg"

    try:
        with open(image_path, "rb") as image_file:
            encoded_bytes = base64.b64encode(image_file.read()).decode("utf-8")
            return f"data:{mime_type};base64,{encoded_bytes}"
    except Exception as e:
        print(f"[AttachmentManager] Error encoding image '{image_path}': {e}")
        return None


def extract_file_text_content(file_path: str, max_chars: int = 12000) -> str:
    """Extracts readable text content from a text/code file with encoding fallbacks."""
    if not os.path.exists(file_path):
        return f"[Error: File '{file_path}' does not exist.]"

    encodings = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc, errors="replace") as f:
                content = f.read(max_chars)
                if len(content) >= max_chars:
                    content += "\n... [truncated for prompt length]"
                return content
        except Exception:
            continue
    return "[Error: Unable to decode file content.]"


def compress_large_image(save_path: str, file_size: int) -> Optional[str]:
    """
    Re-encodes a large raster image (>1MB) as a downscaled WebP (q90, max 1280px).
    Returns the compressed file path, or None when compression is not applicable
    or would not reduce the file size. The original is preserved unless replaced.
    """
    if not file_size or file_size <= COMPRESS_THRESHOLD_BYTES:
        return None
    if not is_image_file(save_path):
        return None

    ext = os.path.splitext(save_path)[1].lower()
    if ext == ".svg":
        return None

    try:
        from PIL import Image, ImageOps

        with Image.open(save_path) as img:
            if getattr(img, "is_animated", False):
                return None
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "LA", "PA"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

            tmp_path = f"{save_path}.yuki_tmp"
            img.save(tmp_path, "WEBP", quality=WEBP_QUALITY, method=4)
    except Exception as e:
        print(f"[AttachmentManager] Image compression failed for '{save_path}': {e}")
        return None

    try:
        if os.path.getsize(tmp_path) < file_size:
            final_path = save_path if ext == ".webp" else f"{os.path.splitext(save_path)[0]}.webp"
            os.replace(tmp_path, final_path)
            return final_path
        os.remove(tmp_path)
    except Exception as e:
        print(f"[AttachmentManager] Compression finalize failed for '{save_path}': {e}")
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return None


def process_uploaded_attachment(
    filename: str,
    file_bytes: bytes,
    workspace_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Saves uploaded file bytes to .yuki_attachments/ and returns attachment metadata dict.
    Large images (>1MB) are automatically re-encoded as downscaled WebP for token efficiency.
    """
    clean_name = sanitize_filename(filename)
    target_dir = get_attachment_directory(workspace_dir)
    save_path = os.path.join(target_dir, clean_name)

    # Prevent collision by appending index if file exists
    if os.path.exists(save_path):
        base, ext = os.path.splitext(clean_name)
        idx = 1
        while os.path.exists(os.path.join(target_dir, f"{base}_{idx}{ext}")):
            idx += 1
        clean_name = f"{base}_{idx}{ext}"
        save_path = os.path.join(target_dir, clean_name)

    with open(save_path, "wb") as f:
        f.write(file_bytes)

    is_img = is_image_file(clean_name)
    is_txt = is_text_file(clean_name)

    display_name = clean_name
    final_save_path = save_path
    final_size = len(file_bytes)

    if is_img:
        compressed_path = compress_large_image(save_path, final_size)
        if compressed_path:
            print(f"[AttachmentManager] Compressed '{clean_name}' ({final_size} bytes -> {os.path.getsize(compressed_path)} bytes) -> {os.path.basename(compressed_path)}")
            final_save_path = compressed_path
            final_size = os.path.getsize(compressed_path)

    data_url = encode_image_to_base64_url(final_save_path) if is_img else None
    text_snippet = extract_file_text_content(final_save_path) if is_txt else ""

    return {
        "filename": display_name,
        "save_path": final_save_path,
        "is_image": is_img,
        "is_text": is_txt,
        "file_size": final_size,
        "data_url": data_url,
        "text_content": text_snippet
    }
