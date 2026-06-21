using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.UI;
using TMPro;
using Yuki.UnityFrontend.Backend;
using Yuki.UnityFrontend.Avatar;
using Yuki.UnityFrontend.Desktop;
using Yuki.UnityFrontend.UI;
using Yuki.UnityFrontend.Chat;

namespace Yuki.UnityFrontend.Editor
{
    public static class YukiSceneSetup
    {
        private static readonly Color BgColor = new Color(0.07f, 0.05f, 0.13f, 0.75f);      // Dark translucent purple
        private static readonly Color AccentPurple = new Color(0.75f, 0.52f, 0.99f, 1f);   // #c084fc
        private static readonly Color AccentTeal = new Color(0.18f, 0.83f, 0.75f, 1f);     // #2dd4bf
        private static readonly Color TextMuted = new Color(0.58f, 0.64f, 0.72f, 1f);      // #94a3b8

        private static Sprite GetCircleSprite()
        {
            string path = "Assets/Resources/Textures/UI_Circle.png";
            if (!System.IO.Directory.Exists("Assets/Resources/Textures"))
            {
                System.IO.Directory.CreateDirectory("Assets/Resources/Textures");
            }
            bool fileExists = System.IO.File.Exists(path);
            if (!fileExists)
            {
                Texture2D tex = new Texture2D(64, 64, TextureFormat.RGBA32, false);
                for (int y = 0; y < 64; y++)
                {
                    for (int x = 0; x < 64; x++)
                    {
                        float dx = x - 31.5f;
                        float dy = y - 31.5f;
                        if (Mathf.Sqrt(dx * dx + dy * dy) <= 31.5f)
                            tex.SetPixel(x, y, Color.white);
                        else
                            tex.SetPixel(x, y, Color.clear);
                    }
                }
                tex.Apply();
                byte[] bytes = tex.EncodeToPNG();
                System.IO.File.WriteAllBytes(path, bytes);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            }

            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer != null && importer.textureType != TextureImporterType.Sprite)
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.SaveAndReimport();
                AssetDatabase.Refresh();
            }

