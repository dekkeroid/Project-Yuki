using System;
using System.Collections.Generic;
using UnityEngine;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.UI
{
    public sealed class YukiTalkModeController : MonoBehaviour
    {
        [SerializeField] private YukiMicRecorder micRecorder;
        [SerializeField] private YukiSttClient sttClient;
        [SerializeField] private YukiWebSocketClient webSocketClient;
        [SerializeField] private YukiAudioPlaybackManager audioManager;
        [SerializeField] private YukiSlashCommandHandler slashCommandHandler;

        private bool isTalkMode;
        private bool isListening;

        public bool IsTalkMode => isTalkMode;
        public bool IsListening => isListening;

        public event Action<bool> OnTalkModeChanged;
        public event Action<bool> OnListeningChanged;
        public event Action<string> OnTranscriptReady;
        public event Action<string> OnStatusMessage;

        private static readonly HashSet<string> StopWords = new()
        {
            "stop", "stop listening", "exit", "quit"
        };

        private void OnEnable()
        {
            if (micRecorder != null)
            {
                micRecorder.OnRecordingComplete += HandleRecordingComplete;
                micRecorder.OnRecordingCancelled += HandleRecordingCancelled;
            }

            if (sttClient != null)
            {
                sttClient.OnTranscriptionComplete += HandleTranscriptionComplete;
                sttClient.OnTranscriptionError += HandleTranscriptionError;
            }

            if (audioManager != null)
            {
                audioManager.OnSpeechEnded += HandleSpeechEnded;
            }
        }

        private void OnDisable()
        {
            if (micRecorder != null)
            {
                micRecorder.OnRecordingComplete -= HandleRecordingComplete;
                micRecorder.OnRecordingCancelled -= HandleRecordingCancelled;
            }

            if (sttClient != null)
            {
                sttClient.OnTranscriptionComplete -= HandleTranscriptionComplete;
                sttClient.OnTranscriptionError -= HandleTranscriptionError;
            }

            if (audioManager != null)
            {
                audioManager.OnSpeechEnded -= HandleSpeechEnded;
            }
        }

        public void ToggleTalkMode()
        {
            if (isTalkMode)
            {
                StopTalkMode();
            }
            else
            {
                StartTalkMode();
            }
        }

        public void StartTalkMode()
        {
            if (isTalkMode) return;

            isTalkMode = true;
            OnTalkModeChanged?.Invoke(true);
            OnStatusMessage?.Invoke("Talk Mode enabled. Click mic to start listening.");

            StartListening();
        }

        public void StopTalkMode()
        {
            if (!isTalkMode) return;

            isTalkMode = false;
            isListening = false;

            if (micRecorder != null && micRecorder.IsRecording)
            {
                micRecorder.CancelRecording();
            }

            OnTalkModeChanged?.Invoke(false);
            OnListeningChanged?.Invoke(false);
            OnStatusMessage?.Invoke("Talk Mode disabled.");
        }

        public void ToggleListening()
        {
            if (!isTalkMode) return;

            if (isListening)
            {
                StopListening();
            }
            else
            {
                StartListening();
            }
        }

        public void StartListening()
        {
            if (!isTalkMode || isListening) return;

            if (audioManager != null && audioManager.IsPlayingSpeech)
            {
                audioManager.StopAndClear();
                _ = webSocketClient.SendInterruptAsync();
            }

            if (sttClient != null && sttClient.IsTranscribing)
            {
                return;
            }

            isListening = true;
            OnListeningChanged?.Invoke(true);
            OnStatusMessage?.Invoke("Listening...");

            if (micRecorder != null)
            {
                micRecorder.StartRecording();
            }
        }

        public void StopListening()
        {
            if (!isListening) return;

            isListening = false;
            OnListeningChanged?.Invoke(false);

            if (micRecorder != null && micRecorder.IsRecording)
            {
                micRecorder.StopRecording();
            }
        }

        private void HandleRecordingComplete(byte[] wavAudio)
        {
            isListening = false;
            OnListeningChanged?.Invoke(false);
            OnStatusMessage?.Invoke("Transcribing...");

            if (sttClient != null)
            {
                sttClient.Transcribe(wavAudio);
            }
        }

        private void HandleRecordingCancelled()
        {
            isListening = false;
            OnListeningChanged?.Invoke(false);
        }

        private void HandleTranscriptionComplete(string transcript)
        {
            if (string.IsNullOrWhiteSpace(transcript))
            {
                OnStatusMessage?.Invoke("No speech detected.");
                if (isTalkMode) StartListening();
                return;
            }

            string cleaned = transcript.Trim().Trim('.', ',', '!', '?', ';', ':');

            if (StopWords.Contains(cleaned.ToLower()))
            {
                StopTalkMode();
                return;
            }

            OnStatusMessage?.Invoke($"Heard: \"{cleaned}\"");
            OnTranscriptReady?.Invoke(cleaned);
        }

        private void HandleTranscriptionError(string error)
        {
            OnStatusMessage?.Invoke($"STT Error: {error}");
            if (isTalkMode) StartListening();
        }

        private void HandleSpeechEnded(string text)
        {
            if (isTalkMode && !isListening)
            {
                StartListening();
            }
        }

        public void ProcessTranscript(string transcript)
        {
            if (string.IsNullOrWhiteSpace(transcript)) return;

            if (slashCommandHandler != null && slashCommandHandler.IsKnownCommand(transcript))
            {
                slashCommandHandler.TryHandleCommand(transcript);
            }
            else
            {
                _ = SendChatMessage(transcript);
            }
        }

        private async System.Threading.Tasks.Task SendChatMessage(string text)
        {
            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendChatAsync(text);
            }
        }
    }
}
