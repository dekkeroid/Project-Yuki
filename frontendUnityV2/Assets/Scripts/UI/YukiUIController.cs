using System;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;
using Yuki.UnityFrontend.Avatar;
using Yuki.UnityFrontend.Desktop;

namespace Yuki.UnityFrontend.UI
{
    public sealed class YukiUIController : MonoBehaviour
    {
        [Header("Components Integration")]
        [SerializeField] private YukiWebSocketClient webSocketClient;
        [SerializeField] private YukiRestClient restClient;
        [SerializeField] private YukiAudioPlaybackManager audioManager;
        [SerializeField] private YukiAvatarPresenter avatarPresenter;
        [SerializeField] private YukiChatController chatController;
        [SerializeField] private YukiSlashCommandHandler slashCommandHandler;
        [SerializeField] private YukiTalkModeController talkModeController;
        [SerializeField] private DesktopOverlayController desktopOverlay;

        [Header("Overlay - Chat & Input")]
        [SerializeField] private TMP_InputField chatInputField;
        [SerializeField] private Button submitButton;
        [SerializeField] private Button micToggleButton;
        [SerializeField] private TextMeshProUGUI speechBubbleText;
        [SerializeField] private GameObject speechBubbleContainer;
        [SerializeField] private TextMeshProUGUI statusIndicatorText;

        [Header("Diagnostics & Settings Dashboard")]
        [SerializeField] private GameObject dashboardPanel;
        [SerializeField] private Button toggleDashboardButton;
        [SerializeField] private TextMeshProUGUI backendStatusText;
        [SerializeField] private TMP_Dropdown modelDropdown;
        [SerializeField] private TMP_Dropdown voiceDropdown;
        [SerializeField] private TMP_Dropdown ttsRateDropdown;
        [SerializeField] private Slider volumeSlider;
        [SerializeField] private Toggle muteToggle;
        [SerializeField] private TextMeshProUGUI userStatsText;

        [Header("Safety Confirmation Overlay")]
        [SerializeField] private GameObject safetyDialogPanel;
        [SerializeField] private TextMeshProUGUI safetyPromptText;
        [SerializeField] private Button approveSafetyButton;
        [SerializeField] private Button rejectSafetyButton;

        [Header("Autocomplete Suggestions")]
        [SerializeField] private GameObject suggestionsContainer;
        [SerializeField] private Transform suggestionsParent;
        [SerializeField] private GameObject suggestionPrefab;

        [Header("Speech Bubble Positioning")]
        [SerializeField] private RectTransform speechBubbleContainerRect;
        [SerializeField] private Canvas mainCanvas;
        [SerializeField] private Camera mainCamera;
        [SerializeField] private float speechBubbleOffsetY = 0.3f;
        [SerializeField] private float speechBubbleMinScreenY = 50f;
        [SerializeField] private float speechBubbleMaxScreenYOffset = 100f;

        private StringBuilder currentAssistantBubbleContent = new StringBuilder();
        private string activeConfirmationId = string.Empty;
        private bool isMicActive = false;
        private string lastCleanSpeechText = string.Empty;

        private void OnEnable()
        {
            if (webSocketClient != null) webSocketClient.EventReceived += OnBackendEventReceived;
            if (audioManager != null)
            {
                audioManager.OnSpeechStarted += OnSpeechStarted;
                audioManager.OnSpeechEnded += OnSpeechEnded;
            }

            if (submitButton != null) submitButton.onClick.AddListener(SubmitUserChat);
            if (chatInputField != null)
            {
                chatInputField.onSubmit.AddListener(delegate { SubmitUserChat(); });
                chatInputField.onValueChanged.AddListener(OnChatInputValueChanged);
            }
            if (micToggleButton != null) micToggleButton.onClick.AddListener(ToggleMicrophoneInput);
            if (toggleDashboardButton != null) toggleDashboardButton.onClick.AddListener(ToggleDashboardPanel);
            if (approveSafetyButton != null) approveSafetyButton.onClick.AddListener(ApproveActiveConfirmation);
            if (rejectSafetyButton != null) rejectSafetyButton.onClick.AddListener(RejectActiveConfirmation);

            if (volumeSlider != null) volumeSlider.onValueChanged.AddListener(OnVolumeSliderChanged);
            if (muteToggle != null) muteToggle.onValueChanged.AddListener(OnMuteToggleChanged);

            if (slashCommandHandler != null)
            {
                slashCommandHandler.OnResponseText += SpeakSystemMessage;
                slashCommandHandler.OnAddMessage += AddChatMessage;
                slashCommandHandler.OnSetThinking += HandleSetThinking;
            }

            if (talkModeController != null)
            {
                talkModeController.OnTranscriptReady += HandleTranscriptReady;
                talkModeController.OnStatusMessage += HandleTalkModeStatus;
                talkModeController.OnTalkModeChanged += HandleTalkModeChanged;
            }

            if (desktopOverlay != null)
            {
                desktopOverlay.OnHotkeyTriggered += HandleGlobalHotkey;
            }
        }

