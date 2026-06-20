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
            if (webSocketClient != null) webSocketClient.EventReceived += HandleBackendEvent;
        }

        private void OnDisable()
        {
            if (webSocketClient != null) webSocketClient.EventReceived -= HandleBackendEvent;
        }

        public async void SendUserMessage(string message)
        {
            if (webSocketClient == null) return;
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
