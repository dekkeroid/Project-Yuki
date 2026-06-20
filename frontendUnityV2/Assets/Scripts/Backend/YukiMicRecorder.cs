using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace Yuki.UnityFrontend.Backend
{
    public sealed class YukiMicRecorder : MonoBehaviour
    {
        [SerializeField] private int sampleRate = 16000;
        [SerializeField] private int recordingLengthSeconds = 30;
        [SerializeField] private float vadThreshold = 0.02f;
        [SerializeField] private float silenceTimeoutSeconds = 1.5f;
        [SerializeField] private float maxRecordingSeconds = 15f;
        [SerializeField] private float startupGracePeriod = 0.4f;

        private AudioClip micClip;
        private string micDevice;
        private bool isRecording;
        private float recordingStartTime;
        private float lastAboveThresholdTime;
        private bool hasDetectedSpeech;
        private float[] sampleBuffer = new float[1024];

        public bool IsRecording => isRecording;

        public event Action<byte[]> OnRecordingComplete;
        public event Action OnRecordingCancelled;
        public event Action<float> OnAmplitudeUpdate;

        private void Update()
        {
            if (!isRecording || micClip == null) return;

            int micPos = Microphone.GetPosition(micDevice);
            int sampleCount = Mathf.Min(sampleBuffer.Length, micClip.samples);
            micClip.GetData(sampleBuffer, Mathf.Max(0, micPos - sampleCount));

            float sum = 0f;
            for (int i = 0; i < sampleCount; i++)
            {
                sum += sampleBuffer[i] * sampleBuffer[i];
            }
            float rms = Mathf.Sqrt(sum / sampleCount);
            OnAmplitudeUpdate?.Invoke(rms);

            float elapsed = Time.time - recordingStartTime;

            if (elapsed < startupGracePeriod) return;

            if (rms > vadThreshold)
            {
                lastAboveThresholdTime = Time.time;
                hasDetectedSpeech = true;
            }
            else if (hasDetectedSpeech && (Time.time - lastAboveThresholdTime) > silenceTimeoutSeconds)
            {
                StopRecording();
                return;
            }

            if (elapsed > maxRecordingSeconds)
            {
                StopRecording();
            }
        }

        public void StartRecording()
        {
            if (isRecording) return;

            micDevice = Microphone.devices.Length > 0 ? Microphone.devices[0] : null;
            if (string.IsNullOrEmpty(micDevice))
            {
                Debug.LogError("[MicRecorder] No microphone devices found.");
                return;
            }

            micClip = Microphone.Start(micDevice, true, recordingLengthSeconds, sampleRate);
            isRecording = true;
            recordingStartTime = Time.time;
            lastAboveThresholdTime = Time.time;
            hasDetectedSpeech = false;

            Debug.Log($"[MicRecorder] Recording started on '{micDevice}' at {sampleRate}Hz");
        }

        public void StopRecording()
        {
            if (!isRecording) return;

            isRecording = false;

            int recordingPos = Microphone.GetPosition(micDevice);
            Microphone.End(micDevice);

            if (recordingPos < sampleRate * 0.3f)
            {
                Debug.Log("[MicRecorder] Recording too short, cancelling.");
                micClip = null;
                OnRecordingCancelled?.Invoke();
                return;
            }

            float[] samples = new float[recordingPos * micClip.channels];
            micClip.GetData(samples, 0);

            byte[] wavBytes = EncodeToWav(samples, micClip.channels, sampleRate);
            micClip = null;

            Debug.Log($"[MicRecorder] Recording complete: {recordingPos} samples, {wavBytes.Length} bytes");
            OnRecordingComplete?.Invoke(wavBytes);
        }

        public void CancelRecording()
        {
            if (!isRecording) return;

            isRecording = false;
            Microphone.End(micDevice);
            micClip = null;
            OnRecordingCancelled?.Invoke();
        }

        private static byte[] EncodeToWav(float[] samples, int channels, int sampleRate)
        {
            int sampleCount = samples.Length;
            int byteRate = sampleRate * channels * 2;
            int blockAlign = channels * 2;
            int dataSize = sampleCount * 2;
            int fileSize = 44 + dataSize;

            using var stream = new MemoryStream(fileSize);
            using var writer = new BinaryWriter(stream);

            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            writer.Write(fileSize - 8);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));

            writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
            writer.Write(16);
            writer.Write((short)1);
            writer.Write((short)channels);
            writer.Write(sampleRate);
            writer.Write(byteRate);
            writer.Write((short)blockAlign);
            writer.Write((short)16);

            writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            writer.Write(dataSize);

            for (int i = 0; i < sampleCount; i++)
            {
                float sample = Mathf.Clamp(samples[i], -1f, 1f);
                short pcm = (short)(sample * short.MaxValue);
                writer.Write(pcm);
            }

            return stream.ToArray();
        }
    }
}
