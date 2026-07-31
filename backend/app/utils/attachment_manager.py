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


def process_uploaded_attachment(
    filename: str,
    file_bytes: bytes,
    workspace_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Saves uploaded file bytes to .yuki_attachments/ and returns attachment metadata dict.
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

    data_url = encode_image_to_base64_url(save_path) if is_img else None
    text_snippet = extract_file_text_content(save_path) if is_txt else ""

    return {
        "filename": clean_name,
        "save_path": save_path,
        "is_image": is_img,
        "is_text": is_txt,
        "file_size": len(file_bytes),
        "data_url": data_url,
        "text_content": text_snippet
    }
