using System.Collections.Generic;
using System.Text;
using UnityEngine;
using Yuki.UnityFrontend.Backend;

namespace Yuki.UnityFrontend.Chat
{
    public sealed class YukiChatController : MonoBehaviour
    {
        [SerializeField] private YukiWebSocketClient webSocketClient;
        private readonly List<string> transcript = new();
        private readonly StringBuilder currentAssistantMessage = new StringBuilder();
        private bool isReceivingMessage = false;

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
            switch (evt.Type)
            {
                case "text_stream":
                    if (!string.IsNullOrEmpty(evt.Text))
                    {
                        if (!isReceivingMessage)
                        {
                            isReceivingMessage = true;
                            currentAssistantMessage.Clear();
                        }
                        currentAssistantMessage.Append(evt.Text);
                    }
                    break;

                case "stream_done":
                    if (isReceivingMessage && currentAssistantMessage.Length > 0)
                    {
                        transcript.Add($"Yuki: {currentAssistantMessage.ToString()}");
                        currentAssistantMessage.Clear();
                        isReceivingMessage = false;
                    }
                    break;
            }
        }
    }
}