            Sprite s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (s == null && fileExists)
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
                s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            }
            return s;
        }

        private static Sprite GetRoundedRectSprite(int radius, int borderThickness, Color fillColor, Color borderColor)
        {
            string fillHex = ColorUtility.ToHtmlStringRGBA(fillColor);
            string borderHex = ColorUtility.ToHtmlStringRGBA(borderColor);
            string path = $"Assets/Resources/Textures/UI_RoundedRect_{radius}_{borderThickness}_{fillHex}_{borderHex}.png";
            if (!System.IO.Directory.Exists("Assets/Resources/Textures"))
            {
                System.IO.Directory.CreateDirectory("Assets/Resources/Textures");
            }
            bool fileExists = System.IO.File.Exists(path);
            if (!fileExists)
            {
                int size = radius * 4;
                Texture2D tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
                for (int y = 0; y < size; y++)
                {
                    for (int x = 0; x < size; x++)
                    {
                        bool inCorner = false;
                        float cx = 0, cy = 0;
                        if (x < radius && y < radius) { inCorner = true; cx = radius - 0.5f; cy = radius - 0.5f; }
                        else if (x >= size - radius && y < radius) { inCorner = true; cx = size - radius - 0.5f; cy = radius - 0.5f; }
                        else if (x < radius && y >= size - radius) { inCorner = true; cx = radius - 0.5f; cy = size - radius - 0.5f; }
                        else if (x >= size - radius && y >= size - radius) { inCorner = true; cx = size - radius - 0.5f; cy = size - radius - 0.5f; }

                        float dist = 0f;
                        if (inCorner)
                        {
                            dist = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                        }

                        bool isFilled = false;
                        bool isBorder = false;

                        if (inCorner)
                        {
                            if (dist <= radius)
                            {
                                isFilled = true;
                                if (dist >= radius - borderThickness)
                                {
                                    isBorder = true;
                                }
                            }
                        }
                        else
                        {
                            isFilled = true;
                            if (x < borderThickness || x >= size - borderThickness || y < borderThickness || y >= size - borderThickness)
                            {
                                isBorder = true;
                            }
                        }

                        if (isBorder)
                        {
                            tex.SetPixel(x, y, borderColor);
                        }
                        else if (isFilled)
                        {
                            tex.SetPixel(x, y, fillColor);
                        }
                        else
                        {
                            tex.SetPixel(x, y, Color.clear);
                        }
                    }
                }
                tex.Apply();
                byte[] bytes = tex.EncodeToPNG();
                System.IO.File.WriteAllBytes(path, bytes);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            }

            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer != null && (importer.textureType != TextureImporterType.Sprite || importer.spriteBorder != new Vector4(radius, radius, radius, radius)))
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteBorder = new Vector4(radius, radius, radius, radius);
                importer.SaveAndReimport();
                AssetDatabase.Refresh();
            }

            Sprite s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (s == null && fileExists)
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            }
            return s;
        }

        private static void DrawLine(Texture2D tex, int x0, int y0, int x1, int y1, Color col, int thickness)
        {
            int dx = Mathf.Abs(x1 - x0);
            int dy = Mathf.Abs(y1 - y0);
            int sx = x0 < x1 ? 1 : -1;
            int sy = y0 < y1 ? 1 : -1;
            int err = dx - dy;

            while (true)
            {
                int radius = thickness / 2;
                for (int ty = -radius; ty <= radius; ty++)
                {
                    for (int tx = -radius; tx <= radius; tx++)
                    {
                        if (tx * tx + ty * ty <= radius * radius)
                        {
                            int px = x0 + tx;
                            int py = y0 + ty;
                            if (px >= 0 && px < tex.width && py >= 0 && py < tex.height)
                            {
                                tex.SetPixel(px, py, col);
                            }
                        }
                    }
                }

                if (x0 == x1 && y0 == y1) break;
                int e2 = 2 * err;
                if (e2 > -dy)
                {
                    err -= dy;
                    x0 += sx;
                }
                if (e2 < dx)
                {
                    err += dx;
                    y0 += sy;
                }
            }
        }

        private static Sprite GetIconSprite(string type)
        {
            string path = $"Assets/Resources/Textures/UI_Icon_{type}.png";
            if (!System.IO.Directory.Exists("Assets/Resources/Textures"))
            {
                System.IO.Directory.CreateDirectory("Assets/Resources/Textures");
            }
            bool fileExists = System.IO.File.Exists(path);
            if (!fileExists)
            {
                Texture2D tex = new Texture2D(64, 64, TextureFormat.RGBA32, false);
                for (int y = 0; y < 64; y++)
                    for (int x = 0; x < 64; x++)
                        tex.SetPixel(x, y, Color.clear);

                Color col = Color.white;

                if (type == "chat")
                {
                    // Rounded rect box outline
                    for (int y = 22; y <= 44; y++)
                    {
                        for (int x = 16; x <= 48; x++)
                        {
                            bool isBorder = (x >= 16 && x <= 18) || (x >= 46 && x <= 48) ||
                                            (y >= 22 && y <= 24) || (y >= 42 && y <= 44);
                            if (isBorder) tex.SetPixel(x, y, col);
                        }
                    }
                    // Tail
                    DrawLine(tex, 24, 22, 18, 14, col, 3);
                    DrawLine(tex, 18, 14, 30, 22, col, 3);
                }
                else if (type == "settings")
                {
                    // Center ring
                    for (int y = 0; y < 64; y++)
                    {
                        for (int x = 0; x < 64; x++)
                        {
                            float dx = x - 31.5f;
                            float dy = y - 31.5f;
                            float dist = Mathf.Sqrt(dx * dx + dy * dy);
                            if (dist >= 7f && dist <= 11f)
                            {
                                tex.SetPixel(x, y, col);
                            }
                        }
                    }
                    // 8 spokes
                    for (int i = 0; i < 8; i++)
                    {
                        float angle = i * Mathf.PI / 4f;
                        int x0 = Mathf.RoundToInt(31.5f + Mathf.Cos(angle) * 10f);
                        int y0 = Mathf.RoundToInt(31.5f + Mathf.Sin(angle) * 10f);
                        int x1 = Mathf.RoundToInt(31.5f + Mathf.Cos(angle) * 16f);
                        int y1 = Mathf.RoundToInt(31.5f + Mathf.Sin(angle) * 16f);
                        DrawLine(tex, x0, y0, x1, y1, col, 3);
                    }
                }
                else if (type == "alwaysontop")
                {
                    // Eye outline
                    for (int x = 14; x <= 50; x++)
                    {
                        float t = (x - 14f) / 36f;
                        float h = Mathf.Sin(t * Mathf.PI) * 9f;
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f + h), col);
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f + h - 1), col);
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f - h), col);
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f - h + 1), col);
                    }
                    // Pupil
                    for (int y = 27; y <= 37; y++)
                        for (int x = 27; x <= 37; x++)
                            if ((x - 31.5f) * (x - 31.5f) + (y - 31.5f) * (y - 31.5f) <= 16f)
                                tex.SetPixel(x, y, col);
                }
                else if (type == "alwaysontop_off")
                {
                    // Draw eye
                    for (int x = 14; x <= 50; x++)
                    {
                        float t = (x - 14f) / 36f;
                        float h = Mathf.Sin(t * Mathf.PI) * 9f;
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f + h), col);
                        tex.SetPixel(x, Mathf.RoundToInt(31.5f - h), col);
                    }
                    for (int y = 28; y <= 36; y++)
                        for (int x = 28; x <= 36; x++)
                            if ((x - 31.5f) * (x - 31.5f) + (y - 31.5f) * (y - 31.5f) <= 9f)
                                tex.SetPixel(x, y, col);
                    // Diagonal slash
                    DrawLine(tex, 16, 16, 48, 48, col, 3);
                }
                else if (type == "mic_on")
                {
                    // Capsule mic
                    for (int y = 26; y <= 44; y++)
                    {
                        for (int x = 26; x <= 38; x++)
                        {
                            float dx = x - 32f;
                            float dy = 0f;
                            if (y > 40) dy = y - 40;
                            else if (y < 30) dy = y - 30;

                            if (dx * dx + dy * dy <= 36f) tex.SetPixel(x, y, col);
                        }
                    }
                    // Stand base stem
                    DrawLine(tex, 32, 12, 32, 22, col, 3);
                    DrawLine(tex, 24, 12, 40, 12, col, 3);
                    // U-Stand
                    for (int x = 20; x <= 44; x++)
                    {
                        float t = (x - 20f) / 24f;
                        float h = (1f - Mathf.Sin(t * Mathf.PI)) * 12f + 22f;
                        tex.SetPixel(x, Mathf.RoundToInt(h), col);
                        tex.SetPixel(x, Mathf.RoundToInt(h) + 1, col);
                    }
                }
                else if (type == "mic_off")
                {
                    // Capsule mic outline
                    for (int y = 28; y <= 42; y++)
                    {
                        for (int x = 26; x <= 38; x++)
                        {
                            float dx = x - 32f;
                            if (dx * dx <= 36f && (x == 26 || x == 38 || y == 28 || y == 42))
                                tex.SetPixel(x, y, col);
                        }
                    }
                    // Stand
                    DrawLine(tex, 32, 12, 32, 22, col, 3);
                    DrawLine(tex, 24, 12, 40, 12, col, 3);
                    // Slash
                    DrawLine(tex, 16, 16, 48, 48, col, 3);
                }
                else if (type == "terminate")
                {
                    // Stop solid square
                    for (int y = 22; y <= 42; y++)
                        for (int x = 22; x <= 42; x++)
                            tex.SetPixel(x, y, col);
                }
                else if (type == "volume_on")
                {
                    // Speaker body
                    for (int y = 24; y <= 40; y++)
                        for (int x = 16; x <= 26; x++)
                            tex.SetPixel(x, y, col);
                    for (int x = 26; x <= 36; x++)
                    {
                        float t = (x - 26f) / 10f;
                        int yOffset = Mathf.RoundToInt(t * 8f);
                        for (int y = 24 - yOffset; y <= 40 + yOffset; y++)
                            tex.SetPixel(x, y, col);
                    }
                    // Sound waves
                    for (float a = -Mathf.PI / 3f; a <= Mathf.PI / 3f; a += 0.05f)
                    {
                        int wx = Mathf.RoundToInt(34f + Mathf.Cos(a) * 8f);
                        int wy = Mathf.RoundToInt(31.5f + Mathf.Sin(a) * 8f);
                        if (wx >= 0 && wx < 64 && wy >= 0 && wy < 64) tex.SetPixel(wx, wy, col);
                    }
                    for (float a = -Mathf.PI / 3f; a <= Mathf.PI / 3f; a += 0.05f)
                    {
                        int wx = Mathf.RoundToInt(34f + Mathf.Cos(a) * 14f);
                        int wy = Mathf.RoundToInt(31.5f + Mathf.Sin(a) * 14f);
                        if (wx >= 0 && wx < 64 && wy >= 0 && wy < 64) tex.SetPixel(wx, wy, col);
                    }
                }
                else if (type == "volume_off")
                {
                    // Speaker body
                    for (int y = 24; y <= 40; y++)
                        for (int x = 16; x <= 26; x++)
                            tex.SetPixel(x, y, col);
                    for (int x = 26; x <= 36; x++)
                    {
                        float t = (x - 26f) / 10f;
                        int yOffset = Mathf.RoundToInt(t * 8f);
                        for (int y = 24 - yOffset; y <= 40 + yOffset; y++)
                            tex.SetPixel(x, y, col);
                    }
                    // Slash
                    DrawLine(tex, 36, 24, 46, 38, col, 3);
                    DrawLine(tex, 36, 38, 46, 24, col, 3);
                }
                else if (type == "close")
                {
                    DrawLine(tex, 18, 18, 46, 46, col, 4);
                    DrawLine(tex, 18, 46, 46, 18, col, 4);
                }

                tex.Apply();
                byte[] bytes = tex.EncodeToPNG();
                System.IO.File.WriteAllBytes(path, bytes);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            }

            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer != null && importer.textureType != TextureImporterType.Sprite)
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.SaveAndReimport();
                AssetDatabase.Refresh();
            }

            Sprite s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (s == null && fileExists)
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
                s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            }
            return s;
        }

        private static GameObject CreateCircularButton(string name, Transform parent, Sprite circleSprite, Sprite iconSprite, Color iconColor)
        {
            var btnGo = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            btnGo.transform.SetParent(parent, false);

            var img = btnGo.GetComponent<Image>();
            img.sprite = circleSprite;
            img.color = BgColor;
            img.type = Image.Type.Simple;

            var rect = btnGo.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(40f, 40f);

            if (iconSprite != null)
            {
                var iconGo = new GameObject("Icon", typeof(RectTransform), typeof(Image));
                iconGo.transform.SetParent(btnGo.transform, false);

                var iconImg = iconGo.GetComponent<Image>();
                iconImg.sprite = iconSprite;
                iconImg.color = iconColor;
                iconImg.type = Image.Type.Simple;

                var iconRect = iconGo.GetComponent<RectTransform>();
                iconRect.anchorMin = new Vector2(0.5f, 0.5f);
                iconRect.anchorMax = new Vector2(0.5f, 0.5f);
                iconRect.pivot = new Vector2(0.5f, 0.5f);
                iconRect.anchoredPosition = Vector2.zero;
                iconRect.sizeDelta = new Vector2(20f, 20f);
            }

            return btnGo;
        }

        [MenuItem("Yuki/Setup Scene")]
        public static void Setup()
        {
            var activeScene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var mainCamera = Camera.main;
            if (mainCamera != null)
            {
                mainCamera.transform.position = new Vector3(0f, 1.15f, 1.3f);
                mainCamera.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
            }

            // Generate circular sprite and 9-sliced panels
            Sprite circleSprite = GetCircleSprite();
            Sprite bubbleSprite = GetRoundedRectSprite(16, 2, new Color(0.07f, 0.05f, 0.13f, 0.94f), AccentPurple);
            Sprite darkGlassSprite = GetRoundedRectSprite(16, 2, new Color(0.05f, 0.03f, 0.10f, 0.85f), new Color(1f, 1f, 1f, 0.08f));
            Sprite modalSprite = GetRoundedRectSprite(16, 2, new Color(0.07f, 0.05f, 0.13f, 0.95f), new Color(1f, 1f, 1f, 0.08f));

            // Generate vector icons
            Sprite chatIcon = GetIconSprite("chat");
            Sprite settingsIcon = GetIconSprite("settings");
            Sprite eyeOnIcon = GetIconSprite("alwaysontop");
            Sprite eyeOffIcon = GetIconSprite("alwaysontop_off");
            Sprite micOnIcon = GetIconSprite("mic_on");
            Sprite micOffIcon = GetIconSprite("mic_off");
            Sprite terminateIcon = GetIconSprite("terminate");
            Sprite volumeOnIcon = GetIconSprite("volume_on");
            Sprite volumeOffIcon = GetIconSprite("volume_off");
            Sprite closeIcon = GetIconSprite("close");

            // 2. Find or create YukiManagers
            var managersGo = new GameObject("YukiManagers");
            var restClient = managersGo.AddComponent<YukiRestClient>();
            var wsClient = managersGo.AddComponent<YukiWebSocketClient>();
            var sttClient = managersGo.AddComponent<YukiSttClient>();
            var audioManager = managersGo.AddComponent<YukiAudioPlaybackManager>();
            var micRecorder = managersGo.AddComponent<YukiMicRecorder>();
            var overlayController = managersGo.AddComponent<DesktopOverlayController>();
            var trayController = managersGo.AddComponent<YukiSystemTrayController>();

            var serializedTray = new SerializedObject(trayController);
            serializedTray.FindProperty("overlayController").objectReferenceValue = overlayController;
            serializedTray.ApplyModifiedProperties();

            // 3. Find or create YukiAvatar
            var avatarGo = new GameObject("YukiAvatar");
            var vrmLoader = avatarGo.AddComponent<YukiVrmLoader>();
            var avatarPresenter = avatarGo.AddComponent<YukiAvatarPresenter>();

            // 4. Find or create YukiUI Canvas
            var canvasGo = new GameObject("YukiUI_Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);

            var eventSystemGo = new GameObject("EventSystem", typeof(UnityEngine.EventSystems.EventSystem), typeof(UnityEngine.EventSystems.StandaloneInputModule));

            var chatController = canvasGo.AddComponent<YukiChatController>();
            var talkModeController = canvasGo.AddComponent<YukiTalkModeController>();
            var slashCommandHandler = canvasGo.AddComponent<YukiSlashCommandHandler>();
            var uiController = canvasGo.AddComponent<YukiUIController>();

            // 5. Setup config file
            YukiBackendConfig configAsset = null;
            var configGuids = AssetDatabase.FindAssets("t:YukiBackendConfig");
            if (configGuids.Length > 0)
            {
                var path = AssetDatabase.GUIDToAssetPath(configGuids[0]);
                configAsset = AssetDatabase.LoadAssetAtPath<YukiBackendConfig>(path);
            }
            else
            {
                configAsset = ScriptableObject.CreateInstance<YukiBackendConfig>();
                AssetDatabase.CreateAsset(configAsset, "Assets/YukiBackendConfig.asset");
                AssetDatabase.SaveAssets();
                Debug.Log("Created new YukiBackendConfig at Assets/YukiBackendConfig.asset");
            }

            if (configAsset != null)
            {
                var serRest = new SerializedObject(restClient);
                serRest.FindProperty("config").objectReferenceValue = configAsset;
                serRest.ApplyModifiedProperties();

                var serWsObject = new SerializedObject(wsClient);
                serWsObject.FindProperty("config").objectReferenceValue = configAsset;
                serWsObject.ApplyModifiedProperties();

                var serStt = new SerializedObject(sttClient);
                serStt.FindProperty("config").objectReferenceValue = configAsset;
                serStt.ApplyModifiedProperties();
            }

            // 6. Connect YukiUIController references
            var serUI = new SerializedObject(uiController);
            serUI.FindProperty("webSocketClient").objectReferenceValue = wsClient;
            serUI.FindProperty("restClient").objectReferenceValue = restClient;
            serUI.FindProperty("audioManager").objectReferenceValue = audioManager;
            serUI.FindProperty("avatarPresenter").objectReferenceValue = avatarPresenter;
            serUI.FindProperty("chatController").objectReferenceValue = chatController;
            serUI.FindProperty("slashCommandHandler").objectReferenceValue = slashCommandHandler;
            serUI.FindProperty("talkModeController").objectReferenceValue = talkModeController;
            serUI.FindProperty("desktopOverlay").objectReferenceValue = overlayController;

            // Bind icon toggles
            serUI.FindProperty("eyeOnSprite").objectReferenceValue = eyeOnIcon;
            serUI.FindProperty("eyeOffSprite").objectReferenceValue = eyeOffIcon;
            serUI.FindProperty("volumeOnSprite").objectReferenceValue = volumeOnIcon;
            serUI.FindProperty("volumeOffSprite").objectReferenceValue = volumeOffIcon;
            serUI.FindProperty("micOnSprite").objectReferenceValue = micOnIcon;
            serUI.FindProperty("micOffSprite").objectReferenceValue = micOffIcon;

            // Floating Vertical Menu
            var floatingMenuGo = new GameObject("FloatingVerticalMenu", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup));
            floatingMenuGo.transform.SetParent(canvasGo.transform, false);
            var menuRect = floatingMenuGo.GetComponent<RectTransform>();
            menuRect.anchorMin = new Vector2(0.5f, 0.5f);
            menuRect.anchorMax = new Vector2(0.5f, 0.5f);
            menuRect.pivot = new Vector2(0.5f, 0.5f);
            menuRect.anchoredPosition = new Vector2(140f, 20f);
            menuRect.sizeDelta = new Vector2(50f, 380f);

            var menuImg = floatingMenuGo.GetComponent<Image>();
            menuImg.sprite = circleSprite;
            menuImg.color = new Color(0.07f, 0.05f, 0.13f, 0.65f);

            var vlg = floatingMenuGo.GetComponent<VerticalLayoutGroup>();
            vlg.padding = new RectOffset(5, 5, 10, 10);
            vlg.spacing = 10;
            vlg.childAlignment = TextAnchor.MiddleCenter;
            vlg.childControlWidth = false;
            vlg.childControlHeight = false;
            vlg.childForceExpandWidth = false;
            vlg.childForceExpandHeight = false;

            var chatBtnGo = CreateCircularButton("ChatButton", floatingMenuGo.transform, circleSprite, chatIcon, Color.white);
            var settingsBtnGo = CreateCircularButton("SettingsButton", floatingMenuGo.transform, circleSprite, settingsIcon, Color.white);
            var alwaysOnTopBtnGo = CreateCircularButton("AlwaysOnTopButton", floatingMenuGo.transform, circleSprite, eyeOnIcon, AccentTeal);
            var micToggleGo = CreateCircularButton("MicToggleButton", floatingMenuGo.transform, circleSprite, micOffIcon, AccentPurple);
            var terminateBtnGo = CreateCircularButton("TerminateButton", floatingMenuGo.transform, circleSprite, terminateIcon, new Color(0.9f, 0.3f, 0.3f));
            var muteBtnGo = CreateCircularButton("MuteButton", floatingMenuGo.transform, circleSprite, volumeOnIcon, Color.white);
            var closeBtnGo = CreateCircularButton("CloseButton", floatingMenuGo.transform, circleSprite, closeIcon, Color.white);

            serUI.FindProperty("toggleChatButton").objectReferenceValue = chatBtnGo.GetComponent<Button>();
            serUI.FindProperty("toggleDashboardButton").objectReferenceValue = settingsBtnGo.GetComponent<Button>();
            serUI.FindProperty("alwaysOnTopButton").objectReferenceValue = alwaysOnTopBtnGo.GetComponent<Button>();
            serUI.FindProperty("micToggleButton").objectReferenceValue = micToggleGo.GetComponent<Button>();
            serUI.FindProperty("terminateButton").objectReferenceValue = terminateBtnGo.GetComponent<Button>();
            serUI.FindProperty("muteButton").objectReferenceValue = muteBtnGo.GetComponent<Button>();
            serUI.FindProperty("closeButton").objectReferenceValue = closeBtnGo.GetComponent<Button>();

            // Collapsible Chat Input Container
            var chatInputContainerGo = new GameObject("ChatInputContainer", typeof(RectTransform), typeof(Image));
            chatInputContainerGo.transform.SetParent(canvasGo.transform, false);
            var cicRect = chatInputContainerGo.GetComponent<RectTransform>();
            cicRect.anchorMin = new Vector2(0f, 0f);
            cicRect.anchorMax = new Vector2(1f, 0f);
            cicRect.pivot = new Vector2(0.5f, 0f);
            cicRect.anchoredPosition = new Vector2(0f, 25f);
            cicRect.sizeDelta = new Vector2(-80f, 50f);
            chatInputContainerGo.GetComponent<Image>().sprite = darkGlassSprite;
            chatInputContainerGo.GetComponent<Image>().type = Image.Type.Sliced;
            serUI.FindProperty("chatInputContainer").objectReferenceValue = chatInputContainerGo;

            // Chat Input Field using our new helper!
            var inputField = CreateTMPInputField(chatInputContainerGo, new Vector2(15f, 0f), new Vector2(-120f, 38f), "Type a message here...", darkGlassSprite);
            var inputRect = inputField.GetComponent<RectTransform>();
            inputRect.anchorMin = new Vector2(0f, 0.5f);
            inputRect.anchorMax = new Vector2(1f, 0.5f);
            inputRect.pivot = new Vector2(0f, 0.5f);
            inputField.textComponent.fontSize = 15f;
            if (inputField.placeholder is TextMeshProUGUI placeholderTmp)
            {
                placeholderTmp.fontSize = 15f;
            }
            serUI.FindProperty("chatInputField").objectReferenceValue = inputField;

            var submitButtonGo = new GameObject("SubmitButton", typeof(RectTransform), typeof(Image), typeof(Button));
            submitButtonGo.transform.SetParent(chatInputContainerGo.transform, false);
            var submitRect = submitButtonGo.GetComponent<RectTransform>();
            submitRect.anchorMin = new Vector2(1f, 0.5f);
            submitRect.anchorMax = new Vector2(1f, 0.5f);
            submitRect.pivot = new Vector2(1f, 0.5f);
            submitRect.anchoredPosition = new Vector2(-10f, 0f);
            submitRect.sizeDelta = new Vector2(80f, 36f);
            var submitImg = submitButtonGo.GetComponent<Image>();
            submitImg.sprite = circleSprite;
            submitImg.color = AccentPurple;
            CreateLabel(submitButtonGo, "Send", 14f, Color.white);
            serUI.FindProperty("submitButton").objectReferenceValue = submitButtonGo.GetComponent<Button>();

            // Floating Speech Bubble
            var bubbleContainerGo = new GameObject("SpeechBubbleContainer", typeof(RectTransform), typeof(Image));
            bubbleContainerGo.transform.SetParent(canvasGo.transform, false);
            var bubbleRect = bubbleContainerGo.GetComponent<RectTransform>();
            bubbleRect.sizeDelta = new Vector2(320f, 120f);
            var bubbleImg = bubbleContainerGo.GetComponent<Image>();
            bubbleImg.sprite = bubbleSprite;
            bubbleImg.type = Image.Type.Sliced;

            var arrowGo = new GameObject("Arrow", typeof(RectTransform), typeof(Image));
            arrowGo.transform.SetParent(bubbleContainerGo.transform, false);
            var arrowRect = arrowGo.GetComponent<RectTransform>();
            arrowRect.anchorMin = new Vector2(0.5f, 0f);
            arrowRect.anchorMax = new Vector2(0.5f, 0f);
            arrowRect.pivot = new Vector2(0.5f, 0.5f);
            arrowRect.anchoredPosition = new Vector2(0f, -4f);
            arrowRect.sizeDelta = new Vector2(14f, 14f);
            arrowRect.rotation = Quaternion.Euler(0f, 0f, 45f);
            var arrowImg = arrowGo.GetComponent<Image>();
            arrowImg.color = new Color(0.07f, 0.05f, 0.13f, 0.94f);

            var tagGo = new GameObject("YukiTagText", typeof(RectTransform), typeof(TextMeshProUGUI));
            tagGo.transform.SetParent(bubbleContainerGo.transform, false);
            var tagRect = tagGo.GetComponent<RectTransform>();
            tagRect.anchorMin = new Vector2(0f, 1f);
            tagRect.anchorMax = new Vector2(0f, 1f);
            tagRect.pivot = new Vector2(0f, 1f);
            tagRect.anchoredPosition = new Vector2(16f, -12f);
            tagRect.sizeDelta = new Vector2(100f, 20f);
            var tagText = tagGo.GetComponent<TextMeshProUGUI>();
            tagText.text = "YUKI";
            tagText.fontSize = 11f;
            tagText.color = AccentPurple;
            tagText.fontStyle = FontStyles.Bold | FontStyles.UpperCase;

            var bubbleTextGo = new GameObject("SpeechBubbleText", typeof(RectTransform), typeof(TextMeshProUGUI));
            bubbleTextGo.transform.SetParent(bubbleContainerGo.transform, false);
            var bubbleTextRect = bubbleTextGo.GetComponent<RectTransform>();
            bubbleTextRect.anchorMin = Vector2.zero;
            bubbleTextRect.anchorMax = Vector2.one;
            bubbleTextRect.offsetMin = new Vector2(16f, 12f);
            bubbleTextRect.offsetMax = new Vector2(-16f, -32f);
            var bubbleText = bubbleTextGo.GetComponent<TextMeshProUGUI>();
            bubbleText.alignment = TextAlignmentOptions.Left;
            bubbleText.fontSize = 15f;
            bubbleText.color = Color.white;

            serUI.FindProperty("speechBubbleContainer").objectReferenceValue = bubbleContainerGo;
            serUI.FindProperty("speechBubbleText").objectReferenceValue = bubbleText;
            serUI.FindProperty("speechBubbleContainerRect").objectReferenceValue = bubbleContainerGo.GetComponent<RectTransform>();

            // Autocomplete Suggestions Panel
            var suggestionsContainerGo = new GameObject("SuggestionsContainer", typeof(RectTransform), typeof(Image));
            suggestionsContainerGo.transform.SetParent(canvasGo.transform, false);
            var sugRect = suggestionsContainerGo.GetComponent<RectTransform>();
            sugRect.anchorMin = new Vector2(0f, 0f);
            sugRect.anchorMax = new Vector2(1f, 0f);
            sugRect.pivot = new Vector2(0.5f, 0f);
            sugRect.anchoredPosition = new Vector2(0f, 85f);
            sugRect.sizeDelta = new Vector2(-80f, 150f);
            suggestionsContainerGo.GetComponent<Image>().sprite = darkGlassSprite;
            suggestionsContainerGo.GetComponent<Image>().type = Image.Type.Sliced;
            serUI.FindProperty("suggestionsContainer").objectReferenceValue = suggestionsContainerGo;

            var suggestionsParentGo = new GameObject("SuggestionsParent", typeof(RectTransform));
            suggestionsParentGo.transform.SetParent(suggestionsContainerGo.transform, false);
            var sugParentRect = suggestionsParentGo.GetComponent<RectTransform>();
            sugParentRect.anchorMin = Vector2.zero;
            sugParentRect.anchorMax = Vector2.one;
            sugParentRect.sizeDelta = new Vector2(-20f, -20f);
            serUI.FindProperty("suggestionsParent").objectReferenceValue = suggestionsParentGo.transform;

            var suggestionPrefabGo = new GameObject("SuggestionPrefab", typeof(RectTransform), typeof(Image), typeof(Button));
            suggestionPrefabGo.SetActive(false);
            suggestionPrefabGo.transform.SetParent(canvasGo.transform, false);
            suggestionPrefabGo.GetComponent<RectTransform>().sizeDelta = new Vector2(300f, 32f);
            suggestionPrefabGo.GetComponent<Image>().sprite = darkGlassSprite;
            suggestionPrefabGo.GetComponent<Image>().type = Image.Type.Sliced;
            CreateLabel(suggestionPrefabGo, "Suggestion Item", 13f, Color.white);
            serUI.FindProperty("suggestionPrefab").objectReferenceValue = suggestionPrefabGo;

            // Settings Dashboard Backdrop Panel overlay
            var dashboardBackdropGo = new GameObject("DashboardPanel", typeof(RectTransform), typeof(Image));
            dashboardBackdropGo.transform.SetParent(canvasGo.transform, false);
            var backdropRect = dashboardBackdropGo.GetComponent<RectTransform>();
            backdropRect.anchorMin = Vector2.zero;
            backdropRect.anchorMax = Vector2.one;
            backdropRect.sizeDelta = Vector2.zero;
            dashboardBackdropGo.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.45f);
            serUI.FindProperty("dashboardPanel").objectReferenceValue = dashboardBackdropGo;

            // Centered Settings Modal Card (Enlarged for layout space)
            var dashboardCardGo = new GameObject("DashboardCard", typeof(RectTransform), typeof(Image));
            dashboardCardGo.transform.SetParent(dashboardBackdropGo.transform, false);
            var cardRect = dashboardCardGo.GetComponent<RectTransform>();
            cardRect.anchorMin = new Vector2(0.5f, 0.5f);
            cardRect.anchorMax = new Vector2(0.5f, 0.5f);
            cardRect.pivot = new Vector2(0.5f, 0.5f);
            cardRect.anchoredPosition = Vector2.zero;
            cardRect.sizeDelta = new Vector2(480f, 600f);
            dashboardCardGo.GetComponent<Image>().sprite = modalSprite;
            dashboardCardGo.GetComponent<Image>().type = Image.Type.Sliced;

            // Header elements
            var titleGo = new GameObject("TitleText", typeof(RectTransform), typeof(TextMeshProUGUI));
            titleGo.transform.SetParent(dashboardCardGo.transform, false);
            var titleRect = titleGo.GetComponent<RectTransform>();
            titleRect.anchorMin = new Vector2(0.5f, 1f);
            titleRect.anchorMax = new Vector2(0.5f, 1f);
            titleRect.pivot = new Vector2(0.5f, 1f);
            titleRect.anchoredPosition = new Vector2(0f, -20f);
            titleRect.sizeDelta = new Vector2(400f, 30f);
            var titleText = titleGo.GetComponent<TextMeshProUGUI>();
            titleText.text = "YUKI SETTINGS";
            titleText.fontSize = 22f;
            titleText.alignment = TextAlignmentOptions.Center;
            titleText.color = AccentPurple;
            titleText.fontStyle = FontStyles.Bold;

            var backendStatusGo = new GameObject("BackendStatusText", typeof(RectTransform), typeof(TextMeshProUGUI));
            backendStatusGo.transform.SetParent(dashboardCardGo.transform, false);
            var backendStatusRect = backendStatusGo.GetComponent<RectTransform>();
            backendStatusRect.anchorMin = new Vector2(0.5f, 1f);
            backendStatusRect.anchorMax = new Vector2(0.5f, 1f);
            backendStatusRect.pivot = new Vector2(0.5f, 1f);
            backendStatusRect.anchoredPosition = new Vector2(0f, -55f);
            backendStatusRect.sizeDelta = new Vector2(400f, 24f);
            var backendStatusText = backendStatusGo.GetComponent<TextMeshProUGUI>();
            backendStatusText.text = "Connection: <color=red>OFFLINE</color>";
            backendStatusText.fontSize = 15f;
            backendStatusText.alignment = TextAlignmentOptions.Center;
            serUI.FindProperty("backendStatusText").objectReferenceValue = backendStatusText;

            // Close settings button at top right of Settings card
            var closeCardBtnGo = CreateCircularButton("CloseSettingsButton", dashboardCardGo.transform, circleSprite, closeIcon, Color.white);
            var ccbRect = closeCardBtnGo.GetComponent<RectTransform>();
            ccbRect.anchorMin = new Vector2(1f, 1f);
            ccbRect.anchorMax = new Vector2(1f, 1f);
            ccbRect.pivot = new Vector2(0.5f, 0.5f);
            ccbRect.anchoredPosition = new Vector2(-20f, -20f);
            ccbRect.sizeDelta = new Vector2(28f, 28f);
            var ccbIcon = closeCardBtnGo.transform.Find("Icon")?.GetComponent<RectTransform>();
            if (ccbIcon != null) ccbIcon.sizeDelta = new Vector2(12f, 12f);
            serUI.FindProperty("closeSettingsButton").objectReferenceValue = closeCardBtnGo.GetComponent<Button>();

            // Footer elements
            var userStatsGo = new GameObject("UserStatsText", typeof(RectTransform), typeof(TextMeshProUGUI));
            userStatsGo.transform.SetParent(dashboardCardGo.transform, false);
            var userStatsRect = userStatsGo.GetComponent<RectTransform>();
            userStatsRect.anchorMin = new Vector2(0.5f, 0f);
            userStatsRect.anchorMax = new Vector2(0.5f, 0f);
            userStatsRect.pivot = new Vector2(0.5f, 0f);
            userStatsRect.anchoredPosition = new Vector2(0f, 15f);
            userStatsRect.sizeDelta = new Vector2(400f, 40f);
            var userStatsText = userStatsGo.GetComponent<TextMeshProUGUI>();
            userStatsText.alignment = TextAlignmentOptions.Center;
            userStatsText.fontSize = 15f;
            userStatsText.text = "User: Guest\nInteractions: 0";
            serUI.FindProperty("userStatsText").objectReferenceValue = userStatsText;

            // Middle Scrollable Settings Viewport
            var scrollViewGo = new GameObject("SettingsScrollView", typeof(RectTransform), typeof(ScrollRect));
            scrollViewGo.transform.SetParent(dashboardCardGo.transform, false);
            var scrollRectTrans = scrollViewGo.GetComponent<RectTransform>();
            scrollRectTrans.anchorMin = Vector2.zero;
            scrollRectTrans.anchorMax = Vector2.one;
            scrollRectTrans.offsetMin = new Vector2(20f, 60f); // Bottom margin leaves room for stats
            scrollRectTrans.offsetMax = new Vector2(-20f, -85f); // Top margin leaves room for headers
            
            var scrollRect = scrollViewGo.GetComponent<ScrollRect>();
            scrollRect.horizontal = false;
            scrollRect.vertical = true;
            scrollRect.movementType = ScrollRect.MovementType.Clamped;
            
            // Viewport mask
            var viewportGo = new GameObject("Viewport", typeof(RectTransform), typeof(Image), typeof(Mask));
            viewportGo.transform.SetParent(scrollViewGo.transform, false);
            var viewportRect = viewportGo.GetComponent<RectTransform>();
            viewportRect.anchorMin = Vector2.zero;
            viewportRect.anchorMax = Vector2.one;
            viewportRect.sizeDelta = Vector2.zero;
            var viewportImg = viewportGo.GetComponent<Image>();
            viewportImg.color = Color.white;
            var viewportMask = viewportGo.GetComponent<Mask>();
            viewportMask.showMaskGraphic = false;
            
            // Content layout container
            var contentGo = new GameObject("Content", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
            contentGo.transform.SetParent(viewportGo.transform, false);
            var contentRect = contentGo.GetComponent<RectTransform>();
            contentRect.anchorMin = new Vector2(0f, 1f);
            contentRect.anchorMax = new Vector2(1f, 1f);
            contentRect.pivot = new Vector2(0.5f, 1f);
            contentRect.anchoredPosition = Vector2.zero;
            contentRect.sizeDelta = new Vector2(0f, 300f);
            
            var contentVlg = contentGo.GetComponent<VerticalLayoutGroup>();
            contentVlg.spacing = 14f;
            contentVlg.padding = new RectOffset(5, 5, 10, 10);
            contentVlg.childAlignment = TextAnchor.UpperCenter;
            contentVlg.childControlWidth = true;
            contentVlg.childControlHeight = false;
            contentVlg.childForceExpandWidth = true;
            contentVlg.childForceExpandHeight = false;
            
            var contentCsf = contentGo.GetComponent<ContentSizeFitter>();
            contentCsf.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            
            scrollRect.viewport = viewportRect;
            scrollRect.content = contentRect;

            // Populate settings rows in order:
            // 1. Model Dropdown
            TMP_Dropdown modelDropdown;
            CreateDropdownSettingRow(contentGo.transform, "LLM Model", darkGlassSprite, modalSprite, out modelDropdown);
            serUI.FindProperty("modelDropdown").objectReferenceValue = modelDropdown;

            // 2. Voice Dropdown
            TMP_Dropdown voiceDropdown;
            CreateDropdownSettingRow(contentGo.transform, "Voice Name", darkGlassSprite, modalSprite, out voiceDropdown);
            serUI.FindProperty("voiceDropdown").objectReferenceValue = voiceDropdown;

            // 3. TTS Rate Dropdown
            TMP_Dropdown ttsRateDropdown;
            CreateDropdownSettingRow(contentGo.transform, "Speech Rate", darkGlassSprite, modalSprite, out ttsRateDropdown);
            serUI.FindProperty("ttsRateDropdown").objectReferenceValue = ttsRateDropdown;

            // 4. Volume Slider
            Slider volumeSlider;
            CreateSliderSettingRow(contentGo.transform, "Output Volume", darkGlassSprite, circleSprite, circleSprite, out volumeSlider);
            serUI.FindProperty("volumeSlider").objectReferenceValue = volumeSlider;

            // 5. Mute Toggle
            Toggle muteToggle;
            CreateToggleSettingRow(contentGo.transform, "Mute Audio Output", darkGlassSprite, circleSprite, out muteToggle);
            serUI.FindProperty("muteToggle").objectReferenceValue = muteToggle;

            // 6. Character Name (InputField)
            TMP_InputField characterNameField;
            CreateInputFieldSettingRow(contentGo.transform, "Character Name", "Enter name...", darkGlassSprite, out characterNameField);
            serUI.FindProperty("characterNameInputField").objectReferenceValue = characterNameField;

            // 7. Character Persona (InputField, multiline)
            var personaRowGo = new GameObject("CharacterPersona_Row", typeof(RectTransform), typeof(VerticalLayoutGroup));
            personaRowGo.transform.SetParent(contentGo.transform, false);
            var personaRowVlg = personaRowGo.GetComponent<VerticalLayoutGroup>();
            personaRowVlg.spacing = 6f;
            personaRowVlg.childAlignment = TextAnchor.UpperLeft;
            personaRowVlg.childControlWidth = true;
            personaRowVlg.childControlHeight = false;
            personaRowVlg.childForceExpandWidth = true;
            personaRowVlg.childForceExpandHeight = false;

            var personaLabelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            personaLabelGo.transform.SetParent(personaRowGo.transform, false);
            var personaLabelText = personaLabelGo.GetComponent<TextMeshProUGUI>();
            personaLabelText.text = "CHARACTER PERSONA";
            personaLabelText.fontSize = 11f;
            personaLabelText.color = TextMuted;
            personaLabelText.fontStyle = FontStyles.Bold;

            var characterPersonaField = CreateTMPInputField(personaRowGo, Vector2.zero, new Vector2(0f, 80f), "Describe personality...", darkGlassSprite);
            characterPersonaField.lineType = TMP_InputField.LineType.MultiLineSubmit;
            personaRowGo.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 102f);
            serUI.FindProperty("characterPersonaInputField").objectReferenceValue = characterPersonaField;

            // 8. Crawler Paused Toggle
            Toggle crawlerPausedToggle;
            CreateToggleSettingRow(contentGo.transform, "Pause Web Crawler", darkGlassSprite, circleSprite, out crawlerPausedToggle);
            serUI.FindProperty("crawlerPausedToggle").objectReferenceValue = crawlerPausedToggle;

            // 9. Tagger Paused Toggle
            Toggle taggerPausedToggle;
            CreateToggleSettingRow(contentGo.transform, "Pause File Tagger", darkGlassSprite, circleSprite, out taggerPausedToggle);
            serUI.FindProperty("taggerPausedToggle").objectReferenceValue = taggerPausedToggle;

            // 10. Use Local Whisper Toggle
            Toggle useLocalWhisperToggle;
            CreateToggleSettingRow(contentGo.transform, "Use Local Whisper (STT)", darkGlassSprite, circleSprite, out useLocalWhisperToggle);
            serUI.FindProperty("useLocalWhisperToggle").objectReferenceValue = useLocalWhisperToggle;

            // 11. No LLM Mode Toggle
            Toggle noLlmModeToggle;
            CreateToggleSettingRow(contentGo.transform, "No LLM Mode (Direct command pass)", darkGlassSprite, circleSprite, out noLlmModeToggle);
            serUI.FindProperty("noLlmModeToggle").objectReferenceValue = noLlmModeToggle;

            // Safety Dialog Panel backdrop overlay
            var safetyBackdropGo = new GameObject("SafetyDialogPanel", typeof(RectTransform), typeof(Image));
            safetyBackdropGo.transform.SetParent(canvasGo.transform, false);
            var safetyBackdropRect = safetyBackdropGo.GetComponent<RectTransform>();
            safetyBackdropRect.anchorMin = Vector2.zero;
            safetyBackdropRect.anchorMax = Vector2.one;
            safetyBackdropRect.sizeDelta = Vector2.zero;
            safetyBackdropGo.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.45f);
            serUI.FindProperty("safetyDialogPanel").objectReferenceValue = safetyBackdropGo;

            // Centered Safety dialog card
            var safetyCardGo = new GameObject("SafetyCard", typeof(RectTransform), typeof(Image));
            safetyCardGo.transform.SetParent(safetyBackdropGo.transform, false);
            var scRect = safetyCardGo.GetComponent<RectTransform>();
            scRect.anchorMin = new Vector2(0.5f, 0.5f);
            scRect.anchorMax = new Vector2(0.5f, 0.5f);
            scRect.pivot = new Vector2(0.5f, 0.5f);
            scRect.anchoredPosition = Vector2.zero;
            scRect.sizeDelta = new Vector2(300f, 220f);
            safetyCardGo.GetComponent<Image>().sprite = modalSprite;
            safetyCardGo.GetComponent<Image>().type = Image.Type.Sliced;

            var safetyPromptGo = new GameObject("SafetyPromptText", typeof(RectTransform), typeof(TextMeshProUGUI));
            safetyPromptGo.transform.SetParent(safetyCardGo.transform, false);
            safetyPromptGo.GetComponent<RectTransform>().anchoredPosition = new Vector2(0f, 50f);
            safetyPromptGo.GetComponent<RectTransform>().sizeDelta = new Vector2(260f, 100f);
            var safetyPromptText = safetyPromptGo.GetComponent<TextMeshProUGUI>();
            safetyPromptText.alignment = TextAlignmentOptions.Center;
            safetyPromptText.fontSize = 15f;
            safetyPromptText.text = "Do you want to run this command?";
            serUI.FindProperty("safetyPromptText").objectReferenceValue = safetyPromptText;

            var approveGo = new GameObject("ApproveSafetyButton", typeof(RectTransform), typeof(Image), typeof(Button));
            approveGo.transform.SetParent(safetyCardGo.transform, false);
            approveGo.GetComponent<RectTransform>().anchoredPosition = new Vector2(-60f, -50f);
            approveGo.GetComponent<RectTransform>().sizeDelta = new Vector2(100f, 36f);
            approveGo.GetComponent<Image>().sprite = circleSprite;
            approveGo.GetComponent<Image>().color = AccentTeal;
            CreateLabel(approveGo, "Approve", 13f, Color.black);
            serUI.FindProperty("approveSafetyButton").objectReferenceValue = approveGo.GetComponent<Button>();

            var rejectGo = new GameObject("RejectSafetyButton", typeof(RectTransform), typeof(Image), typeof(Button));
            rejectGo.transform.SetParent(safetyCardGo.transform, false);
            rejectGo.GetComponent<RectTransform>().anchoredPosition = new Vector2(60f, -50f);
            rejectGo.GetComponent<RectTransform>().sizeDelta = new Vector2(100f, 36f);
            var rejectImg = rejectGo.GetComponent<Image>();
            rejectImg.sprite = circleSprite;
            rejectImg.color = new Color(0.9f, 0.3f, 0.3f);
            CreateLabel(rejectGo, "Reject", 13f, Color.white);
            serUI.FindProperty("rejectSafetyButton").objectReferenceValue = rejectGo.GetComponent<Button>();

            serUI.FindProperty("mainCanvas").objectReferenceValue = canvas;
            serUI.FindProperty("mainCamera").objectReferenceValue = Camera.main;

            serUI.ApplyModifiedProperties();

            // 8. Connect YukiSlashCommandHandler references
            var serSlash = new SerializedObject(slashCommandHandler);
            serSlash.FindProperty("restClient").objectReferenceValue = restClient;
            serSlash.FindProperty("avatarPresenter").objectReferenceValue = avatarPresenter;
            serSlash.FindProperty("webSocketClient").objectReferenceValue = wsClient;
            serSlash.ApplyModifiedProperties();

            // 9. Save the scene
            if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
            {
                AssetDatabase.CreateFolder("Assets", "Scenes");
            }
            EditorSceneManager.SaveScene(activeScene, "Assets/Scenes/YukiDesktop.unity");
            Debug.Log("Successfully created and saved scene at Assets/Scenes/YukiDesktop.unity");

            AssetDatabase.Refresh();
        }

        private static TMP_InputField CreateTMPInputField(GameObject parent, Vector2 anchoredPos, Vector2 size, string placeholderText, Sprite bgSprite)
        {
            var inputGo = new GameObject("InputField", typeof(RectTransform), typeof(Image), typeof(TMP_InputField));
            inputGo.transform.SetParent(parent.transform, false);
            var inputRect = inputGo.GetComponent<RectTransform>();
            inputRect.anchoredPosition = anchoredPos;
            inputRect.sizeDelta = size;
            
            var img = inputGo.GetComponent<Image>();
            img.sprite = bgSprite;
            img.type = Image.Type.Sliced;
            img.color = Color.white;
            
            var inputField = inputGo.GetComponent<TMP_InputField>();
            
            var textAreaGo = new GameObject("TextArea", typeof(RectTransform), typeof(RectMask2D));
            textAreaGo.transform.SetParent(inputGo.transform, false);
            var textAreaRect = textAreaGo.GetComponent<RectTransform>();
            textAreaRect.anchorMin = Vector2.zero;
            textAreaRect.anchorMax = Vector2.one;
            textAreaRect.sizeDelta = new Vector2(-16f, -10f);
            
            var placeholderGo = new GameObject("Placeholder", typeof(RectTransform), typeof(TextMeshProUGUI));
            placeholderGo.transform.SetParent(textAreaGo.transform, false);
            var placeholderRect = placeholderGo.GetComponent<RectTransform>();
            placeholderRect.anchorMin = Vector2.zero;
            placeholderRect.anchorMax = Vector2.one;
            placeholderRect.sizeDelta = Vector2.zero;
            var placeholderTextComp = placeholderGo.GetComponent<TextMeshProUGUI>();
            placeholderTextComp.text = placeholderText;
            placeholderTextComp.fontSize = 13f;
            placeholderTextComp.color = new Color(1f, 1f, 1f, 0.4f);
            placeholderTextComp.fontStyle = FontStyles.Italic;
            placeholderTextComp.alignment = TextAlignmentOptions.MidlineLeft;
            
            var textGo = new GameObject("Text", typeof(RectTransform), typeof(TextMeshProUGUI));
            textGo.transform.SetParent(textAreaGo.transform, false);
            var textRect = textGo.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.sizeDelta = Vector2.zero;
            var textComp = textGo.GetComponent<TextMeshProUGUI>();
            textComp.fontSize = 13f;
            textComp.color = Color.white;
            textComp.alignment = TextAlignmentOptions.MidlineLeft;
            
            inputField.textViewport = textAreaRect;
            inputField.textComponent = textComp;
            inputField.placeholder = placeholderTextComp;
            
            return inputField;
        }

        private static Slider CreateSlider(GameObject parent, Vector2 anchoredPos, Vector2 size, Sprite bgSprite, Sprite fillSprite, Sprite handleSprite)
        {
            var sliderGo = new GameObject("Slider", typeof(RectTransform), typeof(Slider));
            sliderGo.transform.SetParent(parent.transform, false);
            var sliderRect = sliderGo.GetComponent<RectTransform>();
            sliderRect.anchoredPosition = anchoredPos;
            sliderRect.sizeDelta = size;
            
            var slider = sliderGo.GetComponent<Slider>();
            
            var bgGo = new GameObject("Background", typeof(RectTransform), typeof(Image));
            bgGo.transform.SetParent(sliderGo.transform, false);
            var bgRect = bgGo.GetComponent<RectTransform>();
            bgRect.anchorMin = new Vector2(0f, 0.25f);
            bgRect.anchorMax = new Vector2(1f, 0.75f);
            bgRect.offsetMin = Vector2.zero;
            bgRect.offsetMax = Vector2.zero;
            var bgImg = bgGo.GetComponent<Image>();
            bgImg.sprite = bgSprite;
            bgImg.type = Image.Type.Sliced;
            bgImg.color = new Color(1f, 1f, 1f, 0.15f);
            
            var fillAreaGo = new GameObject("Fill Area", typeof(RectTransform));
            fillAreaGo.transform.SetParent(sliderGo.transform, false);
            var fillAreaRect = fillAreaGo.GetComponent<RectTransform>();
            fillAreaRect.anchorMin = new Vector2(0f, 0.25f);
            fillAreaRect.anchorMax = new Vector2(1f, 0.75f);
            fillAreaRect.offsetMin = new Vector2(5f, 0f);
            fillAreaRect.offsetMax = new Vector2(-5f, 0f);
            
            var fillGo = new GameObject("Fill", typeof(RectTransform), typeof(Image));
            fillGo.transform.SetParent(fillAreaGo.transform, false);
            var fillRect = fillGo.GetComponent<RectTransform>();
            fillRect.offsetMin = Vector2.zero;
            fillRect.offsetMax = Vector2.zero;
            var fillImg = fillGo.GetComponent<Image>();
            fillImg.sprite = fillSprite;
            fillImg.type = Image.Type.Sliced;
            fillImg.color = AccentPurple;
            
            var handleAreaGo = new GameObject("Handle Slide Area", typeof(RectTransform));
            handleAreaGo.transform.SetParent(sliderGo.transform, false);
            var handleAreaRect = handleAreaGo.GetComponent<RectTransform>();
            handleAreaRect.anchorMin = new Vector2(0f, 0f);
            handleAreaRect.anchorMax = new Vector2(1f, 1f);
            handleAreaRect.offsetMin = new Vector2(10f, 0f);
            handleAreaRect.offsetMax = new Vector2(-10f, 0f);
            
            var handleGo = new GameObject("Handle", typeof(RectTransform), typeof(Image));
            handleGo.transform.SetParent(handleAreaGo.transform, false);
            var handleRect = handleGo.GetComponent<RectTransform>();
            handleRect.sizeDelta = new Vector2(16f, 16f);
            var handleImg = handleGo.GetComponent<Image>();
            handleImg.sprite = handleSprite;
            handleImg.color = Color.white;
            
            slider.fillRect = fillRect;
            slider.handleRect = handleRect;
            slider.targetGraphic = handleImg;
            slider.direction = Slider.Direction.LeftToRight;
            slider.minValue = 0f;
            slider.maxValue = 1f;
            slider.value = 1f;
            
            return slider;
        }

        private static Toggle CreateToggle(GameObject parent, Vector2 anchoredPos, Vector2 size, string labelText, Sprite bgSprite, Sprite checkmarkSprite)
        {
            var toggleGo = new GameObject("Toggle", typeof(RectTransform), typeof(Toggle));
            toggleGo.transform.SetParent(parent.transform, false);
            var toggleRect = toggleGo.GetComponent<RectTransform>();
            toggleRect.anchoredPosition = anchoredPos;
            toggleRect.sizeDelta = size;
            
            var toggle = toggleGo.GetComponent<Toggle>();
            
            var bgGo = new GameObject("Background", typeof(RectTransform), typeof(Image));
            bgGo.transform.SetParent(toggleGo.transform, false);
            var bgRect = bgGo.GetComponent<RectTransform>();
            bgRect.anchorMin = new Vector2(0f, 0.5f);
            bgRect.anchorMax = new Vector2(0f, 0.5f);
            bgRect.pivot = new Vector2(0f, 0.5f);
            bgRect.anchoredPosition = Vector2.zero;
            bgRect.sizeDelta = new Vector2(18f, 18f);
            var bgImg = bgGo.GetComponent<Image>();
            bgImg.sprite = bgSprite;
            bgImg.type = Image.Type.Sliced;
            bgImg.color = new Color(1f, 1f, 1f, 0.15f);
            
            var checkGo = new GameObject("Checkmark", typeof(RectTransform), typeof(Image));
            checkGo.transform.SetParent(bgGo.transform, false);
            var checkRect = checkGo.GetComponent<RectTransform>();
            checkRect.anchorMin = new Vector2(0.5f, 0.5f);
            checkRect.anchorMax = new Vector2(0.5f, 0.5f);
            checkRect.pivot = new Vector2(0.5f, 0.5f);
            checkRect.anchoredPosition = Vector2.zero;
            checkRect.sizeDelta = new Vector2(10f, 10f);
            var checkImg = checkGo.GetComponent<Image>();
            checkImg.sprite = checkmarkSprite;
            checkImg.color = AccentTeal;
            
            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            labelGo.transform.SetParent(toggleGo.transform, false);
            var labelRect = labelGo.GetComponent<RectTransform>();
            labelRect.anchorMin = new Vector2(0f, 0.5f);
            labelRect.anchorMax = new Vector2(1f, 0.5f);
            labelRect.pivot = new Vector2(0f, 0.5f);
            labelRect.anchoredPosition = new Vector2(26f, 0f);
            labelRect.sizeDelta = new Vector2(-26f, 24f);
            var labelTextComp = labelGo.GetComponent<TextMeshProUGUI>();
            labelTextComp.text = labelText;
            labelTextComp.fontSize = 13f;
            labelTextComp.color = Color.white;
            labelTextComp.alignment = TextAlignmentOptions.MidlineLeft;
            
            toggle.graphic = checkImg;
            toggle.targetGraphic = bgImg;
            toggle.isOn = true;
            
            return toggle;
        }

        private static TMP_Dropdown CreateTMPDropdown(GameObject parent, Vector2 anchoredPos, Vector2 size, Sprite bgSprite, Sprite itemBgSprite)
        {
            var dropdownGo = new GameObject("Dropdown", typeof(RectTransform), typeof(Image), typeof(TMP_Dropdown));
            dropdownGo.transform.SetParent(parent.transform, false);
            var ddRect = dropdownGo.GetComponent<RectTransform>();
            ddRect.anchoredPosition = anchoredPos;
            ddRect.sizeDelta = size;
            
            var ddImg = dropdownGo.GetComponent<Image>();
            ddImg.sprite = bgSprite;
            ddImg.type = Image.Type.Sliced;
            ddImg.color = new Color(1f, 1f, 1f, 0.15f);
            
            var dropdown = dropdownGo.GetComponent<TMP_Dropdown>();
            
            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            labelGo.transform.SetParent(dropdownGo.transform, false);
            var labelRect = labelGo.GetComponent<RectTransform>();
            labelRect.anchorMin = Vector2.zero;
            labelRect.anchorMax = Vector2.one;
            labelRect.offsetMin = new Vector2(10f, 0f);
            labelRect.offsetMax = new Vector2(-28f, 0f);
            var labelText = labelGo.GetComponent<TextMeshProUGUI>();
            labelText.fontSize = 13f;
            labelText.color = Color.white;
            labelText.alignment = TextAlignmentOptions.MidlineLeft;
            
            var arrowGo = new GameObject("Arrow", typeof(RectTransform), typeof(TextMeshProUGUI));
            arrowGo.transform.SetParent(dropdownGo.transform, false);
            var arrowRect = arrowGo.GetComponent<RectTransform>();
            arrowRect.anchorMin = new Vector2(1f, 0.5f);
            arrowRect.anchorMax = new Vector2(1f, 0.5f);
            arrowRect.pivot = new Vector2(1f, 0.5f);
            arrowRect.anchoredPosition = new Vector2(-10f, 0f);
            arrowRect.sizeDelta = new Vector2(16f, 16f);
            var arrowText = arrowGo.GetComponent<TextMeshProUGUI>();
            arrowText.text = "▼";
            arrowText.fontSize = 9f;
            arrowText.color = TextMuted;
            arrowText.alignment = TextAlignmentOptions.Center;
            
            var templateGo = new GameObject("Template", typeof(RectTransform), typeof(Image), typeof(ScrollRect));
            templateGo.transform.SetParent(dropdownGo.transform, false);
            var templateRect = templateGo.GetComponent<RectTransform>();
            templateRect.anchorMin = new Vector2(0f, 0f);
            templateRect.anchorMax = new Vector2(1f, 0f);
            templateRect.pivot = new Vector2(0.5f, 1f);
            templateRect.anchoredPosition = new Vector2(0f, -2f);
            templateRect.sizeDelta = new Vector2(0f, 150f);
            
            var templateImg = templateGo.GetComponent<Image>();
            templateImg.sprite = itemBgSprite;
            templateImg.type = Image.Type.Sliced;
            templateImg.color = new Color(0.05f, 0.03f, 0.10f, 0.98f);
            
            var scrollRect = templateGo.GetComponent<ScrollRect>();
            scrollRect.horizontal = false;
            scrollRect.vertical = true;
            scrollRect.movementType = ScrollRect.MovementType.Clamped;
            
            var viewportGo = new GameObject("Viewport", typeof(RectTransform), typeof(Image), typeof(Mask));
            viewportGo.transform.SetParent(templateGo.transform, false);
            var viewportRect = viewportGo.GetComponent<RectTransform>();
            viewportRect.anchorMin = Vector2.zero;
            viewportRect.anchorMax = Vector2.one;
            viewportRect.sizeDelta = new Vector2(-4f, -4f);
            var viewportImg = viewportGo.GetComponent<Image>();
            viewportImg.sprite = bgSprite;
            viewportImg.type = Image.Type.Sliced;
            var viewportMask = viewportGo.GetComponent<Mask>();
            viewportMask.showMaskGraphic = false;
            
            var contentGo = new GameObject("Content", typeof(RectTransform));
            contentGo.transform.SetParent(viewportGo.transform, false);
            var contentRect = contentGo.GetComponent<RectTransform>();
            contentRect.anchorMin = new Vector2(0f, 1f);
            contentRect.anchorMax = new Vector2(1f, 1f);
            contentRect.pivot = new Vector2(0.5f, 1f);
            contentRect.anchoredPosition = Vector2.zero;
            contentRect.sizeDelta = new Vector2(0f, 28f);
            
            var itemGo = new GameObject("Item", typeof(RectTransform), typeof(Toggle));
            itemGo.transform.SetParent(contentGo.transform, false);
            var itemRect = itemGo.GetComponent<RectTransform>();
            itemRect.anchorMin = new Vector2(0f, 0.5f);
            itemRect.anchorMax = new Vector2(1f, 0.5f);
            itemRect.pivot = new Vector2(0.5f, 0.5f);
            itemRect.sizeDelta = new Vector2(0f, 28f);
            
            var itemToggle = itemGo.GetComponent<Toggle>();
            
            var itemBgGo = new GameObject("Item Background", typeof(RectTransform), typeof(Image));
            itemBgGo.transform.SetParent(itemGo.transform, false);
            var itemBgRect = itemBgGo.GetComponent<RectTransform>();
            itemBgRect.anchorMin = Vector2.zero;
            itemBgRect.anchorMax = Vector2.one;
            itemBgRect.sizeDelta = Vector2.zero;
            var itemBgImg = itemBgGo.GetComponent<Image>();
            itemBgImg.sprite = bgSprite;
            itemBgImg.type = Image.Type.Sliced;
            itemBgImg.color = new Color(1f, 1f, 1f, 0.1f);
            
            var itemCheckGo = new GameObject("Item Checkmark", typeof(RectTransform), typeof(Image));
            itemCheckGo.transform.SetParent(itemGo.transform, false);
            var itemCheckRect = itemCheckGo.GetComponent<RectTransform>();
            itemCheckRect.anchorMin = new Vector2(0f, 0.5f);
            itemCheckRect.anchorMax = new Vector2(0f, 0.5f);
            itemCheckRect.pivot = new Vector2(0f, 0.5f);
            itemCheckRect.anchoredPosition = new Vector2(10f, 0f);
            itemCheckRect.sizeDelta = new Vector2(6f, 6f);
            var itemCheckImg = itemCheckGo.GetComponent<Image>();
            itemCheckImg.sprite = GetCircleSprite();
            itemCheckImg.color = AccentTeal;
            
            var itemLabelGo = new GameObject("Item Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            itemLabelGo.transform.SetParent(itemGo.transform, false);
            var itemLabelRect = itemLabelGo.GetComponent<RectTransform>();
            itemLabelRect.anchorMin = Vector2.zero;
            itemLabelRect.anchorMax = Vector2.one;
            itemLabelRect.offsetMin = new Vector2(24f, 0f);
            itemLabelRect.offsetMax = new Vector2(-10f, 0f);
            var itemLabelText = itemLabelGo.GetComponent<TextMeshProUGUI>();
            itemLabelText.fontSize = 12f;
            itemLabelText.color = Color.white;
            itemLabelText.alignment = TextAlignmentOptions.MidlineLeft;
            
            itemToggle.targetGraphic = itemBgImg;
            itemToggle.graphic = itemCheckImg;
            itemToggle.isOn = false;
            
            scrollRect.viewport = viewportRect;
            scrollRect.content = contentRect;
            
            dropdown.template = templateRect;
            dropdown.captionText = labelText;
            dropdown.itemText = itemLabelText;
            
            templateGo.SetActive(false);
            return dropdown;
        }

        private static TMP_Dropdown CreateDropdownSettingRow(Transform parent, string labelText, Sprite bgSprite, Sprite itemBgSprite, out TMP_Dropdown dropdown)
        {
            var rowGo = new GameObject(labelText + "_Row", typeof(RectTransform), typeof(VerticalLayoutGroup));
            rowGo.transform.SetParent(parent, false);
            var rowVlg = rowGo.GetComponent<VerticalLayoutGroup>();
            rowVlg.spacing = 6f;
            rowVlg.childAlignment = TextAnchor.UpperLeft;
            rowVlg.childControlWidth = true;
            rowVlg.childControlHeight = false;
            rowVlg.childForceExpandWidth = true;
            rowVlg.childForceExpandHeight = false;
            
            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            labelGo.transform.SetParent(rowGo.transform, false);
            var labelTextComp = labelGo.GetComponent<TextMeshProUGUI>();
            labelTextComp.text = labelText.ToUpper();
            labelTextComp.fontSize = 11f;
            labelTextComp.color = TextMuted;
            labelTextComp.fontStyle = FontStyles.Bold;
            
            dropdown = CreateTMPDropdown(rowGo, Vector2.zero, new Vector2(0f, 36f), bgSprite, itemBgSprite);
            
            rowGo.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 58f);
            return dropdown;
        }

        private static TMP_InputField CreateInputFieldSettingRow(Transform parent, string labelText, string placeholderText, Sprite bgSprite, out TMP_InputField inputField)
        {
            var rowGo = new GameObject(labelText + "_Row", typeof(RectTransform), typeof(VerticalLayoutGroup));
            rowGo.transform.SetParent(parent, false);
            var rowVlg = rowGo.GetComponent<VerticalLayoutGroup>();
            rowVlg.spacing = 6f;
            rowVlg.childAlignment = TextAnchor.UpperLeft;
            rowVlg.childControlWidth = true;
            rowVlg.childControlHeight = false;
            rowVlg.childForceExpandWidth = true;
            rowVlg.childForceExpandHeight = false;
            
            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            labelGo.transform.SetParent(rowGo.transform, false);
            var labelTextComp = labelGo.GetComponent<TextMeshProUGUI>();
            labelTextComp.text = labelText.ToUpper();
            labelTextComp.fontSize = 11f;
            labelTextComp.color = TextMuted;
            labelTextComp.fontStyle = FontStyles.Bold;
            
            inputField = CreateTMPInputField(rowGo, Vector2.zero, new Vector2(0f, 36f), placeholderText, bgSprite);
            
            rowGo.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 58f);
            return inputField;
        }

        private static Slider CreateSliderSettingRow(Transform parent, string labelText, Sprite bgSprite, Sprite fillSprite, Sprite handleSprite, out Slider slider)
        {
            var rowGo = new GameObject(labelText + "_Row", typeof(RectTransform), typeof(VerticalLayoutGroup));
            rowGo.transform.SetParent(parent, false);
            var rowVlg = rowGo.GetComponent<VerticalLayoutGroup>();
            rowVlg.spacing = 6f;
            rowVlg.childAlignment = TextAnchor.UpperLeft;
            rowVlg.childControlWidth = true;
            rowVlg.childControlHeight = false;
            rowVlg.childForceExpandWidth = true;
            rowVlg.childForceExpandHeight = false;
            
            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            labelGo.transform.SetParent(rowGo.transform, false);
            var labelTextComp = labelGo.GetComponent<TextMeshProUGUI>();
            labelTextComp.text = labelText.ToUpper();
            labelTextComp.fontSize = 11f;
            labelTextComp.color = TextMuted;
            labelTextComp.fontStyle = FontStyles.Bold;
            
            slider = CreateSlider(rowGo, Vector2.zero, new Vector2(0f, 20f), bgSprite, fillSprite, handleSprite);
            
            rowGo.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 42f);
            return slider;
        }

        private static Toggle CreateToggleSettingRow(Transform parent, string labelText, Sprite bgSprite, Sprite checkmarkSprite, out Toggle toggle)
        {
            var rowGo = new GameObject(labelText + "_Row", typeof(RectTransform));
            rowGo.transform.SetParent(parent, false);
            rowGo.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 28f);
            
            toggle = CreateToggle(rowGo, Vector2.zero, new Vector2(250f, 28f), labelText, bgSprite, checkmarkSprite);
            return toggle;
        }

        private static TextMeshProUGUI CreateLabel(GameObject parent, string text, float size, Color color)
        {
            var textGo = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI));
            textGo.transform.SetParent(parent.transform, false);
            var rect = textGo.GetComponent<RectTransform>();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.sizeDelta = Vector2.zero;
            var tmp = textGo.GetComponent<TextMeshProUGUI>();
            tmp.text = text;
            tmp.fontSize = size;
            tmp.color = color;
            tmp.alignment = TextAlignmentOptions.Center;
            return tmp;
        }
    }
}
