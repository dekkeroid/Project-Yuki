using Newtonsoft.Json;
using System.Collections.Generic;

namespace Yuki.UnityFrontend.Chat
{
    public sealed class YukiProfileSettings
    {
        [JsonProperty("llm_model")]
        public string LlmModel { get; set; } = string.Empty;

        [JsonProperty("tts_voice")]
        public string TtsVoice { get; set; } = string.Empty;

        [JsonProperty("tts_rate")]
        public string TtsRate { get; set; } = string.Empty;

        [JsonProperty("active_vrm_model")]
        public string ActiveVrmModel { get; set; } = string.Empty;
    }

    public sealed class YukiProfile
    {
        [JsonProperty("user_name")]
        public string UserName { get; set; } = string.Empty;

        [JsonProperty("interaction_count")]
        public int InteractionCount { get; set; }

        [JsonProperty("settings")]
        public YukiProfileSettings Settings { get; set; } = new();
    }

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

        [JsonProperty("profile")]
        public YukiProfile Profile { get; set; }

        [JsonProperty("response_time")]
        public double ResponseTime { get; set; }
    }

    public sealed class YukiChatRequest
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "chat";

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;
    }

    public sealed class YukiInterruptRequest
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "interrupt";
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
