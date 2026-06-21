#pragma warning disable CS0067, CS0414
using System;
using System.Collections.Generic;
using UnityEngine;
using Yuki.UnityFrontend.Avatar;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.UI
{
    public sealed class YukiSlashCommandHandler : MonoBehaviour
    {
        [SerializeField] private YukiRestClient restClient;
        [SerializeField] private YukiAvatarPresenter avatarPresenter;
        [SerializeField] private YukiWebSocketClient webSocketClient;

        private string activePendingConfirmationId = null;
        private string pendingOpenQuery = null;
        private bool pendingPlayMode = false;

        public struct SlashCommandDef
        {
            public string Cmd;
            public string Description;
            public string AnimationName;
        }

        private static readonly List<SlashCommandDef> CommandDefs = new()
        {
            new() { Cmd = "/pcstat", Description = "Show live PC stats (CPU, RAM, GPU...)" },
            new() { Cmd = "/open", Description = "Search and open any file" },
            new() { Cmd = "/o", Description = "Search and open any file (Alias)" },
            new() { Cmd = "/play", Description = "Search and play a video or song" },
            new() { Cmd = "/p", Description = "Search and play a video or song (Alias)" },
            new() { Cmd = "/wink", Description = "Yuki winks at you" },
            new() { Cmd = "/angry", Description = "Yuki pouts angrily" },
            new() { Cmd = "/sad", Description = "Yuki sighs sadly" },
            new() { Cmd = "/surprised", Description = "Yuki looks surprised" },
            new() { Cmd = "/relaxed", Description = "Yuki smiles relaxedly" },
            new() { Cmd = "/neutral", Description = "Reset expression to neutral" },
            new() { Cmd = "/ani-wave", Description = "Wave hello animation", AnimationName = "wave" },
            new() { Cmd = "/ani-greeting", Description = "Greeting wave animation (alias)", AnimationName = "wave" },
            new() { Cmd = "/laugh", Description = "Giggle and laugh animation", AnimationName = "laugh" },
            new() { Cmd = "/ani-laugh", Description = "Giggle and laugh animation (alias)", AnimationName = "laugh" },
            new() { Cmd = "/ani-peer", Description = "Curious peeking animation", AnimationName = "peering" },
            new() { Cmd = "/ani-curious", Description = "Curious peek animation (alias)", AnimationName = "peering" },
            new() { Cmd = "/ani-nap", Description = "Nod off and startle awake", AnimationName = "nap" },
            new() { Cmd = "/ani-sleepy", Description = "Sleepy animation (alias)", AnimationName = "nap" },
            new() { Cmd = "/ani-groove", Description = "Groove / head-bob animation", AnimationName = "groove" },
            new() { Cmd = "/ani-bob", Description = "Head-bob animation (alias)", AnimationName = "groove" },
            new() { Cmd = "/ani-pout", Description = "Cross arms and pout animation", AnimationName = "pout" },
            new() { Cmd = "/ani-boredarm", Description = "Bored arm animation (alias)", AnimationName = "pout" },
            new() { Cmd = "/ani-yawn", Description = "Yawn tiredly animation", AnimationName = "yawn" },
            new() { Cmd = "/ani-shrug", Description = "Shrug shoulders animation", AnimationName = "shrug" },
            new() { Cmd = "/ani-knock", Description = "Screen knocking animation", AnimationName = "knock" },
        };

        private static readonly Dictionary<string, string> ExpressionCommands = new()
        {
            { "/wink", "happy" },
            { "/angry", "angry" },
            { "/sad", "sad" },
            { "/surprised", "surprised" },
            { "/relaxed", "relaxed" },
            { "/neutral", "neutral" },
        };

        private static readonly Dictionary<string, string> ExpressionResponseText = new()
        {
            { "/wink", "*winks at you*" },
            { "/angry", "*pouts angrily*" },
            { "/sad", "*sighs sadly*" },
            { "/surprised", "*looks surprised*" },
            { "/relaxed", "*smiles relaxedly*" },
            { "/neutral", "*resets expression*" },
        };

        private static readonly Dictionary<string, string> AnimationResponseText = new()
        {
            { "wave", "*waves hello*" },
            { "laugh", "*giggles and laughs*" },
            { "peering", "*peers curious at you*" },
            { "nap", "*nods off and startles awake*" },
            { "groove", "*grooves to the beat*" },
            { "pout", "*crosses arms and pouts*" },
            { "yawn", "*yawns tiredly*" },
            { "shrug", "*shrugs shoulders*" },
            { "knock", "*knocks on your screen*" },
        };

        public IReadOnlyList<SlashCommandDef> Commands => CommandDefs;

        public event Action<string> OnResponseText;
        public event Action<string, string> OnAddMessage;
        public event Action<bool> OnSetThinking;
        public event Action<string, string> OnSpeakTts;

        private void OnEnable()
        {
            if (restClient != null)
            {
                restClient.OnPcStatReceived += HandlePcStatResult;
                restClient.OnPcStatError += HandlePcStatError;
                restClient.OnOpenPlayResult += HandleOpenPlayResult;
                restClient.OnOpenPlayConfirmRequired += HandleOpenPlayConfirmRequired;
                restClient.OnOpenPlayError += HandleOpenPlayError;
            }
        }

        private void OnDisable()
        {
            if (restClient != null)
            {
                restClient.OnPcStatReceived -= HandlePcStatResult;
                restClient.OnPcStatError -= HandlePcStatError;
                restClient.OnOpenPlayResult -= HandleOpenPlayResult;
                restClient.OnOpenPlayConfirmRequired -= HandleOpenPlayConfirmRequired;
                restClient.OnOpenPlayError -= HandleOpenPlayError;
            }
        }

        public bool IsKnownCommand(string text)
        {
            if (string.IsNullOrEmpty(text) || !text.StartsWith("/")) return false;
            string cmd = text.Split(' ')[0].ToLower();
            return CommandDefs.Exists(c => c.Cmd.ToLower() == cmd);
        }

        public bool TryHandleCommand(string text)
        {
            if (string.IsNullOrEmpty(text) || !text.StartsWith("/")) return false;

            string[] parts = text.Split(' ', 2);
            string cmd = parts[0].ToLower();

            if (!CommandDefs.Exists(c => c.Cmd.ToLower() == cmd))
            {
                OnAddMessage?.Invoke("user", text);
                string errorMsg = $"Unknown command: {cmd}. Type / to see all available commands.";
                OnAddMessage?.Invoke("assistant", errorMsg);
                OnResponseText?.Invoke(errorMsg);
                return true;
            }

            if (cmd == "/pcstat")
            {
                HandlePcStatCommand(text);
                return true;
            }

            bool isOpenCmd = cmd is "/open" or "/o";
            bool isPlayCmd = cmd is "/play" or "/p";
            if (isOpenCmd || isPlayCmd)
            {
                HandleOpenPlayCommand(text, cmd, isOpenCmd, isPlayCmd);
                return true;
            }

            if (ExpressionCommands.TryGetValue(cmd, out string expression))
            {
                OnAddMessage?.Invoke("user", text);
                avatarPresenter?.SetExpression(expression);
                string responseText = ExpressionResponseText[cmd];
                OnAddMessage?.Invoke("assistant", responseText);
                OnResponseText?.Invoke(responseText);
                return true;
            }

            var matchingDef = CommandDefs.Find(c => c.Cmd.ToLower() == cmd);
            if (!string.IsNullOrEmpty(matchingDef.AnimationName))
            {
                OnAddMessage?.Invoke("user", text);
                avatarPresenter?.TriggerAnimation(matchingDef.AnimationName);
                string responseText = AnimationResponseText.TryGetValue(matchingDef.AnimationName, out var rt)
                    ? rt
                    : $"*performs {matchingDef.AnimationName}*";
                OnAddMessage?.Invoke("assistant", responseText);
                OnResponseText?.Invoke(responseText);
                return true;
            }

            return false;
        }

        private void HandlePcStatCommand(string text)
        {
            OnAddMessage?.Invoke("user", text);
            OnSetThinking?.Invoke(true);
            avatarPresenter?.SetExpression("happy");
            restClient.FetchPcStat();
        }

        private void HandlePcStatResult(YukiPcStatResponse data)
        {
            OnSetThinking?.Invoke(false);

            if (data == null)
            {
                OnAddMessage?.Invoke("assistant", "Failed to retrieve PC statistics.");
                return;
            }

            string chatText = FormatPcStatChatText(data);
            string ttsText = FormatPcStatTtsText(data);

            OnAddMessage?.Invoke("assistant", chatText);
            avatarPresenter?.SetExpression("happy");
            OnResponseText?.Invoke(ttsText);
        }

        private void HandlePcStatError(string error)
        {
            OnSetThinking?.Invoke(false);
            string errorMsg = "Sorry Master, I couldn't retrieve your PC statistics right now. Make sure the backend server is running.";
            OnAddMessage?.Invoke("assistant", errorMsg);
            avatarPresenter?.SetExpression("sad");
            OnResponseText?.Invoke(errorMsg);
        }

        private string FormatPcStatChatText(YukiPcStatResponse data)
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("Here are your PC stats, Master:");

            if (data.Cpu != null && string.IsNullOrEmpty(data.Cpu.Error))
            {
                sb.Append($"CPU: {data.Cpu.UsagePercent}% ({data.Cpu.CoresLogical} cores");
                if (data.Cpu.FreqMhz > 0)
                    sb.Append($" @ {(data.Cpu.FreqMhz / 1000f):F1} GHz");
                sb.AppendLine(")");
            }

            if (data.Ram != null && string.IsNullOrEmpty(data.Ram.Error))
            {
                sb.AppendLine($"RAM: {data.Ram.UsedGb:F1} GB / {data.Ram.TotalGb:F1} GB ({data.Ram.UsagePercent}%)");
            }

            if (data.Gpus != null && data.Gpus.Count > 0)
            {
                for (int i = 0; i < data.Gpus.Count; i++)
                {
                    var gpu = data.Gpus[i];
                    sb.Append($"GPU {i + 1}: {gpu.Name}");
                    if (gpu.HasMetrics)
                        sb.Append($" ({gpu.UtilizationPercent}% load, {gpu.TempC}C, VRAM: {gpu.MemUsedMb} MB / {gpu.MemTotalMb} MB)");
                    sb.AppendLine();
                }
            }

            if (data.Battery != null && string.IsNullOrEmpty(data.Battery.Error))
            {
                sb.Append($"Battery: {data.Battery.Percent}%");
                if (data.Battery.Charging)
                    sb.Append(" (Charging)");
                else if (data.Battery.Discharging)
                    sb.Append(" (Discharging)");
                else
                    sb.Append(" (Plugged in/Full)");
                sb.AppendLine();
            }
            else if (data.Battery == null)
            {
                sb.AppendLine("Battery: Not detected (Desktop PC)");
            }

            if (data.Disk != null && string.IsNullOrEmpty(data.Disk.Error))
            {
                sb.AppendLine($"Disk (C:): {data.Disk.UsedGb:F1} GB / {data.Disk.TotalGb:F1} GB ({data.Disk.UsagePercent}%)");
            }

            if (data.Uptime != null && string.IsNullOrEmpty(data.Uptime.Error))
            {
                sb.AppendLine($"Uptime: {data.Uptime.Hours}h {data.Uptime.Minutes}m");
            }

            if (!string.IsNullOrEmpty(data.Os))
            {
                sb.Append($"OS: {data.Os}");
            }

            return sb.ToString();
        }

        private string FormatPcStatTtsText(YukiPcStatResponse data)
        {
            var parts = new List<string> { "Here are your PC statistics." };

            if (data.Cpu != null && string.IsNullOrEmpty(data.Cpu.Error))
                parts.Add($"CPU usage is at {Mathf.RoundToInt(data.Cpu.UsagePercent)} percent.");

            if (data.Ram != null && string.IsNullOrEmpty(data.Ram.Error))
                parts.Add($"RAM usage is {Mathf.RoundToInt(data.Ram.UsedGb)} gigabytes out of {Mathf.RoundToInt(data.Ram.TotalGb)}.");

            if (data.Gpus != null)
            {
                var activeGpu = data.Gpus.Find(g => g.HasMetrics);
                if (activeGpu != null)
                    parts.Add($"The GPU is at {activeGpu.UtilizationPercent} percent usage and {activeGpu.TempC} degrees.");
            }

            if (data.Battery != null && string.IsNullOrEmpty(data.Battery.Error))
            {
                var b = data.Battery;
                if (b.Charging)
                    parts.Add($"The battery is at {b.Percent} percent and charging.");
                else if (b.Discharging)
                    parts.Add($"The battery is at {b.Percent} percent and discharging.");
                else
                    parts.Add($"The battery is fully charged at {b.Percent} percent.");
            }

            if (data.Disk != null && string.IsNullOrEmpty(data.Disk.Error) && data.Disk.UsagePercent > 90)
                parts.Add($"Warning: C drive is {data.Disk.UsagePercent} percent full.");

            return string.Join(" ", parts);
        }

        private void HandleOpenPlayCommand(string text, string cmd, bool isOpenCmd, bool isPlayCmd)
        {
            OnAddMessage?.Invoke("user", text);
            OnSetThinking?.Invoke(true);

            string query = text.Substring(cmd.Length).Trim();
            if (string.IsNullOrEmpty(query))
            {
                OnSetThinking?.Invoke(false);
                string errorMsg = $"Please specify what you want to {(isOpenCmd ? "open" : "play")}. Example: {cmd} paint";
                OnAddMessage?.Invoke("assistant", errorMsg);
                OnResponseText?.Invoke(errorMsg);
                return;
            }

            pendingOpenQuery = query;
            pendingPlayMode = isPlayCmd;
            restClient.OpenOrPlay(query, playMode: isPlayCmd);
        }

        private void HandleOpenPlayResult(YukiOpenPlayResponse data)
        {
            OnSetThinking?.Invoke(false);

            if (!string.IsNullOrEmpty(data.Error))
            {
                string errorMsg = $"Sorry Master, I couldn't execute that command: {data.Error}";
                OnAddMessage?.Invoke("assistant", errorMsg);
                avatarPresenter?.SetExpression("sad");
                OnResponseText?.Invoke(errorMsg);
                return;
            }

            string result = string.IsNullOrEmpty(data.Result) ? "Command executed." : data.Result;
            OnAddMessage?.Invoke("assistant", result);
            avatarPresenter?.SetExpression("happy");
            OnResponseText?.Invoke(result);
        }

        private void HandleOpenPlayConfirmRequired(string programName, string pendingConfirmationId)
        {
            OnSetThinking?.Invoke(false);
            activePendingConfirmationId = pendingConfirmationId;

            string msg = $"Yuki wants to open/run: {programName}\n\nDo you authorize this? (Use safety dialog to approve/reject)";
            OnAddMessage?.Invoke("assistant", msg);
            avatarPresenter?.SetExpression("surprised");
        }

        public void ApproveConfirmation()
        {
            if (string.IsNullOrEmpty(activePendingConfirmationId)) return;

            string confId = activePendingConfirmationId;
            activePendingConfirmationId = null;
            OnSetThinking?.Invoke(true);

            _ = SendConfirmationAsync(confId, true);
        }

        public void RejectConfirmation()
        {
            if (string.IsNullOrEmpty(activePendingConfirmationId)) return;

            activePendingConfirmationId = null;
            string cancelMsg = "Error: Execution cancelled by user confirmation security check.";
            OnAddMessage?.Invoke("assistant", cancelMsg);
            avatarPresenter?.SetExpression("sad");
            OnResponseText?.Invoke(cancelMsg);
        }

        private async System.Threading.Tasks.Task SendConfirmationAsync(string confirmationId, bool confirmed)
        {
            if (webSocketClient != null && webSocketClient.IsConnected)
            {
                await webSocketClient.SendConfirmationAsync(confirmationId, confirmed);
            }
        }

        private void HandleOpenPlayError(string error)
        {
            OnSetThinking?.Invoke(false);
            string errorMsg = $"Sorry Master, I couldn't execute that command: {error}";
            OnAddMessage?.Invoke("assistant", errorMsg);
            avatarPresenter?.SetExpression("sad");
            OnResponseText?.Invoke(errorMsg);
        }

        public List<string> GetMatchingCommands(string prefix)
        {
            var results = new List<string>();
            if (string.IsNullOrEmpty(prefix)) return results;

            string lower = prefix.ToLower();
            foreach (var def in CommandDefs)
            {
                if (def.Cmd.ToLower().StartsWith(lower))
                {
                    results.Add(def.Cmd);
                }
            }
            return results;
        }
    }
}