        private void OnDisable()
        {
            if (webSocketClient != null) webSocketClient.EventReceived -= OnBackendEventReceived;
            if (audioManager != null)
            {
                audioManager.OnSpeechStarted -= OnSpeechStarted;
                audioManager.OnSpeechEnded -= OnSpeechEnded;
            }

            if (submitButton != null) submitButton.onClick.RemoveListener(SubmitUserChat);
            if (chatInputField != null) chatInputField.onValueChanged.RemoveListener(OnChatInputValueChanged);
            if (micToggleButton != null) micToggleButton.onClick.RemoveListener(ToggleMicrophoneInput);
            if (toggleDashboardButton != null) toggleDashboardButton.onClick.RemoveListener(ToggleDashboardPanel);
            if (approveSafetyButton != null) approveSafetyButton.onClick.RemoveListener(ApproveActiveConfirmation);
            if (rejectSafetyButton != null) rejectSafetyButton.onClick.RemoveListener(RejectActiveConfirmation);

            if (slashCommandHandler != null)
            {
                slashCommandHandler.OnResponseText -= SpeakSystemMessage;
                slashCommandHandler.OnAddMessage -= AddChatMessage;
                slashCommandHandler.OnSetThinking -= HandleSetThinking;
            }

            if (talkModeController != null)
            {
                talkModeController.OnTranscriptReady -= HandleTranscriptReady;
                talkModeController.OnStatusMessage -= HandleTalkModeStatus;
                talkModeController.OnTalkModeChanged -= HandleTalkModeChanged;
            }

            if (desktopOverlay != null)
            {
                desktopOverlay.OnHotkeyTriggered -= HandleGlobalHotkey;
            }
        }

        private void Start()
        {
            if (mainCamera == null) mainCamera = Camera.main;
            if (mainCanvas == null) mainCanvas = GetComponentInParent<Canvas>();

            if (speechBubbleContainer != null) speechBubbleContainer.SetActive(false);
            if (dashboardPanel != null) dashboardPanel.SetActive(false);
            if (safetyDialogPanel != null) safetyDialogPanel.SetActive(false);
            if (suggestionsContainer != null) suggestionsContainer.SetActive(false);

            if (volumeSlider != null && audioManager != null)
            {
                volumeSlider.value = audioManager.Volume;
            }
            if (muteToggle != null && audioManager != null)
            {
                muteToggle.isOn = audioManager.IsMuted;
            }

            UpdateBackendConnectionStatus();
        }

        private void Update()
        {
            if (audioManager != null && avatarPresenter != null)
            {
                avatarPresenter.SetAudioLevel(audioManager.CurrentAmplitude);
            }
        }

        private void LateUpdate()
        {
            UpdateSpeechBubblePosition();
        }

        private void UpdateSpeechBubblePosition()
        {
            if (avatarPresenter == null || speechBubbleContainerRect == null || mainCanvas == null || mainCamera == null)
                return;

            if (!speechBubbleContainerRect.gameObject.activeSelf)
                return;

            Vector3 worldPos = avatarPresenter.SpeechBubbleWorldPosition;
            worldPos.y += speechBubbleOffsetY;

            Vector3 screenPos = mainCamera.WorldToScreenPoint(worldPos);

            if (screenPos.z < 0)
            {
                speechBubbleContainerRect.gameObject.SetActive(false);
                return;
            }

            float maxY = Screen.height - speechBubbleMaxScreenYOffset;
            float minY = speechBubbleMinScreenY;
            screenPos.y = Mathf.Clamp(screenPos.y, minY, maxY);

            if (mainCanvas.renderMode == RenderMode.ScreenSpaceOverlay)
            {
                speechBubbleContainerRect.position = screenPos;
            }
            else
            {
                Vector2 localPoint;
                RectTransformUtility.ScreenPointToLocalPointInRectangle(
                    mainCanvas.transform as RectTransform,
                    screenPos,
                    mainCanvas.worldCamera,
                    out localPoint
                );
                speechBubbleContainerRect.localPosition = localPoint;
            }
        }

