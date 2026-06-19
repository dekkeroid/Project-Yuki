# Unity Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `frontendUnity` Unity client skeleton that can render Yuki as a 3D desktop companion while preserving the existing Electron frontend.

**Architecture:** Keep Electron untouched and add Unity as a parallel frontend that talks to the existing FastAPI backend over the same WebSocket and REST contracts. The first deliverable is a clean Unity project skeleton with small focused scripts: backend connection, chat state, confirmation dialog model, avatar presenter, and desktop overlay shell. Later Unity-specific VRM/rendering work can replace placeholder avatar primitives without changing backend contracts.

**Tech Stack:** Unity 2022.3 LTS or newer, C# scripts, Unity Package Manager, Newtonsoft.Json for JSON payloads, native WebSocket via `ClientWebSocket`, existing Project-Yuki FastAPI backend.

---

## File Structure

- Create: `frontendUnity/README.md` — explains Unity setup, backend contract, and why this lives beside Electron.
- Create: `frontendUnity/ProjectSettings/ProjectVersion.txt` — pins Unity editor version for reproducibility.
- Create: `frontendUnity/Packages/manifest.json` — minimal package manifest with Test Framework and Newtonsoft.Json.
- Create: `frontendUnity/Packages/packages-lock.json` — deterministic Unity packages.
- Create: `frontendUnity/Assets/Scripts/Backend/YukiBackendConfig.cs` — backend base URL and WebSocket URL config.
- Create: `frontendUnity/Assets/Scripts/Backend/YukiWebSocketClient.cs` — reconnecting WebSocket client with typed events.
- Create: `frontendUnity/Assets/Scripts/Backend/YukiRestClient.cs` — REST helper for `/api/system/open_or_play`.
- Create: `frontendUnity/Assets/Scripts/Chat/YukiChatController.cs` — sends chat messages, receives stream events, stores chat transcript.
- Create: `frontendUnity/Assets/Scripts/Chat/YukiMessageModels.cs` — typed message/event DTOs shared by chat and backend clients.
- Create: `frontendUnity/Assets/Scripts/UI/ConfirmationDialogController.cs` — handles `confirm_request` and pending open/play confirmations.
- Create: `frontendUnity/Assets/Scripts/Avatar/YukiAvatarPresenter.cs` — placeholder avatar presenter and speech bubble anchor contract.
- Create: `frontendUnity/Assets/Scripts/Desktop/DesktopOverlayController.cs` — desktop window/overlay shell placeholder.
- Create: `frontendUnity/Assets/Scenes/YukiDesktop.unity` — placeholder scene description file for Unity to open and evolve.
- Create: `frontendUnity/Tests/EditMode/BackendMessageParsingTests.cs` — EditMode tests for message parsing and confirmation DTOs.
- Create: `frontendUnity/Tests/EditMode/GrantSafetyContractTests.cs` — EditMode tests documenting that Unity sends pending IDs, never executable grant IDs.
- Create: `docs/unity-frontend.md` — architecture notes and migration roadmap.

## Task 1: Create the Unity project shell

**Files:**
- Create: `frontendUnity/README.md`
- Create: `frontendUnity/ProjectSettings/ProjectVersion.txt`
- Create: `frontendUnity/Packages/manifest.json`
- Create: `frontendUnity/Packages/packages-lock.json`
- Create: `frontendUnity/Assets/Scenes/YukiDesktop.unity`

- [ ] **Step 1: Create project directories**

Run:
```bash
mkdir -p frontendUnity/{Assets/{Scenes,Scripts/{Backend,Chat,UI,Avatar,Desktop}},Packages,ProjectSettings,Tests/EditMode}
```
Expected: directories exist.

- [ ] **Step 2: Add Unity version pin**

Write `frontendUnity/ProjectSettings/ProjectVersion.txt`:
```text
m_EditorVersion: 2022.3.50f1
m_EditorVersionWithRevision: 2022.3.50f1 (c3db7f8bf9b1)
```

- [ ] **Step 3: Add package manifest**

Write `frontendUnity/Packages/manifest.json`:
```json
{
  "dependencies": {
    "com.unity.test-framework": "1.1.33",
    "com.unity.textmeshpro": "3.0.6",
    "com.unity.nuget.newtonsoft-json": "3.2.1"
  }
}
```

- [ ] **Step 4: Add packages lock**

