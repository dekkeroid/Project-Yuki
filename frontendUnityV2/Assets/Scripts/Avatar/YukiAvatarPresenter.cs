using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Yuki.UnityFrontend.Avatar
{
    public sealed class YukiAvatarPresenter : MonoBehaviour
    {
        [Serializable]
        public struct BlendShapeMapping
        {
            public string key;
            public SkinnedMeshRenderer targetMesh;
            public int blendShapeIndex;
            public float maxWeight;
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

        [Header("Expression Smoothing")]
        [SerializeField] private float expressionTransitionSpeed = 8f;

        [Header("Idle Animation")]
        [SerializeField] private bool enableIdleAnimations = true;
        [SerializeField] private float blinkIntervalMin = 2f;
        [SerializeField] private float blinkIntervalMax = 6f;
        [SerializeField] private float blinkDuration = 0.12f;
        [SerializeField] private float breathAmount = 0.3f;
        [SerializeField] private float breathSpeed = 1.5f;
        [SerializeField] private float fidgetAmount = 1.5f;
        [SerializeField] private float fidgetSpeed = 0.5f;

        [Header("Speech Anchor")]
        [SerializeField] private Transform speechBubbleAnchor;

        private GameObject loadedVrmInstance;
        private VRM10.Vrm10Instance vrm10Instance;
        private string activeExpression = "neutral";
        private float targetMouthWeight = 0f;
        private float currentMouthWeight = 0f;
        private Quaternion initialHeadRotation;

        private Dictionary<string, float> expressionWeights = new();
        private Dictionary<string, float> targetExpressionWeights = new();

        private float blinkTimer;
        private float nextBlinkTime;
        private bool isBlinking;
        private float blinkWeight;
        private float breathTimer;
        private Vector3 initialBodyLocalPos;
        private float fidgetTimer;

        private Coroutine activeAnimationCoroutine;

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

            blinkTimer = 0f;
            nextBlinkTime = UnityEngine.Random.Range(blinkIntervalMin, blinkIntervalMax);
        }

        public void LoadVrm(string fileName)
        {
            Debug.Log($"[AvatarPresenter] Requesting load of VRM: {fileName}");

            if (activeAnimationCoroutine != null)
            {
                StopCoroutine(activeAnimationCoroutine);
                activeAnimationCoroutine = null;
            }

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

                vrm10Instance = loadedVrmInstance.GetComponent<VRM10.Vrm10Instance>();

                AutoBindVrmComponents(loadedVrmInstance);
                InitExpressionWeights();
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

            if (transform.childCount > 0)
            {
                Transform rootChild = transform.GetChild(0);
                initialBodyLocalPos = rootChild.localPosition;
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

            if (enableIdleAnimations)
            {
                ResetIdleTimers();
            }
        }

        private void BindCommonBlendshapes(SkinnedMeshRenderer smr)
        {
            expressionMappings.Clear();
            mouthMappings.Clear();

            for (int i = 0; i < smr.sharedMesh.blendShapeCount; i++)
            {
                string name = smr.sharedMesh.GetBlendShapeName(i).ToLower();

                if (name.Contains("aa") || name.Contains("oh") || name.Contains("ih") ||
                    name.Contains("ou") || name.Contains("ee") || name.Contains("mouth"))
                {
                    mouthMappings.Add(new BlendShapeMapping { key = "mouth", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }

                if (name.Contains("happy") || name.Contains("joy") || name.Equals("fun") || name.Contains("blink"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = name.Contains("blink") ? "blink" : "happy", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
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
                else if (name.Contains("relaxed") || name.Contains("relief"))
                {
                    expressionMappings.Add(new BlendShapeMapping { key = "relaxed", targetMesh = smr, blendShapeIndex = i, maxWeight = 100f });
                }
            }
        }

        private void InitExpressionWeights()
        {
            expressionWeights.Clear();
            targetExpressionWeights.Clear();

            string[] keys = { "neutral", "happy", "sad", "angry", "surprised", "relaxed", "blink", "aa", "ih", "ou", "ee", "oh" };
            foreach (string key in keys)
            {
                expressionWeights[key] = 0f;
                targetExpressionWeights[key] = 0f;
            }
            targetExpressionWeights["neutral"] = 1f;
            expressionWeights["neutral"] = 1f;
        }

        public void SetThinking(bool isThinking)
        {
            if (isThinking)
            {
                SetExpression("sad");
            }
        }

        public void SetListening(bool isListening)
        {
            if (isListening)
            {
                SetExpression("surprised");
            }
        }

        public void SetExpression(string expression)
        {
            activeExpression = expression.ToLower();

            if (vrm10Instance != null)
            {
                SetVrm10Expression(activeExpression);
            }

            foreach (string key in targetExpressionWeights.Keys)
            {
                targetExpressionWeights[key] = 0f;
            }

            if (targetExpressionWeights.ContainsKey(activeExpression))
            {
                targetExpressionWeights[activeExpression] = 1f;
            }
            else
            {
                targetExpressionWeights["neutral"] = 1f;
            }
        }

        private void SetVrm10Expression(string expression)
        {
            if (vrm10Instance?.Runtime?.Expression == null) return;

            var expr = vrm10Instance.Runtime.Expression;

            expr.SetWeight(VRM10.ExpressionKey.Happy, 0f);
            expr.SetWeight(VRM10.ExpressionKey.Angry, 0f);
            expr.SetWeight(VRM10.ExpressionKey.Sad, 0f);
            expr.SetWeight(VRM10.ExpressionKey.Relaxed, 0f);
            expr.SetWeight(VRM10.ExpressionKey.Surprised, 0f);

            switch (expression)
            {
                case "happy":
                    expr.SetWeight(VRM10.ExpressionKey.Happy, 1f);
                    break;
                case "angry":
                    expr.SetWeight(VRM10.ExpressionKey.Angry, 1f);
                    break;
                case "sad":
                    expr.SetWeight(VRM10.ExpressionKey.Sad, 1f);
                    break;
                case "relaxed":
                    expr.SetWeight(VRM10.ExpressionKey.Relaxed, 1f);
                    break;
                case "surprised":
                    expr.SetWeight(VRM10.ExpressionKey.Surprised, 1f);
                    break;
            }
        }

        public void SetAudioLevel(float level)
        {
            targetMouthWeight = Mathf.Clamp01(level * mouthOpenSensitivity);

            if (vrm10Instance?.Runtime?.Expression != null)
            {
                vrm10Instance.Runtime.Expression.SetWeight(VRM10.ExpressionKey.Aa, targetMouthWeight);
            }
        }

        public void TriggerAnimation(string animationName)
        {
            if (activeAnimationCoroutine != null)
            {
                StopCoroutine(activeAnimationCoroutine);
            }
            activeAnimationCoroutine = StartCoroutine(PlayNamedAnimation(animationName));
        }

        private IEnumerator PlayNamedAnimation(string name)
        {
            Debug.Log($"[AvatarPresenter] Playing animation: {name}");

            switch (name)
            {
                case "wave":
                    yield return PlayWaveAnimation();
                    break;
                case "laugh":
                    yield return PlayLaughAnimation();
                    break;
                case "nap":
                    yield return PlayNapAnimation();
                    break;
                case "groove":
                    yield return PlayGrooveAnimation();
                    break;
                case "pout":
                    yield return PlayPoutAnimation();
                    break;
                case "yawn":
                    yield return PlayYawnAnimation();
                    break;
                case "shrug":
                    yield return PlayShrugAnimation();
                    break;
                case "knock":
                    yield return PlayKnockAnimation();
                    break;
            }

            activeAnimationCoroutine = null;
            SetExpression("neutral");
        }

        private IEnumerator PlayWaveAnimation()
        {
            SetExpression("happy");
            float elapsed = 0f;
            float duration = 2f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float wave = Mathf.Sin(elapsed * 4f) * 15f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(0f, 0f, wave);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayLaughAnimation()
        {
            SetExpression("happy");
            float elapsed = 0f;
            float duration = 2.5f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float nod = Mathf.Sin(elapsed * 6f) * 8f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(nod, 0f, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayNapAnimation()
        {
            SetExpression("relaxed");
            float elapsed = 0f;
            float duration = 4f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float droop = Mathf.Sin(elapsed * 0.5f) * 12f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(droop, 0f, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayGrooveAnimation()
        {
            SetExpression("happy");
            float elapsed = 0f;
            float duration = 3f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float sway = Mathf.Sin(elapsed * 3f) * 10f;
                    float bob = Mathf.Abs(Mathf.Sin(elapsed * 3f)) * 3f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(-bob, sway, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayPoutAnimation()
        {
            SetExpression("angry");
            float elapsed = 0f;
            float duration = 2f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float turn = Mathf.Sin(elapsed * 2f) * 15f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(5f, turn, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayYawnAnimation()
        {
            SetExpression("surprised");
            float elapsed = 0f;
            float duration = 3f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float tilt = Mathf.Sin(elapsed * 1.5f) * 10f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(-tilt, 0f, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayShrugAnimation()
        {
            SetExpression("surprised");
            float elapsed = 0f;
            float duration = 1.5f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float shrug = Mathf.Sin(elapsed * 4f) * 5f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(-shrug, 0f, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private IEnumerator PlayKnockAnimation()
        {
            SetExpression("neutral");
            float elapsed = 0f;
            float duration = 1f;

            while (elapsed < duration)
            {
                if (headBone != null)
                {
                    float knock = Mathf.Sin(elapsed * 12f) * 8f;
                    headBone.localRotation = initialHeadRotation * Quaternion.Euler(0f, knock, 0f);
                }
                elapsed += Time.deltaTime;
                yield return null;
            }

            if (headBone != null) headBone.localRotation = initialHeadRotation;
        }

        private void Update()
        {
            UpdateMouthSync();
            UpdateExpressionSmoothing();
            UpdateBlendShapes();

            if (enableIdleAnimations)
            {
                UpdateIdleAnimations();
            }
        }

        private void UpdateMouthSync()
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

        private void UpdateExpressionSmoothing()
        {
            foreach (string key in new List<string>(expressionWeights.Keys))
            {
                float target = targetExpressionWeights.ContainsKey(key) ? targetExpressionWeights[key] : 0f;
                expressionWeights[key] = Mathf.MoveTowards(expressionWeights[key], target, Time.deltaTime * expressionTransitionSpeed);
            }
        }

        private void UpdateBlendShapes()
        {
            foreach (var mapping in expressionMappings)
            {
                if (mapping.targetMesh == null) continue;

                float weight = 0f;
                if (expressionWeights.ContainsKey(mapping.key))
                {
                    weight = expressionWeights[mapping.key];
                }

                mapping.targetMesh.SetBlendShapeWeight(mapping.blendShapeIndex, weight * mapping.maxWeight);
            }
        }

        private void UpdateIdleAnimations()
        {
            UpdateBlinking();
            UpdateBreathing();
            UpdateFidgets();
        }

        private void UpdateBlinking()
        {
            if (isBlinking)
            {
                blinkTimer += Time.deltaTime;
                float halfDuration = blinkDuration / 2f;

                if (blinkTimer < halfDuration)
                {
                    blinkWeight = Mathf.Lerp(0f, 1f, blinkTimer / halfDuration);
                }
                else if (blinkTimer < blinkDuration)
                {
                    blinkWeight = Mathf.Lerp(1f, 0f, (blinkTimer - halfDuration) / halfDuration);
                }
                else
                {
                    blinkWeight = 0f;
                    isBlinking = false;
                    blinkTimer = 0f;
                    nextBlinkTime = UnityEngine.Random.Range(blinkIntervalMin, blinkIntervalMax);
                }

                if (vrm10Instance?.Runtime?.Expression != null)
                {
                    vrm10Instance.Runtime.Expression.SetWeight(VRM10.ExpressionKey.Blink, blinkWeight);
                }

                foreach (var mapping in expressionMappings)
                {
                    if (mapping.key == "blink")
                    {
                        mapping.targetMesh.SetBlendShapeWeight(mapping.blendShapeIndex, blinkWeight * mapping.maxWeight);
                    }
                }
            }
            else
            {
                blinkTimer += Time.deltaTime;
                if (blinkTimer >= nextBlinkTime)
                {
                    isBlinking = true;
                    blinkTimer = 0f;
                }
            }
        }

        private void UpdateBreathing()
        {
            if (loadedVrmInstance == null) return;

            breathTimer += Time.deltaTime * breathSpeed;
            float breathOffset = Mathf.Sin(breathTimer) * breathAmount;

            Transform bodyRoot = transform.childCount > 0 ? transform.GetChild(0) : null;
            if (bodyRoot != null)
            {
                Vector3 pos = initialBodyLocalPos;
                pos.y += breathOffset * 0.01f;
                bodyRoot.localPosition = pos;
            }
        }

        private void UpdateFidgets()
        {
            if (headBone == null) return;

            fidgetTimer += Time.deltaTime * fidgetSpeed;
            float fidgetX = Mathf.Sin(fidgetTimer * 1.3f) * fidgetAmount;
            float fidgetY = Mathf.Cos(fidgetTimer * 0.7f) * fidgetAmount * 0.5f;

            headBone.localRotation = initialHeadRotation * Quaternion.Euler(fidgetX, fidgetY, 0f);
        }

        private void ResetIdleTimers()
        {
            blinkTimer = 0f;
            nextBlinkTime = UnityEngine.Random.Range(blinkIntervalMin, blinkIntervalMax);
            isBlinking = false;
            blinkWeight = 0f;
            breathTimer = 0f;
            fidgetTimer = 0f;
        }

        private void LateUpdate()
        {
            if (enableLookAtCursor && headBone != null && Camera.main != null && activeAnimationCoroutine == null)
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
