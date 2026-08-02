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

    public sealed class YukiPcStatResponse
    {
        [JsonProperty("cpu")]
        public YukiCpuStat Cpu { get; set; }

        [JsonProperty("ram")]
        public YukiRamStat Ram { get; set; }

        [JsonProperty("gpus")]
        public List<YukiGpuStat> Gpus { get; set; } = new();

        [JsonProperty("battery")]
        public YukiBatteryStat Battery { get; set; }

        [JsonProperty("disk")]
        public YukiDiskStat Disk { get; set; }

        [JsonProperty("uptime")]
        public YukiUptimeStat Uptime { get; set; }

        [JsonProperty("os")]
        public string Os { get; set; } = string.Empty;
    }

    public sealed class YukiCpuStat
    {
        [JsonProperty("usage_percent")]
        public float UsagePercent { get; set; }

        [JsonProperty("cores_physical")]
        public int CoresPhysical { get; set; }

        [JsonProperty("cores_logical")]
        public int CoresLogical { get; set; }

        [JsonProperty("freq_mhz")]
        public float FreqMhz { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public sealed class YukiRamStat
    {
        [JsonProperty("used_gb")]
        public float UsedGb { get; set; }

        [JsonProperty("total_gb")]
        public float TotalGb { get; set; }

        [JsonProperty("usage_percent")]
        public float UsagePercent { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public sealed class YukiGpuStat
    {
        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("has_metrics")]
        public bool HasMetrics { get; set; }

        [JsonProperty("utilization_percent")]
        public float UtilizationPercent { get; set; }

        [JsonProperty("temp_c")]
        public float TempC { get; set; }

        [JsonProperty("mem_used_mb")]
        public float MemUsedMb { get; set; }

        [JsonProperty("mem_total_mb")]
        public float MemTotalMb { get; set; }
    }

    public sealed class YukiBatteryStat
    {
        [JsonProperty("percent")]
        public float Percent { get; set; }

        [JsonProperty("charging")]
        public bool Charging { get; set; }

        [JsonProperty("discharging")]
        public bool Discharging { get; set; }

        [JsonProperty("charge_rate_mw")]
        public float ChargeRateMw { get; set; }

        [JsonProperty("discharge_rate_mw")]
        public float DischargeRateMw { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public sealed class YukiDiskStat
    {
        [JsonProperty("used_gb")]
        public float UsedGb { get; set; }

        [JsonProperty("total_gb")]
        public float TotalGb { get; set; }

        [JsonProperty("usage_percent")]
        public float UsagePercent { get; set; }

        [JsonProperty("free_gb")]
        public float FreeGb { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public sealed class YukiUptimeStat
    {
        [JsonProperty("hours")]
        public int Hours { get; set; }

        [JsonProperty("minutes")]
        public int Minutes { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }
    }

    public sealed class YukiOpenPlayResponse
    {
        [JsonProperty("status")]
        public string Status { get; set; } = string.Empty;

        [JsonProperty("result")]
        public string Result { get; set; } = string.Empty;

        [JsonProperty("error")]
        public string Error { get; set; } = string.Empty;

        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("pending_confirmation_id")]
        public string PendingConfirmationId { get; set; } = string.Empty;
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
