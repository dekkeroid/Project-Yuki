using System.Collections;
using System.Text;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiRestClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;

        public string HttpBaseUrl => config != null ? config.HttpBaseUrl : YukiBackendConfig.DefaultHttpBaseUrl;

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
            using var request = new UnityWebRequest($"{HttpBaseUrl}/api/system/open_or_play", "POST");
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            yield return request.SendWebRequest();
        }
    }
}