Write `frontendUnity/Packages/packages-lock.json`:
```json
{
  "dependencies": {
    "com.unity.nuget.newtonsoft-json": {
      "version": "3.2.1",
      "depth": 0,
      "source": "registry",
      "dependencies": {},
      "url": "https://packages.unity.com"
    },
    "com.unity.test-framework": {
      "version": "1.1.33",
      "depth": 0,
      "source": "registry",
      "dependencies": {
        "com.unity.ext.nunit": "1.0.6",
        "com.unity.modules.imgui": "1.0.0",
        "com.unity.modules.jsonserialize": "1.0.0"
      },
      "url": "https://packages.unity.com"
    },
    "com.unity.textmeshpro": {
      "version": "3.0.6",
      "depth": 0,
      "source": "registry",
      "dependencies": {
        "com.unity.ugui": "1.0.0"
      },
      "url": "https://packages.unity.com"
    }
  }
}
```

- [ ] **Step 5: Add README**

Write `frontendUnity/README.md`:
```markdown
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
```

- [ ] **Step 6: Add placeholder scene marker**

Write `frontendUnity/Assets/Scenes/YukiDesktop.unity`:
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!29 &1
OcclusionCullingSettings:
  m_ObjectHideFlags: 0
--- !u!104 &2
RenderSettings:
  m_ObjectHideFlags: 0
  m_Fog: 0
--- !u!127 &3
LevelGameManager:
  m_ObjectHideFlags: 0
--- !u!157 &4
LightmapSettings:
  m_ObjectHideFlags: 0
--- !u!196 &5
NavMeshSettings:
  serializedVersion: 2
```

- [ ] **Step 7: Commit shell**

Run:
```bash
git add frontendUnity
git commit -m "Add Unity frontend project shell"
```
Expected: commit created.

## Task 2: Add typed backend message contracts

**Files:**
- Create: `frontendUnity/Assets/Scripts/Chat/YukiMessageModels.cs`
- Create: `frontendUnity/Tests/EditMode/BackendMessageParsingTests.cs`

- [ ] **Step 1: Write parsing tests**

Write `frontendUnity/Tests/EditMode/BackendMessageParsingTests.cs`:
```csharp
using NUnit.Framework;
using Newtonsoft.Json;
using Yuki.UnityFrontend.Chat;

public sealed class BackendMessageParsingTests
{
    [Test]
    public void ParsesConfirmRequest()
    {
        var json = "{\"type\":\"confirm_request\",\"conf_id\":\"abc\",\"name\":\"Run terminal command: echo hi\"}";
        var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);

        Assert.AreEqual("confirm_request", envelope.Type);
        Assert.AreEqual("abc", envelope.ConfirmationId);
        Assert.AreEqual("Run terminal command: echo hi", envelope.Name);
    }

    [Test]
    public void ParsesStreamingText()
    {
        var json = "{\"type\":\"text_stream\",\"text\":\"hello\",\"backend_used\":\"local\"}";
        var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);

        Assert.AreEqual("text_stream", envelope.Type);
        Assert.AreEqual("hello", envelope.Text);
        Assert.AreEqual("local", envelope.BackendUsed);
    }
}
```

- [ ] **Step 2: Add DTO implementation**

Write `frontendUnity/Assets/Scripts/Chat/YukiMessageModels.cs`:
```csharp
using Newtonsoft.Json;

namespace Yuki.UnityFrontend.Chat
{
    public sealed class YukiBackendEvent
    {
        [JsonProperty("type")]
        public string Type { get; set; } = string.Empty;

        [JsonProperty("text")]
        public string Text { get; set; } = string.Empty;

        [JsonProperty("backend_used")]
        public string BackendUsed { get; set; } = string.Empty;

        [JsonProperty("status")]
        public string Status { get; set; } = string.Empty;

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;

        [JsonProperty("conf_id")]
        public string ConfirmationId { get; set; } = string.Empty;

        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("result")]
        public string Result { get; set; } = string.Empty;

