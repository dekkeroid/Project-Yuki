using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.Backend
{

    [Serializable]
    public class YukiLlmModelItem
    {
        [JsonProperty("name")] public string Name;
        [JsonProperty("type")] public string Type;
    }

    [Serializable]
    public class YukiLlmModelsResponse
    {
        [JsonProperty("models")] public List<YukiLlmModelItem> Models;
        [JsonProperty("active")] public string Active;
    }

    [Serializable]
    public class YukiVrmModelsResponse
    {
        [JsonProperty("models")] public List<string> Models;
    }

    [Serializable]
    public class YukiSettingsData
    {
        [JsonProperty("llm_model")] public string LlmModel;
        [JsonProperty("tts_voice")] public string TtsVoice;
        [JsonProperty("tts_rate")] public string TtsRate;
        [JsonProperty("character_name")] public string CharacterName;
        [JsonProperty("character_persona")] public string CharacterPersona;
        [JsonProperty("crawler_paused")] public bool CrawlerPaused;
        [JsonProperty("tagger_paused")] public bool TaggerPaused;
        [JsonProperty("active_vrm_model")] public string ActiveVrmModel;
        [JsonProperty("whisper_model")] public string WhisperModel;
        [JsonProperty("use_local_whisper")] public bool UseLocalWhisper;
        [JsonProperty("stt_language")] public string SttLanguage;
        [JsonProperty("no_llm_mode")] public bool NoLlmMode;
    }

    public sealed class YukiRestClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;

        public string HttpBaseUrl => config != null ? config.HttpBaseUrl : YukiBackendConfig.DefaultHttpBaseUrl;

        public event Action<YukiPcStatResponse> OnPcStatReceived;
        public event Action<string> OnPcStatError;

        public event Action<YukiOpenPlayResponse> OnOpenPlayResult;
        public event Action<string, string> OnOpenPlayConfirmRequired;
        public event Action<string> OnOpenPlayError;

        public void FetchPcStat()
        {
            StartCoroutine(FetchPcStatCoroutine());
        }

        public void OpenOrPlay(string query, bool playMode, string pendingConfirmationId = null)
        {
            StartCoroutine(OpenOrPlayCoroutine(query, playMode, pendingConfirmationId));
        }

        public static object BuildOpenPlayPayload(string query, bool playMode, string pendingConfirmationId)
        {
            return new
            {
                query,
                play_mode = playMode,
                pending_confirmation_id = pendingConfirmationId
            };
        }

        private IEnumerator FetchPcStatCoroutine()
        {
            string url = $"{HttpBaseUrl}/api/system/pcstat";
            using var req = UnityWebRequest.Get(url);
            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError)
            {
                OnPcStatError?.Invoke(req.error);
                yield break;
            }

            try
            {
                var data = JsonConvert.DeserializeObject<YukiPcStatResponse>(req.downloadHandler.text);
                OnPcStatReceived?.Invoke(data);
            }
            catch (Exception ex)
            {
                OnPcStatError?.Invoke(ex.Message);
            }
        }

        private IEnumerator OpenOrPlayCoroutine(string query, bool playMode, string pendingConfirmationId)
        {
            var body = BuildOpenPlayPayload(query, playMode, pendingConfirmationId);
            var payload = JsonConvert.SerializeObject(body);
            using var req = new UnityWebRequest($"{HttpBaseUrl}/api/system/open_or_play", "POST");
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");

            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError)
            {
                OnOpenPlayError?.Invoke(req.error);
                yield break;
            }

            try
            {
                var data = JsonConvert.DeserializeObject<YukiOpenPlayResponse>(req.downloadHandler.text);

                if (data.Status == "confirm_required")
                {
                    OnOpenPlayConfirmRequired?.Invoke(data.Name, data.PendingConfirmationId);
                }
                else
                {
                    OnOpenPlayResult?.Invoke(data);
                }
            }
            catch (Exception ex)
            {
                OnOpenPlayError?.Invoke(ex.Message);
            }
        }

        // --- Expanded REST Methods ---

        public void FetchLlmModels(Action<YukiLlmModelsResponse> onSuccess, Action<string> onError)
        {
            StartCoroutine(GetRequestCoroutine("/api/models", onSuccess, onError));
        }

        public void FetchVrmModels(Action<YukiVrmModelsResponse> onSuccess, Action<string> onError)
        {
            StartCoroutine(GetRequestCoroutine("/api/models/vrm", onSuccess, onError));
        }

        public void FetchSettings(Action<YukiSettingsData> onSuccess, Action<string> onError)
        {
            StartCoroutine(GetRequestCoroutine("/api/settings", onSuccess, onError));
        }

        public void SetActiveModel(string modelName, Action<string> onSuccess, Action<string> onError)
        {
            var reqObj = new { model = modelName };
            string json = JsonConvert.SerializeObject(reqObj);
            StartCoroutine(PostRequestCoroutine("/api/model/set", json, onSuccess, onError));
        }

        public void UpdateSettings(YukiSettingsData settings, Action<string> onSuccess, Action<string> onError)
        {
            string json = JsonConvert.SerializeObject(settings);
            StartCoroutine(PostRequestCoroutine("/api/settings/update", json, onSuccess, onError));
        }

        private IEnumerator GetRequestCoroutine<T>(string endpoint, Action<T> onSuccess, Action<string> onError)
        {
            using var req = UnityWebRequest.Get(HttpBaseUrl + endpoint);
            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError)
            {
                onError?.Invoke(req.error);
            }
            else
            {
                try
                {
                    var data = JsonConvert.DeserializeObject<T>(req.downloadHandler.text);
                    onSuccess?.Invoke(data);
                }
                catch (Exception ex)
                {
                    onError?.Invoke(ex.Message);
                }
            }
        }

        private IEnumerator PostRequestCoroutine(string endpoint, string jsonPayload, Action<string> onSuccess, Action<string> onError)
        {
            using var req = new UnityWebRequest(HttpBaseUrl + endpoint, "POST");
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonPayload);
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");

            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.ConnectionError || req.result == UnityWebRequest.Result.ProtocolError)
            {
                onError?.Invoke(req.error);
            }
            else
            {
                onSuccess?.Invoke(req.downloadHandler.text);
            }
        }
    }
}
