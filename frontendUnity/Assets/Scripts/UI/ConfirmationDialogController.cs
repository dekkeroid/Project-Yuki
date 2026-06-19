using UnityEngine;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.UI
{
    public sealed class ConfirmationDialogController : MonoBehaviour
    {
        [SerializeField] private YukiWebSocketClient webSocketClient;
        private string activeConfirmationId = string.Empty;

        private void OnEnable()
        {
            if (webSocketClient != null) webSocketClient.EventReceived += HandleBackendEvent;
        }

        private void OnDisable()
        {
            if (webSocketClient != null) webSocketClient.EventReceived -= HandleBackendEvent;
        }

        private void HandleBackendEvent(YukiBackendEvent evt)
        {
            if (evt.Type != "confirm_request") return;
            activeConfirmationId = evt.ConfirmationId;
            Debug.Log($"Yuki confirmation required: {evt.Name}");
        }

        public async void ApproveActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId) || webSocketClient == null) return;
            await webSocketClient.SendConfirmationAsync(activeConfirmationId, true);
            activeConfirmationId = string.Empty;
        }

        public async void RejectActiveConfirmation()
        {
            if (string.IsNullOrEmpty(activeConfirmationId) || webSocketClient == null) return;
            await webSocketClient.SendConfirmationAsync(activeConfirmationId, false);
            activeConfirmationId = string.Empty;
        }
    }
}
