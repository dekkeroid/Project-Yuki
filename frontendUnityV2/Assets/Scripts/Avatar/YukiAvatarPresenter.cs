using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuki.UnityFrontend.Avatar
{
    public sealed class YukiAvatarPresenter : MonoBehaviour
    {
        [Serializable]
        public struct BlendShapeMapping
        {
            public string key; // e.g. "happy", "sad", "angry", "surprised", "mouth_o"
            public SkinnedMeshRenderer targetMesh;
            public int blendShapeIndex;
            public float maxWeight; // usually 100 in Unity
        }

        [Header("Bones & Eye Gaze")]
        [SerializeField] private Transform headBone;
        [SerializeField] private float maxLookAngle = 25f;
        [SerializeField] private float lookSpeed = 5f;
        [SerializeField] private bool enableLookAtCursor = true;

        [Header("Blendshapes & Lip-Sync")]
        [SerializeField] private List<BlendShapeMapping> expressionMappings = new();
        [SerializeField] private List<BlendShapeMapping> mouthMappings = new();
        [SerializeField] private float mouthOpenSensitivity = 1.5f;

        [Header("Speech Anchor")]
        [SerializeField] private Transform speechBubbleAnchor;

        private GameObject loadedVrmInstance;
        private string activeExpression = "neutral";
        private float targetMouthWeight = 0f;
        private float currentMouthWeight = 0f;
        private Quaternion initialHeadRotation;

        public delegate void LoadVrmDelegate(string fileName, Action<GameObject> callback);
        public static event LoadVrmDelegate OnLoadVrmRequest;

        public Vector3 SpeechBubbleWorldPosition => speechBubbleAnchor != null
            ? speechBubbleAnchor.position
            : transform.position + Vector3.up * 1.6f;

        private void Start()
        {
            if (headBone != null)
            {
                initialHeadRotation = headBone.localRotation;
            }
        }

        public void LoadVrm(string fileName)
        {
            Debug.Log($"[AvatarPresenter] Requesting load of VRM: {fileName}");
            
            OnLoadVrmRequest?.Invoke(fileName, (vrmInstance) =>
            {
                if (vrmInstance == null)
                {
                    Debug.LogWarning("[AvatarPresenter] Dynamic VRM load returned null instance.");
                    return;
                }

                if (loadedVrmInstance != null)
                {
                    Destroy(loadedVrmInstance);
                }

                loadedVrmInstance = vrmInstance;
                loadedVrmInstance.transform.SetParent(transform, false);
                loadedVrmInstance.transform.localPosition = Vector3.zero;
                loadedVrmInstance.transform.localRotation = Quaternion.identity;
                
                AutoBindVrmComponents(loadedVrmInstance);
            });
        }

        private void AutoBindVrmComponents(GameObject vrmRoot)
        {
            Animator animator = vrmRoot.GetComponentInChildren<Animator>();
            if (animator != null)
            {
                headBone = animator.GetBoneTransform(HumanBodyBones.Head);
                if (headBone != null)
                {
                    initialHeadRotation = headBone.localRotation;
                }
            }

            SkinnedMeshRenderer faceRenderer = null;
            foreach (var smr in vrmRoot.GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                if (smr.name.ToLower().Contains("face") || smr.name.ToLower().Contains("body"))
                {
                    faceRenderer = smr;
                    break;
                }
            }

            if (faceRenderer != null)
            {
                BindCommonBlendshapes(faceRenderer);
            }
        }

        private void BindCommonBlendshapes(SkinnedMeshRenderer smr)
        {
            expressionMappings.Clear();
            mouthMappings.Clear();

            for (int i = 0; i < smr.sharedMesh.blendShapeCount; i++)
            {
                string name = smr.sharedMesh.GetBlendShapeName(i).ToLower();
                
                if (name.EndsWith("_o") || name.Equals("a") || name.Equals("mouth_o") || name.Contains("mouth_open"))
                {
                    mouthMappings.Add(new BlendShapeMapping { key = "mouth_o", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
                
                if (name.Contains("happy") || name.Contains("joy") || name.Equals("fun"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = "happy", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
                else if (name.Contains("angry") || name.Contains("anger"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = "angry", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
                else if (name.Contains("sad") || name.Contains("sorrow"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = "sad", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
                else if (name.Contains("surprised") || name.Contains("gasp") || name.Equals("surprise"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = "surprised", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
            }
        }

        public void SetThinking(bool isThinking)
        {
            Debug.Log($"[AvatarPresenter] Yuki thinking status: {isThinking}");
        }

        public void SetListening(bool isListening)
        {
            Debug.Log($"[AvatarPresenter] Yuki listening status: {isListening}");
        }

        public void SetExpression(string expression)
        {
            activeExpression = expression.ToLower();
            
            foreach (var mapping in expressionMappings)
            {
                if (mapping.targetMesh != null)
                {
                    float weight = (mapping.key == activeExpression) ? mapping.maxWeight : 0f;
                    mapping.targetMesh.SetBlendShapeWeight(mapping.blendShapeIndex, weight);
                }
            }
        }

        public void SetAudioLevel(float level)
        {
            targetMouthWeight = Mathf.Clamp01(level * mouthOpenSensitivity);
        }

        private void Update()
        {
            currentMouthWeight = Mathf.MoveTowards(currentMouthWeight, targetMouthWeight, Time.deltaTime * 12f);
            
            foreach (var mapping in mouthMappings)
            {
                if (mapping.targetMesh != null)
                {
                    mapping.targetMesh.SetBlendShapeWeight(mapping.blendShapeIndex, currentMouthWeight * mapping.maxWeight);
                }
            }
        }

        private void LateUpdate()
        {
            if (enableLookAtCursor && headBone != null && Camera.main != null)
            {
                LookAtCursor();
            }
        }

        private void LookAtCursor()
        {
            Vector3 headPos = headBone.position;
            Vector3 mousePos = Input.mousePosition;
            mousePos.z = Vector3.Distance(Camera.main.transform.position, headPos);
            Vector3 targetWorldPos = Camera.main.ScreenToWorldPoint(mousePos);

            Vector3 localTargetDir = headBone.parent.InverseTransformPoint(targetWorldPos);
            
            if (localTargetDir.z <= 0.1f)
            {
                headBone.localRotation = Quaternion.Slerp(headBone.localRotation, initialHeadRotation, Time.deltaTime * lookSpeed);
                return;
            }

            Vector3 lookDirection = Vector3.RotateTowards(Vector3.forward, localTargetDir.normalized, maxLookAngle * Mathf.Deg2Rad, 0f);
            Quaternion targetRotation = Quaternion.LookRotation(lookDirection, Vector3.up);

            headBone.localRotation = Quaternion.Slerp(headBone.localRotation, targetRotation, Time.deltaTime * lookSpeed);
        }
    }
}
