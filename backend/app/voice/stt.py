# Speech-to-Text (STT) Module
# To ensure lowest possible latency and resource consumption on the local host,
# we use browser-native Web Speech API on the React frontend.
#
# If backend-level Whisper processing is desired, this file can be expanded
# using whisper.cpp / faster-whisper.

def transcribe_audio_file(file_path: str) -> str:
    """
    Placeholder for local Whisper STT transcription.
    """
    return "STT local transcription is not active. Using frontend Web Speech recognition."
