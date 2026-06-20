using Newtonsoft.Json;

namespace Yuki.UnityFrontend.Chat
{
    public sealed class YukiBackendEvent
    {
        [JsonProperty("type")]
        public string Type { get; set; } = string.Empty;

        [JsonProperty("text")]
        public string Text { get; set; } = string.Empty;

        [JsonProperty("backend_used")]
        public string BackendUsed { get; set; } = string.Empty;

        [JsonProperty("status")]
        public string Status { get; set; } = string.Empty;

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;

        [JsonProperty("conf_id")]
        public string ConfirmationId { get; set; } = string.Empty;

        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("result")]
        public string Result { get; set; } = string.Empty;

        [JsonProperty("audio_url")]
        public string AudioUrl { get; set; } = string.Empty;
    }

    public sealed class YukiChatRequest
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "chat";

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;
    }

    public sealed class YukiConfirmResponse
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "confirm_response";

        [JsonProperty("conf_id")]
        public string ConfirmationId { get; set; } = string.Empty;

        [JsonProperty("confirmed")]
        public bool Confirmed { get; set; }
    }
}
