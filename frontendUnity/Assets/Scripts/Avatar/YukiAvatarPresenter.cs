using UnityEngine;

namespace Yuki.UnityFrontend.Avatar
{
    public sealed class YukiAvatarPresenter : MonoBehaviour
    {
        [SerializeField] private Transform speechBubbleAnchor;

        public Vector3 SpeechBubbleWorldPosition => speechBubbleAnchor != null
            ? speechBubbleAnchor.position
            : transform.position + Vector3.up * 1.6f;

        public void SetThinking(bool isThinking)
        {
            Debug.Log($"Yuki thinking: {isThinking}");
        }

        public void SetSpeechText(string text)
        {
            Debug.Log($"Yuki says: {text}");
        }
    }
}