        [JsonProperty("audio_url")]
        public string AudioUrl { get; set; } = string.Empty;
    }

    public sealed class YukiChatRequest
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "chat";

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;
    }

    public sealed class YukiConfirmResponse
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "confirm_response";

        [JsonProperty("conf_id")]
        public string ConfirmationId { get; set; } = string.Empty;

        [JsonProperty("confirmed")]
        public bool Confirmed { get; set; }
    }
}
```

- [ ] **Step 3: Run EditMode tests**

Run:
```bash
/Applications/Unity/Hub/Editor/2022.3.50f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath frontendUnity -runTests -testPlatform EditMode -quit
```
Expected: tests pass. If Unity is not installed, record the exact missing binary as a validation gap and run syntax/static checks instead.

- [ ] **Step 4: Commit DTOs**

Run:
```bash
git add frontendUnity/Assets/Scripts/Chat/YukiMessageModels.cs frontendUnity/Tests/EditMode/BackendMessageParsingTests.cs
git commit -m "Add Unity backend message contracts"
```
Expected: commit created.

## Task 3: Add WebSocket and REST clients

**Files:**
- Create: `frontendUnity/Assets/Scripts/Backend/YukiBackendConfig.cs`
- Create: `frontendUnity/Assets/Scripts/Backend/YukiWebSocketClient.cs`
- Create: `frontendUnity/Assets/Scripts/Backend/YukiRestClient.cs`
- Create: `frontendUnity/Tests/EditMode/GrantSafetyContractTests.cs`

- [ ] **Step 1: Write grant contract tests**

Write `frontendUnity/Tests/EditMode/GrantSafetyContractTests.cs`:
```csharp
using NUnit.Framework;
using Newtonsoft.Json;
using Yuki.UnityFrontend.Backend;

public sealed class GrantSafetyContractTests
{
    [Test]
    public void OpenPlayConfirmPayloadUsesPendingConfirmationId()
    {
        var payload = YukiRestClient.BuildOpenPlayPayload("notepad", false, "pending-123");
        var json = JsonConvert.SerializeObject(payload);

        StringAssert.Contains("pending_confirmation_id", json);
        Assert.False(json.Contains("confirmation_grant_id"));
    }
}
```

- [ ] **Step 2: Add backend config**

Write `frontendUnity/Assets/Scripts/Backend/YukiBackendConfig.cs`:
```csharp
using UnityEngine;

namespace Yuki.UnityFrontend.Backend
{
    [CreateAssetMenu(menuName = "Yuki/Backend Config")]
    public sealed class YukiBackendConfig : ScriptableObject
    {
        [SerializeField] private string httpBaseUrl = "http://127.0.0.1:8000";
        [SerializeField] private string websocketUrl = "ws://127.0.0.1:8000/ws";

        public string HttpBaseUrl => httpBaseUrl;
        public string WebsocketUrl => websocketUrl;
    }
}
```

- [ ] **Step 3: Add WebSocket client**

Write `frontendUnity/Assets/Scripts/Backend/YukiWebSocketClient.cs`:
```csharp
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiWebSocketClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;
        private ClientWebSocket socket;
        private CancellationTokenSource lifetime;

        public event Action<YukiBackendEvent> EventReceived;
        public bool IsConnected => socket != null && socket.State == WebSocketState.Open;

        public async Task ConnectAsync()
        {
            if (IsConnected) return;
            lifetime = new CancellationTokenSource();
            socket = new ClientWebSocket();
            await socket.ConnectAsync(new Uri(config.WebsocketUrl), lifetime.Token);
            _ = ReceiveLoopAsync(lifetime.Token);
        }

        public async Task SendChatAsync(string message)
        {
            var payload = JsonConvert.SerializeObject(new YukiChatRequest { Message = message });
            await SendJsonAsync(payload);
        }

        public async Task SendConfirmationAsync(string confirmationId, bool confirmed)
        {
            var payload = JsonConvert.SerializeObject(new YukiConfirmResponse
            {
                ConfirmationId = confirmationId,
                Confirmed = confirmed
            });
            await SendJsonAsync(payload);
        }

        private async Task SendJsonAsync(string payload)
        {
            if (!IsConnected) throw new InvalidOperationException("Yuki WebSocket is not connected.");
            var bytes = Encoding.UTF8.GetBytes(payload);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, lifetime.Token);
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[8192];
            while (!token.IsCancellationRequested && IsConnected)
            {
                var result = await socket.ReceiveAsync(buffer, token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);
                EventReceived?.Invoke(envelope);
            }
        }

        private void OnDestroy()
        {
            lifetime?.Cancel();
            socket?.Dispose();
            lifetime?.Dispose();
        }
    }
}
```

- [ ] **Step 4: Add REST client**

Write `frontendUnity/Assets/Scripts/Backend/YukiRestClient.cs`:
```csharp
using System.Collections;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiRestClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;

        public static object BuildOpenPlayPayload(string query, bool playMode, string pendingConfirmationId = null)
        {
            return new
            {
                query,
                play_mode = playMode,
                pending_confirmation_id = pendingConfirmationId
            };
        }

        public IEnumerator OpenOrPlay(string query, bool playMode, string pendingConfirmationId)
        {
            var payload = JsonConvert.SerializeObject(BuildOpenPlayPayload(query, playMode, pendingConfirmationId));
            using var request = new UnityWebRequest($"{config.HttpBaseUrl}/api/system/open_or_play", "POST");
            request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(payload));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            yield return request.SendWebRequest();
        }
    }
}
```

- [ ] **Step 5: Run EditMode tests**

Run:
```bash
/Applications/Unity/Hub/Editor/2022.3.50f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath frontendUnity -runTests -testPlatform EditMode -quit
```
Expected: tests pass or missing Unity binary recorded.

- [ ] **Step 6: Commit clients**

Run:
```bash
git add frontendUnity/Assets/Scripts/Backend frontendUnity/Tests/EditMode/GrantSafetyContractTests.cs
git commit -m "Add Unity backend clients"
```
Expected: commit created.

## Task 4: Add UI/avatar orchestration skeleton

**Files:**
- Create: `frontendUnity/Assets/Scripts/Chat/YukiChatController.cs`
- Create: `frontendUnity/Assets/Scripts/UI/ConfirmationDialogController.cs`
- Create: `frontendUnity/Assets/Scripts/Avatar/YukiAvatarPresenter.cs`
- Create: `frontendUnity/Assets/Scripts/Desktop/DesktopOverlayController.cs`
- Modify: `docs/unity-frontend.md`

- [ ] **Step 1: Add chat controller**

Write `frontendUnity/Assets/Scripts/Chat/YukiChatController.cs`:
```csharp
using System.Collections.Generic;
using UnityEngine;
using Yuki.UnityFrontend.Backend;

