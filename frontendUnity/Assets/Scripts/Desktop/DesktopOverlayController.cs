using UnityEngine;

namespace Yuki.UnityFrontend.Desktop
{
    public sealed class DesktopOverlayController : MonoBehaviour
    {
        [SerializeField] private bool transparentWindowRequested = true;
        [SerializeField] private bool clickThroughWhenIdle = true;

        public bool TransparentWindowRequested => transparentWindowRequested;
        public bool ClickThroughWhenIdle => clickThroughWhenIdle;

        public void SetInteractive(bool interactive)
        {
            Debug.Log($"Yuki Unity desktop interactivity: {interactive}");
        }
    }
}
