using System;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;
using Yuki.UnityFrontend.Avatar;

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
            if (micToggleButton != null) micToggleButton.onClick.RemoveListener(ToggleMicrophoneInput);
            if (toggleDashboardButton != null) toggleDashboardButton.onClick.RemoveListener(ToggleDashboardPanel);
            if (approveSafetyButton != null) approveSafetyButton.onClick.RemoveListener(ApproveActiveConfirmation);
            if (rejectSafetyButton != null) rejectSafetyButton.onClick.RemoveListener(RejectActiveConfirmation);
        }

        private void Start()
        {
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

            if (inputVal.StartsWith("/open ") || inputVal.StartsWith("/play "))
            {
                string query = inputVal.Substring(6).Trim();
                bool playMode = inputVal.StartsWith("/play ");
                if (!string.IsNullOrEmpty(query))
                {
                    StopAllCoroutines();
                    StartCoroutine(FetchSuggestionsCoroutine(query, playMode));
                }
            }
        }

        private System.Collections.IEnumerator FetchSuggestionsCoroutine(string query, bool playMode)
        {
            string type = playMode ? "play" : "open";
            using var req = UnityEngine.Networking.UnityWebRequest.Get($"{YukiRestClient.BuildOpenPlayPayload(query, playMode)}");
            yield return null;
        }

        private void ToggleMicrophoneInput()
        {
            isMicActive = !isMicActive;
            Debug.Log($"[UIController] Microphone voice recording active: {isMicActive}");
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

        private async void ApproveActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId)) return;
            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendConfirmationAsync(activeConfirmationId, true);
            }
            activeConfirmationId = string.Empty;
            if (safetyDialogPanel != null) safetyDialogPanel.SetActive(false);
        }

        private async void RejectActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId)) return;
            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendConfirmationAsync(activeConfirmationId, false);
            }
            activeConfirmationId = string.Empty;
            if (safetyDialogPanel != null) safetyDialogPanel.SetActive(false);
        }
    }
}