namespace Yuki.UnityFrontend.Chat
{
    public sealed class YukiChatController : MonoBehaviour
    {
        [SerializeField] private YukiWebSocketClient webSocketClient;
        private readonly List<string> transcript = new();

        public IReadOnlyList<string> Transcript => transcript;

        private void OnEnable()
        {
            webSocketClient.EventReceived += HandleBackendEvent;
        }

        private void OnDisable()
        {
            webSocketClient.EventReceived -= HandleBackendEvent;
        }

        public async void SendUserMessage(string message)
        {
            transcript.Add($"User: {message}");
            await webSocketClient.SendChatAsync(message);
        }

        private void HandleBackendEvent(YukiBackendEvent evt)
        {
            if (evt.Type == "text_stream" && !string.IsNullOrEmpty(evt.Text))
            {
                transcript.Add($"Yuki: {evt.Text}");
            }
        }
    }
}
```

- [ ] **Step 2: Add confirmation dialog controller**

Write `frontendUnity/Assets/Scripts/UI/ConfirmationDialogController.cs`:
```csharp
using UnityEngine;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.UI
{
    public sealed class ConfirmationDialogController : MonoBehaviour
    {
        [SerializeField] private YukiWebSocketClient webSocketClient;
        private string activeConfirmationId = string.Empty;

        private void OnEnable()
        {
            webSocketClient.EventReceived += HandleBackendEvent;
        }

        private void OnDisable()
        {
            webSocketClient.EventReceived -= HandleBackendEvent;
        }

        private void HandleBackendEvent(YukiBackendEvent evt)
        {
            if (evt.Type != "confirm_request") return;
            activeConfirmationId = evt.ConfirmationId;
            Debug.Log($"Yuki confirmation required: {evt.Name}");
        }

        public async void ApproveActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId)) return;
            await webSocketClient.SendConfirmationAsync(activeConfirmationId, true);
            activeConfirmationId = string.Empty;
        }

        public async void RejectActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId)) return;
            await webSocketClient.SendConfirmationAsync(activeConfirmationId, false);
            activeConfirmationId = string.Empty;
        }
    }
}
```

- [ ] **Step 3: Add avatar presenter**

Write `frontendUnity/Assets/Scripts/Avatar/YukiAvatarPresenter.cs`:
```csharp
using UnityEngine;

namespace Yuki.UnityFrontend.Avatar
{
    public sealed class YukiAvatarPresenter : MonoBehaviour
    {
        [SerializeField] private Transform speechBubbleAnchor;

