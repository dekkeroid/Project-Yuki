using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
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

        [Header("Electron UI Parity Fields")]
        [SerializeField] private Button toggleChatButton;
        [SerializeField] private GameObject chatInputContainer;
        [SerializeField] private Button alwaysOnTopButton;
        [SerializeField] private Button terminateButton;
        [SerializeField] private Button muteButton;
        [SerializeField] private Button closeButton;

        [Header("Icons for Dynamic Toggles")]
        [SerializeField] private Sprite eyeOnSprite;
        [SerializeField] private Sprite eyeOffSprite;
        [SerializeField] private Sprite volumeOnSprite;
        [SerializeField] private Sprite volumeOffSprite;
        [SerializeField] private Sprite micOnSprite;
        [SerializeField] private Sprite micOffSprite;
        [SerializeField] private Sprite chatSprite;
        [SerializeField] private Sprite settingsSprite;
        [SerializeField] private Sprite terminateSprite;
        [SerializeField] private Sprite closeSprite;

        private static readonly Color BgColor = new Color(0.07f, 0.05f, 0.13f, 0.75f);
        private static readonly Color AccentPurple = new Color(0.75f, 0.52f, 0.99f, 1f);
        private static readonly Color AccentTeal = new Color(0.18f, 0.83f, 0.75f, 1f);
        private bool isAlwaysOnTop = true;

        [Header("Diagnostics & Settings Dashboard")]
        [SerializeField] private GameObject dashboardPanel;
        [SerializeField] private Button toggleDashboardButton;
        [SerializeField] private Button closeSettingsButton;
        [SerializeField] private TextMeshProUGUI backendStatusText;
        [SerializeField] private TMP_Dropdown modelDropdown;
        [SerializeField] private TMP_Dropdown voiceDropdown;
        [SerializeField] private TMP_Dropdown ttsRateDropdown;
        [SerializeField] private Slider volumeSlider;
        [SerializeField] private Toggle muteToggle;
        [SerializeField] private TMP_InputField characterNameInputField;
        [SerializeField] private TMP_InputField characterPersonaInputField;
        [SerializeField] private Toggle crawlerPausedToggle;
        [SerializeField] private Toggle taggerPausedToggle;
        [SerializeField] private Toggle noLlmModeToggle;
        [SerializeField] private Toggle useLocalWhisperToggle;
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
        private bool isUpdatingDropdownsSilently = false;
        private string activeConfirmationId = string.Empty;
        private bool isMicActive = false;
        private string lastCleanSpeechText = string.Empty;

        private YukiSettingsData currentSettings;

        private static readonly string[] TtsVoiceLabels = {
            "Sarah (US Female - Soft/Cute)",
            "Sky (US Female - Natural)",
            "Bella (US Female - Warm)",
            "Isabella (UK Female - Crisp)",
            "Alice (UK Female - Clear)",
            "Lily (UK Female - Gentle)",
            "Alpha (JP Female - Bright)",
            "Glowing (JP Female - Cute)",
            "Yasmin (JP Female - Soft)"
        };
        private static readonly string[] TtsVoiceValues = {
            "af_sarah", "af_sky", "af_bella", "bf_isabella", "bf_alice", "bf_lily", "jf_alpha", "jf_glowing", "jf_yasmin"
        };

        private static readonly string[] TtsRateLabels = {
            "Slow (0.8x)", "Normal (1.0x)", "Snappy (1.1x)", "Fast (1.2x)", "Faster (1.4x)"
        };
        private static readonly string[] TtsRateValues = {
            "0.8", "1.0", "1.1", "1.2", "1.4"
        };

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
            if (closeSettingsButton != null) closeSettingsButton.onClick.AddListener(ToggleDashboardPanel);
            if (approveSafetyButton != null) approveSafetyButton.onClick.AddListener(ApproveActiveConfirmation);
            if (rejectSafetyButton != null) rejectSafetyButton.onClick.AddListener(RejectActiveConfirmation);

            if (volumeSlider != null) volumeSlider.onValueChanged.AddListener(OnVolumeSliderChanged);
            if (muteToggle != null) muteToggle.onValueChanged.AddListener(OnMuteToggleChanged);

            if (toggleChatButton != null) toggleChatButton.onClick.AddListener(ToggleChatInputContainer);
            if (alwaysOnTopButton != null) alwaysOnTopButton.onClick.AddListener(ToggleAlwaysOnTop);
            if (terminateButton != null) terminateButton.onClick.AddListener(TerminateProcessing);
            if (muteButton != null) muteButton.onClick.AddListener(ToggleMuteState);
            if (closeButton != null) closeButton.onClick.AddListener(QuitApplication);

            if (modelDropdown != null) modelDropdown.onValueChanged.AddListener(OnModelDropdownChanged);
            if (voiceDropdown != null) voiceDropdown.onValueChanged.AddListener(OnVoiceDropdownChanged);
            if (ttsRateDropdown != null) ttsRateDropdown.onValueChanged.AddListener(OnTtsRateDropdownChanged);

            if (characterNameInputField != null) characterNameInputField.onEndEdit.AddListener(OnCharacterNameEndEdit);
            if (characterPersonaInputField != null) characterPersonaInputField.onEndEdit.AddListener(OnCharacterPersonaEndEdit);
            if (crawlerPausedToggle != null) crawlerPausedToggle.onValueChanged.AddListener(OnCrawlerPausedToggleChanged);
            if (taggerPausedToggle != null) taggerPausedToggle.onValueChanged.AddListener(OnTaggerPausedToggleChanged);
            if (noLlmModeToggle != null) noLlmModeToggle.onValueChanged.AddListener(OnNoLlmModeToggleChanged);
            if (useLocalWhisperToggle != null) useLocalWhisperToggle.onValueChanged.AddListener(OnUseLocalWhisperToggleChanged);

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
            if (closeSettingsButton != null) closeSettingsButton.onClick.RemoveListener(ToggleDashboardPanel);
            if (approveSafetyButton != null) approveSafetyButton.onClick.RemoveListener(ApproveActiveConfirmation);
            if (rejectSafetyButton != null) rejectSafetyButton.onClick.RemoveListener(RejectActiveConfirmation);

            if (toggleChatButton != null) toggleChatButton.onClick.RemoveListener(ToggleChatInputContainer);
            if (alwaysOnTopButton != null) alwaysOnTopButton.onClick.RemoveListener(ToggleAlwaysOnTop);
            if (terminateButton != null) terminateButton.onClick.RemoveListener(TerminateProcessing);
            if (muteButton != null) muteButton.onClick.RemoveListener(ToggleMuteState);
            if (closeButton != null) closeButton.onClick.RemoveListener(QuitApplication);

            if (modelDropdown != null) modelDropdown.onValueChanged.RemoveListener(OnModelDropdownChanged);
            if (voiceDropdown != null) voiceDropdown.onValueChanged.RemoveListener(OnVoiceDropdownChanged);
            if (ttsRateDropdown != null) ttsRateDropdown.onValueChanged.RemoveListener(OnTtsRateDropdownChanged);

            if (characterNameInputField != null) characterNameInputField.onEndEdit.RemoveListener(OnCharacterNameEndEdit);
            if (characterPersonaInputField != null) characterPersonaInputField.onEndEdit.RemoveListener(OnCharacterPersonaEndEdit);
            if (crawlerPausedToggle != null) crawlerPausedToggle.onValueChanged.RemoveListener(OnCrawlerPausedToggleChanged);
            if (taggerPausedToggle != null) taggerPausedToggle.onValueChanged.RemoveListener(OnTaggerPausedToggleChanged);
            if (noLlmModeToggle != null) noLlmModeToggle.onValueChanged.RemoveListener(OnNoLlmModeToggleChanged);
            if (useLocalWhisperToggle != null) useLocalWhisperToggle.onValueChanged.RemoveListener(OnUseLocalWhisperToggleChanged);

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
            LoadDynamicSprites();

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

            if (chatInputContainer != null) chatInputContainer.SetActive(false);

            InitializeStaticDropdowns();
            LoadDashboardData();

            UpdateBackendConnectionStatus();
            UpdateButtonVisuals();
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

            isUpdatingDropdownsSilently = true;
            try
            {
                SelectDropdownOption(modelDropdown, settings.LlmModel);

                // Map Voice
                int voiceIdx = Array.IndexOf(TtsVoiceValues, settings.TtsVoice);
                if (voiceIdx >= 0 && voiceDropdown != null) voiceDropdown.value = voiceIdx;

                // Map Rate
                int rateIdx = Array.IndexOf(TtsRateValues, settings.TtsRate);
                if (rateIdx >= 0 && ttsRateDropdown != null) ttsRateDropdown.value = rateIdx;
            }
            finally
            {
                isUpdatingDropdownsSilently = false;
            }
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
                string json = req.downloadHandler.text;
                try
                {
                    var response = JsonConvert.DeserializeObject<YukiSuggestionsResponse>(json);
                    PopulateSuggestions(response?.Suggestions, playMode);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[UIController] Error parsing suggestions: {ex.Message}");
                }
            }
            else
            {
                if (suggestionsContainer != null) suggestionsContainer.SetActive(false);
            }
        }

        private void PopulateSuggestions(List<YukiSuggestionItem> suggestions, bool playMode)
        {
            if (suggestionsParent != null)
            {
                foreach (Transform child in suggestionsParent)
                {
                    Destroy(child.gameObject);
                }
            }

            if (suggestions == null || suggestions.Count == 0)
            {
                if (suggestionsContainer != null) suggestionsContainer.SetActive(false);
                return;
            }

            if (suggestionsContainer != null) suggestionsContainer.SetActive(true);

            foreach (var item in suggestions)
            {
                if (suggestionPrefab == null || suggestionsParent == null) continue;

                GameObject suggObj = Instantiate(suggestionPrefab, suggestionsParent);
                
                var texts = suggObj.GetComponentsInChildren<TextMeshProUGUI>(true);
                if (texts.Length == 1)
                {
                    texts[0].text = item.Name;
                }
                else if (texts.Length > 1)
                {
                    texts[0].text = item.Name;
                    texts[1].text = item.Path;
                }

                if (texts.Length == 0)
                {
                    var legacyTexts = suggObj.GetComponentsInChildren<Text>(true);
                    if (legacyTexts.Length == 1)
                    {
                        legacyTexts[0].text = item.Name;
                    }
                    else if (legacyTexts.Length > 1)
                    {
                        legacyTexts[0].text = item.Name;
                        legacyTexts[1].text = item.Path;
                    }
                }

                var btn = suggObj.GetComponent<Button>();
                if (btn == null) btn = suggObj.GetComponentInChildren<Button>(true);
                if (btn != null)
                {
                    btn.onClick.AddListener(() => OnSuggestionSelected(item, playMode));
                }
            }
        }

        private void OnSuggestionSelected(YukiSuggestionItem item, bool playMode)
        {
            string cmdPrefix = playMode ? "/play" : "/open";
            string pathVal = item.Path.Contains(" ") ? $"\"{item.Path}\"" : item.Path;
            string finalCommand = $"{cmdPrefix} {pathVal}";

            if (chatInputField != null)
            {
                chatInputField.text = finalCommand;
                SubmitUserChat();
            }

            if (suggestionsContainer != null)
            {
                suggestionsContainer.SetActive(false);
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
            UpdateButtonVisuals();
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
            UpdateButtonVisuals();
        }

        private void InitializeStaticDropdowns()
        {
            if (voiceDropdown != null)
            {
                voiceDropdown.ClearOptions();
                var options = new List<TMP_Dropdown.OptionData>();
                foreach (var label in TtsVoiceLabels)
                {
                    options.Add(new TMP_Dropdown.OptionData(label));
                }
                voiceDropdown.AddOptions(options);
            }

            if (ttsRateDropdown != null)
            {
                ttsRateDropdown.ClearOptions();
                var options = new List<TMP_Dropdown.OptionData>();
                foreach (var label in TtsRateLabels)
                {
                    options.Add(new TMP_Dropdown.OptionData(label));
                }
                ttsRateDropdown.AddOptions(options);
            }
        }

        private void LoadDashboardData()
        {
            if (restClient == null) return;

            restClient.FetchLlmModels(
                onSuccess: res => {
                    if (modelDropdown != null && res != null && res.Models != null)
                    {
                        modelDropdown.ClearOptions();
                        var options = new List<TMP_Dropdown.OptionData>();
                        foreach (var model in res.Models)
                        {
                            options.Add(new TMP_Dropdown.OptionData(model.Name));
                        }
                        modelDropdown.AddOptions(options);

                        string activeModel = res.Active;
                        if (currentSettings != null && !string.IsNullOrEmpty(currentSettings.LlmModel))
                        {
                            activeModel = currentSettings.LlmModel;
                        }
                        SelectDropdownOption(modelDropdown, activeModel);
                    }
                },
                onError: err => Debug.LogError($"[UIController] Failed to fetch LLM models: {err}")
            );

            restClient.FetchSettings(
                onSuccess: settings => {
                    currentSettings = settings;
                    if (settings != null)
                    {
                        UpdateDropdownSelectionsFromSettings(settings);
                    }
                },
                onError: err => Debug.LogError($"[UIController] Failed to fetch settings: {err}")
            );
        }

        private void UpdateDropdownSelectionsFromSettings(YukiSettingsData settings)
        {
            if (settings == null) return;

            isUpdatingDropdownsSilently = true;
            try
            {
                if (modelDropdown != null)
                {
                    SelectDropdownOption(modelDropdown, settings.LlmModel);
                }

                if (voiceDropdown != null)
                {
                    int voiceIdx = Array.IndexOf(TtsVoiceValues, settings.TtsVoice);
                    if (voiceIdx >= 0) voiceDropdown.value = voiceIdx;
                }

                if (ttsRateDropdown != null)
                {
                    int rateIdx = Array.IndexOf(TtsRateValues, settings.TtsRate);
                    if (rateIdx >= 0) ttsRateDropdown.value = rateIdx;
                }

                if (characterNameInputField != null)
                {
                    characterNameInputField.text = settings.CharacterName ?? "";
                }

                if (characterPersonaInputField != null)
                {
                    characterPersonaInputField.text = settings.CharacterPersona ?? "";
                }

                if (crawlerPausedToggle != null)
                {
                    crawlerPausedToggle.isOn = settings.CrawlerPaused;
                }

                if (taggerPausedToggle != null)
                {
                    taggerPausedToggle.isOn = settings.TaggerPaused;
                }

                if (noLlmModeToggle != null)
                {
                    noLlmModeToggle.isOn = settings.NoLlmMode;
                }

                if (useLocalWhisperToggle != null)
                {
                    useLocalWhisperToggle.isOn = settings.UseLocalWhisper;
                }
            }
            finally
            {
                isUpdatingDropdownsSilently = false;
            }
        }

        private void OnModelDropdownChanged(int index)
        {
            if (isUpdatingDropdownsSilently) return;
            if (modelDropdown == null || restClient == null) return;
            string selectedModel = modelDropdown.options[index].text;
            
            restClient.SetActiveModel(selectedModel,
                onSuccess: res => Debug.Log($"[UIController] Active model set successfully to {selectedModel}"),
                onError: err => Debug.LogError($"[UIController] Failed to set active model: {err}")
            );

            if (currentSettings != null)
            {
                currentSettings.LlmModel = selectedModel;
            }
        }

        private void OnVoiceDropdownChanged(int index)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            if (index < 0 || index >= TtsVoiceValues.Length) return;

            string selectedVoice = TtsVoiceValues[index];
            currentSettings.TtsVoice = selectedVoice;

            restClient.UpdateSettings(currentSettings,
                onSuccess: res => Debug.Log($"[UIController] Settings updated with voice: {selectedVoice}"),
                onError: err => Debug.LogError($"[UIController] Failed to update settings voice: {err}")
            );
        }

        private void OnTtsRateDropdownChanged(int index)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            if (index < 0 || index >= TtsRateValues.Length) return;

            string selectedRate = TtsRateValues[index];
            currentSettings.TtsRate = selectedRate;

            restClient.UpdateSettings(currentSettings,
                onSuccess: res => Debug.Log($"[UIController] Settings updated with rate: {selectedRate}"),
                onError: err => Debug.LogError($"[UIController] Failed to update settings rate: {err}")
            );
        }

        public void StartDraggingWindow()
        {
            if (desktopOverlay != null)
            {
                desktopOverlay.DragWindow();
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

        private void ToggleChatInputContainer()
        {
            if (chatInputContainer != null)
            {
                bool nextActive = !chatInputContainer.activeSelf;
                chatInputContainer.SetActive(nextActive);
                UpdateButtonVisuals();
            }
        }

        private void ToggleAlwaysOnTop()
        {
            isAlwaysOnTop = !isAlwaysOnTop;
            if (desktopOverlay != null)
            {
                desktopOverlay.SetAlwaysOnTop(isAlwaysOnTop);
            }
            UpdateButtonVisuals();
        }

        private async void TerminateProcessing()
        {
            Debug.Log("[Terminate] Interrupting current turn and clearing playback.");
            if (audioManager != null)
            {
                audioManager.StopAndClear();
            }
            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendInterruptAsync();
            }
            if (speechBubbleContainer != null)
            {
                speechBubbleContainer.SetActive(false);
            }
            currentAssistantBubbleContent.Clear();
            if (statusIndicatorText != null)
            {
                statusIndicatorText.text = "Yuki: Idle";
            }
            if (avatarPresenter != null)
            {
                avatarPresenter.SetThinking(false);
                avatarPresenter.SetListening(false);
                avatarPresenter.SetExpression("neutral");
            }
        }

        private void ToggleMuteState()
        {
            if (audioManager != null)
            {
                bool nextMute = !audioManager.IsMuted;
                audioManager.SetMuted(nextMute);
                if (muteToggle != null)
                {
                    muteToggle.isOn = nextMute;
                }
                UpdateButtonVisuals();
            }
        }

        private void QuitApplication()
        {
            Debug.Log("[UIController] Quitting application.");
            Application.Quit();
        }

        private void UpdateButtonVisuals()
        {
            // Chat toggle button color
            if (toggleChatButton != null)
            {
                var img = toggleChatButton.GetComponent<Image>();
                if (img != null)
                {
                    img.color = (chatInputContainer != null && chatInputContainer.activeSelf) ? AccentTeal : BgColor;
                }
            }

            // Always on top button color/icon
            if (alwaysOnTopButton != null)
            {
                var img = alwaysOnTopButton.GetComponent<Image>();
                if (img != null)
                {
                    img.color = isAlwaysOnTop ? AccentTeal : BgColor;
                }
                Transform iconTrans = alwaysOnTopButton.transform.Find("Icon");
                if (iconTrans != null)
                {
                    var iconImg = iconTrans.GetComponent<Image>();
                    if (iconImg != null)
                    {
                        iconImg.sprite = isAlwaysOnTop ? eyeOnSprite : eyeOffSprite;
                    }
                }
            }

            // Mute button color/icon
            if (muteButton != null)
            {
                bool isMuted = audioManager != null && audioManager.IsMuted;
                var img = muteButton.GetComponent<Image>();
                if (img != null)
                {
                    img.color = isMuted ? new Color(0.9f, 0.3f, 0.3f, 1f) : BgColor;
                }
                Transform iconTrans = muteButton.transform.Find("Icon");
                if (iconTrans != null)
                {
                    var iconImg = iconTrans.GetComponent<Image>();
                    if (iconImg != null)
                    {
                        iconImg.sprite = isMuted ? volumeOffSprite : volumeOnSprite;
                    }
                }
            }

            // Mic button color/label
            if (micToggleButton != null)
            {
                bool active = talkModeController != null && talkModeController.IsTalkMode;
                var img = micToggleButton.GetComponent<Image>();
                if (img != null)
                {
                    img.color = active ? AccentTeal : AccentPurple;
                }
                Transform iconTrans = micToggleButton.transform.Find("Icon");
                if (iconTrans != null)
                {
                    var iconImg = iconTrans.GetComponent<Image>();
                    if (iconImg != null)
                    {
                        iconImg.sprite = active ? micOnSprite : micOffSprite;
                    }
                }
            }
        }

        private void LoadDynamicSprites()
        {
            if (eyeOnSprite == null) eyeOnSprite = Resources.Load<Sprite>("Textures/UI_Icon_alwaysontop");
            if (eyeOffSprite == null) eyeOffSprite = Resources.Load<Sprite>("Textures/UI_Icon_alwaysontop_off");
            if (volumeOnSprite == null) volumeOnSprite = Resources.Load<Sprite>("Textures/UI_Icon_volume_on");
            if (volumeOffSprite == null) volumeOffSprite = Resources.Load<Sprite>("Textures/UI_Icon_volume_off");
            if (micOnSprite == null) micOnSprite = Resources.Load<Sprite>("Textures/UI_Icon_mic_on");
            if (micOffSprite == null) micOffSprite = Resources.Load<Sprite>("Textures/UI_Icon_mic_off");
            if (chatSprite == null) chatSprite = Resources.Load<Sprite>("Textures/UI_Icon_chat");
            if (settingsSprite == null) settingsSprite = Resources.Load<Sprite>("Textures/UI_Icon_settings");
            if (terminateSprite == null) terminateSprite = Resources.Load<Sprite>("Textures/UI_Icon_terminate");
            if (closeSprite == null) closeSprite = Resources.Load<Sprite>("Textures/UI_Icon_close");

            // Apply these sprites to the UI buttons initially if they were loaded or assigned
            if (toggleChatButton != null)
            {
                var icon = toggleChatButton.transform.Find("Icon")?.GetComponent<Image>();
                if (icon != null && chatSprite != null) icon.sprite = chatSprite;
            }
            if (toggleDashboardButton != null)
            {
                var icon = toggleDashboardButton.transform.Find("Icon")?.GetComponent<Image>();
                if (icon != null && settingsSprite != null) icon.sprite = settingsSprite;
            }
            if (terminateButton != null)
            {
                var icon = terminateButton.transform.Find("Icon")?.GetComponent<Image>();
                if (icon != null && terminateSprite != null) icon.sprite = terminateSprite;
            }
            if (closeButton != null)
            {
                var icon = closeButton.transform.Find("Icon")?.GetComponent<Image>();
                if (icon != null && closeSprite != null) icon.sprite = closeSprite;
            }
        }

        private void OnCharacterNameEndEdit(string text)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.CharacterName = text;
            SaveSettingsToServer();
        }

        private void OnCharacterPersonaEndEdit(string text)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.CharacterPersona = text;
            SaveSettingsToServer();
        }

        private void OnCrawlerPausedToggleChanged(bool val)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.CrawlerPaused = val;
            SaveSettingsToServer();
        }

        private void OnTaggerPausedToggleChanged(bool val)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.TaggerPaused = val;
            SaveSettingsToServer();
        }

        private void OnNoLlmModeToggleChanged(bool val)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.NoLlmMode = val;
            SaveSettingsToServer();
        }

        private void OnUseLocalWhisperToggleChanged(bool val)
        {
            if (isUpdatingDropdownsSilently) return;
            if (restClient == null || currentSettings == null) return;
            currentSettings.UseLocalWhisper = val;
            SaveSettingsToServer();
        }

        private void SaveSettingsToServer()
        {
            if (restClient == null || currentSettings == null) return;
            restClient.UpdateSettings(currentSettings,
                onSuccess: res => Debug.Log("[UIController] Settings successfully saved to backend"),
                onError: err => Debug.LogError($"[UIController] Failed to save settings: {err}")
            );
        }
    }

    [Serializable]
    public class YukiSuggestionItem
    {
        [JsonProperty("name")] public string Name;
        [JsonProperty("path")] public string Path;
        [JsonProperty("type")] public string Type;
        [JsonProperty("score")] public float Score;
    }

    [Serializable]
    public class YukiSuggestionsResponse
    {
        [JsonProperty("suggestions")] public List<YukiSuggestionItem> Suggestions;
    }
}
