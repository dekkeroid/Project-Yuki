import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { computeDesktopBubblePosition } from '../utils/desktopBubblePosition';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Upload, Sparkles } from 'lucide-react';
import { ANIMATIONS } from '../animationsRegistry';

// Default Window Dimensions Configuration (Electron Mode)
const ELECTRON_WINDOW_WIDTH = 320;
const ELECTRON_WINDOW_HEIGHT = 605;
const YUKI_SCALE_REDUCER = 0.9; // Reduce avatar size relative to window
const windowWidthExtra = 0;

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
  enableRotation = false,
  autoResetRotation = true
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
  const ignoreTimeoutRef = useRef(null);
  const isIgnoringMouseRef = useRef(false);
  const cursorOffsetRef = useRef({ x: 0, y: 0 });
  const lastMouseMoveTimeRef = useRef(0);
  const canvasRectRef = useRef({ left: 0, top: 0, width: ELECTRON_WINDOW_WIDTH, height: ELECTRON_WINDOW_HEIGHT });
  const lastRaycastTimeRef = useRef(0);
  const lastRaycastHitRef = useRef(false);

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
  const scaleRef = useRef(isElectron ? (window.innerHeight / ELECTRON_WINDOW_HEIGHT) : scale);
  const skinToneRef = useRef(skinToneColor);
  const disabledAnimationsRef = useRef(disabledAnimations || []);
  const prevIsSpeakingRef = useRef(false);
  const prevIsRotatingRef = useRef(false);

  const activeModelRef = useRef(activeModel);
  const enableRotationRef = useRef(enableRotation);
  const autoResetRotationRef = useRef(autoResetRotation);

  useEffect(() => {
    activeModelRef.current = activeModel;
  }, [activeModel]);

  useEffect(() => {
    enableRotationRef.current = enableRotation;
  }, [enableRotation]);

  useEffect(() => {
    autoResetRotationRef.current = autoResetRotation;
  }, [autoResetRotation]);

  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (activeModel) {
      loadModel(`/models/${activeModel}`);
    }
  }, [activeModel]);

  useEffect(() => {
    disabledAnimationsRef.current = disabledAnimations || [];
  }, [disabledAnimations]);

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
    expressionRef.current = expression || 'neutral';
  }, [expression]);

  useEffect(() => {
    cpuLoadRef.current = cpuLoad;
  }, [cpuLoad]);

  useEffect(() => {
    systemIdleTimeRef.current = systemIdleTime;
  }, [systemIdleTime]);

  useEffect(() => {
    if (!isElectron) {
      scaleRef.current = scale;
    }
  }, [scale, isElectron]);

  useEffect(() => {
    skinToneRef.current = skinToneColor;
  }, [skinToneColor]);

  useEffect(() => {
    if (vrmRef.current) {
      applySkinTone(vrmRef.current, skinToneColor);
    }
  }, [skinToneColor]);

  useEffect(() => {
    if (customAnimation && customAnimation !== '') {
      startCustomAnimationRef.current = customAnimation;
    }
  }, [customAnimation]);

  const [loading, setLoading] = useState(true);
  const [hasVrm, setHasVrm] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [modelName, setModelName] = useState("Sci-Fi Hologram Core");

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
    const url = URL.createObjectURL(file);
    setModelName(file.name);
    loadModel(url);
  };

  const disposeObject = (obj) => {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
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
          }
        });
      }
    });
  };

  const loadModel = (url) => {
    setLoading(true);
    setModelError(false);

    currentLoadIdRef.current += 1;
    const loadId = currentLoadIdRef.current;

    // Dispose old VRM if exists
    if (vrmRef.current && vrmRef.current.scene) {
      disposeObject(vrmRef.current.scene);
      const parent = vrmRef.current.scene.parent;
      if (parent) {
        parent.remove(vrmRef.current.scene);
      } else if (window.vrmScene) {
        window.vrmScene.remove(vrmRef.current.scene);
      }
      vrmRef.current = null;
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

        vrmRef.current = vrm;
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
                    mat[key].generateMipmaps = true;               // Calculate downscaled matrices
                    mat[key].minFilter = THREE.LinearMipmapLinearFilter; // Trilinear filtering smoothstep
                    mat[key].magFilter = THREE.LinearFilter;
                    mat[key].needsUpdate = true;                     // Push data block clear to GPU
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
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
          window.electronAPI.setIgnoreMouseEvents(false);
          isIgnoringMouseRef.current = false;
        }
      }
    };
    const onControlsEnd = () => {
      isRotating = false;
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
        try { return localStorage.getItem('yuki-camera-tracking') === 'true'; } catch { return false; }
      },
      set cameraTracking(val) {
        try { localStorage.setItem('yuki-camera-tracking', String(val)); } catch {}
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
    camera.position.set(0, isElectron ? 1.55 : 1.35, isElectron ? 2.2 : 1.2);
    window.vrmCamera = camera;

    // 3. Setup Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    // CRITICAL: set clear color to fully transparent so the desktop shows through
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(
      isElectron ? window.innerWidth : containerRef.current.clientWidth,
      isElectron ? window.innerHeight : containerRef.current.clientHeight
    );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); //changed it from 2 redering density
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
    controls.target.set(0, isElectron ? 0.75 : 1.2, 0);

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

    let model_choice = ["default.vrm", "ayame.vrm", "kanata.vrm", "laplus.vrm", "laplus_no_coat.vrm", "nene.vrm", "miko.vrm", "pekora.vrm", "suisei.vrm",
      "watame.vrm", "yuki.vrm", "timekeeper_cookie.vrm"]

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
    loadModel(`/models/${activeModelRef.current}`);

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
    let idleAnimState = 'none'; // 'none', 'stretching', 'yawning', 'shrugging'
    let idleAnimProgress = 0;
    let idleAnimDuration = 4.0;

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

    let startX = 0;
    let startY = 0;
    let initialWindowX = 0;
    let initialWindowY = 0;
    let isHoveringCharacter = false;

    // Mouse tracking variables for neck look-at animation
    let isMouseInWindow = false;
    const mouseNDC = new THREE.Vector2(0, 0);

    const handleMouseDown = async (event) => {
      if (!window.electronAPI) return;

      // If user clicked inside settings or other HTML UI elements, do not drag
      if (event.target.closest('.interactive-element')) {
        return;
      }

      if (event.button === 0 && isHoveringCharacter && !isDragging) {
        isDragging = true;
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

      if (isHoveringCharacter || isRotating || postOrbitRestTimer > 0) {
        // Hovering over character or rotating: enable clicks/drags on this window immediately
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
          // Off character and off UI: ignore mouse clicks on window, but forward them to desktop.
          const enableClickthrough = window.yukiDebugToggles ? window.yukiDebugToggles.clickthrough : true;
          const suspendClickthrough = window.yukiConfirmJustClosed === true;
          if (enableClickthrough && !suspendClickthrough) {
            if (!isIgnoringMouseRef.current && !ignoreTimeoutRef.current) {
              ignoreTimeoutRef.current = setTimeout(() => {
                window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                isIgnoringMouseRef.current = true;
                ignoreTimeoutRef.current = null;
              }, 350);
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
        const suspendClickthrough = window.yukiConfirmJustClosed === true;
        if (enableClickthrough && !suspendClickthrough && !isRotating && postOrbitRestTimer <= 0) {
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
      if (isHoveringCharacter && !disabledAnimationsRef.current.includes('knocking')) {
        triggerScreenKnock();
      }
    };

    window.addEventListener('dblclick', handleDblClick);

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current) return;
      if (isElectron) {
        scaleRef.current = window.innerHeight / ELECTRON_WINDOW_HEIGHT;
      }
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

    const targetFPS = 50;
    const frameDelay = 1 / targetFPS;
    let accumulatedTime = 0;

    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);

      let delta = clock.getDelta();
      if (delta > 0.1) delta = 0.1;

      // Accumulate elapsed delta time
      accumulatedTime += delta;

      // Only run physics calculations and render the frame if our threshold is met
      if (accumulatedTime >= frameDelay) {
        const time = clock.getElapsedTime();

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
              const defaultOffset = new THREE.Vector3(0, 0.65 * scaleRef.current, baseCameraZ * scaleRef.current);
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
        }

        if (startCustomAnimationRef.current) {
          const customName = startCustomAnimationRef.current;
          startCustomAnimationRef.current = null;

          idleAnimState = customName;
          const matchingAnim = ANIMATIONS.find(a => a.name === customName);
          if (matchingAnim) {
            idleAnimDuration = matchingAnim.duration;
          } else {
            idleAnimDuration = 4.0;
          }

          idleAnimProgress = 0;
          inactivityTimer = 0;
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
                idleAnimState = 'none';
                idleAnimProgress = 0;
              }
            } else {
              idleAnimState = 'none';
              idleAnimProgress = 0;
            }
          }
        } else {
          if (idleAnimState === 'none') {
            inactivityTimer += delta;
            if (inactivityTimer >= 15.0) {
              // Trigger a random enabled idle animation from the registry
              const enabledIdleAnims = ANIMATIONS.filter(
                a => !a.excludeFromRandomIdle && !disabledAnimationsRef.current.includes(a.name)
              );
              if (enabledIdleAnims.length > 0) {
                const randAnim = enabledIdleAnims[Math.floor(Math.random() * enabledIdleAnims.length)];
                idleAnimState = randAnim.name;
                idleAnimDuration = randAnim.duration;
              } else {
                idleAnimState = 'none';
              }
              idleAnimProgress = 0;
              inactivityTimer = 0;
            }
          } else {
            idleAnimProgress += delta;
            if (idleAnimProgress >= idleAnimDuration) {
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
          } else if (idleAnimState === 'peering') {
            spineOffsetX = -0.08 * easeVal;
            chestOffsetX = -0.12 * easeVal;
            neckOffsetX = 0.04 * easeVal;
          } else if (idleAnimState === 'laughing') {
            extraMouthAa = (0.24 + Math.sin(time * 18.0) * 0.12) * easeVal;
            extraBlink = 0.25 * easeVal;
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
          const isSleeping = systemIdleTimeRef.current > 180;
          const targetSleepProgress = isSleeping ? 1.0 : 0.0;
          const sleepTransitionSpeed = isSleeping ? 0.2 : 0.8; // wake up is faster
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
              alwaysLookingAtYou = false;
              gazeAtUserTimer = 0;
            }

            let baseLookY, baseLookX, baseLookZ;
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
                ? Math.atan2(camera.position.y - headHeight, horizontalDist) * 0.8
                : 0;
              const minPitch = -0.45;
              const maxPitch = 0.35;
              const clampedPitch = Math.max(minPitch, Math.min(maxPitch, trackingPitchOffset));

              baseLookY = trackingYawOffset;
              baseLookX = clampedPitch;

              const rollScale = 0.5;
              baseLookZ = horizontalDist > 0.01
                ? Math.atan2(-camera.position.x, horizontalDist) * rollScale
                : 0;
            } else {
              baseLookY = 0;
              baseLookX = 0;
              baseLookZ = 0;
            }

            let targetLookY = baseLookY;
            let targetLookX = baseLookX;
            // ---------------------------------------------------------

            const enableMouseTracking = !disabledAnimationsRef.current.includes('mouse_tracking') && (window.yukiDebugToggles ? window.yukiDebugToggles.mouseTracking !== false : true);

            // During right-click orbit, skip mouse tracking entirely —
            // the camera position already encodes where the user is looking from.
            const isOrbiting = isRotating;

            if (!isOrbiting && isMouseInWindow && postOrbitRestTimer <= 0) {
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

            if ((isOrbiting || postOrbitRestTimer > 0) && enableCameraTracking) {
              // While orbiting, always track camera regardless of gaze cycling
              const orbYaw = Math.atan2(camera.position.x, camera.position.z);
              const orbBodyOffset = vrm.scene.rotation.y - baseRotation;
              let orbTrackingYaw = Math.max(-1.2, Math.min(1.2, (orbYaw - orbBodyOffset) * 0.55));
              const orbHeadHeight = 1.4 * scaleRef.current;
              const orbHDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
              let orbTrackingPitch = orbHDist > 0.01
                ? Math.atan2(camera.position.y - orbHeadHeight, orbHDist) * 0.8
                : 0;
              orbTrackingPitch = Math.max(-0.45, Math.min(0.35, orbTrackingPitch));
              targetLookY = orbTrackingYaw;
              targetLookX = orbTrackingPitch;
              lookState = 'idle';
              lookTimer = 0;
            } else if (isMouseInWindow) {
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
                  targetLookX = -Math.atan(dy / 300) * 0.25 * influence + baseLookX;
                } else {
                  targetLookY = baseLookY;
                  targetLookX = baseLookX;
                }
              } else {
                targetLookY = mouseNDC.x * 0.45 + baseLookY;
                const verticalCenter = 0.0;
                targetLookX = (mouseNDC.y - verticalCenter) * 0.22 + baseLookX;
              }

              lookState = 'idle';
              lookTimer = 0;
            } else if (!isWalkingRef.current) {
              const enableLookAround = window.yukiDebugToggles ? window.yukiDebugToggles.lookAround : true;
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

            // 4. Natural breathing & gentle swaying
            const chest = getBoneNode(vrm, 'chest');
            if (chest) {
              if (dragStateProgress > 0) {
                chest.rotation.x = dragPitchAngle * 0.3 * xMult;
                chest.rotation.y = 0;
                chest.rotation.z = dragSwayAngle * 0.3 * zMult;
              } else {
                chest.rotation.x = (chestOffsetX + 0.015 + Math.sin(time * breathingSpeed) * breathingDepth + Math.sin(time * breathingSpeed * 2) * (breathingDepth * 0.25)) * xMult;
                chest.rotation.y = Math.sin(time * 0.3) * 0.01 * yMult;       // slow sway
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
                spine.rotation.y = Math.sin(time * 0.25) * 0.012 * yMult;     // spine sway
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
                }

                awakeNeckY = (currentLookY + Math.sin(time * 0.5) * 0.012 + microFidgetNeckY + neckAnimY) * yMult;

                // Baseline chest-nudge neck compensation (head nods down slightly when chest expands)
                const breathingNod = Math.sin(time * breathingSpeed) * (breathingDepth * 0.3);
                awakeNeckX = (-0.12 + neckOffsetX + currentLookX + Math.sin(time * 0.35) * 0.012 - breathingNod + microFidgetNeckX + neckAnimX) * xMult;

                // Head Tilts for Empathy (Z-roll) & Curious Thinking
                let tiltZ = microFidgetNeckZ + neckAnimZ + currentLookZ;
                let tiltX = 0;

                if (isListeningRef.current) {
                  tiltZ += 0.045; // gentle empathy tilt to the left
                } else if (isThinkingRef.current) {
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
              } else if (idleAnimState === 'laughing') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                stretchShrug = (0.03 + Math.sin(time * 24.0) * 0.02) * easeVal;
              }

              const finalLift = shoulderLift + stretchShrug;
              leftClavicle.rotation.z = finalLift * zMult;
              rightClavicle.rotation.z = -finalLift * zMult;

              // Subtle rotation on X-axis (tilting back on breath)
              leftClavicle.rotation.x = -finalLift * 0.35 * xMult;
              rightClavicle.rotation.x = -finalLift * 0.35 * xMult;
            }

            const leftEye = getBoneNode(vrm, 'leftEye');
            const rightEye = getBoneNode(vrm, 'rightEye');
            if (leftEye && rightEye) {
              // Rotates the eyes in the same direction, using the lag-lead gaze + saccades
              const eyeYaw = currentGazeY * 0.15 + saccadeY;
              const eyePitch = currentGazeX * 0.15 - 0.03 + saccadeX;

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
                hips.position.x = THREE.MathUtils.lerp(awakeHipsPosX, asleepHipsPosX, sleepProgressRef.current);
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

              vrm.scene.position.y = THREE.MathUtils.lerp(awakeSceneY, asleepSceneY, sleepProgressRef.current);
              vrm.scene.position.z = THREE.MathUtils.lerp(awakeSceneZ, asleepSceneZ, sleepProgressRef.current);
              vrm.scene.position.x = THREE.MathUtils.lerp(awakeSceneX, asleepSceneX, sleepProgressRef.current);

              if (leftShoulder) {
                let awakeShoulderX = 0;
                let awakeShoulderY = 0;
                let awakeShoulderZ = 0;

                if (dragStateProgress > 0) {
                  // Left arm raises up sideways and sways
                  awakeShoulderX = (0.15 + dragPitchAngle * 0.5) * xMult;
                  awakeShoulderY = 0.08 * yMult;
                  awakeShoulderZ = ((1.25 - 0.45 * dragStateProgress) + Math.sin(dragDangleTimer * 0.8) * 0.08 * dragStateProgress) * zMult;
                } else if (idleAnimState === 'pouting') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.35 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (0.45 * easeVal + 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (1.05 * easeVal + 1.25 * (1 - easeVal)) * zMult;
                } else {
                  awakeShoulderX = (0.15 + Math.sin(time * 1.4) * 0.008) * xMult;
                  awakeShoulderY = 0.08 * yMult;
                  awakeShoulderZ = (leftArmOffsetZ + 1.25 + Math.sin(time * 1.4) * 0.012 - shiftCycle * 0.01) * zMult;
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
                } else if (idleAnimState === 'pouting') {
                  const t = idleAnimProgress / idleAnimDuration;
                  const easeVal = Math.sin(t * Math.PI);
                  awakeShoulderX = (0.35 * easeVal + 0.15 * (1 - easeVal)) * xMult;
                  awakeShoulderY = (-0.45 * easeVal - 0.08 * (1 - easeVal)) * yMult;
                  awakeShoulderZ = (-1.05 * easeVal - 1.25 * (1 - easeVal)) * zMult;
                } else {
                  awakeShoulderX = (0.15 + Math.sin(time * 1.4) * 0.008) * xMult;
                  awakeShoulderY = -0.08 * yMult;
                  awakeShoulderZ = (rightArmOffsetZ - 1.25 - Math.sin(time * 1.4) * 0.012 + shiftCycle * 0.01) * zMult;
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
                  leftLeg.rotation.z = -0.05 * dragStateProgress * zMult;
                }
                if (rightLeg) {
                  rightLeg.rotation.x = (0.1 + dangleSwingRight + dragPitchAngle * 0.4) * xMult;
                  rightLeg.rotation.z = 0.05 * dragStateProgress * zMult;
                }
                if (leftLowerLeg) leftLowerLeg.rotation.x = (0.25 + Math.sin(dragDangleTimer * 1.3) * 0.08) * dragStateProgress * xMult;
                if (rightLowerLeg) rightLowerLeg.rotation.x = (0.25 + Math.cos(dragDangleTimer * 1.3 + 0.3) * 0.08) * dragStateProgress * xMult;
              } else {
                if (leftLeg) {
                  const awakeVal = Math.max(0, shiftCycle) * 0.06;
                  leftLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
                  leftLeg.rotation.z = floatLegAngle * zMult;
                }
                if (rightLeg) {
                  const awakeVal = Math.max(0, -shiftCycle) * 0.06;
                  rightLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.02, sleepProgressRef.current) * xMult;
                  rightLeg.rotation.z = -floatLegAngle * zMult;
                }
                if (leftLowerLeg) {
                  const awakeVal = Math.max(0, shiftCycle) * 0.1;
                  leftLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
                }
                if (rightLowerLeg) {
                  const awakeVal = Math.max(0, -shiftCycle) * 0.1;
                  rightLowerLeg.rotation.x = THREE.MathUtils.lerp(awakeVal, 0.04, sleepProgressRef.current) * xMult;
                }
              }
            }

            const leftElbow = getBoneNode(vrm, 'leftLowerArm');
            const rightElbow = getBoneNode(vrm, 'rightLowerArm');
            if (leftElbow) {
              let awakeElbowY = 0;
              let awakeElbowZ = 0;

              if (idleAnimState === 'pouting') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                awakeElbowZ = (1.25 * easeVal) * zMult;
                awakeElbowY = -0.4 * yMult;
              } else {
                awakeElbowY = (leftElbowOffsetY - 0.4 + (isWalkingRef.current ? 0 : Math.sin(time * 1.4) * 0.008)) * yMult;
                awakeElbowZ = 0 * zMult;
              }

              const asleepElbowY = -0.15 * yMult;
              const asleepElbowZ = 0 * zMult;

              leftElbow.rotation.y = THREE.MathUtils.lerp(awakeElbowY, asleepElbowY, sleepProgressRef.current);
              leftElbow.rotation.z = THREE.MathUtils.lerp(awakeElbowZ, asleepElbowZ, sleepProgressRef.current);
            }
            if (rightElbow) {
              let awakeElbowY = 0;
              let awakeElbowZ = 0;

              if (knockActive) {
                const easeVal = Math.sin((knockTimer / knockDuration) * Math.PI);
                const tapOffset = knockTimer < 0.45 ? Math.sin(knockTimer * Math.PI * 14) * 0.14 : 0;
                awakeElbowZ = ((-1.3 + tapOffset) * easeVal) * zMult;
                awakeElbowY = (rightElbowOffsetY + 0.2 * easeVal) * yMult;
              } else if (idleAnimState === 'greeting_wave') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                awakeElbowZ = (-1.4 * easeVal) * zMult;
                awakeElbowY = (rightElbowOffsetY + 0.2 * easeVal) * yMult;
              } else if (idleAnimState === 'pouting') {
                const t = idleAnimProgress / idleAnimDuration;
                const easeVal = Math.sin(t * Math.PI);
                awakeElbowZ = (-1.25 * easeVal) * zMult;
                awakeElbowY = (rightElbowOffsetY + 0.4) * yMult;
              } else {
                awakeElbowY = (rightElbowOffsetY + 0.4 + (isWalkingRef.current ? 0 : Math.sin(time * 1.4) * 0.008)) * yMult;
                awakeElbowZ = 0 * zMult;
              }

              const asleepElbowY = 0.15 * yMult;
              const asleepElbowZ = 0 * zMult;

              rightElbow.rotation.y = THREE.MathUtils.lerp(awakeElbowY, asleepElbowY, sleepProgressRef.current);
              rightElbow.rotation.z = THREE.MathUtils.lerp(awakeElbowZ, asleepElbowZ, sleepProgressRef.current);
            }

            const leftHand = getBoneNode(vrm, 'leftHand');
            const rightHand = getBoneNode(vrm, 'rightHand');
            if (leftHand && !isWalkingRef.current) {
              const awakeY = Math.sin(time * 1.4) * 0.004 * yMult;
              leftHand.rotation.y = THREE.MathUtils.lerp(awakeY, 0.0, sleepProgressRef.current);
            }
            if (rightHand && !isWalkingRef.current) {
              let awakeY = 0;
              let awakeZ = 0;
              if (idleAnimState === 'greeting_wave') {
                const t = idleAnimProgress / idleAnimDuration;
                if (t > 0.15 && t < 0.85) {
                  // Wave hand with smooth ease-in/out multiplier
                  const waveEase = Math.sin((t - 0.15) / 0.7 * Math.PI);
                  awakeZ = Math.sin(time * 15.0) * 0.25 * waveEase * zMult;
                }
                awakeY = -Math.sin(time * 1.4) * 0.004 * yMult;
              } else {
                awakeY = -Math.sin(time * 1.4) * 0.004 * yMult;
              }
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
                  if (finger === 'index') baseCurl = 0.08;
                  else if (finger === 'middle') baseCurl = 0.16;
                  else if (finger === 'ring') baseCurl = 0.24;
                  else if (finger === 'little') baseCurl = 0.30;
                  else if (finger === 'thumb') baseCurl = 0.06;

                  // Calculate target curl bend
                  // Under drag/grab, fingers extend/splay wide (-0.12 rad target)
                  const targetCurl = baseCurl * (1.0 - dragMultiplier) - 0.12 * dragMultiplier + thinkAdd + sleepAdd + speakFlex;

                  // Micro-fidget twitches (using asynchronous prime frequencies)
                  const fidgetFreq = 1.3 + fIndex * 0.4;
                  const fidgetMultiplier = THREE.MathUtils.lerp(1.0, 0.15, sleepProgressRef.current);
                  const fidgetVal = Math.sin(time * fidgetFreq) * 0.02 * (1.0 - dragMultiplier) * fidgetMultiplier;

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
          }

          // Blinking calculation
          const enableBlinking = !disabledAnimationsRef.current.includes('blinking') && (window.yukiDebugToggles ? window.yukiDebugToggles.blinking !== false : true);
          blinkTimer += delta;
          if (enableBlinking && !isBlinking && blinkTimer >= nextBlinkTime) {
            isBlinking = true;
            blinkTimer = 0;
            blinkProgress = 0;
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

          // Lipsync
          const enableLipsync = window.yukiDebugToggles ? window.yukiDebugToggles.lipsync : true;
          if (enableLipsync && audioLevelRef.current > 0) {
            setExpressionValue(vrm, 'aa', Math.min(audioLevelRef.current * 0.9, 0.55));
            setExpressionValue(vrm, 'oh', Math.min(audioLevelRef.current * 0.3, 0.15));
          } else if (extraMouthAa > 0) {
            setExpressionValue(vrm, 'aa', extraMouthAa);
            setExpressionValue(vrm, 'oh', 0.0);
          } else {
            setExpressionValue(vrm, 'aa', 0.0);
            setExpressionValue(vrm, 'oh', 0.0);
          }

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

          // Set target values for facial expressions
          let targetHappy = 0.0;
          let targetSad = 0.0;
          let targetAngry = 0.0;
          let targetSurprised = 0.0;
          let targetRelaxed = 0.0;
          let targetBrowUp = 0.0;
          let targetBrowDown = 0.0;

          if (currentExpr && currentExpr !== 'neutral') {
            if (currentExpr === 'wink') {
              targetHappy = winkVal * 0.5;
            } else if (currentExpr === 'happy') {
              targetHappy = 0.0; // Set to 0 to avoid VRM's pre-baked eye closing morphs on joy
              targetRelaxed = 1.0; // Use open-eyed relaxed smile instead
              targetBrowUp = 0.35; // raise brows slightly on smile
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
            // Mood expressions / OS states / Idle animation overrides
            if (idleAnimState === 'greeting_wave') {
              const t = idleAnimProgress / idleAnimDuration;
              const waveRaise = Math.sin(t * Math.PI);
              targetRelaxed = 0.6 * waveRaise;
              targetHappy = 0.35 * waveRaise;
            } else if (idleAnimState === 'peering') {
              const t = idleAnimProgress / idleAnimDuration;
              const easeVal = Math.sin(t * Math.PI);
              targetSurprised = 0.55 * easeVal;
              targetRelaxed = 0.2 * easeVal;
            } else if (idleAnimState === 'laughing') {
              const t = idleAnimProgress / idleAnimDuration;
              const easeVal = Math.sin(t * Math.PI);
              targetHappy = 0.5 * easeVal;
              targetRelaxed = 0.85 * easeVal;
              targetBrowUp = 0.4 * easeVal;
            } else if (idleAnimState === 'napping') {
              const t = idleAnimProgress / idleAnimDuration;
              if (t < 0.7) {
                targetRelaxed = 0.4;
              } else {
                const wakeT = (t - 0.7) / 0.3;
                const decay = Math.exp(-wakeT * 5.0);
                targetSurprised = 0.85 * decay;
                targetBrowUp = 0.75 * decay;
              }
            } else if (idleAnimState === 'grooving') {
              const t = idleAnimProgress / idleAnimDuration;
              const easeVal = Math.sin(t * Math.PI);
              targetRelaxed = 0.6 * easeVal;
            } else if (idleAnimState === 'pouting') {
              const t = idleAnimProgress / idleAnimDuration;
              const easeVal = Math.sin(t * Math.PI);
              targetSad = 0.4 * easeVal;
              targetAngry = 0.3 * easeVal;
              targetBrowDown = 0.6 * easeVal;
            } else if (dragStateProgress > 0) {
              targetSurprised = 0.85 * dragStateProgress; // wide eyes
              targetBrowUp = 0.75 * dragStateProgress;   // brows raised in surprise
            } else if (cpuLoadRef.current > 80) {
              targetSad = 0.45; // stressed/exhausted look
              targetAngry = 0.2;
              targetRelaxed = 0.0;
            } else if (isThinkingRef.current) {
              targetRelaxed = 0.5;
              targetSurprised = 0.0;
              targetBrowDown = 0.55; // furrow brows while concentrating
            } else if (isListeningRef.current) {
              targetRelaxed = 0.3;
              targetHappy = 0.2;
              targetBrowUp = 0.45;   // raise brows on listening interest
            } else {
              targetHappy = 0.1;
              targetRelaxed = 0.0;
            }
            // Blend in sleep target values smoothly based on sleepProgressRef.current
            targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, 0.6, sleepProgressRef.current);
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
              const finalWindX = windX + walkingWind;

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

        // Real-time 3D-aligned Speech Bubble Tracking (Electron only)
        if (isElectron) {
          const bubbleEl = document.querySelector('.desktop-speech-bubble');
          if (bubbleEl && camera) {
            let targetY = 1.45 * scaleRef.current; // default height for holo core (scaled)
            let targetX = 0;
            let targetZ = 0;
            let headY = 1.4 * scaleRef.current;

            if (vrmRef.current) {
              const headNode = getBoneNode(vrmRef.current, 'head');
              if (headNode) {
                const tempV = new THREE.Vector3();
                headNode.getWorldPosition(tempV);
                targetX = tempV.x;
                targetY = tempV.y + 0.25 * scaleRef.current; // offset above hair scaled dynamically
                targetZ = tempV.z;
                headY = tempV.y;
              }
            }

            const tempV = new THREE.Vector3(targetX, targetY, targetZ);
            tempV.project(camera);

            const xPercent = (tempV.x * 0.5 + 0.5) * 100;
            const yPercent = (tempV.y * -0.5 + 0.5) * 100;

            // Project head top (head bone + hair offset) to ensure bubble bottom is always above it
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
