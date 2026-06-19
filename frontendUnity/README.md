# Yuki Unity Frontend

This is a parallel Unity frontend for Project Yuki. It does not replace the existing Electron/React frontend; it shares the same FastAPI backend and tool-safety contracts.

## Target

- Render Yuki as a real-time 3D desktop companion.
- Use the existing backend WebSocket `/ws` for chat, streaming tokens, audio chunks, tool status, and confirmation prompts.
- Use existing REST endpoints for quick commands such as `/api/system/open_or_play`.
- Preserve backend safety: Unity must send pending confirmation IDs after user approval, never executable grant IDs.

## Open in Unity

Use Unity 2022.3 LTS or newer and open the `frontendUnity` folder as a project.

## Current state

The first scaffold contains focused C# scripts and tests. VRM model import, transparent always-on-top windows, animation blending, and production UI can be added after the contract layer is stable.