        private void UpdateBackendConnectionStatus()
        {
            bool connected = webSocketClient != null && webSocketClient.IsConnected;
            if (backendStatusText != null)
            {
                backendStatusText.text = connected ? "<color=green>ONLINE</color>" : "<color=red>OFFLINE</color>";
            }
            if (statusIndicatorText != null)
            {
                statusIndicatorText.text = connected ? "Yuki: Idle" : "Yuki: Offline";
            }
        }

        private void OnBackendEventReceived(YukiBackendEvent evt)
        {
            switch (evt.Type)
            {
                case "profile_update":
                    HandleProfileUpdate(evt.Profile);
                    break;
                case "status":
                    HandleStatusUpdate(evt.Status, evt.Message);
                    break;
                case "text_stream":
                    HandleTextStreamToken(evt.Text);
                    break;
                case "audio_chunk":
                    HandleAudioChunk(evt.AudioUrl, evt.Text);
                    break;
                case "confirm_request":
                    HandleConfirmRequest(evt.ConfirmationId, evt.Name);
                    break;
                case "tool_result":
                    HandleToolResult(evt.Result);
                    break;
                case "stream_done":
                    HandleStreamDone(evt.ResponseTime);
                    break;
                case "error":
                    HandleError(evt.Message);
                    break;
            }
        }

        private void HandleProfileUpdate(YukiProfile profile)
        {
            if (profile == null) return;

            if (userStatsText != null)
            {
                userStatsText.text = $"User: {profile.UserName}\nInteractions: {profile.InteractionCount}";
            }

            if (avatarPresenter != null && profile.Settings != null && !string.IsNullOrEmpty(profile.Settings.ActiveVrmModel))
            {
                avatarPresenter.LoadVrm(profile.Settings.ActiveVrmModel);
            }

            UpdateDropdownSelections(profile.Settings);
            UpdateBackendConnectionStatus();
        }

        private void UpdateDropdownSelections(YukiProfileSettings settings)
        {
            if (settings == null) return;

            SelectDropdownOption(modelDropdown, settings.LlmModel);
            SelectDropdownOption(voiceDropdown, settings.TtsVoice);
            SelectDropdownOption(ttsRateDropdown, settings.TtsRate);
        }

        private void SelectDropdownOption(TMP_Dropdown dropdown, string optionText)
        {
            if (dropdown == null || string.IsNullOrEmpty(optionText)) return;
            for (int i = 0; i < dropdown.options.Count; i++)
            {
                if (dropdown.options[i].text.Equals(optionText, StringComparison.OrdinalIgnoreCase))
                {
                    dropdown.value = i;
                    break;
                }
            }
        }

        private void HandleStatusUpdate(string status, string message)
        {
            if (statusIndicatorText != null)
            {
                string displayMsg = string.IsNullOrEmpty(message) ? $"Yuki: {status}" : $"Yuki: {message}";
                statusIndicatorText.text = displayMsg;
            }

            if (avatarPresenter != null)
            {
                avatarPresenter.SetThinking(status.Equals("thinking", StringComparison.OrdinalIgnoreCase));
                avatarPresenter.SetListening(status.Equals("listening", StringComparison.OrdinalIgnoreCase));
            }
        }

        private void HandleTextStreamToken(string token)
        {
            if (speechBubbleContainer != null && !speechBubbleContainer.activeSelf)
            {
                speechBubbleContainer.SetActive(true);
                currentAssistantBubbleContent.Clear();
            }

            currentAssistantBubbleContent.Append(token);
            if (speechBubbleText != null)
            {
                speechBubbleText.text = currentAssistantBubbleContent.ToString();
            }
        }

        private void HandleAudioChunk(string audioUrlBase64, string speechText)
        {
            AudioClip clip = WavUtil.ToAudioClip(audioUrlBase64);
            if (clip != null && audioManager != null)
            {
                audioManager.QueueAudio(clip, speechText);
            }
        }

