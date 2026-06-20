using System;
using System.Collections;
using System.Text;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.Backend
{
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
            var body = new
            {
                query,
                play_mode = playMode,
                pending_confirmation_id = pendingConfirmationId
            };

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
    }
}
