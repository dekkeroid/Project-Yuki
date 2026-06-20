using System;
using UnityEngine;

namespace Yuki.UnityFrontend.Backend
{
    public static class WavUtil
    {
        public static AudioClip ToAudioClip(string base64String, string clipName = "YukiSpeechSpeech")
        {
            if (string.IsNullOrEmpty(base64String)) return null;

            // Strip the standard data URI prefix if it exists
            const string prefix = "data:audio/wav;base64,";
            if (base64String.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                base64String = base64String.Substring(prefix.Length);
            }

            try
            {
                byte[] wavBytes = Convert.FromBase64String(base64String);
                return ToAudioClip(wavBytes, clipName);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WavUtil] Failed to decode base64 string: {ex.Message}");
                return null;
            }
        }

        public static AudioClip ToAudioClip(byte[] wavBytes, string clipName = "YukiSpeechSpeech")
        {
            if (wavBytes == null || wavBytes.Length < 44)
            {
                Debug.LogError("[WavUtil] Invalid WAV bytes or too short.");
                return null;
            }

            try
            {
                // 1. Read fmt subchunk info
                int channels = BitConverter.ToInt16(wavBytes, 22);
                int sampleRate = BitConverter.ToInt32(wavBytes, 24);
                int bitsPerSample = BitConverter.ToInt16(wavBytes, 34);

                // 2. Locate data chunk by walking subchunks
                int pos = 12;
                bool foundData = false;
                while (pos < wavBytes.Length - 8)
                {
                    string chunkId = System.Text.Encoding.ASCII.GetString(wavBytes, pos, 4);
                    int chunkSize = BitConverter.ToInt32(wavBytes, pos + 4);
                    
                    if (chunkId == "data")
                    {
                        pos += 8;
                        foundData = true;
                        break;
                    }
                    
                    int alignedSize = chunkSize + (chunkSize % 2);
                    pos += 8 + alignedSize;
                }

                if (!foundData || pos >= wavBytes.Length)
                {
                    Debug.LogError("[WavUtil] Could not find WAV data chunk.");
                    return null;
                }

                int dataBytesLength = wavBytes.Length - pos;
                int bytesPerSample = bitsPerSample / 8;
                if (bytesPerSample <= 0)
                {
                    Debug.LogError($"[WavUtil] Invalid bytes per sample derived from bits: {bitsPerSample}");
                    return null;
                }
                int totalSamples = dataBytesLength / bytesPerSample;
                int sampleCount = totalSamples / channels;

                float[] floatData = new float[totalSamples];

                if (bitsPerSample == 16)
                {
                    for (int i = 0; i < totalSamples; i++)
                    {
                        short val = BitConverter.ToInt16(wavBytes, pos + i * 2);
                        floatData[i] = val / 32768.0f; // Scale to -1.0 to 1.0
                    }
                }
                else if (bitsPerSample == 8)
                {
                    for (int i = 0; i < totalSamples; i++)
                    {
                        byte val = wavBytes[pos + i];
                        floatData[i] = (val - 128) / 128.0f; // 8-bit is unsigned (0-255)
                    }
                }
                else if (bitsPerSample == 32)
                {
                    for (int i = 0; i < totalSamples; i++)
                    {
                        floatData[i] = BitConverter.ToSingle(wavBytes, pos + i * 4);
                    }
                }
                else
                {
                    Debug.LogError($"[WavUtil] Unsupported WAV bit depth: {bitsPerSample}");
                    return null;
                }

                AudioClip clip = AudioClip.Create(clipName, sampleCount, channels, sampleRate, false);
                clip.SetData(floatData, 0);
                return clip;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[WavUtil] Exception during WAV parsing: {ex.Message}");
                return null;
            }
        }
    }
}
