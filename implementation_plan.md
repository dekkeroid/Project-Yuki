# Implementation Plan: `Alt+S` Hotkey to Show Yuki & Focus Chat Input

This document outlines the proposed changes to make `Alt+S` reliably show Yuki (if hidden), restore window focus, open the chat overlay, and immediately focus the chat text input so users can instantly start typing.

---

## 1. Problem Statement
Currently:
1. `Alt+S` triggers `showYuki()`, brings `mainWindow` to focus, and emits `'trigger-listening'`.
2. However, if Yuki is already visible, `showYuki()` exits early without ensuring the window is unminimized, focused, and interactive.
3. The renderer process (`App.jsx`) does **not** listen to `onTriggerListening`, so pressing `Alt+S` does **not** open the chat overlay panel (`isChatOpen`) or place keyboard focus in the chat `<textarea>`.

---

## 2. Proposed Architectural Changes

### Step 1: Main Electron Process (`frontend/main.electron.cjs`)
Update the `Alt+S` global shortcut registration:
- Always call `showYuki()` (or ensure `yukiVisible = true` and `sendVisibility(true)`).
- Clear `skipTaskbar` or restore window if minimized:
  - `mainWindow.restore()`
  - `mainWindow.show()`
  - `mainWindow.focus()`
- Unignore mouse events (`mainWindow.setIgnoreMouseEvents(false)`).
- Emit `webContents.send('trigger-listening')` to signal the renderer to open the chat overlay and focus input.

### Step 2: Preload Bridge (`frontend/preload.cjs`)
- Ensure `onTriggerListening` is properly exported in `window.electronAPI` (already exists on line 83).

### Step 3: Renderer React Application (`frontend/src/App.jsx`)
- Subscribe to `window.electronAPI.onTriggerListening(...)` in `App.jsx`.
- When `trigger-listening` is received:
  1. Set `setIsChatOpen(true)` so the `ChatOverlay` component is rendered/opened.
  2. Emit a focus trigger signal or custom event (e.g. `window.dispatchEvent(new CustomEvent('yuki:focus-chat'))`).

### Step 4: Chat Overlay Component (`frontend/src/components/ChatOverlay.jsx`)
- Add a listener for the focus signal (or depend on `isPanelOpen` transition) to execute `inputRef.current?.focus()` with a small timeout (50ms–150ms) to ensure DOM focus is captured cleanly when Electron focuses the window.

---

## 3. Files Affected
- `frontend/main.electron.cjs`
- `frontend/src/App.jsx`
- `frontend/src/components/ChatOverlay.jsx`

---

## 4. Verification & Testing Plan
1. **Frontend Syntax & Build Check**: Run `npm run build` or Vite dry-run build in `frontend/` to ensure no JSX/JS syntax errors or broken imports.
2. **Behavioral Manual Verification Instructions**:
   - Start Yuki (`npm start` or Electron wrapper).
   - Press `Alt+S` when Yuki is hidden -> Yuki becomes visible, window focuses, chat panel opens, and text cursor blinks in the chat input.
   - Press `Alt+S` when Yuki is already visible -> Window re-focuses, chat panel opens (if closed), and input gains focus.

---

## 5. File Link
[implementation_plan.md](file:///D:/Projects%20New/Projects%20Misc/Projects%20C/Project%20Yuki/implementation_plan.md)