        private void HandleConfirmRequest(string confirmationId, string toolName)
        {
            activeConfirmationId = confirmationId;
            if (safetyDialogPanel != null)
            {
                safetyDialogPanel.SetActive(true);
                if (safetyPromptText != null)
                {
                    safetyPromptText.text = $"Yuki wants to execute:\n<color=yellow>{toolName}</color>\n\nDo you authorize this?";
                }
            }
        }

        private void HandleToolResult(string result)
        {
            Debug.Log($"[UIController] Tool execution result: {result}");
        }

        private void HandleStreamDone(double responseTime)
        {
            Debug.Log($"[UIController] Turn complete in {responseTime} seconds.");
            if (statusIndicatorText != null)
            {
                statusIndicatorText.text = "Yuki: Idle";
            }
        }

        private void HandleError(string errorMsg)
        {
            if (speechBubbleContainer != null) speechBubbleContainer.SetActive(true);
            if (speechBubbleText != null)
            {
                speechBubbleText.text = $"<color=red>Error: {errorMsg}</color>";
            }
        }

        private void OnSpeechStarted(string text)
        {
            lastCleanSpeechText = text;
            if (speechBubbleContainer != null) speechBubbleContainer.SetActive(true);
            if (speechBubbleText != null)
            {
                speechBubbleText.text = text;
            }

            if (avatarPresenter != null)
            {
                string lower = text.ToLower();
                string expression = "neutral";
                if (lower.Contains("happy") || lower.Contains("smile") || lower.Contains("giggle") || lower.Contains("😊")) expression = "happy";
                else if (lower.Contains("sad") || lower.Contains("cry") || lower.Contains("sorrow")) expression = "sad";
                else if (lower.Contains("angry") || lower.Contains("pout") || lower.Contains("scold")) expression = "angry";
                else if (lower.Contains("surprised") || lower.Contains("gasp") || lower.Contains("shock")) expression = "surprised";

                avatarPresenter.SetExpression(expression);
            }
        }

        private void OnSpeechEnded(string text)
        {
            if (speechBubbleContainer != null)
            {
                speechBubbleContainer.SetActive(false);
            }
            if (avatarPresenter != null)
            {
                avatarPresenter.SetExpression("neutral");
            }
        }

        private async void SubmitUserChat()
        {
            if (chatInputField == null || string.IsNullOrWhiteSpace(chatInputField.text)) return;

            string text = chatInputField.text.Trim();
            chatInputField.text = string.Empty;
            
            if (suggestionsContainer != null) suggestionsContainer.SetActive(false);

            if (audioManager != null && audioManager.IsPlayingSpeech)
            {
                audioManager.StopAndClear();
                if (webSocketClient != null && webSocketClient.IsConnected)
                {
                    await webSocketClient.SendInterruptAsync();
                }
            }

            if (slashCommandHandler != null && slashCommandHandler.IsKnownCommand(text))
            {
                slashCommandHandler.TryHandleCommand(text);
                return;
            }

            if (chatController != null)
            {
                chatController.SendUserMessage(text);
            }
            else if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendChatAsync(text);
            }
        }

        private void OnChatInputValueChanged(string inputVal)
        {
            if (string.IsNullOrEmpty(inputVal) || !inputVal.StartsWith("/"))
            {
                if (suggestionsContainer != null) suggestionsContainer.SetActive(false);
                return;
            }

            if (inputVal.StartsWith("/open ") || inputVal.StartsWith("/play ") || inputVal.StartsWith("/o ") || inputVal.StartsWith("/p "))
            {
                string[] parts = inputVal.Split(' ', 2);
                if (parts.Length < 2 || string.IsNullOrEmpty(parts[1].Trim())) return;

                string cmd = parts[0].ToLower();
                string query = parts[1].Trim();
                bool playMode = cmd is "/play" or "/p";

                if (!string.IsNullOrEmpty(query))
                {
                    StopAllCoroutines();
                    StartCoroutine(FetchSuggestionsCoroutine(query, playMode));
                }
            }
            else if (slashCommandHandler != null && inputVal.Length >= 2)
            {
                var matches = slashCommandHandler.GetMatchingCommands(inputVal);
                if (matches.Count > 0)
                {
                    Debug.Log($"[UIController] Command suggestions: {string.Join(", ", matches)}");
                }
            }
        }