        public Vector3 SpeechBubbleWorldPosition => speechBubbleAnchor != null
            ? speechBubbleAnchor.position
            : transform.position + Vector3.up * 1.6f;

        public void SetThinking(bool isThinking)
        {
            Debug.Log($"Yuki thinking: {isThinking}");
        }

        public void SetSpeechText(string text)
        {
            Debug.Log($"Yuki says: {text}");
        }
    }
}
```

- [ ] **Step 4: Add desktop overlay controller**

Write `frontendUnity/Assets/Scripts/Desktop/DesktopOverlayController.cs`:
```csharp
using UnityEngine;

namespace Yuki.UnityFrontend.Desktop
{
    public sealed class DesktopOverlayController : MonoBehaviour
    {
        [SerializeField] private bool transparentWindowRequested = true;
        [SerializeField] private bool clickThroughWhenIdle = true;

        public bool TransparentWindowRequested => transparentWindowRequested;
        public bool ClickThroughWhenIdle => clickThroughWhenIdle;

        public void SetInteractive(bool interactive)
        {
            Debug.Log($"Yuki Unity desktop interactivity: {interactive}");
        }
    }
}
```

- [ ] **Step 5: Add architecture docs**

Write `docs/unity-frontend.md`:
```markdown
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
```

- [ ] **Step 6: Commit skeleton orchestration**

Run:
```bash
git add frontendUnity/Assets/Scripts/Chat/YukiChatController.cs frontendUnity/Assets/Scripts/UI/ConfirmationDialogController.cs frontendUnity/Assets/Scripts/Avatar/YukiAvatarPresenter.cs frontendUnity/Assets/Scripts/Desktop/DesktopOverlayController.cs docs/unity-frontend.md
git commit -m "Add Unity frontend orchestration skeleton"
```
Expected: commit created.

## Task 5: Verification and thermo review

**Files:**
- Verify all files under `frontendUnity/`

- [ ] **Step 1: Run CodeGraph mapping if installed**

Run:
```bash
codegraph init --path frontendUnity || codegraph init frontendUnity || true
```
Expected: CodeGraph initializes or prints a missing-command/usage message. Do not fail the branch solely if CodeGraph is not installed.

- [ ] **Step 2: Run Unity EditMode tests**

Run:
```bash
/Applications/Unity/Hub/Editor/2022.3.50f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath frontendUnity -runTests -testPlatform EditMode -quit
```
Expected: tests pass. If Unity is not installed, record the exact missing binary.

- [ ] **Step 3: Run text-level static checks**

Run:
```bash
find frontendUnity -type f \( -name '*.cs' -o -name '*.json' -o -name '*.md' -o -name '*.unity' \) -print0 | xargs -0 wc -l
python3 -m json.tool frontendUnity/Packages/manifest.json >/dev/null
python3 -m json.tool frontendUnity/Packages/packages-lock.json >/dev/null
```
Expected: JSON checks pass; line counts show no giant files.

- [ ] **Step 4: Run thermo-nuclear review**

Use `thermo-nuclear-code-quality-review` standards against the Unity branch. Required verdict: no blocking structural/safety regressions.

- [ ] **Step 5: Commit any review fixes**

If review requests changes, fix them and commit:
```bash
git add frontendUnity docs/unity-frontend.md
git commit -m "Refine Unity frontend scaffold"
```
Expected: commit created only if fixes were needed.

- [ ] **Step 6: Push branch**

Run:
```bash
git push -u origin feature/unity-frontend-scaffold
```
Expected: remote branch pushed.

## Self-Review

Spec coverage:
- Separate Unity frontend folder: covered by Task 1.
- Keep Electron version: no Electron files are modified by this plan.
- 3D model rendering path: placeholder avatar presenter and Unity scene are in Task 4; VRM production import is explicitly roadmap after scaffold.
- Existing backend safety contracts: Tasks 2-4 define WebSocket/REST contracts and pending-confirmation behavior.
- CodeGraph mapping: Task 5 includes `codegraph init` attempt.
- Thermo-nuclear review: Task 5 includes explicit review.

Placeholder scan:
- The plan does not use TBD/TODO/fill-in placeholders. The Unity scene and avatar are called placeholders because they are concrete scaffold artifacts and the roadmap states what remains.

Type consistency:
- `YukiBackendEvent`, `YukiChatRequest`, `YukiConfirmResponse`, `YukiBackendConfig`, `YukiWebSocketClient`, and `YukiRestClient` names are consistent across tasks.
