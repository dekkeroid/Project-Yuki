using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuki.UnityFrontend.Backend
{
    [RequireComponent(typeof(AudioSource))]
    public sealed class YukiAudioPlaybackManager : MonoBehaviour
    {
        private struct SpeechClip
        {
            public AudioClip Clip;
            public string Text;
        }

        private AudioSource audioSource;
        private readonly Queue<SpeechClip> playbackQueue = new();
        private float[] sampleBuffer = new float[256];
        
        private bool wasPlaying = false;
        private bool isSimulatingMute = false;
        private bool isMuted = false;
        private string currentPlayingText = string.Empty;

        public event Action<string> OnSpeechStarted;
        public event Action<string> OnSpeechEnded;

        public float CurrentAmplitude { get; private set; }
        public bool IsMuted => isMuted;
        public float Volume => audioSource != null ? audioSource.volume : 1f;
        public bool IsPlayingSpeech => (audioSource != null && audioSource.isPlaying) || isSimulatingMute;

        private void Awake()
        {
            audioSource = GetComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.loop = false;
        }

        private void Update()
        {
            if (audioSource != null && audioSource.isPlaying)
            {
                audioSource.GetOutputData(sampleBuffer, 0);
                float sum = 0f;
                for (int i = 0; i < sampleBuffer.Length; i++)
                {
                    sum += sampleBuffer[i] * sampleBuffer[i];
                }
                float rms = Mathf.Sqrt(sum / sampleBuffer.Length);
                CurrentAmplitude = Mathf.Clamp01(rms * 2.0f);
            }
            else
            {
                CurrentAmplitude = 0f;
            }

            ProcessQueue();
        }

        private void ProcessQueue()
        {
            if (audioSource == null) return;

            if (wasPlaying && !audioSource.isPlaying && !isSimulatingMute)
            {
                wasPlaying = false;
                OnSpeechEnded?.Invoke(currentPlayingText);
                currentPlayingText = string.Empty;
            }

            if (audioSource.isPlaying)
            {
                wasPlaying = true;
                return;
            }

            if (isSimulatingMute) return;

            if (playbackQueue.Count > 0)
            {
                var next = playbackQueue.Dequeue();
                if (next.Clip != null)
                {
                    currentPlayingText = next.Text;
                    OnSpeechStarted?.Invoke(next.Text);

                    if (!isMuted)
                    {
                        audioSource.clip = next.Clip;
                        audioSource.Play();
                        wasPlaying = true;
                    }
                    else
                    {
                        StartCoroutine(SimulateMutedPlayback(next.Clip.length, next.Text));
                    }
                }
            }
        }

        private System.Collections.IEnumerator SimulateMutedPlayback(float duration, string text)
        {
            isSimulatingMute = true;
            yield return new WaitForSeconds(duration);
            isSimulatingMute = false;
            OnSpeechEnded?.Invoke(text);
            currentPlayingText = string.Empty;
        }

        public void QueueAudio(AudioClip clip, string text)
        {
            if (clip == null) return;
            playbackQueue.Enqueue(new SpeechClip { Clip = clip, Text = text });
        }

        public void StopAndClear()
        {
            StopAllCoroutines();
            isSimulatingMute = false;
            if (audioSource != null)
            {
                audioSource.Stop();
                audioSource.clip = null;
            }
            playbackQueue.Clear();
            wasPlaying = false;
            currentPlayingText = string.Empty;
            CurrentAmplitude = 0f;
            OnSpeechEnded?.Invoke(string.Empty);
        }

        public void SetMuted(bool muted)
        {
            isMuted = muted;
            if (audioSource != null)
            {
                audioSource.mute = muted;
            }

            if (muted && audioSource != null && audioSource.isPlaying)
            {
                float remainingTime = audioSource.clip.length - audioSource.time;
                audioSource.Stop();
                wasPlaying = false;
                StartCoroutine(SimulateMutedPlayback(remainingTime, currentPlayingText));
            }
        }

        public void SetVolume(float volume)
        {
            if (audioSource != null)
            {
                audioSource.volume = Mathf.Clamp01(volume);
            }
        }
    }
}