        private System.Collections.IEnumerator FetchSuggestionsCoroutine(string query, bool playMode)
        {
            string type = playMode ? "play" : "open";
            string baseUrl = restClient != null ? restClient.HttpBaseUrl : "http://127.0.0.1:8000";
            string url = $"{baseUrl}/api/system/suggestions?query={Uri.EscapeDataString(query)}&type={type}";
            using var req = UnityEngine.Networking.UnityWebRequest.Get(url);
            yield return req.SendWebRequest();

            if (req.result == UnityEngine.Networking.UnityWebRequest.Result.Success)
            {
                Debug.Log($"[UIController] Suggestions: {req.downloadHandler.text}");
            }
        }

        private void ToggleMicrophoneInput()
        {
            if (talkModeController != null)
            {
                talkModeController.ToggleTalkMode();
            }
            else
            {
                isMicActive = !isMicActive;
                Debug.Log($"[UIController] Microphone voice recording active: {isMicActive}");
            }
        }

        private void ToggleDashboardPanel()
        {
            if (dashboardPanel != null)
            {
                dashboardPanel.SetActive(!dashboardPanel.activeSelf);
            }
        }

        private void OnVolumeSliderChanged(float val)
        {
            if (audioManager != null)
            {
                audioManager.SetVolume(val);
            }
        }

        private void OnMuteToggleChanged(bool isOn)
        {
            if (audioManager != null)
            {
                audioManager.SetMuted(isOn);
            }
        }

        private void ApproveActiveConfirmation()
        {
            if (slashCommandHandler != null)
            {
                slashCommandHandler.ApproveConfirmation();
            }
            activeConfirmationId = string.Empty;
            if (safetyDialogPanel != null) safetyDialogPanel.SetActive(false);
        }

        private async void RejectActiveConfirmation()
        {
            if (slashCommandHandler != null)
            {
                slashCommandHandler.RejectConfirmation();
            }
            else
            {
                if (!string.IsNullOrEmpty(activeConfirmationId) && webSocketClient != null && webSocketClient.IsConnected)
                {
                    await webSocketClient.SendConfirmationAsync(activeConfirmationId, false);
                }
            }
            activeConfirmationId = string.Empty;
            if (safetyDialogPanel != null) safetyDialogPanel.SetActive(false);
        }

        private void AddChatMessage(string role, string content)
        {
            if (role == "user")
            {
                if (speechBubbleContainer != null) speechBubbleContainer.SetActive(false);
                return;
            }

            if (speechBubbleContainer != null) speechBubbleContainer.SetActive(true);
            if (speechBubbleText != null)
            {
                speechBubbleText.text = content;
            }
        }

        private async void SpeakSystemMessage(string text)
        {
            if (string.IsNullOrEmpty(text)) return;

            if (speechBubbleContainer != null) speechBubbleContainer.SetActive(true);
            if (speechBubbleText != null)
            {
                speechBubbleText.text = text;
            }

            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendTtsOnlyAsync(text);
            }
        }

        private void HandleSetThinking(bool isThinking)
        {
            if (statusIndicatorText != null)
            {
                statusIndicatorText.text = isThinking ? "Yuki: Thinking..." : "Yuki: Idle";
            }
        }

        private void HandleTranscriptReady(string transcript)
        {
            if (talkModeController != null)
            {
                talkModeController.ProcessTranscript(transcript);
            }
        }

        private void HandleTalkModeStatus(string message)
        {
            if (statusIndicatorText != null)
            {
                statusIndicatorText.text = message;
            }
        }

        private void HandleTalkModeChanged(bool active)
        {
            if (micToggleButton != null)
            {
                var label = micToggleButton.GetComponentInChildren<TextMeshProUGUI>();
                if (label != null)
                {
                    label.text = active ? "Talk Mode ON" : "Talk Mode";
                }
            }
        }

        private void HandleGlobalHotkey()
        {
            Debug.Log("[UIController] Global hotkey triggered (Alt+S)");

            if (talkModeController != null)
            {
                talkModeController.ToggleTalkMode();
            }

            if (desktopOverlay != null && !desktopOverlay.IsWindowVisible)
            {
                desktopOverlay.ShowWindow();
            }
        }
    }
}
