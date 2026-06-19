# Unity Frontend Architecture

`frontendUnity` is a parallel client, not a replacement for `frontend`.

## Shared backend contract

- WebSocket: `ws://127.0.0.1:8000/ws`
- Chat send payload: `{ "type": "chat", "message": "..." }`
- Confirmation response payload: `{ "type": "confirm_response", "conf_id": "...", "confirmed": true }`
- Quick open/play REST: `POST /api/system/open_or_play`
- Unity sends `pending_confirmation_id` after user approval; it never sends or stores executable `confirmation_grant_id` values.

## Migration roadmap

1. Keep Electron as the stable frontend.
2. Add Unity backend contracts and tests.
3. Add VRM import/rendering.
4. Add transparent always-on-top desktop window support per platform.
5. Move chat bubble and confirmation UI into Unity canvases.
6. Decide whether Unity replaces Electron only after feature parity and safety parity are tested.

## Unity asset metadata

Commit `Assets/**/*.meta` files with this project. They preserve stable GUIDs for scenes, assemblies, scripts, and test assets. Do not commit Unity-generated `Library/`, `Temp/`, `Logs/`, or `.codegraph/` runtime data.
