import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { computeDesktopBubblePosition } from '../utils/desktopBubblePosition';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Upload, Sparkles } from 'lucide-react';
import { ANIMATIONS, EMOTIONS } from '../animationsRegistry';
import { API_BASE } from '../api';

// Default Window Dimensions Configuration (Electron Mode)
const ELECTRON_WINDOW_WIDTH = 320;
const ELECTRON_WINDOW_HEIGHT = 605;
const YUKI_SCALE_REDUCER = 0.9; // Reduce avatar size relative to window
const windowWidthExtra = 0;

// Yuki was here - feeling sassy and ready for snacks
const AvatarViewer = ({
  audioLevel,
  isThinking,
  isListening,
  isWalking = false,
  walkDirection = 0,
  expression = 'neutral',
  cpuLoad = 0,
  systemIdleTime = 0,
  onFileDropped = null,
  scale = 1.0,
  skinToneColor = '#FFE5E5',
  customAnimation = '',
  disabledAnimations = [],
  activeModel = 'default.vrm',
  enableRotation = true,
  autoResetRotation = false,
  visible = true,
  isBackendOnline = false,
  vrmDpr = 1.5,
  vrmFps = 40,
  cameraTracking = true,
  boredom = 0,
  energy = 55,
  playfulness = 50,
  mood = null,
  sleepState = 'active',
  onWakeCharacter = null,
  onAnimationTriggered = null
}) => {
  const isElectron = (window.electronAPI && window.electronAPI.isElectron) || (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const vrmRef = useRef(null);
  const requestRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const currentLoadIdRef = useRef(0);
  const fingerBonesRef = useRef({ left: {}, right: {} });
  const startGreetingRef = useRef(false);
  const startCustomAnimationRef = useRef(null);
  const mixerRef = useRef(null);
  const vrmaLoaderRef = useRef(null);
  const vrmaClipsCacheRef = useRef(new Map());
  const currentVrmaActionRef = useRef(null);
  const isVrmaActiveRef = useRef(false);
  const isVrmaUpperBodyRef = useRef(false);
  const vrmaFadeDurationRef = useRef(0.35);
  const vrmaExitBlendActiveRef = useRef(false);
  const vrmaExitProgressRef = useRef(0);
  const vrmaExitDurationRef = useRef(0.75);
  const vrmaExitSnapshotsRef = useRef(new Map());
  const vrmaExitScenePosSnapRef = useRef({ x: 0, y: 0, z: 0 });
  const initialHipsPosRef = useRef(null);
  const vrmaExitHipsPosSnapRef = useRef({ x: 0, y: 0, z: 0 });
  const ignoreTimeoutRef = useRef(null);
  const isIgnoringMouseRef = useRef(false);
  const cursorOffsetRef = useRef({ x: 0, y: 0 });
  const lastMouseMoveTimeRef = useRef(0);
  const canvasRectRef = useRef({ left: 0, top: 0, width: ELECTRON_WINDOW_WIDTH, height: ELECTRON_WINDOW_HEIGHT });
  const lastRaycastTimeRef = useRef(0);
  const lastRaycastHitRef = useRef(false);
  const customVrmBlobUrlRef = useRef(null);
  const rendererRef = useRef(null);
  const vrmDprRef = useRef(vrmDpr);
  const vrmFpsRef = useRef(vrmFps);

  // Hologram particle parameters
  const particleSystemRef = useRef(null);

  const audioLevelRef = useRef(audioLevel);
  const isThinkingRef = useRef(isThinking);
  const isListeningRef = useRef(isListening);
  const isWalkingRef = useRef(isWalking);
  const walkDirectionRef = useRef(walkDirection);
  const expressionRef = useRef(expression);
  const cpuLoadRef = useRef(cpuLoad);
  const systemIdleTimeRef = useRef(systemIdleTime);
  const sleepProgressRef = useRef(0.0);
  const scaleRef = useRef(scale);
  const skinToneRef = useRef(skinToneColor);
  const disabledAnimationsRef = useRef(disabledAnimations || []);
  const prevIsSpeakingRef = useRef(false);
  const prevIsRotatingRef = useRef(false);

  const activeModelRef = useRef(activeModel);
  const enableRotationRef = useRef(enableRotation);
  const autoResetRotationRef = useRef(autoResetRotation);
  const visibleRef = useRef(visible);
  const boredomRef = useRef(boredom);
  const energyRef = useRef(energy);
  const playfulnessRef = useRef(playfulness);
  const moodRef = useRef(mood);
  const sleepStateRef = useRef(sleepState);

  useEffect(() => {
    boredomRef.current = boredom;
  }, [boredom]);

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  useEffect(() => {
    playfulnessRef.current = playfulness;
  }, [playfulness]);

  const onWakeCharacterRef = useRef(onWakeCharacter);
  const onAnimationTriggeredRef = useRef(onAnimationTriggered);

  useEffect(() => {
    enableRotationRef.current = enableRotation;
  }, [enableRotation]);

  useEffect(() => {
    autoResetRotationRef.current = autoResetRotation;
  }, [autoResetRotation]);

  useEffect(() => {
    onAnimationTriggeredRef.current = onAnimationTriggered;
  }, [onAnimationTriggered]);

  useEffect(() => {
    onWakeCharacterRef.current = onWakeCharacter;
  }, [onWakeCharacter]);

  useEffect(() => {
    sleepStateRef.current = sleepState;
    if (sleepState !== 'sleeping' && sleepState !== 'napping') {
      sleepProgressRef.current = 0.0;
    }
  }, [sleepState]);

  useEffect(() => {
    if (isThinking) {
      if (sleepStateRef.current === 'sleeping' || sleepStateRef.current === 'napping') {
        sleepStateRef.current = 'active';
        sleepProgressRef.current = 0.0;
      }
    }
  }, [isThinking]);

  useEffect(() => {
    activeModelRef.current = activeModel;
  }, [activeModel]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    enableRotationRef.current = enableRotation;
  }, [enableRotation]);

  const cameraTrackingRef = useRef(cameraTracking);
  const isRotatingRef = useRef(false);

  useEffect(() => {
    cameraTrackingRef.current = cameraTracking;
  }, [cameraTracking]);

  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (activeModel) {
      loadModel(`${API_BASE}/api/models/vrm/files/${encodeURIComponent(activeModel)}?t=${Date.now()}`);
    }
  }, [activeModel]);

  useEffect(() => {
    disabledAnimationsRef.current = disabledAnimations || [];
  }, [disabledAnimations]);

  useEffect(() => {
    vrmDprRef.current = vrmDpr;
    if (rendererRef.current) {
      const targetRatio = parseFloat(vrmDpr) || 1.5;
      rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, targetRatio));
    }
  }, [vrmDpr]);

  useEffect(() => {
    vrmFpsRef.current = vrmFps;
  }, [vrmFps]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isWalkingRef.current = isWalking;
  }, [isWalking]);

  useEffect(() => {
    walkDirectionRef.current = walkDirection;
  }, [walkDirection]);

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  useEffect(() => {
    if ((!expression || expression === 'neutral') && mood?.expression && mood.expression !== 'neutral') {
      expressionRef.current = mood.expression;
    } else {
      expressionRef.current = expression || 'neutral';
    }
  }, [expression, mood]);

  useEffect(() => {
    cpuLoadRef.current = cpuLoad;
  }, [cpuLoad]);

  useEffect(() => {
    systemIdleTimeRef.current = systemIdleTime;
  }, [systemIdleTime]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    skinToneRef.current = skinToneColor;
  }, [skinToneColor]);

  useEffect(() => {
    if (vrmRef.current) {
      applySkinTone(vrmRef.current, skinToneColor);
    }
  }, [skinToneColor]);

  useEffect(() => {
    if (customAnimation && (typeof customAnimation === 'object' || customAnimation !== '')) {
      startCustomAnimationRef.current = customAnimation;
    }
  }, [customAnimation]);

  const [loading, setLoading] = useState(true);
  const [hasVrm, setHasVrm] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [modelName, setModelName] = useState("Sci-Fi Hologram Core");

  useEffect(() => {
    if (isBackendOnline && !hasVrm && activeModel) {
      loadModel(`${API_BASE}/api/models/vrm/files/${encodeURIComponent(activeModel)}?t=${Date.now()}`);
    }
  }, [isBackendOnline, hasVrm, activeModel]);

  useEffect(() => {
    if (vrmRef.current) {
      sanitizeExpressions(vrmRef.current);
    }
  }, [hasVrm, activeModel]);

  // Blend shape helper to support both VRM v0 and v1
  const setExpressionValue = (vrm, name, value) => {
    if (!vrm) return;

    const manager = vrm.expressionManager || vrm.blendShapeProxy;
    if (manager) {
      // Try name as-is first
      try {
        manager.setValue(name, value);
      } catch (_) { }

      // Fallback mappings for both VRM 0.x (uppercase / presets) and VRM 1.0 conventions
      const fallbacks = [];
      if (name === 'aa') fallbacks.push('ih', 'A', 'a', 'AA');
      else if (name === 'oh') fallbacks.push('O', 'o', 'OH');
      else if (name === 'blink') fallbacks.push('Blink', 'BLINK');
      else if (name === 'blinkLeft') fallbacks.push('blink_l', 'Blink_L', 'BLINK_L');
      else if (name === 'blinkRight') fallbacks.push('blink_r', 'Blink_R', 'BLINK_R');
      else if (name === 'happy') fallbacks.push('joy', 'Joy', 'JOY');
      else if (name === 'sad') fallbacks.push('sorrow', 'Sorrow', 'SORROW');
      else if (name === 'angry') fallbacks.push('anger', 'Anger', 'ANGRY');
      else if (name === 'surprised') fallbacks.push('surprise', 'Surprise', 'SURPRISED');
      else if (name === 'relaxed') fallbacks.push('Relaxed', 'relax', 'RELAXED');
      else if (name === 'browUp') fallbacks.push('brow_up', 'BrowUp', 'eyebrow_up', 'EyebrowUp', 'brow_raise', 'BrowRaise', 'BRW_Up');
      else if (name === 'browDown') fallbacks.push('brow_down', 'BrowDown', 'eyebrow_down', 'EyebrowDown', 'brow_furrow', 'BrowFurrow', 'brow_low', 'BrowLow', 'BRW_Down');

      for (const f of fallbacks) {
        try {
          manager.setValue(f, value);
        } catch (_) { }
      }
    }
  };

  const updateExpressions = (vrm) => {
    if (!vrm) return;
    const manager = vrm.expressionManager || vrm.blendShapeProxy;
    if (manager && typeof manager.update === 'function') {
      manager.update();
    }
  };

  // Sanitizes expressions on newly loaded VRM models so that 'relaxed' / 'happy' maintains open eyes,
  // and indexes all eye-closing morph targets to completely prevent double-blinking over closed eyes.
  const sanitizeExpressions = (vrm) => {
    if (!vrm) return;
    const manager = vrm.expressionManager || vrm.blendShapeProxy;
    if (!manager) return;

    const blinkMorphIndices = new Set();
    const allEyeClosingIndices = new Set();
    const blinkPrimitives = new Set();

    const getExpr = (name) => {
      if (typeof manager.getExpression === 'function') return manager.getExpression(name);
      if (manager.expressionMap) return manager.expressionMap[name];
      if (typeof manager.getBlendShapeGroup === 'function') return manager.getBlendShapeGroup(name);
      return null;
    };

    // 1. Identify all blink morph targets across blink expressions
    ['blink', 'blinkLeft', 'blinkRight', 'blink_l', 'blink_r', 'Blink', 'BLINK'].forEach((name) => {
      const expr = getExpr(name);
      if (expr && expr._binds) {
        expr._binds.forEach((bind) => {
          if (bind.index !== undefined) {
            blinkMorphIndices.add(bind.index);
            allEyeClosingIndices.add(bind.index);
            if (bind.primitives && Array.isArray(bind.primitives)) {
              bind.primitives.forEach((p) => blinkPrimitives.add(p));
            }
          }
        });
      } else if (expr && expr.binds) {
        expr.binds.forEach((bind) => {
          if (bind.index !== undefined) {
            blinkMorphIndices.add(bind.index);
            allEyeClosingIndices.add(bind.index);
          }
        });
      }
    });

    // 2. Discover ALL eye-closing / squinting morph targets across all meshes in the scene
    vrm.scene.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary) {
        blinkPrimitives.add(obj);
        for (const [name, idx] of Object.entries(obj.morphTargetDictionary)) {
          const lower = name.toLowerCase();
          if (
            /eye.*(close|shut|blink|relax|joy|fun|squint|sorrow)/i.test(lower) ||
            /(close|shut|blink).*eye/i.test(lower) ||
            lower.includes('fcl_all_fun') ||
            lower.includes('fcl_all_joy') ||
            lower.includes('fcl_all_sorrow')
          ) {
            allEyeClosingIndices.add(idx);
          }
        }
      }
    });

    const getMorphName = (mesh, index) => {
      if (!mesh || !mesh.morphTargetDictionary) return '';
      for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
        if (idx === index) return name;
      }
      return '';
    };

    const isEyeClosingMorphName = (name, index) => {
      if (blinkMorphIndices.has(index)) return true;
      const lower = (name || '').toLowerCase();
      return (
        /eye.*(close|shut|blink|relax|joy|fun|squint|sorrow)/i.test(lower) ||
        /(close|shut|blink).*eye/i.test(lower) ||
        lower.includes('fcl_eye_close') ||
        lower.includes('eye_close') ||
        lower.includes('eye_blink') ||
        lower.includes('eye_relax') ||
        lower.includes('eye_fun') ||
        lower.includes('eye_joy')
      );
    };

    // Helper to decompose compound ALL morphs (e.g. Fcl_ALL_Fun -> Fcl_MTH_Fun + Fcl_BRW_Fun)
    const decomposeCompoundBind = (bind) => {
      if (!bind || !bind.primitives || bind.primitives.length === 0) return null;
      const mesh = bind.primitives[0];
      const morphName = getMorphName(mesh, bind.index);
      const lower = morphName.toLowerCase();

      // Check if this is an all-in-one morph target like Fcl_ALL_Fun or Fcl_ALL_Joy
      if (lower.startsWith('fcl_all_') || lower.includes('_all_') || lower.startsWith('all_')) {
        const suffix = morphName.replace(/^.*all_/i, ''); // e.g. "Fun", "Joy"
        const dict = mesh.morphTargetDictionary || {};
        const newBinds = [];

        // Find matching MOUTH morph (e.g. Fcl_MTH_Fun, Fcl_MTH_Joy, Fcl_MTH_Smile)
        const mouthName = Object.keys(dict).find((k) =>
          new RegExp(`^(fcl_)?mth_${suffix}$`, 'i').test(k) ||
          new RegExp(`^mouth_${suffix}$`, 'i').test(k) ||
          new RegExp(`^mth_${suffix}$`, 'i').test(k)
        );
        if (mouthName && dict[mouthName] !== undefined) {
          const mthIndex = dict[mouthName];
          const bindCtor = bind.constructor || Object;
          const newBind = new bindCtor({
            primitives: bind.primitives,
            index: mthIndex,
            weight: bind.weight
          });
          newBinds.push(newBind);
        }

        // Find matching BROW morph (e.g. Fcl_BRW_Fun, Fcl_BRW_Joy)
        const browName = Object.keys(dict).find((k) =>
          new RegExp(`^(fcl_)?brw_${suffix}$`, 'i').test(k) ||
          new RegExp(`^brow_${suffix}$`, 'i').test(k) ||
          new RegExp(`^brw_${suffix}$`, 'i').test(k)
        );
        if (browName && dict[browName] !== undefined) {
          const brwIndex = dict[browName];
          const bindCtor = bind.constructor || Object;
          const newBind = new bindCtor({
            primitives: bind.primitives,
            index: brwIndex,
            weight: bind.weight
          });
          newBinds.push(newBind);
        }

        // Return the decomposed mouth + brow binds (excluding the eye closing bind!)
        if (newBinds.length > 0) {
          console.log(`[AvatarViewer] Decomposed compound morph '${morphName}' into [${mouthName || ''}, ${browName || ''}] with eyes open.`);
          return newBinds;
        }
      }
      return null;
    };

    // 3. Sanitize 'relaxed' (and aliases) and 'happy' so eyes stay open
    ['relaxed', 'Relaxed', 'relax', 'RELAXED', 'happy', 'Joy', 'joy'].forEach((exprName) => {
      const expr = getExpr(exprName);
      if (expr) {
        const bindsList = expr._binds || expr.binds;
        if (bindsList && bindsList.length > 0) {
          let updatedBinds = [];
          let changed = false;

          for (const bind of bindsList) {
            const mesh = bind.primitives ? bind.primitives[0] : null;
            const morphName = getMorphName(mesh, bind.index);

            // Check if compound ALL_ morph
            const decomp = decomposeCompoundBind(bind);
            if (decomp) {
              updatedBinds.push(...decomp);
              changed = true;
              continue;
            }

            // Check if individual eye closing morph
            if (isEyeClosingMorphName(morphName, bind.index)) {
              console.log(`[AvatarViewer] Removed eye-closing bind '${morphName}' (index ${bind.index}) from '${exprName}'.`);
              changed = true;
              continue;
            }

            // Keep other binds (e.g. mouth, brow, materials)
            updatedBinds.push(bind);
          }

          if (changed) {
            // Fallback: If no mouth morph remained, look for any mouth smile in mesh
            const hasMouth = updatedBinds.some((b) => {
              const m = b.primitives ? b.primitives[0] : null;
              return /mth|mouth|lip/i.test(getMorphName(m, b.index));
            });

            if (!hasMouth && bindsList[0] && bindsList[0].primitives && bindsList[0].primitives[0]) {
              const mesh = bindsList[0].primitives[0];
              const dict = mesh.morphTargetDictionary || {};
              const smileKey = Object.keys(dict).find((k) =>
                /^(fcl_)?mth_(smile|fun|joy|neutral)$/i.test(k) ||
                /^mouth_(smile|fun|joy)$/i.test(k) ||
                /smile/i.test(k)
              );
              if (smileKey && dict[smileKey] !== undefined) {
                const bindCtor = bindsList[0].constructor || Object;
                const smileBind = new bindCtor({
                  primitives: bindsList[0].primitives,
                  index: dict[smileKey],
                  weight: 1.0
                });
                updatedBinds.push(smileBind);
                console.log(`[AvatarViewer] Added fallback mouth smile '${smileKey}' to '${exprName}'.`);
              }
            }

            if (expr._binds) expr._binds = updatedBinds;
            else if (expr.binds) expr.binds = updatedBinds;
          }
        }
      }
    });

    // 4. Cache for per-frame blink checks
    vrm._blinkMorphIndices = blinkMorphIndices;
    vrm._allEyeClosingIndices = allEyeClosingIndices;
    vrm._blinkPrimitives = Array.from(blinkPrimitives);
  };

  const getBoneNode = (vrm, name) => {
    if (!vrm || !vrm.humanoid) return null;

    // 1. Try standard camelCase name (VRM 1.0)
    let bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) return bone;

    // 2. Try PascalCase name (VRM 0.x / legacy)
    const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
    bone = vrm.humanoid.getNormalizedBoneNode(pascalName);
    if (bone) return bone;

    // 3. Fallback to raw bone node if normalized isn't found
    if (typeof vrm.humanoid.getRawBoneNode === 'function') {
      bone = vrm.humanoid.getRawBoneNode(name) || vrm.humanoid.getRawBoneNode(pascalName);
      if (bone) return bone;
    }

    // 4. Fallback to older three-vrm bone node method if exists
    if (typeof vrm.humanoid.getBoneNode === 'function') {
      try {
        bone = vrm.humanoid.getBoneNode(name) || vrm.humanoid.getBoneNode(pascalName);
        if (bone) return bone;
      } catch (_) { }
    }

    return null;
  };

  const handleVrmFile = (file) => {
    // Revoke previous custom VRM blob URL to prevent memory leak
    if (customVrmBlobUrlRef.current) {
      URL.revokeObjectURL(customVrmBlobUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    customVrmBlobUrlRef.current = url;
    setModelName(file.name);
    loadModel(url);
  };

  const disposeVrm = (vrm) => {
    if (!vrm) return;
    try {
      if (typeof vrm.dispose === 'function') {
        vrm.dispose();
      }
    } catch (e) {
      console.warn("[AvatarViewer] vrm.dispose() warning:", e);
    }
    try {
      if (vrm.scene) {
        VRMUtils.deepDispose(vrm.scene);
      }
    } catch (e) {
      console.warn("[AvatarViewer] VRMUtils.deepDispose warning:", e);
    }
    if (vrm.scene) {
      disposeObject(vrm.scene);
    }
  };

  const disposeObject = (obj) => {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.geometry) {
        try { child.geometry.dispose(); } catch (_) { }
        child.geometry = null;
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          for (const key of Object.keys(mat)) {
            const value = mat[key];
            if (value && typeof value.dispose === 'function') {
              try { value.dispose(); } catch (_) { }
            }
          }
          try { mat.dispose(); } catch (_) { }
        }
        child.material = null;
      }
      if (child.skeleton) {
        try { child.skeleton.dispose(); } catch (_) { }
        child.skeleton = null;
      }
    });
  };

  const applySkinTone = (vrm, colorHex) => {
    if (!vrm || !vrm.scene) return;

    // Parse chosen color and calculate luminance (to darken/suppress rim lights accordingly)
    const tintColor = new THREE.Color(colorHex || '#ffffff');
    const luminance = tintColor.r * 0.299 + tintColor.g * 0.587 + tintColor.b * 0.114;

    vrm.scene.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          if (!mat || !mat.name) return;

          const nameLower = mat.name.toLowerCase();
          const isSkin = nameLower.includes('skin') ||
            nameLower.includes('hand') ||
            nameLower.includes('wrist') ||
            nameLower.includes('finger') ||
            nameLower.includes('nail') ||
            (nameLower.includes('arm') && !nameLower.includes('band') && !nameLower.includes('guard') && !nameLower.includes('armor') && !nameLower.includes('warm')) ||
            (nameLower.includes('face') && !nameLower.includes('eye') && !nameLower.includes('brow') && !nameLower.includes('line') && !nameLower.includes('extra') && !nameLower.includes('white') && !nameLower.includes('iris') && !nameLower.includes('mouth') && !nameLower.includes('tooth') && !nameLower.includes('teeth') && !nameLower.includes('tongue')) ||
            (nameLower.includes('body') && !nameLower.includes('cloth') && !nameLower.includes('hair') && !nameLower.includes('acc') && !nameLower.includes('pant') && !nameLower.includes('shirt') && !nameLower.includes('dress') && !nameLower.includes('shoe') && !nameLower.includes('socks'));

          if (isSkin) {
            // Adjust main color
            if (mat.color && typeof mat.color.copy === 'function') {
              if (!mat.userData.origColor) {
                mat.userData.origColor = mat.color.clone();
              }
              mat.color.copy(mat.userData.origColor).multiply(tintColor);
            }

            // Adjust MToon shade color
            const shadeColorObj = mat.shadeColorFactor || mat.shadeColor;
            if (shadeColorObj && typeof shadeColorObj.copy === 'function') {
              if (!mat.userData.origShadeColor) {
                mat.userData.origShadeColor = shadeColorObj.clone();
              }
              shadeColorObj.copy(mat.userData.origShadeColor).multiply(tintColor);
            }

            // Adjust rim light color to prevent blue/purple outlines on dark skin
            const rimColorObj = mat.rimColorFactor || mat.rimColor;
            if (rimColorObj && typeof rimColorObj.copy === 'function') {
              if (!mat.userData.origRimColor) {
                mat.userData.origRimColor = rimColorObj.clone();
              }
              rimColorObj.copy(mat.userData.origRimColor).multiplyScalar(luminance);
            }

            mat.needsUpdate = true;
          }
        });
      }
    });
  };

  const getVrmaLoader = () => {
    if (!vrmaLoaderRef.current) {
      const loader = new GLTFLoader();
      loader.register((parser) => {
        const plugin = new VRMAnimationLoaderPlugin(parser);
        const origAfterRoot = plugin.afterRoot.bind(plugin);
        plugin.afterRoot = async (gltf) => {
          const ext = parser.json?.extensions?.VRMC_vrm_animation;
          if (ext && !ext.specVersion) {
            ext.specVersion = '1.0';
          }
          return origAfterRoot(gltf);
        };
        return plugin;
      });
      vrmaLoaderRef.current = loader;
    }
    return vrmaLoaderRef.current;
  };

  const resolveVrmaUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('file://')) {
      return url;
    }
    const cleaned = url.replace(/^\/+/, '');
    return `./${cleaned}`;
  };

  const playVrmaClip = async (matchingAnim, vrm) => {
    if (!vrm || !matchingAnim?.vrmaUrl) return;
    const mixer = mixerRef.current;
    if (!mixer) return;

    const targetUrl = resolveVrmaUrl(matchingAnim.vrmaUrl);
    const isUpperBody = matchingAnim.upperBodyOnly === true || (
      matchingAnim.upperBodyOnly !== false &&
      !['jumping', 'squat_stretch', 'show_body', 'model_pose'].includes(matchingAnim.name)
    );
    const cacheKey = `${targetUrl}${isUpperBody ? '_upper' : '_full'}`;

    try {
      let clip = vrmaClipsCacheRef.current.get(cacheKey);
      if (!clip) {
        let baseClip = vrmaClipsCacheRef.current.get(targetUrl);
        if (!baseClip) {
          const loader = getVrmaLoader();
          const gltf = await new Promise((resolve, reject) => {
            loader.load(targetUrl, resolve, undefined, reject);
          });
          const vrmAnim = gltf.userData.vrmAnimation || gltf.userData.vrmAnimations?.[0];
          if (!vrmAnim) {
            console.warn('[AvatarViewer] No VRMAnimation in file:', targetUrl);
            return;
          }
          baseClip = createVRMAnimationClip(vrmAnim, vrm);
          vrmaClipsCacheRef.current.set(targetUrl, baseClip);
        }

        if (isUpperBody) {
          const LEG_BONE_NAMES = [
            'leftUpperLeg', 'rightUpperLeg',
            'leftLowerLeg', 'rightLowerLeg',
            'leftFoot', 'rightFoot',
            'leftToes', 'rightToes'
          ];
          const legNodeNames = new Set();
          LEG_BONE_NAMES.forEach(b => {
            const node = vrm.humanoid?.getNormalizedBoneNode?.(b) || vrm.humanoid?.getBoneNode?.(b);
            if (node?.name) legNodeNames.add(node.name);
            legNodeNames.add(b);
            legNodeNames.add(`normalized_${b}`);
          });
          const hipsNode = vrm.humanoid?.getNormalizedBoneNode?.('hips') || vrm.humanoid?.getBoneNode?.('hips');
          const hipsNodeName = hipsNode?.name || 'hips';

          const filteredTracks = baseClip.tracks.filter(track => {
            const targetName = track.name.split('.')[0];
            if (legNodeNames.has(targetName)) return false;
            if ((targetName === hipsNodeName || targetName.toLowerCase().includes('hips')) && track.name.endsWith('.position')) return false;
            const lower = track.name.toLowerCase();
            if (lower.includes('upperleg') || lower.includes('lowerleg') || lower.includes('foot') || lower.includes('toe')) return false;
            return true;
          });
          clip = new THREE.AnimationClip(`${baseClip.name}_upper`, baseClip.duration, filteredTracks);
        } else {
          clip = baseClip;
        }
        vrmaClipsCacheRef.current.set(cacheKey, clip);
      }

      if (!clip) return;

      // Clear any active exit blend so the new animation takes over cleanly
      vrmaExitBlendActiveRef.current = false;
      vrmaExitSnapshotsRef.current.clear();

      const fadeDuration = matchingAnim.fadeDuration ?? (isUpperBody ? 0.35 : 0.75);
      vrmaFadeDurationRef.current = fadeDuration;

      // Cross-fade from previous action if active
      if (currentVrmaActionRef.current && currentVrmaActionRef.current.isRunning()) {
        currentVrmaActionRef.current.fadeOut(fadeDuration);
      }

      const action = mixer.clipAction(clip);
      action.reset();
      action.clampWhenFinished = true;
      if (matchingAnim.loop) {
        action.setLoop(THREE.LoopRepeat);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
      }
      action.fadeIn(fadeDuration).play();
      currentVrmaActionRef.current = action;
      isVrmaActiveRef.current = true;
      isVrmaUpperBodyRef.current = isUpperBody;
    } catch (err) {
      console.error('[AvatarViewer] Failed to load/play VRMA animation:', matchingAnim.name, err);
      isVrmaActiveRef.current = false;
      isVrmaUpperBodyRef.current = false;
    }
  };

  const loadModel = (url) => {
    setLoading(true);
    setModelError(false);

    currentLoadIdRef.current += 1;
    const loadId = currentLoadIdRef.current;

    // Dispose old VRM if exists
    if (vrmRef.current) {
      const oldVrm = vrmRef.current;
      vrmRef.current = null;

      if (oldVrm.scene) {
        const parent = oldVrm.scene.parent;
        if (parent) {
          parent.remove(oldVrm.scene);
        } else if (window.vrmScene) {
          window.vrmScene.remove(oldVrm.scene);
        }
      }

      disposeVrm(oldVrm);

      if (mixerRef.current) {
        try {
          mixerRef.current.stopAllAction();
          if (oldVrm.scene) {
            mixerRef.current.uncacheRoot(oldVrm.scene);
          }
        } catch (_) { }
        mixerRef.current = null;
      }
      vrmaClipsCacheRef.current.clear();
      currentVrmaActionRef.current = null;
      isVrmaActiveRef.current = false;

      // Clear Three.js texture/file caches
      THREE.Cache.clear();

      // Force V8 to collect the disposed textures and geometries immediately
      if (window.gc) {
        setTimeout(() => {
          try {
            window.gc();
            console.log("[AvatarViewer] Garbage collection executed to flush old model memory.");
          } catch (_) { }
        }, 50);
      }
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        if (loadId !== currentLoadIdRef.current) {
          // superseded or unmounted
          if (gltf.scene) {
            disposeObject(gltf.scene);
          }
          return;
        }

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          console.error("The loaded model is not a valid VRM model:", gltf);
          setHasVrm(false);
          setLoading(false);
          setModelError(true);
          return;
        }

        const extensionsUsed = gltf.parser?.json?.extensionsUsed || [];
        const isVRM1 = extensionsUsed.some(ext => ext.includes('VRMC_vrm'));
        vrm.isVRM1 = isVRM1;

        // --- VRAM Optimization Triggers ---
        if (isElectron) {
          try {
            VRMUtils.combineSkeletons(vrm.scene);
            VRMUtils.combineMorphs(vrm);
          } catch (err) {
            console.warn("VRMUtils optimization failed:", err);
          }
        }

        sanitizeExpressions(vrm);
        vrmRef.current = vrm;
        const initialHips = getBoneNode(vrm, 'hips');
        if (initialHips) {
          initialHipsPosRef.current = initialHips.position.clone();
        }
        mixerRef.current = new THREE.AnimationMixer(vrm.scene);
        setHasVrm(true);
        setLoading(false);

        // --- FIX A START: Force Advanced Mipmap Filtering ---
        if (vrm.scene && isElectron) {
          vrm.scene.traverse((child) => {
            if (child.isMesh && child.material) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];

              materials.forEach((mat) => {
                // Target core rendering maps along with custom Pixiv MToon shader extensions
                const textureKeys = [
                  'map',
                  'shadeTexture',
                  'rimTexture',
                  'outlineWidthMultiplyTexture',
                  'shadeMultiplierTexture'
                ];

                textureKeys.forEach((key) => {
                  if (mat[key] && mat[key].isTexture) {
                    mat[key].generateMipmaps = false;               // Disable mipmaps to save VRAM and System RAM (prevents 33% expansion)
                    mat[key].minFilter = THREE.LinearFilter;        // Use basic LinearFilter instead of Mipmap filters
                    mat[key].magFilter = THREE.LinearFilter;
                    mat[key].needsUpdate = true;
                  }
                });
              });
            }
          });
        }
        // --- FIX A END ---

        // Turn around the avatar to face the camera
        if (vrm.scene) {
          const isVRM1 = !!vrm.isVRM1;
          vrm.scene.rotation.y = isVRM1 ? 0 : Math.PI;

          // Disable frustum culling so hair/clothing doesn't clip
          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
          });

          // Add to main global scene
          if (window.vrmScene) {
            window.vrmScene.add(vrm.scene);
          }

          // Apply scale and update matrix world immediately so we calculate correct world coordinates on load
          vrm.scene.scale.set(scaleRef.current, scaleRef.current, scaleRef.current);
          vrm.scene.updateMatrixWorld(true);
        }

        // Apply skin tone on load
        applySkinTone(vrm, skinToneRef.current);

        // Cache all finger bones for high-performance frame-level animations
        const fingers = ['index', 'middle', 'ring', 'little', 'thumb'];
        const joints = ['Proximal', 'Intermediate', 'Distal'];
        const cachedBones = { left: {}, right: {} };

        ['left', 'right'].forEach((side) => {
          fingers.forEach((finger) => {
            cachedBones[side][finger] = [];
            joints.forEach((joint) => {
              const boneName = `${side}${finger.charAt(0).toUpperCase() + finger.slice(1)}${joint}`;
              const boneNode = getBoneNode(vrm, boneName);
              if (boneNode) {
                cachedBones[side][finger].push(boneNode);
              }
            });
          });
        });
        fingerBonesRef.current = cachedBones;

        // Auto-position camera to look at the face/body
        const headNode = getBoneNode(vrm, 'head');
        if (headNode && window.vrmControls && window.vrmCamera) {
          const isElectron = window.electronAPI && window.electronAPI.isElectron;
          const headPos = new THREE.Vector3();
          headNode.getWorldPosition(headPos);
          if (isElectron) {
            // Look at mid-torso, shifted down slightly to maximize headroom above head
            window.vrmControls.target.set(headPos.x, headPos.y - 0.55 * scaleRef.current, headPos.z);
            window.vrmCamera.position.set(headPos.x, headPos.y - 0.45 * scaleRef.current, headPos.z + 2.2 * scaleRef.current);
          } else {
            // Web browser mode: look close-up at her face, scaled proportionally
            window.vrmControls.target.set(headPos.x, headPos.y - 0.1 * scaleRef.current, headPos.z);
            window.vrmCamera.position.set(headPos.x, headPos.y, headPos.z + 0.85 * scaleRef.current);
          }
          window.vrmControls.update();
        }
        // startGreetingRef.current = true; // Disabled startup greeting wave for now

        // Trigger post-load garbage collection to reclaim memory spike right away
        if (isElectron && window.gc) {
          setTimeout(() => {
            try {
              window.gc();
              console.log("[AvatarViewer] Post-load garbage collection executed.");
            } catch (_) { }
          }, 3000);
        }

        // Trigger backend system-level memory optimization to reclaim Normal RAM (System RAM)
        if (isElectron) {
          const optimizeRAM = async () => {
            try {
              await fetch(`${API_BASE}/api/system/optimize_memory`, { method: 'POST' });
              console.log("[AvatarViewer] Triggered backend memory optimization to free Normal RAM.");
            } catch (err) {
              console.error("[AvatarViewer] Memory optimization error:", err);
            }
          };

          // Double-tap the RAM optimization to ensure late shader compilations are also cleared from System RAM
          setTimeout(optimizeRAM, 2000);
          setTimeout(optimizeRAM, 6000);
        }
      },
      (progress) => {
        // Loading progress...
      },
      (error) => {
        if (loadId !== currentLoadIdRef.current) return;
        console.warn("Could not load VRM avatar from url, falling back to Hologram Core.", error);
        setHasVrm(false);
        setLoading(false);
        setModelError(true);
      }
    );
  };

  useEffect(() => {
    let _mouseTracking = true;
    let _clickthrough = true;

    let isRotating = false;
    let lastRotationTime = Date.now();

    const onControlsStart = () => {
      if (isElectron && enableRotationRef.current) {
        isRotating = true;
        isRotatingRef.current = true;
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
          window.electronAPI.setIgnoreMouseEvents(false);
          isIgnoringMouseRef.current = false;
        }
      }
    };
    const onControlsEnd = () => {
      isRotating = false;
      isRotatingRef.current = false;
    };
    const handleContextMenu = (e) => {
      if (isElectron && enableRotationRef.current) {
        e.preventDefault();
      }
    };

    window.yukiDebugToggles = {
      get mouseTracking() {
        return _mouseTracking;
      },
      set mouseTracking(val) {
        _mouseTracking = val;
        console.log(`[Yuki Debug] mouseTracking set to ${val}`);
        if (!val) {
          isMouseInWindow = false;
          cursorOffsetRef.current = { x: 0, y: 0 };
        }
      },
      get clickthrough() {
        return _clickthrough;
      },
      set clickthrough(val) {
        _clickthrough = val;
        console.log(`[Yuki Debug] clickthrough set to ${val}`);
        if (!val) {
          if (ignoreTimeoutRef.current) {
            clearTimeout(ignoreTimeoutRef.current);
            ignoreTimeoutRef.current = null;
          }
          if (isIgnoringMouseRef.current && window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(false);
            isIgnoringMouseRef.current = false;
          }
        }
      },
      get cameraTracking() {
        // cameraTrackingRef is the canonical source of truth.
        // It is updated by: the IPC pipeline from Settings window, and local toggles.
        return cameraTrackingRef.current !== false;
      },
      set cameraTracking(val) {
        cameraTrackingRef.current = !!val;
        try { localStorage.setItem('yuki-camera-tracking', String(!!val)); } catch { }
        console.log(`[Yuki Debug] cameraTracking set to ${val}`);
      },
      dragPhysics: true,
      floatingIdle: true,
      wind: true,
      hoverRaycast: false,
      breathing: true,
      weightShift: true,
      microFidget: true,
      lookAround: true,
      fingerFidget: true,
      saccades: true,
      blinking: true,
      lipsync: true,
      springBones: true,
      orbitControls: true,
      particles: true,
      rendering: true,
      status: function () {
        console.table(Object.keys(this)
          .filter(k => typeof this[k] !== 'function')
          .reduce((acc, k) => {
            acc[k] = this[k];
            return acc;
          }, {})
        );
      },
      reset: function () {
        this.mouseTracking = true;
        this.dragPhysics = true;
        this.clickthrough = true;
        this.floatingIdle = true;
        this.wind = true;
        this.hoverRaycast = false;
        this.breathing = true;
        this.weightShift = true;
        this.microFidget = true;
        this.lookAround = true;
        this.fingerFidget = true;
        this.saccades = true;
        this.blinking = true;
        this.lipsync = true;
        this.springBones = true;
        this.orbitControls = true;
        this.particles = true;
        this.rendering = true;
        console.log("[Yuki Debug] Toggles reset to defaults.");
      }
    };

    // 1. Setup Three Scene
    const scene = new THREE.Scene();
    window.vrmScene = scene;

    // Add space dust / star background (only in browser web mode, disable in desktop transparent mode)
    if (!isElectron) {
      const bgGeometry = new THREE.BufferGeometry();
      const count = 300;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i++) {
        positions[i] = (Math.random() - 0.5) * 8;
      }
      bgGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const bgMaterial = new THREE.PointsMaterial({
        size: 0.015,
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.3
      });
      const backgroundStars = new THREE.Points(bgGeometry, bgMaterial);
      scene.add(backgroundStars);
    }

    // 2. Setup Camera
    const camera = new THREE.PerspectiveCamera(
      // Wider FOV in Electron to capture full body in the window
      isElectron ? 55 : 45,
      isElectron
        ? window.innerWidth / window.innerHeight
        : containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      20.0
    );
    // In Electron: position camera low and far back to see full body including legs
    camera.position.set(0, (isElectron ? 1.55 : 1.35) * scale, (isElectron ? 2.2 : 1.2) * scale);
    window.vrmCamera = camera;

    // 3. Setup Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    rendererRef.current = renderer;
    // CRITICAL: set clear color to fully transparent so the desktop shows through
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(
      isElectron ? window.innerWidth : containerRef.current.clientWidth,
      isElectron ? window.innerHeight : containerRef.current.clientHeight
    );
    const targetDpr = parseFloat(vrmDprRef.current) || 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, targetDpr)); // Dynamic resolution pixel ratio
    renderer.shadowMap.enabled = !isElectron; // shadows cause issues on transparent bg

    // Cache the initial canvas rect to avoid layout thrashing in handleMouseMove
    setTimeout(() => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        canvasRectRef.current = {
          left: rect.left,
          top: rect.top,
          width: rect.width || 1,
          height: rect.height || 1
        };
      }
    }, 100);

    // 4. Setup OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 5.0;
    controls.minDistance = 0.3;
    // In Electron: target mid-body so full character is visible
    controls.target.set(0, (isElectron ? 0.75 : 1.2) * scale, 0);

    // Disable OrbitControls in desktop mode to allow window dragging to work
    if (isElectron) {
      if (enableRotationRef.current) {
        controls.enabled = true;
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.NONE,
          MIDDLE: THREE.MOUSE.NONE,
          RIGHT: THREE.MOUSE.ROTATE
        };
      } else {
        controls.enabled = false;
      }
    } else {
      controls.enabled = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
    }
    window.vrmControls = controls;

    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('end', onControlsEnd);
    canvasRef.current?.addEventListener('contextmenu', handleContextMenu);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(0, 5, 1.5);
    scene.add(dirLight);

    const accentLight = new THREE.PointLight(0xc084fc, 0.8, 5);
    accentLight.position.set(0, 4, 1.5);
    scene.add(accentLight);

    // 6. Hologram Core Particle Visualizer Setup
    const holoGeometry = new THREE.SphereGeometry(0.2, 32, 32);
    const holoMaterial = new THREE.PointsMaterial({
      size: 0.008,
      color: 0x2dd4bf,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    const holoCore = new THREE.Points(holoGeometry, holoMaterial);
    holoCore.position.set(0, 1.2, 0);
    scene.add(holoCore);
    particleSystemRef.current = holoCore;

    // A ring around the holoCore
    const ringGeometry = new THREE.RingGeometry(0.3, 0.31, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(0, 1.2, 0);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    let model_choice = ["default.vrm", "mizuki.vrm", "mixup.vrm", "mixup with hat.vrm", "trial.vrm", "whai.vrm"]

    // 7. Load default VRM model
    // loadModel('/models/default.vrm');0
    // loadModel('/models/ayame.vrm');1
    // loadModel('/models/kanata.vrm');2
    // loadModel('/models/laplus.vrm');3
    // loadModel('/models/laplus_no_coat.vrm');4
    // loadModel('/models/nene.vrm');5
    // loadModel('/models/miko.vrm');6
    // loadModel('/models/pekora.vrm');7
    // loadModel('/models/suisei.vrm');8
    // loadModel('/models/watame.vrm');9
    // loadModel('/models/yuki.vrm');10
    // loadModel('/models/timekeeper_cookie.vrm');11
    loadModel(`${API_BASE}/api/models/vrm/files/${encodeURIComponent(activeModelRef.current)}?t=${Date.now()}`);

    // 8. Animation Loop variables
    let blinkTimer = 0;
    let nextBlinkTime = 2 + Math.random() * 3;
    let isBlinking = false;
    let blinkProgress = 0;

    // Fidget/Look around variables
    let lookTimer = 0;
    let nextLookTime = 5 + Math.random() * 8;
    let lookState = 'idle'; // 'idle', 'turning', 'holding', 'returning'
    let lookTargetX = 0;
    let lookTargetY = 0;
    let currentLookX = 0;
    let currentLookY = 0;
    let lookHoldTimer = 0;

    // Gaze-at-user cycling variables
    let gazeAtUserTimer = 0;
    let gazeAtUserDuration = 5 + Math.random() * 10;
    let alwaysLookingAtYou = true;

    // Post-orbit rest: keep looking at camera for a few seconds after orbit ends
    let postOrbitRestTimer = 0;
    let postOrbitRestDuration = 5 + Math.random() * 5;

    // Eye saccade variables
    let saccadeTimer = 0;
    let nextSaccadeTime = 0.2 + Math.random() * 0.3;
    let saccadeX = 0;
    let saccadeY = 0;

    // Micro-fidget active posture shifting variables
    let microFidgetTimer = 0;
    let nextMicroFidgetTime = 15 + Math.random() * 20;
    let microFidgetActive = false;
    let microFidgetProgress = 0;
    let microFidgetDuration = 2.5;

    // Head spring-damper velocity variables
    let lookVelocityX = 0;
    let lookVelocityY = 0;

    // Eye look tracking variables (separate from head for lag-lead)
    let currentGazeX = 0;
    let currentGazeY = 0;

    // Smooth roll tracking (Z-axis, not covered by spring-damper)
    let currentLookZ = 0;

    // Double-blink state
    let pendingDoubleBlink = false;
    let doubleBlinkDelay = 0;

    // Wink animation variables
    let winkStage = 'idle'; // 'idle', 'closing', 'holding', 'opening', 'completed'
    let winkProgress = 0;
    let winkHoldTimer = 0;
    let winkVal = 0;

    // Screen glass knocking variables
    let knockActive = false;
    let knockTimer = 0;
    const knockDuration = 1.2;

    // Smooth expression transition values (initialized close to neutral defaults)
    let currentHappy = 0.1;
    let currentSad = 0.0;
    let currentAngry = 0.0;
    let currentSurprised = 0.0;
    let currentRelaxed = 0.0;
    let currentBrowUp = 0.0;
    let currentBrowDown = 0.0;

    // Inactivity & Idle animations variables
    let inactivityTimer = 0;
    let nextIdleInterval = 18.0 + Math.random() * 14.0; // 18s - 32s organic interval
    const recentIdleHistory = []; // Anti-repeat history buffer
    let idleAnimState = 'none';
    let idleAnimProgress = 0;
    let idleAnimDuration = 4.0;

    const ALL_HUMANOID_BONES = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
    ];

    const triggerVrmaExitBlend = (vrm) => {
      if (!vrm) return;
      vrmaExitSnapshotsRef.current.clear();
      ALL_HUMANOID_BONES.forEach(bName => {
        const node = getBoneNode(vrm, bName);
        if (node) {
          vrmaExitSnapshotsRef.current.set(node, {
            x: node.rotation.x,
            y: node.rotation.y,
            z: node.rotation.z
          });
        }
      });

      if (vrm.scene) {
        vrmaExitScenePosSnapRef.current = {
          x: vrm.scene.position.x,
          y: vrm.scene.position.y,
          z: vrm.scene.position.z
        };
      }
      const hipsNode = getBoneNode(vrm, 'hips');
      if (hipsNode) {
        vrmaExitHipsPosSnapRef.current = {
          x: hipsNode.position.x,
          y: hipsNode.position.y,
          z: hipsNode.position.z
        };
      }

      vrmaExitBlendActiveRef.current = true;
      vrmaExitDurationRef.current = Math.max(0.65, vrmaFadeDurationRef.current || 0.5);
      vrmaExitProgressRef.current = 0;

      isVrmaActiveRef.current = false;
      isVrmaUpperBodyRef.current = false;
      if (currentVrmaActionRef.current) {
        currentVrmaActionRef.current.stop();
        currentVrmaActionRef.current = null;
      }
    };

    // Raycaster for mouse click-through detection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    let isDragging = false;
    let dragVelocityX = 0;
    let dragVelocityY = 0;
    let lastDragX = 0;
    let lastDragY = 0;
    let dragSwayAngle = 0;
    let dragPitchAngle = 0;
    let dragDangleTimer = 0;
    let dragStateProgress = 0;
    let orbitSwayAngle = 0;
    let orbitVelX = 0;
    let lastCameraAzimuth = undefined;

    let startX = 0;
    let startY = 0;
    let initialWindowX = 0;
    let initialWindowY = 0;
    let isHoveringCharacter = false;

    // Mouse tracking variables for neck look-at animation
    let isMouseInWindow = false;
    const mouseNDC = new THREE.Vector2(0, 0);

    const handleMouseDown = async (event) => {
      // If user clicked inside settings or other HTML UI elements, do not drag
      if (event.target.closest('.interactive-element')) {
        return;
      }

      if (event.button === 0 && isHoveringCharacter) {
        const sleeping = (sleepStateRef.current === 'sleeping' || sleepStateRef.current === 'napping');
        if (sleeping && typeof onWakeCharacterRef.current === 'function') {
          console.log("[Presence] User clicked/touched sleeping avatar. Triggering immediate wake up.");
          sleepStateRef.current = 'active';
          sleepProgressRef.current = 0.0;
          onWakeCharacterRef.current();
        }
      }

      if (!window.electronAPI) return;

      if (event.button === 0 && isHoveringCharacter && !isDragging) {
        isDragging = true;
        vrmaExitBlendActiveRef.current = false;
        vrmaExitSnapshotsRef.current.clear();
        startX = event.screenX;
        startY = event.screenY;
        try {
          const bounds = await window.electronAPI.getWindowBounds();
          initialWindowX = bounds.x;
          initialWindowY = bounds.y;
          lastDragX = bounds.x;
          lastDragY = bounds.y;
          dragVelocityX = 0;
          dragVelocityY = 0;
        } catch (e) {
          console.warn("Failed to get window bounds during drag start:", e);
          isDragging = false;
        }
      }
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleMouseLeave = () => {
      const isElectronMode = window.electronAPI && window.electronAPI.isElectron;
      if (isElectronMode) {
        // In Electron mode, we rely entirely on the IPC hover poll (onCursorMove)
        // to detect window leave and enter states. This avoids artificial DOM mouseleave
        // events triggered by toggling setIgnoreMouseEvents.
        return;
      }

      isMouseInWindow = false;
      lookState = 'returning'; // Return head to normal position
    };

    const handleMouseMove = (event) => {
      // Use cached rect ref to prevent layout thrashing (synchronous reflows)
      const rect = canvasRectRef.current;
      const clientX = event.clientX - rect.left;
      const clientY = event.clientY - rect.top;

      // In Electron mode, we use the main process cursor-move publisher to update coordinates.
      // This avoids coordinate fighting between Chromium's delayed/forwarded mousemove events 
      // and the real-time OS cursor coordinates.
      const isElectronMode = (window.electronAPI && window.electronAPI.isElectron) || (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1);
      if (!isElectronMode) {
        const x = (clientX / rect.width) * 2 - 1;
        const y = -(clientY / rect.height) * 2 + 1;
        mouseNDC.set(x, y);

        // Determine if mouse is inside the canvas area
        const isInside = (clientX >= 0 && clientX <= rect.width && clientY >= 0 && clientY <= rect.height);
        if (isMouseInWindow && !isInside) {
          lookState = 'returning'; // Return head to normal position when exiting bounds
        }
        isMouseInWindow = isInside;
        return; // Exit early for browser mode
      }

      if (!window.electronAPI) return;

      if (isDragging) {
        const enableDragPhysics = window.yukiDebugToggles ? window.yukiDebugToggles.dragPhysics : true;
        if (!enableDragPhysics) {
          return;
        }
        const deltaX = event.screenX - startX;
        const deltaY = event.screenY - startY;
        const currentX = initialWindowX + deltaX;
        const currentY = initialWindowY + deltaY;

        const dx = currentX - lastDragX;
        const dy = currentY - lastDragY;
        lastDragX = currentX;
        lastDragY = currentY;

        dragVelocityX = dragVelocityX * 0.7 + dx * 0.3;
        dragVelocityY = dragVelocityY * 0.7 + dy * 0.3;

        window.electronAPI.setWindowPosition(currentX, currentY);
        return;
      }

      // Fast path: 2D bounding box check to bypass raycasting during rapid pointer moves.
      // Yuki is centered horizontally and spans from ~100px to the bottom of the window viewport.
      const currentWidth = isElectron ? window.innerWidth : (containerRef.current ? containerRef.current.clientWidth : ELECTRON_WINDOW_WIDTH);
      const currentHeight = isElectron ? window.innerHeight : (containerRef.current ? containerRef.current.clientHeight : ELECTRON_WINDOW_HEIGHT);
      const bodyWidthLimit = 90 * scaleRef.current;
      const isOverYuki2D = (
        clientX >= (currentWidth / 2 - bodyWidthLimit) &&
        clientX <= (currentWidth / 2 + bodyWidthLimit) &&
        clientY >= (100 * scaleRef.current) &&
        clientY <= (currentHeight - 80 * scaleRef.current)
      );

      isHoveringCharacter = false;

      if (isOverYuki2D) {
        isHoveringCharacter = true;
      } else {
        const enableHoverRaycast = window.yukiDebugToggles ? window.yukiDebugToggles.hoverRaycast : false;
        if (enableHoverRaycast) {
          // Fallback to precise raycasting if outside the fast path 2D box.
          // Throttle to 100ms to avoid high CPU usage and physics engine glitches.
          const now = performance.now();
          if (now - lastRaycastTimeRef.current > 100) {
            lastRaycastTimeRef.current = now;

            mouse.set(mouseNDC.x, mouseNDC.y);
            raycaster.setFromCamera(mouse, camera);

            let hit = false;
            if (vrmRef.current && vrmRef.current.scene) {
              const intersects = raycaster.intersectObject(vrmRef.current.scene, true);
              if (intersects.length > 0) {
                hit = true;
              }
            } else if (holoCore && holoCore.visible) {
              const intersects = raycaster.intersectObject(holoCore, true);
              if (intersects.length > 0) {
                hit = true;
              }
            }
            lastRaycastHitRef.current = hit;
          }

          if (lastRaycastHitRef.current) {
            isHoveringCharacter = true;
          }
        }
      }

      if (isHoveringCharacter || isRotating) {
        // Hovering over character mesh or rotating: enable clicks/drags on this window immediately
        if (ignoreTimeoutRef.current) {
          clearTimeout(ignoreTimeoutRef.current);
          ignoreTimeoutRef.current = null;
        }
        if (isIgnoringMouseRef.current) {
          window.electronAPI.setIgnoreMouseEvents(false);
          isIgnoringMouseRef.current = false;
        }
      } else {
        // Check if mouse is hovering over any interactive HTML UI elements
        const isOverUI = event.target.closest('.interactive-element');
        if (isOverUI) {
          if (ignoreTimeoutRef.current) {
            clearTimeout(ignoreTimeoutRef.current);
            ignoreTimeoutRef.current = null;
          }
          if (isIgnoringMouseRef.current) {
            window.electronAPI.setIgnoreMouseEvents(false);
            isIgnoringMouseRef.current = false;
          }
        } else {
          // Off character and off UI: ignore mouse clicks on window, but forward them to desktop instantly.
          const enableClickthrough = window.yukiDebugToggles ? window.yukiDebugToggles.clickthrough : true;
        const suspendClickthrough = window.yukiConfirmJustClosed === true || window.yukiAskUserOpen === true || !!document.querySelector('.ask-user-dialog-overlay') || !!document.querySelector('.yuki-confirm-overlay');
          if (enableClickthrough && !suspendClickthrough) {
            if (!isIgnoringMouseRef.current) {
              window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
              isIgnoringMouseRef.current = true;
            }
          } else {
            // Clickthrough disabled/suspended: ensure window is not ignoring mouse events
            if (ignoreTimeoutRef.current) {
              clearTimeout(ignoreTimeoutRef.current);
              ignoreTimeoutRef.current = null;
            }
            if (isIgnoringMouseRef.current) {
              window.electronAPI.setIgnoreMouseEvents(false);
              isIgnoringMouseRef.current = false;
            }
          }
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    let unsubscribeCursorMove = null;
    if (isElectron && window.electronAPI && window.electronAPI.onCursorMove) {
      unsubscribeCursorMove = window.electronAPI.onCursorMove((data) => {
        // Toggle click-through ignores state based on window bounds hovering
        const enableClickthrough = window.yukiDebugToggles ? window.yukiDebugToggles.clickthrough : true;
        const suspendClickthrough = window.yukiConfirmJustClosed === true || window.yukiAskUserOpen === true || !!document.querySelector('.ask-user-dialog-overlay') || !!document.querySelector('.yuki-confirm-overlay');
        if (enableClickthrough && !suspendClickthrough && !isRotating) {
          if (!data.hovering) {
            if (ignoreTimeoutRef.current) {
              clearTimeout(ignoreTimeoutRef.current);
              ignoreTimeoutRef.current = null;
            }
            if (!isIgnoringMouseRef.current) {
              window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
              isIgnoringMouseRef.current = true;
            }
          }
        } else {
          if (ignoreTimeoutRef.current) {
            clearTimeout(ignoreTimeoutRef.current);
            ignoreTimeoutRef.current = null;
          }
          if (isIgnoringMouseRef.current) {
            window.electronAPI.setIgnoreMouseEvents(false);
            isIgnoringMouseRef.current = false;
          }
        }

        // Store relative coordinates relative to window viewport for raycasting fallback
        const enableMouseTracking = window.yukiDebugToggles ? window.yukiDebugToggles.mouseTracking : true;
        if (enableMouseTracking) {
          const x = (data.x / data.width) * 2 - 1;
          const y = -(data.y / data.height) * 2 + 1;
          mouseNDC.set(x, y);

          // Store screen-space cursor offsets for smooth screen-wide proximity gaze
          cursorOffsetRef.current = { x: data.dx, y: data.dy };

          // Proximity checks to prevent coordinate/active state fighting
          const distance = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
          const isInsideWindow = Math.abs(x) <= 1.0 && Math.abs(y) <= 1.0;

          if (isInsideWindow || distance <= 500) {
            isMouseInWindow = true;
            lastMouseMoveTimeRef.current = performance.now();
          } else {
            isMouseInWindow = false;
          }
        } else {
          isMouseInWindow = false;
          cursorOffsetRef.current = { x: 0, y: 0 };
        }
      });
    }

    if (isElectron) {
      window.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);
    }

    const triggerScreenKnock = () => {
      if (knockActive) return;
      knockActive = true;
      knockTimer = 0;

      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          const playTap = (delay) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(650, ctx.currentTime + delay);
            osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + delay + 0.05);
            gain.gain.setValueAtTime(0.0, ctx.currentTime + delay);
            gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + delay + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + 0.06);

            const noise = ctx.createOscillator();
            const noiseGain = ctx.createGain();
            noise.type = 'sine';
            noise.frequency.setValueAtTime(2200, ctx.currentTime + delay);
            noiseGain.gain.setValueAtTime(0.0, ctx.currentTime + delay);
            noiseGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + delay + 0.001);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.01);
            noise.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(ctx.currentTime + delay);
            noise.stop(ctx.currentTime + delay + 0.02);
          };
          playTap(0.0);
          playTap(0.14);
          playTap(0.28);
        }
      } catch (e) {
        console.warn("Glass knock sound synthesis failed:", e);
      }
    };

    const handleDblClick = () => {
      // Screen knock disabled by user request
    };

    window.addEventListener('dblclick', handleDblClick);

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = isElectron ? window.innerWidth : containerRef.current.clientWidth;
      const height = isElectron ? window.innerHeight : containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);

      // Update cached rect on resize to avoid layout thrashing in handleMouseMove
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        canvasRectRef.current = {
          left: rect.left,
          top: rect.top,
          width: rect.width || 1,
          height: rect.height || 1
        };
      }
    };
    window.addEventListener('resize', handleResize);

    // 9. Main Render Loop
    const clock = clockRef.current;

    let accumulatedTime = 0;

    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);

      if (!visibleRef.current) {
        return;
      }

      const targetFPS = parseInt(vrmFpsRef.current, 10) || 40;
      const frameDelay = 1 / targetFPS;

      let delta = clock.getDelta();
      if (delta > 0.1) delta = 0.1;

      // Accumulate elapsed delta time
      accumulatedTime += delta;

      // Only run physics calculations and render the frame if our threshold is met
      if (accumulatedTime >= frameDelay) {
        const time = clock.getElapsedTime();

        // Track subtle camera rotation speed for hair, chest, and wrist inertia (WITHOUT triggering pick-up ragdoll state)
        let curOrbitVelX = 0;
        if (camera && controls) {
          const dxCam = camera.position.x - controls.target.x;
          const dzCam = camera.position.z - controls.target.z;
          const curAzimuth = Math.atan2(dxCam, dzCam);

          if (lastCameraAzimuth !== undefined && delta > 0) {
            let deltaAz = curAzimuth - lastCameraAzimuth;
            if (deltaAz > Math.PI) deltaAz -= Math.PI * 2;
            if (deltaAz < -Math.PI) deltaAz += Math.PI * 2;

            if (Math.abs(deltaAz) > 0.0001) {
              curOrbitVelX = (deltaAz / delta);
            }
          }
          lastCameraAzimuth = curAzimuth;
        }

        // Smoothly decay orbit velocity and calculate subtle sway angle
        orbitVelX = orbitVelX * 0.82 + curOrbitVelX * 0.18;
        const targetOrbitSway = -orbitVelX * 0.035; // subtle rotational inertia angle
        orbitSwayAngle += (targetOrbitSway - orbitSwayAngle) * Math.min(1.0, delta * 10.0);

        // Drag state update and physics calculation
        const enableDragPhysics = window.yukiDebugToggles ? window.yukiDebugToggles.dragPhysics : true;
        if (isDragging && (!isElectron || enableDragPhysics)) {
          dragStateProgress = Math.min(1.0, dragStateProgress + delta * 6.0); // ease-in over ~160ms
          dragDangleTimer += delta * 6.5;
        } else {
          dragStateProgress = Math.max(0.0, dragStateProgress - delta * 4.0); // ease-out over ~250ms
          dragVelocityX *= 0.85; // decay velocity
          dragVelocityY *= 0.85;
          if (dragStateProgress > 0 && (!isElectron || enableDragPhysics)) {
            dragDangleTimer += delta * 6.5;
          } else {
            dragDangleTimer = 0;
            if (isElectron && !enableDragPhysics) {
              dragStateProgress = 0;
            }
          }
        }

        // Smooth inertia sway and pitch angle updates
        const targetSwayAngle = -dragVelocityX * 0.007; // Moving right tilts body left (negative Z)
        const targetPitchAngle = dragVelocityY * 0.004; // Moving down tilts body forward (positive X)
        dragSwayAngle += (targetSwayAngle - dragSwayAngle) * delta * 12.0;
        dragPitchAngle += (targetPitchAngle - dragPitchAngle) * delta * 12.0;

        // Update camera target, Y, and Z positions dynamically based on scale (Electron mode only)
        if (isElectron && controls && camera) {
          const baseTargetOffset = 0.55;
          const baseCameraOffset = -0.10;
          // const baseCameraZ = 2.2;

          // Divide distance by reducer. If reducer is 0.8, camera moves back, making her smaller.
          const baseCameraZ = 2.2 / YUKI_SCALE_REDUCER;

          let headY = 1.45; // default unscaled head height
          // if (vrmRef.current) {
          //   const headNode = getBoneNode(vrmRef.current, 'head');
          //   if (headNode) {
          //     const tempV = new THREE.Vector3();
          //     headNode.getWorldPosition(tempV);
          //     headY = tempV.y / scaleRef.current; // get unscaled head height
          //   }
          // }

          if (!enableRotationRef.current) {
            controls.target.set(0, (headY - baseTargetOffset) * scaleRef.current, 0);
            camera.position.set(0, (headY - baseCameraOffset) * scaleRef.current, baseCameraZ * scaleRef.current);
            camera.lookAt(controls.target);
          } else {
            const targetY = (headY - baseTargetOffset) * scaleRef.current;
            controls.target.set(0, targetY, 0);

            if (isRotating) {
              lastRotationTime = Date.now();
            }

            const now = Date.now();
            if (!isRotating && autoResetRotationRef.current && (now - lastRotationTime > 10000)) {
              // Smooth return to front-facing position
              const defaultOffset = new THREE.Vector3(0, (baseTargetOffset - baseCameraOffset) * scaleRef.current, baseCameraZ * scaleRef.current);
              const targetCamPos = new THREE.Vector3().copy(controls.target).add(defaultOffset);
              const dist = camera.position.distanceTo(targetCamPos);
              if (dist > 0.001) {
                const lerpFactor = 1 - Math.exp(-4 * delta);
                camera.position.lerp(targetCamPos, lerpFactor);
              } else {
                camera.position.copy(targetCamPos);
              }
            } else {
              // Normalize camera distance to match current scale while preserving angles
              const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
              if (offset.lengthSq() === 0) {
                offset.set(0, 0, baseCameraZ * scaleRef.current);
              } else {
                offset.normalize().multiplyScalar(baseCameraZ * scaleRef.current);
              }
              camera.position.copy(controls.target).add(offset);
            }
            controls.update();
          }
        }

        if (!isElectron) {
          const enableOrbitControls = window.yukiDebugToggles ? window.yukiDebugToggles.orbitControls : true;
          if (enableOrbitControls) {
            controls.update();
          }
        }

        if (knockActive) {
          knockTimer += delta;
          if (knockTimer >= knockDuration) {
            knockActive = false;
            knockTimer = 0;
          }
        }

        // Check for inactivity to trigger procedural idle animations
        const isActive = (audioLevelRef.current > 0.015) || isThinkingRef.current || isListeningRef.current || isWalkingRef.current || expressionRef.current !== 'neutral' || isDragging || (dragStateProgress > 0);

        if (startGreetingRef.current) {
          startGreetingRef.current = false;
          idleAnimState = 'greeting_wave';
          idleAnimDuration = 3.5;
          idleAnimProgress = 0;
          inactivityTimer = 0;
          onAnimationTriggeredRef.current?.('greeting_wave', 'user_interaction', 'Startup greeting wave on avatar connect');
        }

        if (startCustomAnimationRef.current) {
          const rawCustom = startCustomAnimationRef.current;
          const customName = typeof rawCustom === 'object' && rawCustom?.name ? rawCustom.name : rawCustom;
          const customCategory = typeof rawCustom === 'object' && rawCustom?.category ? rawCustom.category : 'user_interaction';
          const customReason = typeof rawCustom === 'object' && rawCustom?.reason ? rawCustom.reason : 'Custom animation trigger';
          startCustomAnimationRef.current = null;

          if (!disabledAnimationsRef.current.includes(customName)) {
            // Guard: If sleeping/napping, do not run the temporary 5s nod-off gesture that startles awake
            if (customName === 'napping' && (sleepStateRef.current === 'sleeping' || sleepStateRef.current === 'napping')) {
              // Procedural sleeping already maintains sleeping pose
            } else {
              idleAnimState = customName;
              const matchingAnim = ANIMATIONS.find(a => a.name === customName);
              if (matchingAnim) {
                idleAnimDuration = matchingAnim.duration;
              } else {
                idleAnimDuration = 4.0;
              }

              idleAnimProgress = 0;
              inactivityTimer = 0;
              onAnimationTriggeredRef.current?.(customName, customCategory, customReason);

              if (matchingAnim?.type === 'vrma') {
                if (vrmRef.current) {
                  playVrmaClip(matchingAnim, vrmRef.current);
                }
              } else {
                if (isVrmaActiveRef.current) {
                  triggerVrmaExitBlend(vrmRef.current);
                }
              }
            }
          }
        }

        if (isActive) {
          inactivityTimer = 0;
          if (idleAnimState !== 'none') {
            // If greeting_wave or any custom animation is running, don't interrupt it unless user is dragging
            const isManualAnim = ANIMATIONS.some(a => a.name === idleAnimState);
            if (isManualAnim && !isDragging) {
              // Let the animation finish naturally
              idleAnimProgress += delta;
              if (idleAnimProgress >= idleAnimDuration) {
                if (isVrmaActiveRef.current) {
                  triggerVrmaExitBlend(vrmRef.current);
                }
                idleAnimState = 'none';
                idleAnimProgress = 0;
              }
            } else {
              if (isVrmaActiveRef.current) {
                triggerVrmaExitBlend(vrmRef.current);
              }
              idleAnimState = 'none';
              idleAnimProgress = 0;
            }
          }
        } else {
          if (idleAnimState === 'none') {
            inactivityTimer += delta;
            if (inactivityTimer >= nextIdleInterval) {
              nextIdleInterval = 18.0 + Math.random() * 16.0; // 18s - 34s organic delay between idles
              const enabledIdleAnims = ANIMATIONS.filter(
                a => !a.excludeFromRandomIdle && !disabledAnimationsRef.current.includes(a.name)
              );
              if (enabledIdleAnims.length > 0) {
                const currentBoredom = boredomRef.current || 0;
                const currentEnergy = energyRef.current ?? 55;
                const currentPlayfulness = playfulnessRef.current ?? 50;

                // Organic selection weights with anti-repetition deck penalty
                const weights = enabledIdleAnims.map(anim => {
                  let weight = 1.0;
                  const name = anim.name.toLowerCase();

                  // Anti-repetition penalty based on recency in recentIdleHistory
                  const historyIdx = recentIdleHistory.indexOf(anim.name);
                  if (historyIdx !== -1) {
                    if (historyIdx === recentIdleHistory.length - 1) weight *= 0.05; // just played last cycle
                    else if (historyIdx === recentIdleHistory.length - 2) weight *= 0.25;
                    else weight *= 0.55;
                  }

                  // Contextual boredom weighting
                  if (currentBoredom >= 0.5) {
                    if (name.includes('bored') || name.includes('pout')) weight += currentBoredom * 6;
                    if (name.includes('shrug')) weight += currentBoredom * 2.5;
                  }

                  // Contextual fatigue / low energy weighting
                  if (currentEnergy <= 40) {
                    const fatigueFactor = (40 - currentEnergy) / 40;
                    if (name.includes('yawn') || name.includes('nap')) weight += fatigueFactor * 6;
                    if (name.includes('drowsy') || name.includes('catch')) weight += fatigueFactor * 7;
                    if (name.includes('cat_stretch') || name.includes('stretch')) weight += fatigueFactor * 4;
                  }

                  // Contextual high playfulness weighting
                  if (currentPlayfulness >= 60) {
                    const playFactor = (currentPlayfulness - 60) / 40;
                    if (name.includes('groove') || name.includes('cheer')) weight += playFactor * 5;
                  }

                  return Math.max(0.01, weight);
                });

                const totalWeight = weights.reduce((sum, w) => sum + w, 0);
                let randomRoll = Math.random() * totalWeight;
                let selectedAnim = enabledIdleAnims[0];

                for (let i = 0; i < enabledIdleAnims.length; i++) {
                  if (randomRoll < weights[i]) {
                    selectedAnim = enabledIdleAnims[i];
                    break;
                  }
                  randomRoll -= weights[i];
                }

                // Append to history buffer (retain last 4 to prevent repeats)
                recentIdleHistory.push(selectedAnim.name);
                if (recentIdleHistory.length > 4) {
                  recentIdleHistory.shift();
                }

                idleAnimState = selectedAnim.name;
                idleAnimDuration = selectedAnim.duration;
                onAnimationTriggeredRef.current?.(selectedAnim.name, 'random_idle', `Random idle selection: ${selectedAnim.name}`);

                if (selectedAnim.type === 'vrma') {
                  if (vrmRef.current) {
                    playVrmaClip(selectedAnim, vrmRef.current);
                  }
                } else {
                  if (isVrmaActiveRef.current) {
                    triggerVrmaExitBlend(vrmRef.current);
                  }
                }
              } else {
                idleAnimState = 'none';
              }
              idleAnimProgress = 0;
              inactivityTimer = 0;
            }
          } else {
            idleAnimProgress += delta;
            if (idleAnimProgress >= idleAnimDuration) {
              if (isVrmaActiveRef.current) {
                triggerVrmaExitBlend(vrmRef.current);
              }
              idleAnimState = 'none';
              idleAnimProgress = 0;
              inactivityTimer = 0;
            }
          }
        }

        // Procedural micro-fidget loops for active standing postures (subtle neck rolls)
        let microFidgetNeckX = 0;
        let microFidgetNeckY = 0;
        let microFidgetNeckZ = 0;

        if (!isWalkingRef.current && idleAnimState === 'none') {
          microFidgetTimer += delta;
          if (!microFidgetActive && microFidgetTimer >= nextMicroFidgetTime) {
            microFidgetActive = true;
            microFidgetProgress = 0;
            microFidgetTimer = 0;
            nextMicroFidgetTime = 15 + Math.random() * 25; // 15-40 seconds
          }

          const enableMicroFidget = window.yukiDebugToggles ? window.yukiDebugToggles.microFidget : true;
          if (microFidgetActive && enableMicroFidget) {
            microFidgetProgress += delta;
            if (microFidgetProgress >= microFidgetDuration) {
              microFidgetActive = false;
            } else {
              const t = microFidgetProgress / microFidgetDuration;
              const easeVal = Math.sin(t * Math.PI); // sine curve

              // Subtle head roll and tilt
              microFidgetNeckX = Math.sin(time * 3.5) * 0.02 * easeVal;
              microFidgetNeckY = Math.cos(time * 2.8) * 0.025 * easeVal;
              microFidgetNeckZ = Math.sin(time * 1.9) * 0.035 * easeVal;
            }
          }
        } else {
          microFidgetActive = false;
          microFidgetTimer = 0;
        }

        // Calculate procedural idle offsets
        let leftArmOffsetZ = 0;
        let rightArmOffsetZ = 0;
        let leftElbowOffsetY = 0;
        let rightElbowOffsetY = 0;
        let spineOffsetX = 0;
        let neckOffsetX = 0;
        let chestOffsetX = 0;
        let extraMouthAa = 0;
        let extraMouthOh = 0;
        let extraBlink = 0;

        if (idleAnimState !== 'none') {
          const t = idleAnimProgress / idleAnimDuration;
          const easeVal = Math.sin(t * Math.PI); // Beautiful sine curve for ease-in-out

          if (idleAnimState === 'yawning') {
            extraMouthAa = 0.45 * easeVal;
            extraBlink = 0.35 * easeVal;
            neckOffsetX = -0.12 * easeVal;
            leftArmOffsetZ = -0.08 * easeVal;
            rightArmOffsetZ = 0.08 * easeVal;
          } else if (idleAnimState === 'shrugging') {
            leftArmOffsetZ = -0.18 * easeVal;
            rightArmOffsetZ = 0.18 * easeVal;
            chestOffsetX = -0.03 * easeVal;
            neckOffsetX = 0.06 * easeVal;
          } else if (idleAnimState === 'peering' || idleAnimState === 'inspect_screen') {
            spineOffsetX = (idleAnimState === 'inspect_screen' ? -0.15 : -0.08) * easeVal;
            chestOffsetX = (idleAnimState === 'inspect_screen' ? -0.18 : -0.12) * easeVal;
            neckOffsetX = (idleAnimState === 'inspect_screen' ? 0.08 : 0.04) * easeVal;
          } else if (idleAnimState === 'cat_stretch') {
            spineOffsetX = 0.16 * easeVal;
            neckOffsetX = -0.12 * easeVal;
            chestOffsetX = 0.10 * easeVal;
          } else if (idleAnimState === 'gasp_recoil' || idleAnimState === 'disgusted_recoil') {
            spineOffsetX = 0.14 * easeVal;
            neckOffsetX = -0.12 * easeVal;
            extraMouthAa = 0.35 * easeVal;
            extraBlink = 0.15 * easeVal;
          } else if (idleAnimState === 'finger_guns') {
            chestOffsetX = -0.05 * easeVal;
            neckOffsetX = 0.03 * easeVal;
          } else if (idleAnimState === 'formal_bow' || idleAnimState === 'bow') {
            spineOffsetX = -0.22 * easeVal;
            chestOffsetX = -0.15 * easeVal;
            neckOffsetX = 0.12 * easeVal;
          } else if (idleAnimState === 'shy_fidget') {
            spineOffsetX = -0.05 * easeVal;
          } else if (idleAnimState === 'laughing' || idleAnimState === 'laugh_opt2' || idleAnimState === 'laugh2') {
            // Laughing chuckle mouth flutter and cheerful eyelid flutter
            extraMouthAa = (0.28 + Math.sin(time * 16.0) * 0.14) * easeVal;
            extraBlink = 0.28 * easeVal;
          } else if (idleAnimState === 'pouting') {
            // Cute pursed / puffed sulking lips
            extraMouthOh = 0.22 * easeVal;
            extraMouthAa = 0.04 * easeVal;
          } else if (idleAnimState === 'tsundere_bicker' || idleAnimState === 'baka' || idleAnimState === 'laugh_opt4') {
            // Tsundere indignant bickering: rapid defensive mouth flutter and subtle head tilt
            extraMouthAa = (0.22 + Math.sin(time * 20.0) * 0.12) * easeVal;
            neckOffsetX = 0.08 * easeVal;
          } else if (idleAnimState === 'napping') {
            if (t < 0.7) {
              const droopT = t / 0.7;
              const droopEase = droopT * droopT;
              extraBlink = 0.85 * droopEase;
              neckOffsetX = -0.25 * droopEase;
              spineOffsetX = 0.04 * droopEase;
            } else {
              const wakeT = (t - 0.7) / 0.3;
              const bounce = Math.exp(-wakeT * 5.0) * Math.sin(wakeT * Math.PI * 2.0);
              neckOffsetX = 0.15 * bounce;
              extraBlink = 0;
            }
          }
        }
        if (dragStateProgress > 0) {
          extraMouthAa = Math.max(extraMouthAa, 0.20 * dragStateProgress); // surprise gasp
        }
        // Animate Hologram core
        if (holoCore) {
          const enableParticles = window.yukiDebugToggles ? window.yukiDebugToggles.particles : true;
          const isLoaded = !!vrmRef.current;

          if (enableParticles && !isLoaded) {
            holoCore.visible = true;
            ring.visible = true;
            holoCore.rotation.y = time * 0.3;
            holoCore.rotation.x = time * 0.15;

            const scaleVal = (1 + (isThinkingRef.current ? Math.sin(time * 15) * 0.08 : 0) + (audioLevelRef.current * 0.6)) * scaleRef.current;
            holoCore.scale.set(scaleVal, scaleVal, scaleVal);

            ring.rotation.y = time * 0.6;
            ring.rotation.z = -time * 0.4;
            const finalRingScale = (1 + audioLevelRef.current * 0.2) * scaleRef.current;
            ring.scale.set(finalRingScale, finalRingScale, scaleRef.current);
          } else {
            holoCore.visible = false;
            ring.visible = false;
          }
        }

        // Animate VRM Avatar
        if (vrmRef.current) {
          const vrm = vrmRef.current;
          const isVRM1 = !!vrm.isVRM1;
          const xMult = isVRM1 ? -1 : 1;
          const zMult = isVRM1 ? -1 : 1;
          const yMult = 1;
          const isSleeping = (sleepStateRef.current === 'sleeping' || sleepStateRef.current === 'napping');
          const targetSleepProgress = isSleeping ? 1.0 : 0.0;
          const sleepTransitionSpeed = isSleeping ? 0.2 : 3.0; // wake up is snappy and immediate
          sleepProgressRef.current += (targetSleepProgress - sleepProgressRef.current) * (delta * 3.0 * sleepTransitionSpeed);
          sleepProgressRef.current = Math.max(0.0, Math.min(1.0, sleepProgressRef.current));

          // Apply dynamic scale
          vrm.scene.scale.set(scaleRef.current, scaleRef.current, scaleRef.current);

          // Smooth rotation to face walk direction
          const baseRotation = isVRM1 ? 0 : Math.PI;
          let targetRotation = baseRotation; // default facing forward
          if (isWalkingRef.current) {
            if (walkDirectionRef.current === -1) {
              targetRotation = baseRotation - 0.7; // angle left
            } else if (walkDirectionRef.current === 1) {
              targetRotation = baseRotation + 0.7; // angle right
            }
          }
          vrm.scene.rotation.y += (targetRotation - vrm.scene.rotation.y) * 0.15;

          if (vrm.humanoid) {
            // Neck look-around state machine update
            const isElectron = (window.electronAPI && window.electronAPI.isElectron) || (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1);

            // cameraTracking is always read via window.yukiDebugToggles getter,
            // which returns cameraTrackingRef.current — the single source of truth.
            const enableCameraTracking = !!(window.yukiDebugToggles && window.yukiDebugToggles.cameraTracking);

            // Gaze cycling: toggle between looking at user and looking away
            if (enableCameraTracking) {
              const isSpeaking = audioLevelRef.current > 0.015;

              if (!alwaysLookingAtYou && isSpeaking) {
                // Speech interrupt: snap to looking at you
                alwaysLookingAtYou = true;
                gazeAtUserTimer = 0;
                gazeAtUserDuration = 5 + Math.random() * 10;
              } else if (alwaysLookingAtYou && !isSpeaking && prevIsSpeakingRef.current) {
                // Speech just ended: reset timer for full post-speech look duration
                gazeAtUserTimer = 0;
                gazeAtUserDuration = 5 + Math.random() * 10;
              } else {
                gazeAtUserTimer += delta;
                if (gazeAtUserTimer >= gazeAtUserDuration) {
                  alwaysLookingAtYou = !alwaysLookingAtYou;
                  gazeAtUserTimer = 0;
                  gazeAtUserDuration = alwaysLookingAtYou
                    ? 5 + Math.random() * 10
                    : 120 + Math.random() * 60;
                }
              }
              prevIsSpeakingRef.current = isSpeaking;
            } else {
              // Camera tracking OFF: never look at you via camera angle
              alwaysLookingAtYou = false;
              gazeAtUserTimer = 0;
            }

            let baseLookY = 0;
            let baseLookX = 0;
            let baseLookZ = 0;

            if (enableCameraTracking && alwaysLookingAtYou) {
              // ---------------------------------------------------------
              // --- CAMERA-AWARE GAZE TRACKING BASE CALCULATION ---
              // ---------------------------------------------------------
              const cameraYaw = Math.atan2(camera.position.x, camera.position.z);
              const bodyRotationOffset = vrm.scene.rotation.y - baseRotation;
              let trackingYawOffset = cameraYaw - bodyRotationOffset;

              const yawScale = 0.55;
              const maxNeckYaw = 1.2;
              trackingYawOffset = Math.max(-maxNeckYaw, Math.min(maxNeckYaw, trackingYawOffset * yawScale));

              const headHeight = 1.4 * scaleRef.current;
              const horizontalDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
              const trackingPitchOffset = horizontalDist > 0.01
                ? Math.atan2(camera.position.y - headHeight, horizontalDist) * 1.1
                : 0;
              const minPitch = -0.30;
              const maxPitch = 0.85;
              const clampedPitch = Math.max(minPitch, Math.min(maxPitch, trackingPitchOffset));

              baseLookY = trackingYawOffset;
              baseLookX = clampedPitch;

              const rollScale = 0.5;
              baseLookZ = horizontalDist > 0.01
                ? Math.atan2(-camera.position.x, horizontalDist) * rollScale
                : 0;
            }

            let targetLookY = baseLookY;
            let targetLookX = baseLookX;
            // ---------------------------------------------------------

            const enableMouseTracking = !disabledAnimationsRef.current.includes('mouse_tracking') && (window.yukiDebugToggles ? window.yukiDebugToggles.mouseTracking !== false : true);

            // During right-click orbit, skip mouse tracking entirely —
            // the camera position already encodes where the user is looking from.
            const isOrbiting = isRotating;

            const isOverChatOverlay = !!window.yukiChatOverlayHovered;
            if (!isOrbiting && isMouseInWindow && !isOverChatOverlay && postOrbitRestTimer <= 0) {
              if (!enableMouseTracking) {
                isMouseInWindow = false;
                lookState = 'returning';
              } else if (isElectron) {
                const isInsideWindow = Math.abs(mouseNDC.x) <= 1.0 && Math.abs(mouseNDC.y) <= 1.0;
                const isStationary = (performance.now() - lastMouseMoveTimeRef.current > 4000);

                let influence = 1.0;
                if (!isInsideWindow) {
                  const dx = cursorOffsetRef.current.x;
                  const dy = cursorOffsetRef.current.y;
                  const distance = Math.sqrt(dx * dx + dy * dy);
                  const t = Math.max(0, Math.min(1, (500 - distance) / 300));
                  influence = t * t * (3 - 2 * t);
                }

                if (influence <= 0 || isStationary) {
                  isMouseInWindow = false;
                  lookState = 'returning';
                }
              }
            }

            // Post-orbit rest: detect orbit end, start rest timer
            if (prevIsRotatingRef.current && !isRotating) {
              postOrbitRestDuration = 5 + Math.random() * 5;
              postOrbitRestTimer = postOrbitRestDuration;
            }
            if (postOrbitRestTimer > 0) {
              postOrbitRestTimer -= delta;
              if (postOrbitRestTimer <= 0) {
                lastMouseMoveTimeRef.current = performance.now();
              }
            }
            prevIsRotatingRef.current = isRotating;

            // Handle orbit dragging & post-orbit rest:
            if (isOrbiting || postOrbitRestTimer > 0) {
              if (enableCameraTracking) {
                const orbYaw = Math.atan2(camera.position.x, camera.position.z);
                const orbBodyOffset = vrm.scene.rotation.y - baseRotation;
                let orbTrackingYaw = Math.max(-1.2, Math.min(1.2, (orbYaw - orbBodyOffset) * 0.55));
                const orbHeadHeight = 1.4 * scaleRef.current;
                const orbHDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
                let orbTrackingPitch = orbHDist > 0.01
                  ? Math.atan2(camera.position.y - orbHeadHeight, orbHDist) * 1.1
                  : 0;
                orbTrackingPitch = Math.max(-0.30, Math.min(0.85, orbTrackingPitch));
                targetLookY = orbTrackingYaw;
                targetLookX = orbTrackingPitch;
              } else {
                // When Camera Tracking is OFF: head stays 100% locked straight ahead aligned with body while rotating
                targetLookY = 0;
                targetLookX = 0;
              }
              lookState = 'idle';
              lookTimer = 0;
            } else if (isMouseInWindow && !isOverChatOverlay) {
              if (isElectron) {
                if (enableMouseTracking) {
                  const dx = cursorOffsetRef.current.x;
                  const dy = cursorOffsetRef.current.y;
                  const isInsideWindow = Math.abs(mouseNDC.x) <= 1.0 && Math.abs(mouseNDC.y) <= 1.0;

                  let influence = 1.0;
                  if (!isInsideWindow) {
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const t = Math.max(0, Math.min(1, (500 - distance) / 300));
                    influence = t * t * (3 - 2 * t);
                  }

                  targetLookY = Math.atan(dx / 300) * 0.45 * influence + baseLookY;
                  targetLookX = -Math.atan(dy / 300) * 0.55 * influence + baseLookX;
                } else {
                  targetLookY = baseLookY;
                  targetLookX = baseLookX;
                }
              } else {
                if (enableMouseTracking) {
                  targetLookY = mouseNDC.x * 0.45 + baseLookY;
                  const verticalCenter = 0.0;
                  targetLookX = (mouseNDC.y - verticalCenter) * 0.45 + baseLookX;
                } else {
                  targetLookY = baseLookY;
                  targetLookX = baseLookX;
                }
              }

              lookState = 'idle';
              lookTimer = 0;
            } else if (!isWalkingRef.current) {
              const enableLookAround = enableCameraTracking && (window.yukiDebugToggles ? window.yukiDebugToggles.lookAround !== false : true);
              if (enableLookAround && isElectron) {
                lookTimer += delta;
                if (lookState === 'idle') {
                  if (lookTimer >= nextLookTime) {
                    lookState = 'turning';
                    lookTargetY = (Math.random() - 0.5) * 0.45 + baseLookY;
                    lookTargetX = (Math.random() - 0.5) * 0.2 + baseLookX;
                    lookTimer = 0;
                  }
                } else if (lookState === 'turning') {
                  targetLookY = lookTargetY;
                  targetLookX = lookTargetX;
                  if (Math.abs(currentLookY - lookTargetY) < 0.03) {
                    lookState = 'holding';
                    lookHoldTimer = 0;
                  }
                } else if (lookState === 'holding') {
                  targetLookY = lookTargetY;
                  targetLookX = lookTargetX;
                  lookHoldTimer += delta;
                  if (lookHoldTimer >= 1.5 + Math.random() * 2) {
                    lookState = 'returning';
                  }
                } else if (lookState === 'returning') {
                  targetLookY = baseLookY;
                  targetLookX = baseLookX;
                  if (Math.abs(currentLookY - targetLookY) < 0.03 && Math.abs(currentLookX - targetLookX) < 0.03) {
                    lookState = 'idle';
                    lookTimer = 0;
                    nextLookTime = 6 + Math.random() * 10;
                  }
                }
              } else {
                targetLookY = baseLookY;
                targetLookX = baseLookX;
              }
            } else {
              lookState = 'idle';
              currentLookX = baseLookX;
              currentLookY = baseLookY;
              currentLookZ = baseLookZ;
              currentGazeX = baseLookX;
              currentGazeY = baseLookY;
              lookVelocityX = 0;
              lookVelocityY = 0;
              lookTimer = 0;
            }

            // 1. Spring-Damper for Neck Head Rotation (smooth lag and overshoot bounce)
            // Spring constant: 28, damping: 7.5. Makes a beautiful organic settlement.
            const springK = 28.0;
            const dampingC = 7.5;
            const forceY = (targetLookY - currentLookY) * springK - lookVelocityY * dampingC;
            const forceX = (targetLookX - currentLookX) * springK - lookVelocityX * dampingC;

            lookVelocityY += forceY * delta;
            lookVelocityX += forceX * delta;

            // Clamp velocity to prevent wild spins
            lookVelocityY = Math.max(-2.5, Math.min(2.5, lookVelocityY));
            lookVelocityX = Math.max(-2.5, Math.min(2.5, lookVelocityX));

            currentLookY += lookVelocityY * delta;
            currentLookX += lookVelocityX * delta;

            // Smooth roll (Z-axis) lerp — no spring needed, just gentle interpolation
            currentLookZ += (baseLookZ - currentLookZ) * Math.min(1, delta * 5.0);

            // 2. Faster Eye Gaze Tracking (Lag-lead effect: eyes lock first)
            currentGazeY += (targetLookY - currentGazeY) * (delta * 7.5);
            currentGazeX += (targetLookX - currentGazeX) * (delta * 7.5);

            // 3. Eye Saccades (Micro-Adjustments)
            saccadeTimer += delta;
            if (saccadeTimer >= nextSaccadeTime) {
              saccadeTimer = 0;
              nextSaccadeTime = 0.18 + Math.random() * 0.25; // every 180-430ms

              const enableSaccades = window.yukiDebugToggles ? window.yukiDebugToggles.saccades : true;
              const enableMouseTracking = window.yukiDebugToggles ? window.yukiDebugToggles.mouseTracking : true;
              const isMouseTrackingActive = enableMouseTracking && isMouseInWindow;

              // Only saccade when looking at something (active mouse tracking or turning) and enabled
              if (enableSaccades && (isMouseTrackingActive || lookState === 'turning')) {
                saccadeX = (Math.random() - 0.5) * 0.024;
                saccadeY = (Math.random() - 0.5) * 0.024;
              } else {
                saccadeX = 0;
                saccadeY = 0;
              }
            }

            // Dynamic breathing modulation based on active state
            let baseBreathingSpeed = 1.3;
            let baseBreathingDepth = 0.012;

            if (dragStateProgress > 0) {
              baseBreathingSpeed = 2.0;  // faster excited breathing when carried
              baseBreathingDepth = 0.016;
            } else if (cpuLoadRef.current > 80) {
              baseBreathingSpeed = 3.6;  // rapid panting when CPU load is very high
              baseBreathingDepth = 0.02;
            } else if (audioLevelRef.current > 0.015) {
              baseBreathingSpeed = 2.4; // fast breathing when speaking
              baseBreathingDepth = 0.007; // shallower
            } else if (isWalkingRef.current) {
              baseBreathingSpeed = 1.8; // faster breathing when walking
              baseBreathingDepth = 0.010;
            } else if (isThinkingRef.current) {
              baseBreathingSpeed = 0.95; // slower, deeper breathing when thinking
              baseBreathingDepth = 0.016;
            } else if (isListeningRef.current) {
              baseBreathingSpeed = 1.1; // calmer breathing when listening
              baseBreathingDepth = 0.011;
            }

            let breathingSpeed = THREE.MathUtils.lerp(baseBreathingSpeed, 0.65, sleepProgressRef.current);
            let breathingDepth = THREE.MathUtils.lerp(baseBreathingDepth, 0.015, sleepProgressRef.current);

            const enableBreathing = !disabledAnimationsRef.current.includes('breathing') && (window.yukiDebugToggles ? window.yukiDebugToggles.breathing !== false : true);
            if (!enableBreathing) {
              breathingSpeed = 0;
              breathingDepth = 0;
            }

            if (!isVrmaActiveRef.current) {
              // 4. Natural breathing & gentle swaying
              const chest = getBoneNode(vrm, 'chest');
            if (chest) {
              if (dragStateProgress > 0) {
                chest.rotation.x = dragPitchAngle * 0.3 * xMult;
                chest.rotation.y = 0;
                chest.rotation.z = dragSwayAngle * 0.3 * zMult;
              } else {
                chest.rotation.x = (chestOffsetX + 0.015 + Math.sin(time * breathingSpeed) * breathingDepth + Math.sin(time * breathingSpeed * 2) * (breathingDepth * 0.25)) * xMult;
                chest.rotation.y = (Math.sin(time * 0.3) * 0.01 + orbitSwayAngle * 0.3) * yMult;       // slow sway + orbit inertia
              }
            }

            const spine = getBoneNode(vrm, 'spine');
            if (spine) {
              if (dragStateProgress > 0) {
                spine.rotation.x = dragPitchAngle * 0.45 * xMult;
                spine.rotation.y = 0;
                spine.rotation.z = dragSwayAngle * 0.45 * zMult;
              } else {
                spine.rotation.x = spineOffsetX * xMult;                      // stretch bend back
                spine.rotation.y = (Math.sin(time * 0.25) * 0.012 + orbitSwayAngle * 0.2) * yMult;     // spine sway + orbit inertia
                spine.rotation.z = Math.cos(time * 0.2) * 0.006 * zMult;
              }
            }

            const neck = getBoneNode(vrm, 'neck');
            if (neck) {
              let awakeNeckX = 0;
              let awakeNeckY = 0;
              let awakeNeckZ = 0;

              if (dragStateProgress > 0) {
                // Head sway leans with movement but stabilizes looking forward
                awakeNeckX = (dragPitchAngle * 0.5 - 0.04) * xMult;
                awakeNeckZ = (dragSwayAngle * 0.5) * zMult;
                awakeNeckY = 0;
              } else {
                let neckAnimX = 0;
                let neckAnimY = 0;
                let neckAnimZ = 0;

                if (idleAnimState === 'grooving') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimY = Math.sin(time * 5.5) * 0.12 * easeVal;
                  neckAnimZ = Math.cos(time * 5.5) * 0.08 * easeVal;
                } else if (idleAnimState === 'peering') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimZ = 0.08 * easeVal;
                } else if (idleAnimState === 'laughing') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimY = Math.sin(time * 16.0) * 0.04 * easeVal;
                  neckAnimX = -0.06 * easeVal + Math.sin(time * 22.0) * 0.03 * easeVal;
                } else if (idleAnimState === 'giggle_cover') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimY = Math.sin(time * 16.0) * 0.04 * easeVal;
                  neckAnimX = -0.05 * easeVal + Math.sin(time * 20.0) * 0.02 * easeVal;
                  neckAnimZ = 0.08 * easeVal;
                } else if (idleAnimState === 'nodding') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimX = (Math.sin(time * 12.0) * 0.12) * easeVal;
                } else if (idleAnimState === 'head_shake') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimY = (Math.sin(time * 14.0) * 0.18) * easeVal;
                } else if (idleAnimState === 'salute') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimZ = 0.05 * easeVal;
                } else if (idleAnimState === 'cheering') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimX = (Math.sin(time * 15.0) * 0.06) * easeVal;
                } else if (idleAnimState === 'shy_fidget') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimZ = Math.sin(time * 4.0) * 0.06 * easeVal;
                } else if (idleAnimState === 'pouting') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimY = 0.35 * easeVal; // Turns head away defensively in a "hmph!" sulk
                  neckAnimX = -0.07 * easeVal; // Tilts chin up proudly/petulantly
                  neckAnimZ = 0.06 * easeVal; // Cute slight head tilt
                } else if (idleAnimState === 'disappointed_nod' || idleAnimState === 'look_down') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimX = (-0.15 * easeVal + Math.sin(time * 5.0) * 0.04) * easeVal;
                } else if (idleAnimState === 'crying_sob') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimX = (-0.1 * easeVal + Math.sin(time * 18.0) * 0.03) * easeVal;
                } else if (idleAnimState === 'shocked_recoil') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  neckAnimX = 0.18 * easeVal;
                  neckAnimZ = -0.08 * easeVal;
                }

                awakeNeckY = (currentLookY + Math.sin(time * 0.5) * 0.012 + microFidgetNeckY + neckAnimY) * yMult;

                // Baseline chest-nudge neck compensation (head nods down slightly when chest expands)
                const breathingNod = Math.sin(time * breathingSpeed) * (breathingDepth * 0.3);
                awakeNeckX = (-0.12 + neckOffsetX + currentLookX + Math.sin(time * 0.35) * 0.012 - breathingNod + microFidgetNeckX + neckAnimX) * xMult;

                // Head Tilts for Empathy (Z-roll) & Curious Thinking
                let tiltZ = microFidgetNeckZ + neckAnimZ + currentLookZ;
                let tiltX = 0;

                if (isThinkingRef.current) {
                  tiltZ += -0.035; // thoughtful tilt to the right
                  tiltX = -0.07; // look up slightly to think
                }

                awakeNeckZ = tiltZ * zMult;
                awakeNeckX += tiltX * xMult;
              }

              // Slump forward and slightly sideways when sleeping
              const asleepNeckX = -0.25 * xMult;
              const asleepNeckZ = 0.03 * zMult;
              const asleepNeckY = (Math.sin(time * 0.15) * 0.04) * yMult;

              neck.rotation.x = THREE.MathUtils.lerp(awakeNeckX, asleepNeckX, sleepProgressRef.current);
              neck.rotation.y = THREE.MathUtils.lerp(awakeNeckY, asleepNeckY, sleepProgressRef.current);
              neck.rotation.z = THREE.MathUtils.lerp(awakeNeckZ, asleepNeckZ, sleepProgressRef.current);
            }

            const headNode = getBoneNode(vrm, 'head');
            if (headNode) {
              headNode.rotation.set(0, 0, 0);
            }
            const upperChest = getBoneNode(vrm, 'upperChest');
            if (upperChest) {
              upperChest.rotation.set(0, 0, 0);
            }

            // Real shoulder (clavicle) bones for breathing shrugs
            const leftClavicle = getBoneNode(vrm, 'leftShoulder');
            const rightClavicle = getBoneNode(vrm, 'rightShoulder');
            if (leftClavicle && rightClavicle) {
              // Clavicles raise slightly during inspiration
              const inspirationPhase = Math.sin(time * breathingSpeed);
              const shoulderLift = Math.max(0, inspirationPhase) * (breathingDepth * 0.4);

              let stretchShrug = 0;
              if (idleAnimState === 'yawning') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                stretchShrug = 0.08 * easeVal;
              } else if (idleAnimState === 'shrugging') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                stretchShrug = 0.14 * easeVal;
              } else if (idleAnimState === 'laughing' || idleAnimState === 'giggle_cover') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                stretchShrug = (0.03 + Math.sin(time * 24.0) * 0.02) * easeVal;
              } else if (idleAnimState === 'crying_sob') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                stretchShrug = (0.04 + Math.sin(time * 20.0) * 0.03) * easeVal;
              }

              const finalLift = shoulderLift + stretchShrug;
              leftClavicle.rotation.z = finalLift * zMult;
              rightClavicle.rotation.z = -finalLift * zMult;

              // Subtle rotation on X-axis (tilting back on breath)
              leftClavicle.rotation.x = -finalLift * 0.35 * xMult;
              rightClavicle.rotation.x = -finalLift * 0.35 * xMult;

              leftClavicle.rotation.y = 0;
              rightClavicle.rotation.y = 0;
            }

            const leftEye = getBoneNode(vrm, 'leftEye');
            const rightEye = getBoneNode(vrm, 'rightEye');
            if (leftEye && rightEye) {
              // Rotates the eyes subtler than the neck, preventing eyeballs from rolling too high when head tilts up
              const rawEyeYaw = currentGazeY * 0.08 + saccadeY;
              const rawEyePitch = currentGazeX * 0.08 - 0.015 + saccadeX;

              // Clamp eye rotation to human anatomical limits so eyes stay centered within eyelids
              const eyeYaw = Math.max(-0.12, Math.min(0.12, rawEyeYaw));
              const eyePitch = Math.max(-0.06, Math.min(0.06, rawEyePitch));

              leftEye.rotation.y = eyeYaw * yMult;
              leftEye.rotation.x = eyePitch * xMult;
              rightEye.rotation.y = eyeYaw * yMult;
              rightEye.rotation.x = eyePitch * xMult;
            }

            // Arm and Leg bones for walking/standing animation
            const leftShoulder = getBoneNode(vrm, 'leftUpperArm');
            const rightShoulder = getBoneNode(vrm, 'rightUpperArm');
            const leftLeg = getBoneNode(vrm, 'leftUpperLeg');
            const rightLeg = getBoneNode(vrm, 'rightUpperLeg');
            const leftLowerLeg = getBoneNode(vrm, 'leftLowerLeg');
            const rightLowerLeg = getBoneNode(vrm, 'rightLowerLeg');

            if (isWalkingRef.current) {
              if (isVrmaActiveRef.current && currentVrmaActionRef.current) {
                currentVrmaActionRef.current.fadeOut(0.2);
                currentVrmaActionRef.current = null;
                isVrmaActiveRef.current = false;
                idleAnimState = 'none';
              }
              // Procedural walk cycle speed and time
              const walkSpeed = 6.8; // slightly slower step frequency for smoother glide
              const walkTime = time * walkSpeed;

              // Opposing leg swings (contralateral)
              if (leftLeg) leftLeg.rotation.x = Math.sin(walkTime) * 0.35;
              if (rightLeg) rightLeg.rotation.x = -Math.sin(walkTime) * 0.35;

              // Bend knees backward during recovery swing phase
              if (leftLowerLeg) leftLowerLeg.rotation.x = Math.max(0, -Math.sin(walkTime)) * 0.45;
              if (rightLowerLeg) rightLowerLeg.rotation.x = Math.max(0, Math.sin(walkTime)) * 0.45;

              // Contralateral arm swings (opposite to legs)
              if (leftShoulder) {
                leftShoulder.rotation.x = (0.15 - Math.sin(walkTime) * 0.25) * xMult; // opposite to left leg swing
                leftShoulder.rotation.y = 0.08 * yMult;
                leftShoulder.rotation.z = (1.22 + Math.cos(walkTime) * 0.05) * zMult; // slight arm drift
              }
              if (rightShoulder) {
                rightShoulder.rotation.x = (0.15 + Math.sin(walkTime) * 0.25) * xMult; // opposite to right leg swing
                rightShoulder.rotation.y = -0.08 * yMult;
                rightShoulder.rotation.z = (-1.22 + Math.cos(walkTime) * 0.05) * zMult;
              }

              // Hips rotation and sway
              const hips = getBoneNode(vrm, 'hips');
              if (hips) {
                hips.rotation.y = Math.sin(walkTime) * 0.06 * yMult; // horizontal twist
                hips.rotation.z = Math.cos(walkTime) * 0.03 * zMult; // side sway matching weight shift
                hips.position.x = Math.cos(walkTime) * 0.015 * zMult; // local X slide flip
              }

              // Smooth body bobbing (twice per step cycle)
              vrm.scene.position.y = Math.abs(Math.sin(walkTime)) * 0.025;
              vrm.scene.position.x = 0; // ensure character stays dead center in canvas
              vrm.scene.position.z = 0; // reset Z-position
            } else {
              const enableWeightShift = window.yukiDebugToggles ? window.yukiDebugToggles.weightShift : true;
              const shiftCycle = enableWeightShift ? Math.sin(time * 0.1) : 0;

              // Gentle zero-g drift overlay (ONLY IN ELECTRON)
              const isElectronMode = window.electronAPI && window.electronAPI.isElectron;
              let floatOffsetY = 0;
              let floatOffsetX = 0;
              let floatLegAngle = 0;
              const enableFloatingIdle = !disabledAnimationsRef.current.includes('floating') && (window.yukiDebugToggles ? window.yukiDebugToggles.floatingIdle !== false : true);
              if (enableFloatingIdle && isElectronMode && !isWalkingRef.current && dragStateProgress === 0 && !knockActive) {
                const floatMultiplier = 1.0 - sleepProgressRef.current;
                floatOffsetY = Math.sin(time * 1.1) * 0.015 * floatMultiplier; // gently hover 1.8cm up/down (more subtle)
                floatOffsetX = Math.cos(time * 0.6) * 0.01 * floatMultiplier;  // gently drift 1cm side-to-side (more subtle)
                floatLegAngle = Math.sin(time * 1.2 - 0.5) * 0.02 * floatMultiplier; // leg drag lag (more subtle)
              }

              const hips = getBoneNode(vrm, 'hips');
              if (hips) {
                let awakeHipsZ = 0;
                let awakeHipsX = 0;
                let awakeHipsPosX = 0;

                if (dragStateProgress > 0) {
                  // Apply inertial side sway and forward/backward tilt
                  awakeHipsZ = dragSwayAngle * 0.6 * zMult;
                  awakeHipsX = dragPitchAngle * 0.5 * xMult;
                  awakeHipsPosX = dragSwayAngle * 0.1 * zMult; // local X slide flip
                } else {
                  awakeHipsZ = shiftCycle * 0.025 * zMult; // hips tilt
                  awakeHipsPosX = shiftCycle * 0.015 * zMult; // hips slide flip
                }

                const asleepHipsZ = 0.005 * zMult;
                const asleepHipsX = 0.0;
                const asleepHipsPosX = 0.0;

                hips.rotation.z = THREE.MathUtils.lerp(awakeHipsZ, asleepHipsZ, sleepProgressRef.current);
                hips.rotation.x = THREE.MathUtils.lerp(awakeHipsX, asleepHipsX, sleepProgressRef.current);
                hips.rotation.y = 0;
                hips.position.x = THREE.MathUtils.lerp(awakeHipsPosX, asleepHipsPosX, sleepProgressRef.current);
                if (!initialHipsPosRef.current) {
                  initialHipsPosRef.current = hips.position.clone();
                }
                if (initialHipsPosRef.current) {
                  hips.position.y = initialHipsPosRef.current.y;
                  hips.position.z = initialHipsPosRef.current.z;
                }
              }

              let awakeSceneY = 0;
              let awakeSceneZ = 0;
              let awakeSceneX = 0;

              if (dragStateProgress > 0) {
                awakeSceneY = -0.09 * dragStateProgress; // hang down
                awakeSceneZ = -dragPitchAngle * 0.3; // slide back slightly under forward drag
                awakeSceneX = 0;
              } else if (knockActive) {
                const easeVal = Math.sin((knockTimer / knockDuration) * Math.PI);
                awakeSceneY = 0;
                awakeSceneZ = easeVal * 0.18; // step forward to knock screen
                awakeSceneX = 0;
              } else {
                awakeSceneY = floatOffsetY;
                awakeSceneZ = 0;
                awakeSceneX = floatOffsetX;

                // Apply peering Z displacement
                if (idleAnimState === 'peering') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeSceneZ = 0.22 * easeVal;
                }
              }

              const asleepSceneY = -0.02; // sink down slightly
              const asleepSceneZ = 0;
              const asleepSceneX = 0;

              const targetSceneY = THREE.MathUtils.lerp(awakeSceneY, asleepSceneY, sleepProgressRef.current);
              const targetSceneZ = THREE.MathUtils.lerp(awakeSceneZ, asleepSceneZ, sleepProgressRef.current);
              const targetSceneX = THREE.MathUtils.lerp(awakeSceneX, asleepSceneX, sleepProgressRef.current);
              vrm.scene.position.y += (targetSceneY - vrm.scene.position.y) * Math.min(1, delta * 5.0);
              vrm.scene.position.z += (targetSceneZ - vrm.scene.position.z) * Math.min(1, delta * 5.0);
              vrm.scene.position.x += (targetSceneX - vrm.scene.position.x) * Math.min(1, delta * 5.0);

              if (leftShoulder) {
                let awakeShoulderX = 0;
                let awakeShoulderY = 0;
                let awakeShoulderZ = 0;

                if (dragStateProgress > 0) {
                  // Left arm raises up sideways and sways
                  awakeShoulderX = (0.15 + dragPitchAngle * 0.5) * xMult;
                  awakeShoulderY = 0.08 * yMult;
                  awakeShoulderZ = ((1.25 - 0.45 * dragStateProgress) + Math.sin(dragDangleTimer * 0.8) * 0.08 * dragStateProgress) * zMult;
                } else if (idleAnimState === 'cheering') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.6 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = 0.08 * yMult;
                  awakeShoulderZ = (0.2 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                } else if (idleAnimState === 'shy_fidget') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.4 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.2 * easeVal + 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (1.05 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                  leftElbowOffsetY = -0.5 * easeVal;
                } else if (idleAnimState === 'cat_stretch' || idleAnimState === 'neck_crack') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.9 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.2 * easeVal + 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (0.1 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                  leftElbowOffsetY = -0.8 * easeVal;
                } else if (idleAnimState === 'finger_guns') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.7 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.15 * easeVal + 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (0.7 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                  leftElbowOffsetY = -0.8 * easeVal;
                } else if (idleAnimState === 'formal_bow' || idleAnimState === 'bow') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (-0.25 * easeVal + 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (0.85 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                } else {
                  const upperArmTime = time * 1.2;
                  const multiSwayX = (Math.sin(upperArmTime) * 0.012 + Math.cos(upperArmTime * 2.3 + 0.4) * 0.006);
                  const multiSwayZ = (Math.sin(upperArmTime * 0.9 + 0.5) * 0.016 + Math.cos(upperArmTime * 2.1) * 0.008);
                  awakeShoulderX = (0.15 + multiSwayX) * xMult;
                  awakeShoulderY = (0.08 + Math.sin(upperArmTime * 0.7) * 0.008 + orbitSwayAngle * 0.3) * yMult;
                  awakeShoulderZ = (leftArmOffsetZ + 1.25 + multiSwayZ - shiftCycle * 0.01) * zMult;
                }

                const asleepShoulderX = 0.06 * xMult;
                const asleepShoulderY = 0.04 * yMult;
                const asleepShoulderZ = 1.15 * zMult;

                leftShoulder.rotation.x = THREE.MathUtils.lerp(awakeShoulderX, asleepShoulderX, sleepProgressRef.current);
                leftShoulder.rotation.y = THREE.MathUtils.lerp(awakeShoulderY, asleepShoulderY, sleepProgressRef.current);
                leftShoulder.rotation.z = THREE.MathUtils.lerp(awakeShoulderZ, asleepShoulderZ, sleepProgressRef.current);
              }

              if (rightShoulder) {
                let awakeShoulderX = 0;
                let awakeShoulderY = 0;
                let awakeShoulderZ = 0;

                if (knockActive) {
                  // Perform screen knocking pose and animation (raise arm forward and tap)
                  const easeVal = Math.sin((knockTimer / knockDuration) * Math.PI);
                  awakeShoulderX = (0.8 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.4 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-1.0 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else if (dragStateProgress > 0) {
                  // Right arm raises up sideways and sways (out of phase)
                  awakeShoulderX = (0.15 + dragPitchAngle * 0.5) * xMult;
                  awakeShoulderY = -0.08 * yMult;
                  awakeShoulderZ = ((-1.25 + 0.45 * dragStateProgress) + Math.cos(dragDangleTimer * 0.8) * 0.08 * dragStateProgress) * zMult;
                } else if (idleAnimState === 'greeting_wave') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  // Lift arm up and outwards naturally (Z = -0.4) and twist palm forward (Y = 0.7)
                  awakeShoulderX = (0.3 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.7 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.4 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else if (idleAnimState === 'salute') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  // Crisp military salute: raise right arm to temple
                  awakeShoulderX = (0.85 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.5 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.55 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = 1.6 * easeVal;
                } else if (idleAnimState === 'cheering') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.6 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = -0.08 * yMult;
                  awakeShoulderZ = (-0.2 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else if (idleAnimState === 'pointing') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.65 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.1 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.85 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else if (idleAnimState === 'shy_fidget') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.4 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (-0.2 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-1.05 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = -0.5 * easeVal;
                } else if (idleAnimState === 'giggle_cover') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.75 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.45 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.6 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = -0.9 * easeVal;
                } else if (idleAnimState === 'cat_stretch' || idleAnimState === 'neck_crack') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.9 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (-0.2 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.1 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = 0.8 * easeVal;
                } else if (idleAnimState === 'peace_sign') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.75 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.35 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.65 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = 1.3 * easeVal;
                } else if (idleAnimState === 'finger_guns') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.7 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (-0.15 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.7 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                  rightElbowOffsetY = 0.8 * easeVal;
                } else if (idleAnimState === 'formal_bow' || idleAnimState === 'bow') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.25 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-0.85 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else {
                  const upperArmTime = time * 1.2 + 0.5;
                  const multiSwayX = (Math.sin(upperArmTime) * 0.012 + Math.cos(upperArmTime * 2.3 + 0.8) * 0.006);
                  const multiSwayZ = (Math.sin(upperArmTime * 0.9 + 0.2) * 0.016 + Math.cos(upperArmTime * 2.1) * 0.008);
                  awakeShoulderX = (0.15 + multiSwayX) * xMult;
                  awakeShoulderY = (-0.08 - Math.sin(upperArmTime * 0.7) * 0.008 + orbitSwayAngle * 0.3) * yMult;
                  awakeShoulderZ = (rightArmOffsetZ - 1.25 - multiSwayZ + shiftCycle * 0.01) * zMult;
                }

                const asleepShoulderX = 0.06 * xMult;
                const asleepShoulderY = -0.04 * yMult;
                const asleepShoulderZ = -1.15 * zMult;

                rightShoulder.rotation.x = THREE.MathUtils.lerp(awakeShoulderX, asleepShoulderX, sleepProgressRef.current);
                rightShoulder.rotation.y = THREE.MathUtils.lerp(awakeShoulderY, asleepShoulderY, sleepProgressRef.current);
                rightShoulder.rotation.z = THREE.MathUtils.lerp(awakeShoulderZ, asleepShoulderZ, sleepProgressRef.current);
              }

              // Bend knee of non-weight-bearing leg (procedural weight shifting / dangling)
              if (dragStateProgress > 0) {
                const dangleSwingLeft = Math.sin(dragDangleTimer) * 0.08 * dragStateProgress;
                const dangleSwingRight = Math.cos(dragDangleTimer + 0.5) * 0.08 * dragStateProgress;

                if (leftLeg) {
                  leftLeg.rotation.x = (0.1 + dangleSwingLeft + dragPitchAngle * 0.4) * xMult;
                  leftLeg.rotation.y = 0;
                  leftLeg.rotation.z = -0.05 * dragStateProgress * zMult;
                }
                if (rightLeg) {
                  rightLeg.rotation.x = (0.1 + dangleSwingRight + dragPitchAngle * 0.4) * xMult;
                  rightLeg.rotation.y = 0;
                  rightLeg.rotation.z = 0.05 * dragStateProgress * zMult;
                }
                if (leftLowerLeg) {
                  leftLowerLeg.rotation.x = (0.25 + Math.sin(dragDangleTimer * 1.3) * 0.08) * dragStateProgress * xMult;
                  leftLowerLeg.rotation.y = 0;
                  leftLowerLeg.rotation.z = 0;
                }
                if (rightLowerLeg) {
                  rightLowerLeg.rotation.x = (0.25 + Math.cos(dragDangleTimer * 1.3 + 0.3) * 0.08) * dragStateProgress * xMult;
                  rightLowerLeg.rotation.y = 0;
                  rightLowerLeg.rotation.z = 0;
                }
              } else {
                if (leftLeg) {
                  const awakeVal = Math.max(0, shiftCycle) * 0.06;
                  leftLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
                  leftLeg.rotation.y = 0;
                  leftLeg.rotation.z = floatLegAngle * zMult;
                }
                if (rightLeg) {
                  const awakeVal = Math.max(0, -shiftCycle) * 0.06;
                  rightLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
                  rightLeg.rotation.y = 0;
                  rightLeg.rotation.z = -floatLegAngle * zMult;
                }
                if (leftLowerLeg) {
                  const awakeVal = Math.max(0, shiftCycle) * 0.1;
                  leftLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
                  leftLowerLeg.rotation.y = 0;
                  leftLowerLeg.rotation.z = 0;
                }
                if (rightLowerLeg) {
                  const awakeVal = Math.max(0, -shiftCycle) * 0.1;
                  rightLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
                  rightLowerLeg.rotation.y = 0;
                  rightLowerLeg.rotation.z = 0;
                }
              }
              const leftFoot = getBoneNode(vrm, 'leftFoot');
              const rightFoot = getBoneNode(vrm, 'rightFoot');
              if (leftFoot) leftFoot.rotation.set(0.12 * xMult, 0, 0);
              if (rightFoot) rightFoot.rotation.set(0.12 * xMult, 0, 0);
              const leftToes = getBoneNode(vrm, 'leftToes');
              const rightToes = getBoneNode(vrm, 'rightToes');
              if (leftToes) leftToes.rotation.set(0, 0, 0);
              if (rightToes) rightToes.rotation.set(0, 0, 0);
            }

            const leftElbow = getBoneNode(vrm, 'leftLowerArm');
            const rightElbow = getBoneNode(vrm, 'rightLowerArm');
            if (leftElbow) {
              let awakeElbowX = 0;
              let awakeElbowY = 0;
              let awakeElbowZ = 0;

              const lowerArmTime = (time - 0.18) * 1.2; // 180ms kinetic phase lag behind upper arm
              const elbowSwayY = (Math.sin(lowerArmTime * 1.1) * 0.015 + Math.cos(lowerArmTime * 2.4 + 0.3) * 0.008);
              const elbowFlexX = (0.22 + Math.sin(lowerArmTime * 0.85) * 0.015); // natural relaxed X elbow bend forward
              const elbowFlexZ = (0.06 + Math.cos(lowerArmTime * 0.7) * 0.008);
              awakeElbowX = (isWalkingRef.current ? 0.1 : elbowFlexX) * xMult;
              awakeElbowY = (leftElbowOffsetY - 0.2 + (isWalkingRef.current ? 0 : elbowSwayY)) * yMult;
              awakeElbowZ = (isWalkingRef.current ? 0 : elbowFlexZ) * zMult;

              const asleepElbowX = 0.08 * xMult;
              const asleepElbowY = -0.15 * yMult;
              const asleepElbowZ = 0 * zMult;

              leftElbow.rotation.x = THREE.MathUtils.lerp(awakeElbowX, asleepElbowX, sleepProgressRef.current);
              leftElbow.rotation.y = THREE.MathUtils.lerp(awakeElbowY, asleepElbowY, sleepProgressRef.current);
              leftElbow.rotation.z = THREE.MathUtils.lerp(awakeElbowZ, asleepElbowZ, sleepProgressRef.current);
            }
            if (rightElbow) {
              let awakeElbowX = 0;
              let awakeElbowY = 0;
              let awakeElbowZ = 0;

              if (knockActive) {
                const easeVal = Math.sin((knockTimer / knockDuration) * Math.PI);
                const tapOffset = knockTimer < 0.45 ? Math.sin(knockTimer * Math.PI * 14) * 0.14 : 0;
                awakeElbowZ = ((-1.3 + tapOffset) * easeVal) * zMult;
                awakeElbowY = (rightElbowOffsetY + 0.2 * easeVal) * yMult;
                awakeElbowX = 0.3 * easeVal * xMult;
              } else if (idleAnimState === 'greeting_wave') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                awakeElbowZ = (1.4 * easeVal) * zMult;
                awakeElbowY = (rightElbowOffsetY + 1.6 * easeVal) * yMult;
                awakeElbowX = 0.4 * easeVal * xMult;
              } else {
                const lowerArmTime = (time - 0.18) * 1.2 + 0.5; // 180ms kinetic phase lag behind upper arm
                const elbowSwayY = (Math.sin(lowerArmTime * 1.1) * 0.015 + Math.cos(lowerArmTime * 2.4 + 0.6) * 0.008);
                const elbowFlexX = (0.22 + Math.sin(lowerArmTime * 0.85 + 0.5) * 0.015); // natural relaxed X elbow bend forward
                const elbowFlexZ = (-0.06 - Math.cos(lowerArmTime * 0.7 + 0.5) * 0.008);
                awakeElbowX = (isWalkingRef.current ? 0.1 : elbowFlexX) * xMult;
                awakeElbowY = (rightElbowOffsetY + 0.2 + (isWalkingRef.current ? 0 : elbowSwayY)) * yMult;
                awakeElbowZ = (isWalkingRef.current ? 0 : elbowFlexZ) * zMult;
              }

              const asleepElbowX = 0.08 * xMult;
              const asleepElbowY = 0.15 * yMult;
              const asleepElbowZ = 0 * zMult;

              rightElbow.rotation.x = THREE.MathUtils.lerp(awakeElbowX, asleepElbowX, sleepProgressRef.current);
              rightElbow.rotation.y = THREE.MathUtils.lerp(awakeElbowY, asleepElbowY, sleepProgressRef.current);
              rightElbow.rotation.z = THREE.MathUtils.lerp(awakeElbowZ, asleepElbowZ, sleepProgressRef.current);
            }

            const leftHand = getBoneNode(vrm, 'leftHand');
            const rightHand = getBoneNode(vrm, 'rightHand');

            // Kinetic drag time with ~350ms phase lag behind shoulders
            const handTimeL = (time - 0.35) * 1.2;
            const handTimeR = (time - 0.35) * 1.2 + 0.5;

            // Micro-fidget impulse generator for wrists (spikes periodically every ~4-6s)
            const fidgetTriggerL = Math.max(0, Math.sin(time * 0.75) - 0.80) * 5.0;
            const fidgetTriggerR = Math.max(0, Math.sin(time * 0.75 + 1.8) - 0.80) * 5.0;

            const fidgetWristXL = Math.sin(time * 4.3) * 0.035 * fidgetTriggerL;
            const fidgetWristYL = Math.cos(time * 3.7) * 0.045 * fidgetTriggerL;
            const fidgetWristZL = Math.sin(time * 5.2) * 0.030 * fidgetTriggerL;

            const fidgetWristXR = Math.sin(time * 4.1 + 0.5) * 0.035 * fidgetTriggerR;
            const fidgetWristYR = Math.cos(time * 3.9 + 0.5) * 0.045 * fidgetTriggerR;
            const fidgetWristZR = Math.sin(time * 4.9 + 0.5) * 0.030 * fidgetTriggerR;

            if (leftHand && !isWalkingRef.current) {
              let awakeX = (Math.sin(handTimeL * 1.3) * 0.020 + Math.cos(handTimeL * 2.7) * 0.008 + fidgetWristXL) * xMult;
              let awakeY = (Math.sin(handTimeL * 0.95 + 0.4) * 0.030 + Math.cos(handTimeL * 1.8) * 0.012 + fidgetWristYL + orbitSwayAngle * 0.5) * yMult;
              let awakeZ = (Math.cos(handTimeL * 1.1) * 0.018 + Math.sin(handTimeL * 2.2) * 0.007 + fidgetWristZL) * zMult;

              leftHand.rotation.x = THREE.MathUtils.lerp(awakeX, 0.0, sleepProgressRef.current);
              leftHand.rotation.y = THREE.MathUtils.lerp(awakeY, 0.0, sleepProgressRef.current);
              leftHand.rotation.z = THREE.MathUtils.lerp(awakeZ, 0.0, sleepProgressRef.current);
            }
            if (rightHand && !isWalkingRef.current) {
              let awakeX = 0;
              let awakeY = 0;
              let awakeZ = 0;
              if (idleAnimState === 'greeting_wave') {
                const t = idleAnimProgress / idleAnimDuration;
                if (t > 0.26 && t < 0.73) {
                  // Wave hand with smooth ease-in/out multiplier
                  const waveEase = Math.sin((t - 0.15) / 0.7 * Math.PI);
                  awakeY = Math.sin(time * 17) * 0.25 * waveEase * yMult;
                }
              } else {
                awakeX = (Math.sin(handTimeR * 1.3) * 0.020 + Math.cos(handTimeR * 2.7) * 0.008 + fidgetWristXR) * xMult;
                awakeY = (-Math.sin(handTimeR * 0.95 + 0.4) * 0.030 - Math.cos(handTimeR * 1.8) * 0.012 + fidgetWristYR + orbitSwayAngle * 0.5) * yMult;
                awakeZ = (-Math.cos(handTimeR * 1.1) * 0.018 - Math.sin(handTimeR * 2.2) * 0.007 + fidgetWristZR) * zMult;
              }
              rightHand.rotation.x = THREE.MathUtils.lerp(awakeX, 0.0, sleepProgressRef.current);
              rightHand.rotation.y = THREE.MathUtils.lerp(awakeY, 0.0, sleepProgressRef.current);
              rightHand.rotation.z = THREE.MathUtils.lerp(awakeZ, 0.0, sleepProgressRef.current);
            }

            // Procedural Hand & Finger Animation Layer
            const enableFingerFidget = window.yukiDebugToggles ? window.yukiDebugToggles.fingerFidget : true;
            if (fingerBonesRef.current && enableFingerFidget) {
              const fingersObj = fingerBonesRef.current;
              ['left', 'right'].forEach((side) => {
                const sideSign = side === 'left' ? 1.0 : -1.0;

                // Multipliers/Offsets based on active companion states
                const dragMultiplier = dragStateProgress; // 0 to 1
                const thinkAdd = isThinkingRef.current ? 0.08 : 0.0;
                const sleepAdd = sleepProgressRef.current * 0.20;

                // Audio-reactive flex (talking gesture)
                let speakFlex = 0.0;
                if (audioLevelRef.current > 0.015) {
                  speakFlex = Math.sin(time * 10.0) * 0.06 * Math.min(audioLevelRef.current * 10.0, 1.0);
                }

                const fingers = ['index', 'middle', 'ring', 'little', 'thumb'];
                fingers.forEach((finger, fIndex) => {
                  const bones = fingersObj[side]?.[finger];
                  if (!bones) return;

                  // Base curl angles for a natural, relaxed cup shape
                  let baseCurl = 0.12;
                  if (finger === 'index') baseCurl = 0.10;
                  else if (finger === 'middle') baseCurl = 0.18;
                  else if (finger === 'ring') baseCurl = 0.26;
                  else if (finger === 'little') baseCurl = 0.34;
                  else if (finger === 'thumb') baseCurl = 0.08;

                  // Calculate target curl bend
                  // Under drag/grab, fingers extend/splay wide (-0.12 rad target)
                  const targetCurl = baseCurl * (1.0 - dragMultiplier) - 0.12 * dragMultiplier + thinkAdd + sleepAdd + speakFlex;

                  // Micro-fidget twitches (using asynchronous prime frequencies and organic impulses)
                  const fidgetFreq = 1.3 + fIndex * 0.47 + (side === 'left' ? 0.0 : 0.23);
                  const fidgetMultiplier = THREE.MathUtils.lerp(1.0, 0.15, sleepProgressRef.current);

                  // Organic impulse spike (occasional finger twitch)
                  const fingerTrigger = Math.max(0, Math.sin(time * 0.6 + fIndex * 1.1 + (side === 'left' ? 0 : 2.0)) - 0.85) * 6.0;
                  const organicTwitch = Math.sin(time * 6.5 + fIndex * 1.7) * 0.025 * fingerTrigger;

                  const fidgetVal = (Math.sin(time * fidgetFreq) * 0.018 + organicTwitch) * (1.0 - dragMultiplier) * fidgetMultiplier;

                  const finalCurl = targetCurl + fidgetVal;

                  bones.forEach((joint, jIndex) => {
                    // Bend joint on Z-axis (standard VRM humanoid finger bend axis)
                    // Distal joint (2) bends slightly less
                    const jointFactor = jIndex === 2 ? 0.75 : 1.0;
                    joint.rotation.z = sideSign * finalCurl * jointFactor * zMult;

                    // Slightly rotate the thumb on Y/X to curl inwards naturally
                    if (finger === 'thumb' && jIndex === 0) {
                      joint.rotation.y = sideSign * 0.06 * (1.0 - dragMultiplier) * yMult;
                    }
                  });
                });
              });
            }

            // If exiting from a VRMA motion capture animation, smoothly interpolate ALL bones
            // and scene origin from the exact final mocap pose into the live procedural idle pose!
            if (vrmaExitBlendActiveRef.current) {
              vrmaExitProgressRef.current += delta;
              const exitT = Math.min(1.0, vrmaExitProgressRef.current / vrmaExitDurationRef.current);
              // Cubic smoothstep curve for liquid-smooth deceleration
              const alpha = exitT * exitT * (3 - 2 * exitT);

              const lerpShortestAngle = (a, b, t) => {
                let diff = (b - a) % (Math.PI * 2);
                if (diff > Math.PI) diff -= Math.PI * 2;
                if (diff < -Math.PI) diff += Math.PI * 2;
                return a + diff * t;
              };

              vrmaExitSnapshotsRef.current.forEach((snap, node) => {
                node.rotation.x = lerpShortestAngle(snap.x, node.rotation.x, alpha);
                node.rotation.y = lerpShortestAngle(snap.y, node.rotation.y, alpha);
                node.rotation.z = lerpShortestAngle(snap.z, node.rotation.z, alpha);
              });

              // Smoothly interpolate hips local position from mocap final position to procedural idle position
              const hipsNode = getBoneNode(vrm, 'hips');
              if (hipsNode && vrmaExitHipsPosSnapRef.current) {
                hipsNode.position.x = THREE.MathUtils.lerp(vrmaExitHipsPosSnapRef.current.x, hipsNode.position.x, alpha);
                hipsNode.position.y = THREE.MathUtils.lerp(vrmaExitHipsPosSnapRef.current.y, hipsNode.position.y, alpha);
                hipsNode.position.z = THREE.MathUtils.lerp(vrmaExitHipsPosSnapRef.current.z, hipsNode.position.z, alpha);
              }

              // Smoothly interpolate scene position from mocap final position to procedural floating position
              vrm.scene.position.x = THREE.MathUtils.lerp(vrmaExitScenePosSnapRef.current.x, vrm.scene.position.x, alpha);
              vrm.scene.position.y = THREE.MathUtils.lerp(vrmaExitScenePosSnapRef.current.y, vrm.scene.position.y, alpha);
              vrm.scene.position.z = THREE.MathUtils.lerp(vrmaExitScenePosSnapRef.current.z, vrm.scene.position.z, alpha);

              if (exitT >= 1.0) {
                vrmaExitBlendActiveRef.current = false;
                vrmaExitSnapshotsRef.current.clear();
              }
            }
          }
        } else {
          // VRMA motion capture active: let Three.js AnimationMixer drive skeleton smoothly
          if (dragStateProgress > 0) {
            if (currentVrmaActionRef.current) {
              currentVrmaActionRef.current.fadeOut(0.2);
              currentVrmaActionRef.current = null;
              isVrmaActiveRef.current = false;
              isVrmaUpperBodyRef.current = false;
              vrmaExitBlendActiveRef.current = false;
              vrmaExitSnapshotsRef.current.clear();
            }
          } else if (isVrmaUpperBodyRef.current) {
            // Floating upper-body animation: preserve Yuki's graceful floating hover and leg dangle!
            vrm.scene.position.y = floatOffsetY;
            vrm.scene.position.x = floatOffsetX;
            vrm.scene.position.z = 0;

            const hips = getBoneNode(vrm, 'hips');
            if (hips && initialHipsPosRef.current) {
              hips.position.y = initialHipsPosRef.current.y;
              hips.position.z = initialHipsPosRef.current.z;
              hips.rotation.y = 0;
            }

            const leftLeg = getBoneNode(vrm, 'leftUpperLeg');
            const rightLeg = getBoneNode(vrm, 'rightUpperLeg');
            const leftLowerLeg = getBoneNode(vrm, 'leftLowerLeg');
            const rightLowerLeg = getBoneNode(vrm, 'rightLowerLeg');

            if (leftLeg) {
              const awakeVal = Math.max(0, shiftCycle) * 0.06;
              leftLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
              leftLeg.rotation.y = 0;
              leftLeg.rotation.z = floatLegAngle * zMult;
            }
            if (rightLeg) {
              const awakeVal = Math.max(0, -shiftCycle) * 0.06;
              rightLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
              rightLeg.rotation.y = 0;
              rightLeg.rotation.z = -floatLegAngle * zMult;
            }
            if (leftLowerLeg) {
              const awakeVal = Math.max(0, shiftCycle) * 0.1;
              leftLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
              leftLowerLeg.rotation.y = 0;
              leftLowerLeg.rotation.z = 0;
            }
            if (rightLowerLeg) {
              const awakeVal = Math.max(0, -shiftCycle) * 0.1;
              rightLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
              rightLowerLeg.rotation.y = 0;
              rightLowerLeg.rotation.z = 0;
            }
            const leftFoot = getBoneNode(vrm, 'leftFoot');
            const rightFoot = getBoneNode(vrm, 'rightFoot');
            if (leftFoot) leftFoot.rotation.set(0.12 * xMult, 0, 0);
            if (rightFoot) rightFoot.rotation.set(0.12 * xMult, 0, 0);
            const leftToes = getBoneNode(vrm, 'leftToes');
            const rightToes = getBoneNode(vrm, 'rightToes');
            if (leftToes) leftToes.rotation.set(0, 0, 0);
            if (rightToes) rightToes.rotation.set(0, 0, 0);
          } else {
            // Full-body motion capture: smoothly transition scene origin towards floor base
            vrm.scene.position.x += (0 - vrm.scene.position.x) * Math.min(1, delta * 5.0);
            vrm.scene.position.y += (0 - vrm.scene.position.y) * Math.min(1, delta * 5.0);
            vrm.scene.position.z += (0 - vrm.scene.position.z) * Math.min(1, delta * 5.0);
          }
        }

        // Update Three.js AnimationMixer for VRMA motion capture playback and smooth cross-fading
        if (mixerRef.current) {
          mixerRef.current.update(delta);
        }

          // Ensure live active VRM is sanitized immediately even if hot-reloading
          if (vrm && !vrm._allEyeClosingIndices) {
            sanitizeExpressions(vrm);
          }

          // Check if eyes are already closed on the avatar (e.g. from sleep or an eye-closing expression)
          let activeEyeClosure = sleepProgressRef.current || 0;
          if (vrm && vrm._allEyeClosingIndices && vrm._blinkPrimitives) {
            for (let i = 0; i < vrm._blinkPrimitives.length; i++) {
              const prim = vrm._blinkPrimitives[i];
              if (prim && prim.morphTargetInfluences) {
                for (const idx of vrm._allEyeClosingIndices) {
                  const influence = prim.morphTargetInfluences[idx] || 0;
                  if (influence > activeEyeClosure) {
                    activeEyeClosure = influence;
                  }
                }
              }
            }
          }

          // Blinking calculation
          const enableBlinking = !disabledAnimationsRef.current.includes('blinking') && (window.yukiDebugToggles ? window.yukiDebugToggles.blinking !== false : true);
          const eyesAreClosed = activeEyeClosure >= 0.45;

          if (eyesAreClosed) {
            // Suppress blinking entirely when eyes are already closed (prevents double-blinking, eyelid clipping, and twitching)
            isBlinking = false;
            blinkTimer = 0;
            blinkProgress = 0;
          } else {
            blinkTimer += delta;
            if (enableBlinking && !isBlinking && blinkTimer >= nextBlinkTime) {
              isBlinking = true;
              blinkTimer = 0;
              blinkProgress = 0;
            }
          }

          const currentExpr = expressionRef.current;
          let blinkValue = 0;

          // Modulate blink speed based on cognitive and emotional states
          let blinkSpeed = 12.0; // base speed
          if (isThinkingRef.current) {
            blinkSpeed = 8.5;  // slower, more thoughtful blink
          } else if (currentExpr === 'happy') {
            blinkSpeed = 14.5; // faster, fluttery blink
          }

          if (isBlinking && currentExpr !== 'wink') {
            blinkProgress += delta * blinkSpeed;
            if (blinkProgress <= 1.0) {
              blinkValue = blinkProgress;
            } else if (blinkProgress <= 2.0) {
              blinkValue = 2.0 - blinkProgress;
            } else {
              isBlinking = false;
              blinkValue = 0;

              // Post-blink saccadic alignment (immediate micro-re-focusing)
              const enableMouseTracking = !disabledAnimationsRef.current.includes('mouse_tracking') && (window.yukiDebugToggles ? window.yukiDebugToggles.mouseTracking !== false : true);
              if ((enableMouseTracking && isMouseInWindow) || lookState === 'turning') {
                saccadeX = (Math.random() - 0.5) * 0.035;
                saccadeY = (Math.random() - 0.5) * 0.035;
                saccadeTimer = 0;
                nextSaccadeTime = 0.2 + Math.random() * 0.25; // delay next standard saccade
              }

              // Introduce organic double-blink patterns
              if (!pendingDoubleBlink && Math.random() < 0.18) {
                pendingDoubleBlink = true;
                doubleBlinkDelay = 0.08 + Math.random() * 0.1; // 80-180ms delay between blinks
              } else {
                pendingDoubleBlink = false;

                // Modulate next blink delay based on cognitive and emotional states
                let baseMinTime = 2.0;
                let baseRange = 4.5;
                if (isThinkingRef.current) {
                  baseMinTime = 4.5; // concentrate/stare more
                  baseRange = 6.0;
                } else if (currentExpr === 'happy') {
                  baseMinTime = 1.5; // blink slightly more frequently
                  baseRange = 3.0;
                } else if (currentExpr === 'surprised') {
                  baseMinTime = 5.0; // wide-eyed surprise stares longer
                  baseRange = 5.0;
                }
                nextBlinkTime = baseMinTime + Math.random() * baseRange;
              }
            }
          }

          // Handle scheduled double blinks
          if (pendingDoubleBlink && !isBlinking) {
            doubleBlinkDelay -= delta;
            if (doubleBlinkDelay <= 0) {
              isBlinking = true;
              blinkProgress = 0;
              pendingDoubleBlink = false;
            }
          }

          // Lipsync & Mouth Movement Blending
          const enableLipsync = window.yukiDebugToggles ? window.yukiDebugToggles.lipsync : true;
          const speechAa = (enableLipsync && audioLevelRef.current > 0) ? Math.min(audioLevelRef.current * 0.9, 0.55) : 0.0;
          const speechOh = (enableLipsync && audioLevelRef.current > 0) ? Math.min(audioLevelRef.current * 0.3, 0.15) : 0.0;

          const blendedAa = speechAa > 0
            ? (extraMouthAa > 0 ? Math.min(0.68, speechAa + (extraMouthAa * 0.40)) : speechAa)
            : extraMouthAa;
          const blendedOh = speechOh > 0
            ? (extraMouthOh > 0 ? Math.min(0.45, speechOh + (extraMouthOh * 0.50)) : speechOh)
            : extraMouthOh;

          setExpressionValue(vrm, 'aa', blendedAa);
          setExpressionValue(vrm, 'oh', blendedOh);

          // Wink animation state machine update
          if (currentExpr === 'wink') {
            if (winkStage === 'idle') {
              winkStage = 'closing';
              winkProgress = 0;
            } else if (winkStage === 'closing') {
              winkProgress += delta / 0.55; // Close eye over 0.55s
              const t = Math.min(1.0, winkProgress);
              winkVal = t * t * (3 - 2 * t); // Smooth ease-in-out (smoothstep)
              if (winkProgress >= 1.0) {
                winkStage = 'holding';
                winkHoldTimer = 0;
              }
            } else if (winkStage === 'holding') {
              winkVal = 1.0;
              winkHoldTimer += delta;
              if (winkHoldTimer >= 1.0) { // Hold wink for 1.0s
                winkStage = 'opening';
                winkProgress = 0;
              }
            } else if (winkStage === 'opening') {
              winkProgress += delta / 0.50; // Open eye over 0.5s
              const t = Math.min(1.0, winkProgress);
              winkVal = 1.0 - (t * t * (3 - 2 * t)); // Smooth ease-in-out opening
              if (winkProgress >= 1.0) {
                winkStage = 'completed';
              }
            } else if (winkStage === 'completed') {
              winkVal = 0.0;
            }
          } else {
            winkStage = 'idle';
            winkVal = 0.0;
            winkProgress = 0;
          }

          // Set base target values for facial expressions (from LLM tags or OS / live Mood Engine)
          let targetHappy = 0.0;
          let targetSad = 0.0;
          let targetAngry = 0.0;
          let targetSurprised = 0.0;
          let targetRelaxed = 0.0;
          let targetBrowUp = 0.0;
          let targetBrowDown = 0.0;

          if (currentExpr && currentExpr !== 'neutral') {
            const emotionDef = EMOTIONS[currentExpr];
            if (currentExpr === 'wink') {
              targetRelaxed = winkVal * 0.5;
            } else if (currentExpr === 'smug') {
              targetHappy = 0.0; // Closed mouth, open eyes
              targetRelaxed = 1.0; // Wide confident smile
              targetBrowUp = 0.3; // Confident brow raise
            } else if (currentExpr === 'happy') {
              targetHappy = 0.0; // Set to 0 to avoid VRM's pre-baked eye closing and jaw-drop morphs on joy
              targetRelaxed = 1.0; // Use open-eyed relaxed wide smile instead
              targetBrowUp = 0.35; // raise brows slightly on smile
            } else if (emotionDef && emotionDef.blendShapes) {
              const bs = emotionDef.blendShapes;
              targetHappy = bs.happy || 0.0;
              targetSad = bs.sad || 0.0;
              targetAngry = bs.angry || 0.0;
              targetSurprised = bs.surprised || 0.0;
              targetRelaxed = bs.relaxed || 0.0;
              targetBrowUp = bs.browUp || 0.0;
              targetBrowDown = bs.browDown || 0.0;
            } else if (currentExpr === 'sad') {
              targetSad = 1.0;
              targetBrowDown = 0.65; // furrow brows on sad
            } else if (currentExpr === 'angry') {
              targetAngry = 1.0;
              targetBrowDown = 0.85; // furrow brows on angry
            } else if (currentExpr === 'surprised') {
              targetSurprised = 1.0;
              targetBrowUp = 0.9;   // lift brows high on surprise
            } else if (currentExpr === 'relaxed') {
              targetRelaxed = 1.0;
              targetBrowUp = 0.2;
            }
          } else {
            // Base OS states / live Mood Engine resting facial expressions
            if (cpuLoadRef.current > 80) {
              targetSad = 0.45; // stressed/exhausted look
              targetAngry = 0.2;
              targetRelaxed = 0.0;
            } else if (isThinkingRef.current) {
              targetRelaxed = 0.5;
              targetSurprised = 0.0;
              targetBrowDown = 0.55; // furrow brows while concentrating
            } else if (isListeningRef.current) {
              targetRelaxed = 0.3;
              targetHappy = 0;
              targetBrowUp = 0.45;   // raise brows on listening interest
            } else {
              // Dynamic resting facial expression computed from live Mood Engine:
              const m = moodRef.current || {};
              const happiness = typeof m.happiness === 'number' ? m.happiness : 60;
              const playfulness = typeof m.playfulness === 'number' ? m.playfulness : 50;
              const anger = typeof m.anger === 'number' ? m.anger : 10;
              const stress = typeof m.stress_level === 'number' ? m.stress_level : 20;

              if (anger >= 60) {
                targetAngry = Math.min(0.5, (anger - 50) / 50 * 0.4);
                targetBrowDown = 0.35;
              } else if (stress >= 65 || happiness <= 30) {
                targetSad = 0.35;
                targetBrowDown = 0.25;
              } else if (playfulness >= 65) {
                targetRelaxed = 0.45;
                targetBrowUp = 0.25;
              } else if (happiness >= 45) {
                // Gentle, warm resting anime smile proportional to happiness
                const smile = Math.min(0.65, Math.max(0.15, (happiness - 35) / 90));
                targetRelaxed = smile;
                targetBrowUp = smile * 0.35;
              } else {
                targetHappy = 0.0;
                targetRelaxed = 0.0;
              }
            }
            // Blend in sleep target values smoothly based on sleepProgressRef.current
            targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, 0.6, sleepProgressRef.current);
          }

          // Layer animation blendshapes smoothly on top while an animation is playing:
          // Uses lerp with easeVal so the face smoothly transitions from the base mood into the animation,
          // and smoothly transitions back to her mood/LLM expression at the end without dipping to neutral!
          if (idleAnimState !== 'none') {
            const t = idleAnimDuration > 0 ? (idleAnimProgress / idleAnimDuration) : 0;
            const easeVal = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
            const animDef = ANIMATIONS.find(a => a.name === idleAnimState || a.alias === idleAnimState);
            if (animDef && animDef.blendShapes) {
              const bs = animDef.blendShapes;
              if (bs.happy !== undefined) targetHappy = THREE.MathUtils.lerp(targetHappy, bs.happy, easeVal);
              if (bs.sad !== undefined) targetSad = THREE.MathUtils.lerp(targetSad, bs.sad, easeVal);
              if (bs.angry !== undefined) targetAngry = THREE.MathUtils.lerp(targetAngry, bs.angry, easeVal);
              if (bs.surprised !== undefined) targetSurprised = THREE.MathUtils.lerp(targetSurprised, bs.surprised, easeVal);
              if (bs.relaxed !== undefined) targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, bs.relaxed, easeVal);
              if (bs.browUp !== undefined) targetBrowUp = THREE.MathUtils.lerp(targetBrowUp, bs.browUp, easeVal);
              if (bs.browDown !== undefined) targetBrowDown = THREE.MathUtils.lerp(targetBrowDown, bs.browDown, easeVal);
            }
            // Specific custom procedural expression timing (e.g. napping wake-up startle):
            if (idleAnimState === 'napping') {
              if (t < 0.7) {
                targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, 0.4, easeVal);
              } else {
                const wakeT = (t - 0.7) / 0.3;
                const decay = Math.exp(-wakeT * 5.0);
                targetSurprised = THREE.MathUtils.lerp(targetSurprised, 0.85 * decay, decay);
                targetBrowUp = THREE.MathUtils.lerp(targetBrowUp, 0.75 * decay, decay);
              }
            }
          }

          // If being dragged/picked up, smoothly override expression with surprise (wide eyes & raised brows)
          if (dragStateProgress > 0) {
            const dragSurprise = THREE.MathUtils.clamp(dragStateProgress, 0, 1);
            targetSurprised = THREE.MathUtils.lerp(targetSurprised, 0.85, dragSurprise);
            targetBrowUp = THREE.MathUtils.lerp(targetBrowUp, 0.80, dragSurprise);
            targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, 0.0, dragSurprise);
            targetHappy = THREE.MathUtils.lerp(targetHappy, 0.0, dragSurprise);
            targetSad = THREE.MathUtils.lerp(targetSad, 0.0, dragSurprise);
            targetAngry = THREE.MathUtils.lerp(targetAngry, 0.0, dragSurprise);
            targetBrowDown = THREE.MathUtils.lerp(targetBrowDown, 0.0, dragSurprise);
          }

          // Smoothly interpolate current values towards targets (using delta * speed)
          // A speed of 5.5s is fast enough to feel responsive, but slow enough to be beautifully smooth.
          const exprSpeed = 5.5;
          currentHappy += (targetHappy - currentHappy) * delta * exprSpeed;
          currentSad += (targetSad - currentSad) * delta * exprSpeed;
          currentAngry += (targetAngry - currentAngry) * delta * exprSpeed;
          currentSurprised += (targetSurprised - currentSurprised) * delta * exprSpeed;
          currentRelaxed += (targetRelaxed - currentRelaxed) * delta * exprSpeed;
          currentBrowUp += (targetBrowUp - currentBrowUp) * delta * exprSpeed;
          currentBrowDown += (targetBrowDown - currentBrowDown) * delta * exprSpeed;

          // Calculate micro-expression fluctuations (small organic twitches)
          const microScale = 0.025; // max 2.5% deviation
          const microHappy = currentHappy > 0.05 ? Math.sin(time * 4.3) * microScale : 0;
          const microSad = currentSad > 0.05 ? Math.sin(time * 3.7) * microScale : 0;
          const microAngry = currentAngry > 0.05 ? Math.sin(time * 5.1) * microScale : 0;
          const microSurprised = currentSurprised > 0.05 ? Math.sin(time * 4.7) * microScale : 0;
          const microRelaxed = currentRelaxed > 0.05 ? Math.sin(time * 3.1) * microScale : 0;

          // Apply smooth expression values to VRM with micro-fluctuations
          setExpressionValue(vrm, 'happy', Math.max(0, Math.min(1, currentHappy + microHappy)));
          setExpressionValue(vrm, 'sad', Math.max(0, Math.min(1, currentSad + microSad)));
          setExpressionValue(vrm, 'angry', Math.max(0, Math.min(1, currentAngry + microAngry)));
          setExpressionValue(vrm, 'surprised', Math.max(0, Math.min(1, currentSurprised + microSurprised)));
          setExpressionValue(vrm, 'relaxed', Math.max(0, Math.min(1, currentRelaxed + microRelaxed)));
          setExpressionValue(vrm, 'browUp', Math.max(0, Math.min(1, currentBrowUp)));
          setExpressionValue(vrm, 'browDown', Math.max(0, Math.min(1, currentBrowDown)));

          // Blinking and winking output blend (squinting disabled per user request)
          const squintValue = 0.0;
          let finalBlinkLeft = 0.0;
          let finalBlinkRight = 0.0;

          let normalBlinkLeft = 0.0;
          let normalBlinkRight = 0.0;

          if (isBlinking && currentExpr !== 'wink') {
            normalBlinkLeft = blinkValue;
            normalBlinkRight = blinkValue;
          } else if (currentExpr === 'wink') {
            normalBlinkLeft = winkVal;
            normalBlinkRight = squintValue; // squint non-winking eye
          } else if (extraBlink > 0) {
            normalBlinkLeft = extraBlink;
            normalBlinkRight = extraBlink;
          } else {
            normalBlinkLeft = squintValue;
            normalBlinkRight = squintValue;
          }

          // Clamp so that total eye closure from expression + blink never exceeds 1.0 (prevents eyelid vertex inversion)
          const maxAllowedBlink = Math.max(0, 1.0 - activeEyeClosure);
          normalBlinkLeft = Math.min(normalBlinkLeft, maxAllowedBlink);
          normalBlinkRight = Math.min(normalBlinkRight, maxAllowedBlink);

          finalBlinkLeft = THREE.MathUtils.lerp(normalBlinkLeft, 1.0, sleepProgressRef.current);
          finalBlinkRight = THREE.MathUtils.lerp(normalBlinkRight, 1.0, sleepProgressRef.current);

          setExpressionValue(vrm, 'blinkLeft', finalBlinkLeft);
          setExpressionValue(vrm, 'blinkRight', finalBlinkRight);

          // Dynamic wind force and spring bones physics solving
          const enableSpringBones = window.yukiDebugToggles ? window.yukiDebugToggles.springBones : true;
          if (enableSpringBones) {
            if (vrm.springBoneManager && vrm.springBoneManager.joints) {
              const windSpeedX = 2.0;
              const windSpeedZ = 1.3;

              const windX = Math.sin(time * windSpeedX) * 0.15 + Math.sin(time * windSpeedX * 2.3) * 0.08;
              const windZ = Math.cos(time * windSpeedZ) * 0.12 + Math.sin(time * windSpeedZ * 1.7) * 0.06;

              const walkingWind = isWalkingRef.current ? (walkDirectionRef.current === -1 ? -0.15 : 0.15) : 0;
              const orbitHairWind = -orbitVelX * 0.08; // subtle hair sway in response to camera orbit rotation
              const finalWindX = windX + walkingWind + orbitHairWind;

              vrm.springBoneManager.joints.forEach((joint) => {
                if (!joint._originalGravityDir) {
                  joint._originalGravityDir = joint.settings.gravityDir.clone();
                  joint._originalGravityPower = joint.settings.gravityPower;
                }

                const newGravityDir = joint._originalGravityDir.clone();
                newGravityDir.x += finalWindX;
                newGravityDir.z += windZ;
                newGravityDir.normalize();

                joint.settings.gravityDir.copy(newGravityDir);

                const pressureGust = 1.0 + (Math.sin(time * 3.1) * 0.15);
                joint.settings.gravityPower = Math.max(0.1, joint._originalGravityPower * pressureGust);
              });
            }

            // Clamp delta to 0.033s max to prevent physics joint explosion during stutters
            vrm.update(Math.min(delta, 0.033));
          }
          updateExpressions(vrm);
        }

        // Real-time 3D tracking for chat overlay + speech bubble (Electron only)
        if (isElectron && camera) {
          let targetY = 1.45 * scaleRef.current;
          let targetX = 0;
          let targetZ = 0;
          let headY = 1.4 * scaleRef.current;

          // Chat overlay anchor: use leftFoot (stable, no breathing/fidget noise)
          if (vrmRef.current) {
            const footNode = getBoneNode(vrmRef.current, 'leftFoot');
            if (footNode) {
              const tempV = new THREE.Vector3();
              footNode.getWorldPosition(tempV);
              targetX = tempV.x;
              targetY = tempV.y;
              targetZ = tempV.z;
            }
          }

          const headWorld = new THREE.Vector3(targetX, targetY, targetZ);
          headWorld.project(camera);

          const xPercent = (headWorld.x * 0.5 + 0.5) * 100;
          const yPercent = (headWorld.y * -0.5 + 0.5) * 100;
          window.yukiAvatarHeadYPercent = yPercent;

          // Speech bubble positioning still uses head (only when bubble element exists)
          if (vrmRef.current) {
            const headNode = getBoneNode(vrmRef.current, 'head');
            if (headNode) {
              const tempV = new THREE.Vector3();
              headNode.getWorldPosition(tempV);
              headY = tempV.y;
            }
          }
          const bubbleEl = document.querySelector('.desktop-speech-bubble');
          if (bubbleEl) {
            // Project head top for bubble bottom clamp
            const headTopY = headY + 0.12 * scaleRef.current;
            const headTopV = new THREE.Vector3(targetX, headTopY, targetZ);
            headTopV.project(camera);
            const headTopYPercent = (headTopV.y * -0.5 + 0.5) * 100;
            const minBottomPercent = 100 - headTopYPercent;

            const rect = bubbleEl.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
            const desiredBottomPercent = 100 - yPercent;
            const bubblePosition = computeDesktopBubblePosition({
              anchorXPercent: xPercent,
              desiredBottomPercent,
              minBottomPercent: minBottomPercent + 2,
              bubbleWidth: rect.width,
              bubbleHeight: rect.height,
              viewportWidth,
              viewportHeight,
              margin: 16,
              arrowMargin: 18,
            });

            bubbleEl.style.left = `${bubblePosition.leftPercent}%`;
            bubbleEl.style.top = 'auto';
            bubbleEl.style.bottom = `${bubblePosition.bottomPercent}%`;
            bubbleEl.style.transform = 'translateX(-50%)';
            bubbleEl.style.setProperty('--arrow-left', `${bubblePosition.arrowLeft}px`);
          }
        }

        const enableRendering = window.yukiDebugToggles ? window.yukiDebugToggles.rendering : true;
        if (enableRendering) {
          renderer.render(scene, camera);
        }

        // Deduct frame delay while preserving precision drift
        accumulatedTime = accumulatedTime % frameDelay;
      }
    };

    animate();

    return () => {
      delete window.yukiDebugToggles;
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);

      if (isElectron) {
        window.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mouseup', handleMouseUp);
        if (unsubscribeCursorMove) unsubscribeCursorMove();
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('dblclick', handleDblClick);
      cancelAnimationFrame(requestRef.current);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('end', onControlsEnd);
      canvasRef.current?.removeEventListener('contextmenu', handleContextMenu);
      controls.dispose();

      if (mixerRef.current) {
        try {
          mixerRef.current.stopAllAction();
          mixerRef.current = null;
        } catch (_) { }
      }
      vrmaClipsCacheRef.current.clear();
      currentVrmaActionRef.current = null;
      isVrmaActiveRef.current = false;

      // Dispose of all scene resources to prevent WebGL memory leaks
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of materials) {
            mat.dispose();
            for (const key of Object.keys(mat)) {
              const value = mat[key];
              if (value && typeof value.dispose === 'function') {
                value.dispose();
              }
            }
          }
        }
      });

      renderer.dispose();
      if (customVrmBlobUrlRef.current) {
        URL.revokeObjectURL(customVrmBlobUrlRef.current);
        customVrmBlobUrlRef.current = null;
      }
      if (vrmRef.current && vrmRef.current.scene) {
        scene.remove(vrmRef.current.scene);
      }
      currentLoadIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (vrmRef.current) {
      setHasVrm(true);
    }
  }, [vrmRef.current]);

  useEffect(() => {
    const controls = window.vrmControls;
    if (controls) {
      if (isElectron) {
        if (enableRotation) {
          controls.enabled = true;
          controls.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.NONE,
            RIGHT: THREE.MOUSE.ROTATE
          };
        } else {
          controls.enabled = false;
        }
      } else {
        controls.enabled = true;
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
      }
    }
  }, [enableRotation, isElectron]);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (!onFileDropped || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const file = e.dataTransfer.files[0];
    if (file.path) {
      onFileDropped(file.name, file.path, true);
    } else {
      try {
        const text = await file.text();
        onFileDropped(file.name, text, false);
      } catch (err) {
        console.warn("Failed to read dropped file contents:", err);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <canvas ref={canvasRef} />

      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          borderRadius: '16px'
        }}>
          <div className="w-10 h-10 border-4 border-violet-500/30 border-t-violet-400 rounded-full animate-spin"></div>
          <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 500, color: '#ddd' }}>Reconfiguring neural avatar matrix...</p>
        </div>
      )}

      {/* Upload prompt when using Hologram Core */}
      {!hasVrm && !loading && (
        <div className="vrm-load-widget glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-teal)' }}>
            <Sparkles className="w-4 h-4 breathing" />
            <h4 style={{ margin: 0, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hologram Engine Active</h4>
          </div>
          <p className="vrm-load-text">
            Currently displaying the procedural AI core. Drag & drop or select a 3D VRM file to load your custom avatar!
          </p>
          <label className="vrm-upload-label">
            <Upload className="w-3.5 h-3.5" />
            <span>Load VRM Character</span>
            <input
              type="file"
              accept=".vrm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleVrmFile(e.target.files[0]);
                }
              }}
            />
          </label>
        </div>
      )}

      {hasVrm && (
        <div className="vrm-loaded-status glass-panel">
          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full breathing" style={{ display: 'inline-block' }}></span>
          Loaded: {modelName.length > 20 ? modelName.slice(0, 17) + "..." : modelName}
        </div>
      )}
    </div>
  );
};

export default AvatarViewer;
