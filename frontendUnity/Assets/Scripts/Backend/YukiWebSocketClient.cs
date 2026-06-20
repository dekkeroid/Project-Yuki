using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiWebSocketClient : MonoBehaviour
    {
        [SerializeField] private YukiBackendConfig config;

        private readonly ConcurrentQueue<YukiBackendEvent> inboundEvents = new();
        private ClientWebSocket socket;
        private CancellationTokenSource lifetime;

        public event Action<YukiBackendEvent> EventReceived;
        public bool IsConnected => socket != null && socket.State == WebSocketState.Open;

        private string WebsocketUrl => config != null ? config.WebsocketUrl : YukiBackendConfig.DefaultWebsocketUrl;

        private void Update()
        {
            while (inboundEvents.TryDequeue(out var evt))
            {
                EventReceived?.Invoke(evt);
            }
        }

        public async Task ConnectAsync()
        {
            if (IsConnected) return;

            lifetime?.Cancel();
            lifetime?.Dispose();
            socket?.Dispose();

            lifetime = new CancellationTokenSource();
            socket = new ClientWebSocket();
            await socket.ConnectAsync(new Uri(WebsocketUrl), lifetime.Token);
            _ = ReceiveLoopAsync(lifetime.Token);
        }

        public async Task SendChatAsync(string message)
        {
            var payload = JsonConvert.SerializeObject(new YukiChatRequest { Message = message });
            await SendJsonAsync(payload);
        }

        public async Task SendConfirmationAsync(string confirmationId, bool confirmed)
        {
            var payload = JsonConvert.SerializeObject(new YukiConfirmResponse
            {
                ConfirmationId = confirmationId,
                Confirmed = confirmed
            });
            await SendJsonAsync(payload);
        }

        private async Task SendJsonAsync(string payload)
        {
            if (!IsConnected) throw new InvalidOperationException("Yuki WebSocket is not connected.");
            var bytes = Encoding.UTF8.GetBytes(payload);
            await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, lifetime.Token);
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[8192];

            try
            {
                while (!token.IsCancellationRequested && IsConnected)
                {
                    using var message = new MemoryStream();
                    WebSocketReceiveResult result;

                    do
                    {
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                        if (result.MessageType == WebSocketMessageType.Close) return;
                        message.Write(buffer, 0, result.Count);
                    }
                    while (!result.EndOfMessage && !token.IsCancellationRequested);

                    var json = Encoding.UTF8.GetString(message.ToArray());
                    var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);
                    if (envelope != null) inboundEvents.Enqueue(envelope);
                }
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown path.
            }
            catch (Exception ex)
            {
                Debug.LogError($"Yuki WebSocket receive loop failed: {ex.Message}");
            }
        }

        private void OnDestroy()
        {
            lifetime?.Cancel();
            socket?.Dispose();
            lifetime?.Dispose();
        }
    }
}
