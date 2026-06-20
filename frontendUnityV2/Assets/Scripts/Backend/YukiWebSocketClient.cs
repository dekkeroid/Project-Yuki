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
        [SerializeField] private float reconnectMinDelay = 1f;
        [SerializeField] private float reconnectMaxDelay = 30f;
        [SerializeField] private int maxReconnectAttempts = 0;

        private readonly ConcurrentQueue<YukiBackendEvent> inboundEvents = new();
        private ClientWebSocket socket;
        private CancellationTokenSource lifetime;
        private int reconnectAttempts;
        private bool intentionalClose;
        private bool shouldReconnect = true;
        private float reconnectDelay;

        public event Action<YukiBackendEvent> EventReceived;
        public event Action OnConnected;
        public event Action OnDisconnected;
        public event Action<string> OnConnectionError;

        public bool IsConnected => socket != null && socket.State == WebSocketState.Open;
        public int ReconnectAttempts => reconnectAttempts;

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

            intentionalClose = false;

            lifetime?.Cancel();
            lifetime?.Dispose();
            socket?.Dispose();

            lifetime = new CancellationTokenSource();
            socket = new ClientWebSocket();

            try
            {
                await socket.ConnectAsync(new Uri(WebsocketUrl), lifetime.Token);
                reconnectAttempts = 0;
                reconnectDelay = reconnectMinDelay;
                OnConnected?.Invoke();
                Debug.Log("[WebSocket] Connected to backend.");
                _ = ReceiveLoopAsync(lifetime.Token);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocket] Connection failed: {ex.Message}");
                OnConnectionError?.Invoke(ex.Message);
                _ = AttemptReconnect();
            }
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

        public async Task SendInterruptAsync()
        {
            var payload = JsonConvert.SerializeObject(new YukiInterruptRequest());
            await SendJsonAsync(payload);
        }

        public async Task SendTtsOnlyAsync(string text, string expression = null)
        {
            var body = new System.Collections.Generic.Dictionary<string, string>
            {
                { "type", "tts_only" },
                { "text", text }
            };
            if (!string.IsNullOrEmpty(expression)) body["expression"] = expression;
            var payload = JsonConvert.SerializeObject(body);
            await SendJsonAsync(payload);
        }

        public void Disconnect()
        {
            intentionalClose = true;
            shouldReconnect = false;
            lifetime?.Cancel();
            socket?.Dispose();
            socket = null;
            Debug.Log("[WebSocket] Disconnected intentionally.");
        }

        private async Task SendJsonAsync(string payload)
        {
            if (!IsConnected)
            {
                Debug.LogWarning("[WebSocket] Cannot send, not connected. Attempting reconnect...");
                _ = AttemptReconnect();
                return;
            }

            try
            {
                var bytes = Encoding.UTF8.GetBytes(payload);
                await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, lifetime.Token);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocket] Send failed: {ex.Message}");
                OnConnectionError?.Invoke(ex.Message);
                _ = AttemptReconnect();
            }
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
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            Debug.Log("[WebSocket] Server closed connection.");
                            OnDisconnected?.Invoke();
                            if (shouldReconnect && !intentionalClose) _ = AttemptReconnect();
                            return;
                        }
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
            catch (WebSocketException wsEx)
            {
                Debug.LogError($"[WebSocket] Connection lost: {wsEx.Message}");
                OnConnectionError?.Invoke(wsEx.Message);
                OnDisconnected?.Invoke();
                if (shouldReconnect && !intentionalClose) _ = AttemptReconnect();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WebSocket] Receive loop failed: {ex.Message}");
                OnConnectionError?.Invoke(ex.Message);
                OnDisconnected?.Invoke();
                if (shouldReconnect && !intentionalClose) _ = AttemptReconnect();
            }
        }

        private async Task AttemptReconnect()
        {
            if (intentionalClose || !shouldReconnect) return;
            if (IsConnected) return;

            reconnectAttempts++;

            if (maxReconnectAttempts > 0 && reconnectAttempts >= maxReconnectAttempts)
            {
                Debug.LogError($"[WebSocket] Max reconnect attempts ({maxReconnectAttempts}) reached. Giving up.");
                OnConnectionError?.Invoke("Max reconnect attempts reached.");
                return;
            }

            float jitter = UnityEngine.Random.Range(0f, reconnectDelay * 0.3f);
            float delay = Mathf.Min(reconnectDelay + jitter, reconnectMaxDelay);

            Debug.Log($"[WebSocket] Reconnecting in {delay:F1}s (attempt {reconnectAttempts})...");
            await Task.Delay((int)(delay * 1000));

            reconnectDelay = Mathf.Min(reconnectDelay * 2f, reconnectMaxDelay);

            await ConnectAsync();
        }

        private void OnDestroy()
        {
            Disconnect();
        }

        private void OnApplicationQuit()
        {
            Disconnect();
        }
    }
}
