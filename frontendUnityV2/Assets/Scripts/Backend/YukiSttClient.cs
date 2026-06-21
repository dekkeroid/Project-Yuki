using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiSttClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;
        [SerializeField] private string whisperModel = "base";

        public string WhisperModel
        {
            get => whisperModel;
            set => whisperModel = value;
        }

        private string HttpBaseUrl => config != null ? config.HttpBaseUrl : YukiBackendConfig.DefaultHttpBaseUrl;

        public event Action<string> OnTranscriptionComplete;
        public event Action<string> OnTranscriptionError;

        private bool isTranscribing;

        public bool IsTranscribing => isTranscribing;

        public void Transcribe(byte[] wavAudio)
        {
            if (isTranscribing)
            {
                Debug.LogWarning("[SttClient] Already transcribing, ignoring request.");
                return;
            }

            if (wavAudio == null || wavAudio.Length == 0)
            {
                OnTranscriptionError?.Invoke("No audio data to transcribe.");
                return;
            }

            StartCoroutine(TranscribeCoroutine(wavAudio));
        }

        private IEnumerator TranscribeCoroutine(byte[] wavAudio)
        {
            isTranscribing = true;

            var form = new List<IMultipartFormSection>
            {
                new MultipartFormFileSection("file", wavAudio, "speech.wav", "audio/wav"),
                new MultipartFormDataSection("model", whisperModel)
            };

            using var req = UnityWebRequest.Post($"{HttpBaseUrl}/api/speech/transcribe", form);
            yield return req.SendWebRequest();

            isTranscribing = false;

            if (req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError)
            {
                OnTranscriptionError?.Invoke(req.error);
                yield break;
            }

            try
            {
                var json = req.downloadHandler.text;
                var data = JsonUtility.FromJson<SttResponse>(json);

                if (string.IsNullOrEmpty(data.text))
                {
                    OnTranscriptionError?.Invoke("Empty transcription result.");
                }
                else
                {
                    OnTranscriptionComplete?.Invoke(data.text.Trim());
                }
            }
            catch (Exception ex)
            {
                OnTranscriptionError?.Invoke($"Failed to parse STT response: {ex.Message}");
            }
        }

        [Serializable]
        private class SttResponse
        {
            public string text;
        }
    }
}
