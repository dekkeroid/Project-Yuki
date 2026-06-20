using UnityEngine;

namespace Yuki.UnityFrontend.Backend
{
    [CreateAssetMenu(menuName = "Yuki/Backend Config")]
    public sealed class YukiBackendConfig : ScriptableObject
    {
        public const string DefaultHttpBaseUrl = "http://127.0.0.1:8000";
        public const string DefaultWebsocketUrl = "ws://127.0.0.1:8000/ws";

        [SerializeField] private string httpBaseUrl = DefaultHttpBaseUrl;
        [SerializeField] private string websocketUrl = DefaultWebsocketUrl;

        public string HttpBaseUrl => string.IsNullOrWhiteSpace(httpBaseUrl) ? DefaultHttpBaseUrl : httpBaseUrl;
        public string WebsocketUrl => string.IsNullOrWhiteSpace(websocketUrl) ? DefaultWebsocketUrl : websocketUrl;
    }
}
