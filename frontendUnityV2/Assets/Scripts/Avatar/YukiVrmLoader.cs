using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UniGLTF;

namespace Yuki.UnityFrontend.Avatar
{
    public sealed class YukiVrmLoader : MonoBehaviour
    {
        [SerializeField] private string modelsSubFolder = "models";

        private string ModelsPath => Path.Combine(Application.streamingAssetsPath, modelsSubFolder);

        private UniVRM10.Vrm10Instance lastLoadedVrm10Instance;

        public UniVRM10.Vrm10Instance LastVrm10Instance => lastLoadedVrm10Instance;

        public event Action<GameObject> OnVrmLoaded;

        private void OnEnable()
        {
            YukiAvatarPresenter.OnLoadVrmRequest += HandleLoadVrmRequest;
        }

        private void OnDisable()
        {
            YukiAvatarPresenter.OnLoadVrmRequest -= HandleLoadVrmRequest;
        }

        private void HandleLoadVrmRequest(string fileName, Action<GameObject> callback)
        {
            _ = LoadVrmAsync(fileName, callback);
        }

        private async Task LoadVrmAsync(string fileName, Action<GameObject> callback)
        {
            try
            {
                string path = Path.Combine(ModelsPath, fileName);

                if (!File.Exists(path))
                {
                    Debug.LogError($"[VrmLoader] VRM file not found: {path}");
                    callback?.Invoke(null);
                    return;
                }

                byte[] bytes = await File.ReadAllBytesAsync(path);
                bool isVrm10 = IsVrm10(bytes);

                GameObject loaded;

                if (isVrm10)
                {
                    Debug.Log($"[VrmLoader] Loading VRM 1.0: {fileName}");
                    loaded = await LoadVrm10Async(bytes, fileName);
                }
                else
                {
                    Debug.Log($"[VrmLoader] Loading VRM 0.x: {fileName}");
                    loaded = await LoadVrm0Async(bytes, fileName);
                }

                if (loaded != null)
                {
                    OnVrmLoaded?.Invoke(loaded);
                }

                callback?.Invoke(loaded);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[VrmLoader] Failed to load VRM '{fileName}': {ex}");
                callback?.Invoke(null);
            }
        }

        private static bool IsVrm10(byte[] bytes)
        {
            string header = Encoding.UTF8.GetString(bytes, 0, Mathf.Min(bytes.Length, 512));
            return !header.Contains("\"VRM\"");
        }

        private async Task<GameObject> LoadVrm10Async(byte[] bytes, string fileName)
        {
            var instance = await UniVRM10.Vrm10.LoadBytesAsync(
                bytes,
                canLoadVrm0X: true,
                controlRigGenerationOption: UniVRM10.ControlRigGenerationOption.None,
                awaitCaller: new RuntimeOnlyAwaitCaller(),
                ct: default
            );

            if (instance == null)
            {
                Debug.LogError($"[VrmLoader] VRM 1.0 load returned null for: {fileName}");
                return null;
            }

            lastLoadedVrm10Instance = instance;

            if (instance.TryGetComponent<RuntimeGltfInstance>(out var gltfInstance))
            {
                gltfInstance.ShowMeshes();
            }
            return instance.gameObject;
        }

        private async Task<GameObject> LoadVrm0Async(byte[] bytes, string fileName)
        {
            lastLoadedVrm10Instance = null;

            var instance = await VRM.VrmUtility.LoadBytesAsync(fileName, bytes, new RuntimeOnlyAwaitCaller());
            return instance != null ? instance.Root : null;
        }
    }
}
