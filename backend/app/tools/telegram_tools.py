"""
Specialized Telegram Tools for Project Yuki.
Enables Yuki to directly capture & upload screenshots and transfer files/folders
to the user's active Telegram chat.
"""

import os
import time
import zipfile
import asyncio
from typing import Optional
from pathlib import Path

from app import config
from app.utils.attachment_manager import get_attachment_directory, is_image_file


async def telegram_send_screenshot(caption: str = "") -> str:
    """
    Captures the primary monitor screen of the user's PC and uploads it directly
    to the user's active Telegram chat.
    """
    try:
        from app.tools.scheduled_tasks import capture_screenshot
        result = capture_screenshot()
        if "captured screenshot:" not in result:
            return f"Error: Failed to capture screen screenshot ({result})"
        
        img_path = result.split("captured screenshot:", 1)[1].strip()
        if not os.path.exists(img_path):
            return f"Error: Screenshot file was not found at '{img_path}'."
        
        from app.channels import telegram_service
        sent = await telegram_service.send_file_to_active_chat(img_path, caption=caption or f"📸 Desktop Screenshot ({time.strftime('%I:%M %p')})")
        if sent:
            return f"Successfully captured screen and sent screenshot to user's Telegram: {img_path}"
        else:
            return f"Captured screenshot at '{img_path}', but no active Telegram chat is currently open to receive it."
    except Exception as e:
        return f"Error capturing/sending screenshot to Telegram: {str(e)}"


async def telegram_send_file(file_or_folder_path: str, caption: str = "") -> str:
    """
    Sends any file, photo, document, or auto-zips a folder and sends it directly
    to the user's active Telegram chat.
    """
    if not file_or_folder_path:
        return "Error: No file_or_folder_path provided."
    
    clean_path = os.path.abspath(file_or_folder_path.strip().strip('"').strip("'"))
    if not os.path.exists(clean_path):
        return f"Error: The target path '{clean_path}' does not exist on this computer."
    
    try:
        from app.channels import telegram_service
        sent = await telegram_service.send_file_to_active_chat(clean_path, caption=caption)
        if sent:
            if os.path.isdir(clean_path):
                return f"Successfully compressed folder and sent '{clean_path}' to user's Telegram as a zip archive."
            else:
                return f"Successfully sent file '{clean_path}' to user's Telegram."
        else:
            return f"Target exists at '{clean_path}', but no active Telegram chat is currently open to receive it."
    except Exception as e:
        return f"Error sending file to Telegram: {str(e)}"
