import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import {
  Heart,
  Camera,
  Volume2,
  VolumeX,
  Music,
  X,
  Send,
  Mic,
  MicOff,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Wine,
  Coffee,
  Flame,
  Cake,
  ExternalLink,
  ChevronDown,
  RotateCcw,
  Settings,
  Sliders,
  Activity,
  Bookmark,
  Save,
  Plus,
  Sun,
  Box,
  Copy,
  Check,
  Code,
  Eye,
  EyeOff,
  Palette,
  Layers,
  Minimize2,
  Maximize2,
  Trash2,
  Upload,
  Image as ImageIcon,
  Edit3,
  MapPin,
  User,
  Move,
  ChevronUp,
  Loader2
} from 'lucide-react';
import { API_BASE, WS_BASE } from './api';
import { stripAnimationTags, parseResponseTags } from './utils/responseParser';
import { EMOTIONS, LLM_EMOTION_MAP, ANIMATIONS } from './animationsRegistry';

// ============================================================================
// HARDWARE & EFFICIENCY PROTOCOL: DEDICATED GPU (dGPU) VALIDATION
// Set to true in the future if integrated GPU fallback is desired.
// ============================================================================
export const ALLOW_INTEGRATED_GPU_FALLBACK = false;

function inspectWebGLGPU() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' })
      || canvas.getContext('webgl', { powerPreference: 'high-performance' });
    if (!gl) return { ok: false, error: 'WebGL 2.0 is not supported on this device.', isDedicated: false };

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendorStr = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const fullText = `${rendererStr || ''} ${vendorStr || ''}`.toLowerCase();

    // Discrete GPU signatures (NVIDIA / AMD Radeon discrete)
    const isNvidia = fullText.includes('nvidia') || fullText.includes('geforce')
      || fullText.includes('rtx') || fullText.includes('gtx') || fullText.includes('quadro');
    const isAmdDiscrete = (fullText.includes('amd') || fullText.includes('radeon'))
      && (fullText.includes('rx ') || fullText.includes('discrete') || fullText.includes('pro') || !fullText.includes('vega'));

    // Integrated / Software rasterizer signatures
    const isIntegrated = fullText.includes('intel') || fullText.includes('uhd')
      || fullText.includes('iris') || fullText.includes('hd graphics')
      || fullText.includes('swiftshader') || fullText.includes('basic render') || fullText.includes('llvmpipe');

    const isDedicated = (isNvidia || isAmdDiscrete) && !isIntegrated;

    return {
      ok: isDedicated || ALLOW_INTEGRATED_GPU_FALLBACK,
      renderer: rendererStr || 'Unknown Graphics Device',
      vendor: vendorStr || 'Unknown Vendor',
      isDedicated,
      isIntegrated
    };
  } catch (err) {
    return { ok: false, error: err.message, isDedicated: false };
  }
}

// ============================================================================
// WEB AUDIO SYNTHESIZED SFX (0ms latency, zero external asset dependency)
// ============================================================================
function playWineClinkSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // High crystal wine glass chime (2800Hz fundamental + 5600Hz harmonic)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(2800, now);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(5620, now);

    gainNode.gain.setValueAtTime(0.35, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.2);
    osc2.stop(now + 1.2);
  } catch (_) {}
}

function playCameraShutterSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Shutter mechanical click (burst of shaped white noise)
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
  } catch (_) {}
}

// ============================================================================
// DATE AMBIENCE ENGINE (Web Audio API Synthesized Soundscapes, 0-dependency)
// ============================================================================
class DateAmbienceEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.currentScenario = null;
    this.nodes = [];
    this.isPlaying = false;
    this.baseVolume = 0.22;
    this.isDucked = false;
    this.chordInterval = null;
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.baseVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  start(scenarioId = 'cute_cafe') {
    this._initContext();
    if (this.isPlaying && this.currentScenario === scenarioId) return;
    this.stop(false);
    this.currentScenario = scenarioId;
    this.isPlaying = true;

    try {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0.0001, now);
      const targetVol = this.isDucked ? this.baseVolume * 0.35 : this.baseVolume;
      this.masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, targetVol), now + 2.0);

      const chordsMap = {
        standard_dining: [
          [174.61, 220.00, 261.63, 329.63],
          [196.00, 246.94, 293.66, 369.99],
          [220.00, 261.63, 329.63, 392.00],
          [146.83, 174.61, 220.00, 261.63]
        ],
        cute_cafe: [
          [261.63, 329.63, 392.00, 493.88],
          [164.81, 196.00, 246.94, 293.66],
          [220.00, 261.63, 329.63, 392.00],
          [174.61, 220.00, 261.63, 329.63]
        ],
        tokyo_sky_lounge: [
          [174.61, 220.00, 261.63, 329.63, 392.00],
          [196.00, 246.94, 293.66, 349.23, 440.00],
          [220.00, 261.63, 329.63, 392.00, 493.88],
          [146.83, 174.61, 220.00, 261.63, 329.63]
        ],
        marine_drive_night: [
          [155.56, 196.00, 233.08, 293.66, 349.23],
          [196.00, 233.08, 293.66, 349.23, 392.00],
          [174.61, 207.65, 261.63, 311.13, 349.23],
          [116.54, 174.61, 233.08, 293.66, 329.63]
        ],
        stargazing: [
          [110.00, 164.81, 220.00, 329.63],
          [98.00, 146.83, 196.00, 293.66],
          [123.47, 185.00, 246.94, 369.99],
          [110.00, 164.81, 220.00, 329.63]
        ]
      };

      const progression = chordsMap[scenarioId] || chordsMap.marine_drive_night || chordsMap.tokyo_sky_lounge || chordsMap.cute_cafe;
      let chordIndex = 0;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(scenarioId === 'stargazing' ? 650 : 850, now);
      filter.Q.setValueAtTime(1.2, now);
      filter.connect(this.masterGain);
      this.nodes.push(filter);

      const playChord = (chordNotes) => {
        if (!this.isPlaying || !this.ctx) return;
        const chordTime = this.ctx.currentTime;

        chordNotes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const noteGain = this.ctx.createGain();

          osc.type = (idx % 2 === 0) ? 'sine' : 'triangle';
          osc.frequency.setValueAtTime(freq, chordTime);

          noteGain.gain.setValueAtTime(0.0001, chordTime);
          noteGain.gain.linearRampToValueAtTime(0.07 / chordNotes.length, chordTime + 1.8);
          noteGain.gain.setValueAtTime(0.07 / chordNotes.length, chordTime + 4.5);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, chordTime + 6.2);

          osc.connect(noteGain);
          noteGain.connect(filter);

          osc.start(chordTime);
          osc.stop(chordTime + 6.3);
        });
      };

      playChord(progression[0]);

      this.chordInterval = setInterval(() => {
        if (!this.isPlaying || !this.ctx) return;
        chordIndex = (chordIndex + 1) % progression.length;
        playChord(progression[chordIndex]);
      }, 5800);

    } catch (err) {
      console.warn('[DateAmbienceEngine] Start note:', err);
    }
  }

  setVolume(vol) {
    this.baseVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      const target = this.isDucked ? this.baseVolume * 0.35 : this.baseVolume;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + 0.1);
    }
  }

  setDucked(ducked) {
    if (this.isDucked === ducked) return;
    this.isDucked = ducked;
    if (this.masterGain && this.ctx && this.isPlaying) {
      const now = this.ctx.currentTime;
      const target = this.isDucked ? this.baseVolume * 0.35 : this.baseVolume;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + (ducked ? 0.2 : 0.6));
    }
  }

  stop(hard = true) {
    this.isPlaying = false;
    if (this.chordInterval) {
      clearInterval(this.chordInterval);
      this.chordInterval = null;
    }
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(0.0001, now + (hard ? 0.1 : 0.6));
    }
    if (hard && this.ctx) {
      setTimeout(() => {
        try {
          this.nodes.forEach((n) => n.disconnect?.());
          this.nodes = [];
        } catch (_) {}
      }, 200);
    }
  }
}

export const dateAmbienceEngine = new DateAmbienceEngine();

// ============================================================================
// SEATED PROCEDURAL GESTURE MAPPER (<yuki_anim:...> tags -> seated motions)
// ============================================================================
export const SEATED_GESTURE_MAP = {
  nod: 'seated_nod',
  nodding: 'seated_nod',
  agree: 'seated_nod',
  gentle_smile: 'seated_nod',
  caring: 'seated_nod',
  pat: 'seated_nod',
  gentle_wave: 'seated_nod',
  greeting_wave: 'seated_nod',

  shake: 'seated_shake',
  head_shake: 'seated_shake',
  no: 'seated_shake',
  disagree: 'seated_shake',
  sigh: 'seated_shake',

  shy: 'seated_shy',
  shy_fidget: 'seated_shy',
  blush: 'seated_shy',
  fidget: 'seated_shy',
  look_away: 'seated_shy',
  worried: 'seated_shy',

  laugh: 'seated_laugh',
  laughing: 'seated_laugh',
  smile: 'seated_laugh',
  tease_laugh: 'seated_laugh',
  mock: 'seated_laugh',
  mocking_laugh: 'seated_laugh',
  giggle: 'seated_laugh',
  laugh_opt2: 'seated_laugh',
  knee_slap: 'seated_laugh',

  sleepy: 'seated_sleepy',
  sleepy_rub_eyes: 'seated_sleepy',
  rub_eyes: 'seated_sleepy',
  yawn: 'seated_sleepy',
  yawning: 'seated_sleepy',
  nap: 'seated_sleepy',

  smug: 'seated_smug',
  model_pose: 'seated_smug',
  peace_sign: 'seated_smug',
  finger_guns: 'seated_smug',

  peer: 'seated_lean_in',
  peering: 'seated_lean_in',
  inspect: 'seated_lean_in',
  curious: 'seated_lean_in',

  toast: 'seated_cheers',
  cheers: 'seated_cheers',
  wine: 'seated_cheers'
};

// Resolves relative asset URLs cleanly across both dev server and packaged Electron (file:// protocol)
export function resolveAssetPath(relPath) {
  const clean = String(relPath || '').replace(/^\.?\//, '');
  return `./${clean}`;
}

// Recursively disposes geometries, materials, textures, and detached nodes to free GPU memory
export function disposeHierarchy(rootObj) {
  if (!rootObj) return;
  rootObj.traverse((child) => {
    if (child.isLight) {
      child.intensity = 0;
      child.visible = false;
      child.dispose?.();
    }
    if (child.geometry) {
      child.geometry.dispose?.();
    }
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (!m) return;
        for (const key of Object.keys(m)) {
          const val = m[key];
          if (val && typeof val === 'object' && val.isTexture) {
            val.dispose?.();
          }
        }
        m.dispose?.();
      });
    }
  });
}

// Sanitizes materials to prevent shader uniform limit overflow (MAX_FRAGMENT_UNIFORM_VECTORS 1024),
// strips unnecessary cameras from imported GLTF stages, preserves architectural lighting,
// sanitizes physical glass to MeshStandardMaterial to prevent MAX_FRAGMENT_UNIFORM_VECTORS overflow,
// and eliminates heavy shadow passes
export function sanitizePbrMaterials(rootObj, options = {}) {
  const { castShadow = false, receiveShadow = true, keepLights = true, lightIntensityScale = 1.0 } = options;
  if (!rootObj) return;

  const lightsToRemove = [];
  const camerasToRemove = [];

  // Check root object directly
  if (rootObj.isLight) {
    if (!keepLights) {
      rootObj.intensity = 0;
      rootObj.visible = false;
      if (rootObj.parent) rootObj.parent.remove(rootObj);
      rootObj.dispose?.();
      return;
    } else {
      if (rootObj.isDirectionalLight) {
        rootObj.castShadow = true;
        rootObj.shadow.mapSize.width = 2048;
        rootObj.shadow.mapSize.height = 2048;
        rootObj.shadow.bias = -0.0005;
        rootObj.shadow.normalBias = 0.02;
      } else {
        rootObj.castShadow = false;
      }
      if (!rootObj.userData.baseIntensity) {
        let normalized = rootObj.intensity;
        if (rootObj.isDirectionalLight && normalized > 10) {
          // Blender glTF sun lights are exported in Lux (e.g. 2868 Lux).
          // Standard Three.js directional lights for anime VRM MToon are 1.5 - 3.0.
          normalized = Math.min(normalized * 0.001, 3.0);
        } else if ((rootObj.isPointLight || rootObj.isSpotLight) && normalized > 20) {
          // Point/spot lights in glTF are in Candela/Lumens. Normalize to physical decay range.
          normalized = normalized > 100 ? normalized * 0.005 : normalized * 0.08;
        }
        rootObj.userData.baseIntensity = normalized * (typeof lightIntensityScale === 'number' ? lightIntensityScale : 1.0);
      }
      rootObj.intensity = rootObj.userData.baseIntensity;
    }
  }
  if (rootObj.isCamera) {
    if (rootObj.parent) rootObj.parent.remove(rootObj);
    return;
  }

  rootObj.traverse((child) => {
    // 1. Embedded lights: Preserve architectural lights (Sun, table pendants, sconces, sunbeams)
    // Primary DirectionalLight casts high-quality soft shadows (1 shadow map unit, zero GPU bottleneck).
    // Point and spot lights do not cast shadows to protect WebGL texture units and cube map limits.
    if (child.isLight) {
      if (!keepLights) {
        lightsToRemove.push(child);
        return;
      } else {
        if (child.isDirectionalLight) {
          child.castShadow = true;
          child.shadow.mapSize.width = 2048;
          child.shadow.mapSize.height = 2048;
          child.shadow.bias = -0.0005;
          child.shadow.normalBias = 0.02;
          child.shadow.camera.near = 0.5;
          child.shadow.camera.far = 25;
          const d = 6;
          child.shadow.camera.left = -d;
          child.shadow.camera.right = d;
          child.shadow.camera.top = d;
          child.shadow.camera.bottom = -d;
        } else {
          child.castShadow = false;
        }
        if (!child.userData.baseIntensity) {
          let normalized = child.intensity;
          if (child.isDirectionalLight && normalized > 10) {
            // Blender glTF sun lights are exported in Lux (e.g. 2868 Lux).
            // Standard Three.js directional lights for anime VRM MToon are 1.5 - 3.0.
            normalized = Math.min(normalized * 0.001, 3.0);
          } else if ((child.isPointLight || child.isSpotLight) && normalized > 20) {
            // Point/spot lights in glTF are in Candela/Lumens. Normalize to physical decay range.
            normalized = normalized > 100 ? normalized * 0.005 : normalized * 0.08;
          }
          child.userData.baseIntensity = normalized * (typeof lightIntensityScale === 'number' ? lightIntensityScale : 1.0);
        }
        child.intensity = child.userData.baseIntensity;
      }
    }
    // 2. Strip embedded cameras
    if (child.isCamera) {
      camerasToRemove.push(child);
      return;
    }

    if (child.isMesh) {
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const sanitized = mats.map((mat) => {
          if (!mat) return mat;
          // Detect heavy transmission, physical glass, or materials exceeding WebGL fragment uniform limits
          const isGlass =
            mat.isMeshPhysicalMaterial ||
            (typeof mat.transmission === 'number' && mat.transmission > 0) ||
            (mat.name && (
              mat.name.toLowerCase().includes('glass') ||
              mat.name.toLowerCase().includes('transmission')
            ));

          if (isGlass) {
            // Replace with high-performance transparent MeshStandardMaterial (avoids MAX_FRAGMENT_UNIFORM_VECTORS overflow)
            const isWindowGlass = mat.name && mat.name.toLowerCase().includes('window');
            const stdMat = new THREE.MeshStandardMaterial({
              color: isWindowGlass ? new THREE.Color(0xf0f8ff) : (mat.color || new THREE.Color(0xddeeff)),
              roughness: isWindowGlass ? 0.02 : 0.1,
              metalness: 0.05,
              transparent: true,
              opacity: isWindowGlass ? 0.12 : ((typeof mat.opacity === 'number' && mat.opacity < 1 && mat.opacity > 0) ? mat.opacity : 0.35),
              depthWrite: false
            });
            stdMat.name = mat.name || 'GlassMaterial';
            mat.dispose?.();
            return stdMat;
          }
          return mat;
        });
        child.material = Array.isArray(child.material) ? sanitized : sanitized[0];
      }

      // Transparent/glass materials must never cast shadows
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const hasTransparent = mats.some((m) => m && m.transparent);
      child.castShadow = hasTransparent ? false : castShadow;
      child.receiveShadow = receiveShadow;
    }
  });

  // Detach and dispose all embedded lights if explicitly stripped
  lightsToRemove.forEach((light) => {
    light.intensity = 0;
    light.visible = false;
    if (light.parent) {
      light.parent.remove(light);
    }
    light.dispose?.();
  });

  // Detach embedded cameras
  camerasToRemove.forEach((cam) => {
    if (cam.parent) {
      cam.parent.remove(cam);
    }
  });
}

// Robust bone node retrieval supporting VRM 1.0 (camelCase), VRM 0.x (PascalCase), and legacy fallbacks
export function getBoneNode(vrm, name) {
  if (!vrm || !vrm.humanoid) return null;

  // 1. Try standard camelCase (VRM 1.0 normalized)
  let bone = vrm.humanoid.getNormalizedBoneNode?.(name);
  if (bone) return bone;

  // 2. Try PascalCase (VRM 0.x / legacy normalized)
  const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
  bone = vrm.humanoid.getNormalizedBoneNode?.(pascalName);
  if (bone) return bone;

  // 3. Fallback to raw bone node
  if (typeof vrm.humanoid.getRawBoneNode === 'function') {
    bone = vrm.humanoid.getRawBoneNode(name) || vrm.humanoid.getRawBoneNode(pascalName);
    if (bone) return bone;
  }

  // 4. Fallback to older three-vrm bone node method if exists
  if (typeof vrm.humanoid.getBoneNode === 'function') {
    try {
      bone = vrm.humanoid.getBoneNode(name) || vrm.humanoid.getBoneNode(pascalName);
      if (bone) return bone;
    } catch (_) {}
  }

  return null;
}

// Canonical VRM 1.0 & VRM 0.x alias maps (First-match wins — never multi-cast conflicting shapes!)
export const EXPR_FALLBACKS = {
  aa: ['aa', 'A', 'a', 'AA'],
  ih: ['ih', 'I', 'i', 'IH'],
  ou: ['ou', 'u', 'U', 'OU'],
  ee: ['ee', 'e', 'E', 'EE'],
  oh: ['oh', 'o', 'O', 'OH'],
  blink: ['blink', 'Blink', 'BLINK'],
  blinkLeft: ['blinkLeft', 'blink_l', 'Blink_L', 'BLINK_L'],
  blinkRight: ['blinkRight', 'blink_r', 'Blink_R', 'BLINK_R'],
  happy: ['happy', 'joy', 'Joy', 'JOY'],
  sad: ['sad', 'sorrow', 'Sorrow', 'SORROW'],
  angry: ['angry', 'anger', 'Anger', 'ANGRY'],
  surprised: ['surprised', 'surprise', 'Surprise', 'SURPRISED'],
  relaxed: ['relaxed', 'Relaxed', 'relax', 'RELAXED'],
  browUp: ['browUp', 'brow_up', 'BrowUp', 'eyebrow_up', 'EyebrowUp', 'brow_raise', 'BrowRaise', 'BRW_Up'],
  browDown: ['browDown', 'brow_down', 'BrowDown', 'eyebrow_down', 'EyebrowDown', 'brow_furrow', 'BrowFurrow', 'brow_low', 'BrowLow', 'BRW_Down'],
};

// Blend shape helper to support both VRM v0 and v1 with first-match exclusive resolution
export const setExpressionValue = (vrm, name, value) => {
  if (!vrm) return;

  const manager = vrm.expressionManager || vrm.blendShapeProxy;
  if (!manager) return;

  if (!vrm._exprNameCache) vrm._exprNameCache = new Map();
  let resolved = vrm._exprNameCache.get(name);

  if (resolved === undefined) {
    const candidates = EXPR_FALLBACKS[name] || [name];
    for (const cand of candidates) {
      try {
        if (typeof manager.getExpression === 'function' && manager.getExpression(cand)) {
          resolved = cand;
          break;
        }
        if (manager.expressionMap && manager.expressionMap[cand]) {
          resolved = cand;
          break;
        }
        if (typeof manager.getBlendShapeGroup === 'function' && manager.getBlendShapeGroup(cand)) {
          resolved = cand;
          break;
        }
      } catch (_) { }
    }

    if (!resolved) {
      resolved = name;
      for (const cand of candidates) {
        try {
          manager.setValue(cand, 0);
          resolved = cand;
          break;
        } catch (_) { }
      }
    }
    vrm._exprNameCache.set(name, resolved);
  }

  try {
    manager.setValue(resolved, value);
  } catch (_) { }
};

// Recreates the exact 5-stop anime sky gradient from Blender's Mat_CuteSkyBlue Color Ramp
// (glTF 2.0 specification cannot export Blender's procedural node trees)
export function createCuteSkyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  // Linear gradient from bottom (horizon V=0.0) to top (zenith V=1.0)
  const grad = ctx.createLinearGradient(0, 512, 0, 0);
  grad.addColorStop(0.00, 'rgb(178, 220, 250)'); // Stop 0: soft ground-level atmospheric haze
  grad.addColorStop(0.38, 'rgb(165, 214, 252)'); // Stop 1: crisp airy horizon transition
  grad.addColorStop(0.47, 'rgb(107, 195, 252)'); // Stop 2: eye-level cheerful anime cyan-sky blue
  grad.addColorStop(0.65, 'rgb(45, 153, 240)');  // Stop 3: mid-sky radiant azure blue
  grad.addColorStop(1.00, 'rgb(26, 108, 196)');  // Stop 4: deep zenith sapphire blue
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ============================================================================
// DATE SCENARIOS & MAPS CONFIGURATION (3D Stages & 360 Panoramas)
// ============================================================================
export const MAP_POSITION_PRESETS = {
  standard_dining: {
    id: 'standard_dining',
    name: 'Standard Dining',
    desc: 'Classic dining table setup with natural eye contact distance',
    positions: {
      camera: { fov: 44, posX: 0.02, posY: 0.97, posZ: -0.5, rotY: 180 },
      objects: {
        playerPov: { posX: 0.02, posY: 0.97, posZ: -0.5, rotY: 180, scale: 1.0 },
        yuki: { posX: 0.02, posY: -0.59, posZ: 0.62, rotY: 360, scale: 1.10, scaleX: 1.10, scaleY: 1.10, scaleZ: 1.10 },
        chair: { posX: 0.08, posY: -0.32, posZ: -1.10, rotY: 5, scale: 2.75, scaleX: 2.75, scaleY: 2.75, scaleZ: 2.75 },
        table: { posX: 0, posY: 1.18, posZ: 0.30, rotY: 0, scale: 0.52, scaleX: 0.58, scaleY: 1.02, scaleZ: 0.58 },
        candleGLB: { posX: 0.12, posY: 2.02, posZ: 0.40, rotY: 0, scale: 0.11, scaleX: 0.11, scaleY: 0.11, scaleZ: 0.11 },
        vaseGLB: { posX: -0.16, posY: 1.99, posZ: 0.34, rotY: 77, scale: 0.40, scaleX: 0.40, scaleY: 0.40, scaleZ: 0.40 },
        cake: { posX: -0.05, posY: 1.99, posZ: 0.20, rotY: 0, scale: 0.32, scaleX: 0.32, scaleY: 0.32, scaleZ: 0.32 },
        herGlass: { posX: 0.12, posY: 1.55, posZ: 0.15, rotY: 0, scale: 0.65, scaleX: 0.65, scaleY: 0.65, scaleZ: 0.65 },
        yourGlass: { posX: -0.08, posY: 1.55, posZ: 0.32, rotY: 0, scale: 0.58, scaleX: 0.58, scaleY: 0.58, scaleZ: 0.58 }
      }
    }
  },
  intimate_close: {
    id: 'intimate_close',
    name: 'Intimate Close-Up',
    desc: 'Closer proximity with Yuki leaning near, ideal for private lounges',
    positions: {
      camera: { fov: 38, posX: 0, posY: 2.2, posZ: 0.25 },
      objects: {
        playerPov: { posX: 0, posY: 2.2, posZ: 0.25, rotY: 0, scale: 1.0 },
        yuki: { posX: 0, posY: 0.72, posZ: -0.05, rotY: 180, scale: 1.15, scaleX: 1.15, scaleY: 1.15, scaleZ: 1.15 },
        chair: { posX: 0.05, posY: -0.25, posZ: -0.95, rotY: 5, scale: 2.75, scaleX: 2.75, scaleY: 2.75, scaleZ: 2.75 },
        table: { posX: 0, posY: 1.21, posZ: 0.22, rotY: 0, scale: 0.53, scaleX: 0.6, scaleY: 1.05, scaleZ: 0.6 },
        candleGLB: { posX: -0.18, posY: 2.05, posZ: 0.35, rotY: 0, scale: 0.12, scaleX: 0.12, scaleY: 0.12, scaleZ: 0.12 },
        vaseGLB: { posX: -0.22, posY: 2.02, posZ: 0.28, rotY: 77, scale: 0.38, scaleX: 0.38, scaleY: 0.38, scaleZ: 0.38 },
        cake: { posX: 0.05, posY: 2.02, posZ: 0.15, rotY: 0, scale: 0.34, scaleX: 0.34, scaleY: 0.34, scaleZ: 0.34 },
        herGlass: { posX: 0.11, posY: 1.58, posZ: 0.12, rotY: 0, scale: 0.65, scaleX: 0.65, scaleY: 0.65, scaleZ: 0.65 },
        yourGlass: { posX: -0.07, posY: 1.58, posZ: 0.28, rotY: 0, scale: 0.6, scaleX: 0.6, scaleY: 0.6, scaleZ: 0.6 }
      }
    }
  },
  cozy_cafe: {
    id: 'cozy_cafe',
    name: 'Cozy Cafe',
    desc: 'Compact table spacing tailored for cafe interiors & counter seating',
    positions: {
      camera: { fov: 44, posX: 0.02, posY: 0.97, posZ: -0.5, rotY: 180 },
      objects: {
        playerPov: { posX: 0.02, posY: 0.97, posZ: -0.5, rotY: 180, scale: 1.0 },
        yuki: { posX: 0.02, posY: -0.59, posZ: 0.62, rotY: 360, scale: 1.10, scaleX: 1.10, scaleY: 1.10, scaleZ: 1.10 },
        chair: { posX: 0.08, posY: -0.32, posZ: -1.10, rotY: 5, scale: 2.75, scaleX: 2.75, scaleY: 2.75, scaleZ: 2.75 },
        table: { posX: 0, posY: 1.18, posZ: 0.30, rotY: 0, scale: 0.52, scaleX: 0.58, scaleY: 1.02, scaleZ: 0.58 },
        candleGLB: { posX: 0.12, posY: 2.02, posZ: 0.40, rotY: 0, scale: 0.11, scaleX: 0.11, scaleY: 0.11, scaleZ: 0.11 },
        vaseGLB: { posX: -0.16, posY: 1.99, posZ: 0.34, rotY: 77, scale: 0.40, scaleX: 0.40, scaleY: 0.40, scaleZ: 0.40 },
        cake: { posX: -0.05, posY: 1.99, posZ: 0.20, rotY: 0, scale: 0.32, scaleX: 0.32, scaleY: 0.32, scaleZ: 0.32 },
        herGlass: { posX: 0.12, posY: 1.55, posZ: 0.15, rotY: 0, scale: 0.65, scaleX: 0.65, scaleY: 0.65, scaleZ: 0.65 },
        yourGlass: { posX: -0.08, posY: 1.55, posZ: 0.32, rotY: 0, scale: 0.58, scaleX: 0.58, scaleY: 0.58, scaleZ: 0.58 }
      }
    }
  },
  lounge_relaxed: {
    id: 'lounge_relaxed',
    name: 'Relaxed Lounge',
    desc: 'Spacious scenic perspective for expansive terraces and sunsets',
    positions: {
      camera: { fov: 46, posX: 0, posY: 2.35, posZ: 0.55 },
      objects: {
        playerPov: { posX: 0, posY: 2.35, posZ: 0.55, rotY: 0, scale: 1.0 },
        yuki: { posX: 0, posY: 0.68, posZ: -0.28, rotY: 176, scale: 1.12, scaleX: 1.12, scaleY: 1.12, scaleZ: 1.12 },
        chair: { posX: 0.10, posY: -0.30, posZ: -1.22, rotY: 8, scale: 2.80, scaleX: 2.80, scaleY: 2.80, scaleZ: 2.80 },
        table: { posX: 0, posY: 1.21, posZ: 0.35, rotY: 0, scale: 0.53, scaleX: 0.6, scaleY: 1.05, scaleZ: 0.6 },
        candleGLB: { posX: 0, posY: 2.05, posZ: 0.45, rotY: 0, scale: 0.12, scaleX: 0.12, scaleY: 0.12, scaleZ: 0.12 },
        vaseGLB: { posX: -0.15, posY: 2.02, posZ: 0.38, rotY: 77, scale: 0.41, scaleX: 0.41, scaleY: 0.41, scaleZ: 0.41 },
        cake: { posX: 0, posY: 2.02, posZ: 0.22, rotY: 0, scale: 0.34, scaleX: 0.34, scaleY: 0.34, scaleZ: 0.34 },
        herGlass: { posX: 0.13, posY: 1.58, posZ: 0.18, rotY: 0, scale: 0.67, scaleX: 0.67, scaleY: 0.67, scaleZ: 0.67 },
        yourGlass: { posX: -0.09, posY: 1.58, posZ: 0.36, rotY: 0, scale: 0.6, scaleX: 0.6, scaleY: 0.6, scaleZ: 0.6 }
      }
    }
  },
  promenade_edge: {
    id: 'promenade_edge',
    name: 'Promenade Waterfront Railing',
    desc: 'Standing side-by-side at the waterfront railing overlooking the river and illuminated skyline',
    positions: {
      camera: { fov: 48, posX: 2.2, posY: 1.68, posZ: 0.0, rotY: 90, rotX: -7, far: 2000 },
      objects: {
        playerPov: { posX: 2.2, posY: 1.68, posZ: 0.0, rotY: 90, rotX: -7, scale: 1.0, far: 2000 },
        yuki: { posX: 2.2, posY: 0.0, posZ: 1.2, rotY: 270, scale: 1.10, scaleX: 1.10, scaleY: 1.10, scaleZ: 1.10 },
        chair: { posX: 6.2, posY: -10.0, posZ: 0.0, rotY: 180, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        table: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        candleGLB: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        vaseGLB: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        cake: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        herGlass: { posX: 1.1, posY: 1.05, posZ: 0.6, rotY: 0, scale: 0.55, scaleX: 0.55, scaleY: 0.55, scaleZ: 0.55 },
        yourGlass: { posX: 1.1, posY: 1.05, posZ: 0.2, rotY: 0, scale: 0.55, scaleX: 0.55, scaleY: 0.55, scaleZ: 0.55 }
      }
    }
  },
  promenade_bench: {
    id: 'promenade_bench',
    name: 'Promenade Seaside Bench',
    desc: 'Seated together on the seaside wooden bench gazing out at the glowing river and city lights',
    positions: {
      camera: { fov: 46, posX: 6.05, posY: 1.15, posZ: -0.35, rotY: 90, far: 2000 },
      objects: {
        playerPov: { posX: 6.05, posY: 1.15, posZ: -0.35, rotY: 90, scale: 1.0, far: 2000 },
        yuki: { posX: 6.05, posY: 0.45, posZ: 0.35, rotY: 270, scale: 1.10, scaleX: 1.10, scaleY: 1.10, scaleZ: 1.10 },
        chair: { posX: 6.2, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        table: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        candleGLB: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        vaseGLB: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        cake: { posX: 0, posY: -10.0, posZ: 0, rotY: 0, scale: 0.001, scaleX: 0.001, scaleY: 0.001, scaleZ: 0.001 },
        herGlass: { posX: 6.0, posY: 0.48, posZ: 0.1, rotY: 0, scale: 0.55, scaleX: 0.55, scaleY: 0.55, scaleZ: 0.55 },
        yourGlass: { posX: 5.9, posY: 0.48, posZ: -0.1, rotY: 0, scale: 0.55, scaleX: 0.55, scaleY: 0.55, scaleZ: 0.55 }
      }
    }
  }
};

/**
 * Normalizes any color representation (hex integer, 3-digit hex, 6-digit hex, 0x prefix, or THREE.Color)
 * into a valid lowercase 7-character CSS hexadecimal string (#rrggbb).
 */
export function normalizeColorHex(color, fallback = '#ffffff') {
  if (color === null || color === undefined) return fallback;
  if (typeof color === 'string') {
    let s = color.trim().toLowerCase();
    if (s.startsWith('0x')) s = '#' + s.slice(2);
    if (!s.startsWith('#') && /^[0-9a-f]{6}$/i.test(s)) s = '#' + s;
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    return s || fallback;
  }
  if (typeof color === 'number' && !isNaN(color)) {
    return '#' + ('000000' + (color & 0xffffff).toString(16)).slice(-6).toLowerCase();
  }
  if (typeof color === 'object' && typeof color?.getHexString === 'function') {
    return '#' + color.getHexString().toLowerCase();
  }
  return fallback;
}

export const DEFAULT_SCENARIOS = {
  marine_drive_night: {
    id: 'marine_drive_night',
    type: '3d_model',
    title: 'Marine Drive Night',
    subtitle: 'Midnight promenade with glowing skyline reflections and calm river breeze',
    assetUrl: resolveAssetPath('3d_assets/date/MarineDriveNightMap.glb'),
    bg: null,
    cameraFar: 2000,
    customPrompt: 'You and Master are having a late night walk along a quiet marine drive promenade overlooking a vast, dark, reflective river with a breathtaking skyscraper skyline across the water. The atmosphere is romantic, peaceful, and delightfully chill with a touch of quiet midnight mystery. You are leaning close to Master near the waterfront railing or sitting together on the promenade bench, sharing soft whispered words and admiring the city lights.',
    ambientColor: '#181e36',
    ambientIntensity: 0.95,
    spotColor: '#ffdca8',
    spotIntensity: 1.2,
    mapLightsIntensity: 0.25,
    toneMapping: 'AgX',
    exposure: 1.05,
    envIntensity: 0.75,
    candleColor: '#ffaa44',
    candleIntensity: 1.0,
    showDefaultTable: false,
    modelTransform: { posX: 0, posY: 0.0, posZ: 0, rotY: 0, scale: 1.0 },
    waterLevel: -2.35,
    defaultPositions: MAP_POSITION_PRESETS.promenade_edge.positions,
    welcomeDialogue: "The city lights across the water look breathtaking tonight... It's so peaceful and quiet here by the river. Just you and me."
  },
  cute_cafe: {
    id: 'cute_cafe',
    type: '3d_model',
    title: 'Cute Cafe',
    subtitle: 'Charming 3D cafe with warm coffee and gentle jazz',
    assetUrl: resolveAssetPath('3d_assets/date/CuteCafeMap.glb'),
    bg: null,
    customPrompt: 'You and Master are having a relaxed coffee date in a lovely, cozy cafe. Yuki is in a sweet, playful mood, taking sips of warm latte and sharing pastries across the table.',
    ambientColor: '#fff6eb',
    ambientIntensity: 0.9,
    spotColor: '#ffeedd',
    spotIntensity: 1.0,
    mapLightsIntensity: 0.05,
    toneMapping: 'AgX',
    exposure: 0.9,
    envIntensity: 0.8,
    candleColor: '#ffaa44',
    candleIntensity: 1.5,
    showDefaultTable: false,
    modelTransform: { posX: 0, posY: -0.2, posZ: 0, rotY: 0, scale: 1.0 },
    defaultPositions: MAP_POSITION_PRESETS.cozy_cafe.positions,
    welcomeDialogue: "The coffee smells amazing here! I'm so happy to sit across from you in this cozy cafe."
  },
  tokyo_sky_lounge: {
    id: 'tokyo_sky_lounge',
    type: 'panorama',
    title: 'Tokyo Sky Lounge',
    subtitle: 'Romantic Dinner overlooking glowing city lights',
    assetUrl: resolveAssetPath('3d_assets/date/bg/tokyo_sky_lounge.png'),
    bg: resolveAssetPath('3d_assets/date/bg/tokyo_sky_lounge.png'),
    customPrompt: 'You and Master are having a private romantic dinner at the Tokyo Sky Lounge on the 52nd floor. The city lights glow below through the panoramic glass. Yuki is elegant, loving, and attentive, enjoying wine and dessert together.',
    ambientColor: '#281932',
    ambientIntensity: 1.15,
    spotColor: '#ffeedd',
    spotIntensity: 2.0,
    candleColor: '#ff9933',
    showDefaultTable: true,
    defaultPositions: MAP_POSITION_PRESETS.standard_dining.positions,
    welcomeDialogue: "This table has such a breathtaking view of the city tonight... I'm so glad we came here together."
  },
  beach_sunset: {
    id: 'beach_sunset',
    type: 'panorama',
    title: 'Sunset Beach Terrace',
    subtitle: 'Golden hour dinner listening to gentle ocean waves',
    assetUrl: resolveAssetPath('3d_assets/date/bg/beach_sunset.png'),
    bg: resolveAssetPath('3d_assets/date/bg/beach_sunset.png'),
    customPrompt: 'You and Master are on a beachside terrace date during golden hour. Soft ocean breezes blow and gentle waves lap the shore as the sun sinks below the horizon. Yuki is romantic, nostalgic, and loving.',
    ambientColor: '#3d1b14',
    ambientIntensity: 1.5,
    spotColor: '#ff8e40',
    spotIntensity: 2.2,
    candleColor: '#ffc470',
    showDefaultTable: true,
    defaultPositions: MAP_POSITION_PRESETS.lounge_relaxed.positions,
    welcomeDialogue: "Look at that sunset over the ocean... the golden colors are magical. Let's stay until the stars come out!"
  },
  cinema_lounge: {
    id: 'cinema_lounge',
    type: 'panorama',
    title: 'VIP Cinema Lounge',
    subtitle: 'Private velvet lounge seating with cinema screen ambiance',
    assetUrl: resolveAssetPath('3d_assets/date/bg/cinema_lounge.png'),
    bg: resolveAssetPath('3d_assets/date/bg/cinema_lounge.png'),
    customPrompt: 'You and Master are sharing a private VIP cinema screening lounge with velvet seating. Yuki is cuddly, whispering playfully, and excited to watch something special together.',
    ambientColor: '#140a1c',
    ambientIntensity: 1.2,
    spotColor: '#8aa8ff',
    spotIntensity: 1.8,
    candleColor: '#ff9944',
    showDefaultTable: true,
    defaultPositions: MAP_POSITION_PRESETS.intimate_close.positions,
    welcomeDialogue: "We have the whole VIP lounge to ourselves! What are you in the mood to watch tonight?"
  }
};

export const DESTINATIONS = DEFAULT_SCENARIOS;

export function loadCustomScenarios() {
  try {
    const raw = localStorage.getItem('yuki_custom_date_scenarios');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function saveCustomScenarios(scenarios) {
  try {
    localStorage.setItem('yuki_custom_date_scenarios', JSON.stringify(scenarios));
    fetch(`${API_BASE}/api/date/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarios: Object.values(scenarios) })
    }).catch(() => {});
  } catch (_) {}
}

export const FLOOR_TEXTURES = {
  wood: {
    id: 'wood',
    name: 'Tokyo Terrace Deck (Wood)',
    url: resolveAssetPath('3d_assets/date/tokyo_terrace_floor.jpg'),
    repeat: [3, 3],
    roughness: 0.35,
    metalness: 0.15
  },
  stone: {
    id: 'stone',
    name: 'Metropolitan Stone Tile',
    url: resolveAssetPath('3d_assets/date/tokyo_terrace_deck.jpg'),
    repeat: [4, 4],
    roughness: 0.5,
    metalness: 0.1
  }
};

// ============================================================================
// DATE MODE DEV & CONFIG ENGINE
// ============================================================================
export const TONE_MAPPINGS = {
  AgX: THREE.AgXToneMapping || THREE.ACESFilmicToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  Linear: THREE.LinearToneMapping
};

export const POSE_PRESETS = {
  standing_promenade: {
    id: 'standing_promenade',
    label: 'Promenade Standing',
    desc: 'Natural standing posture looking out over the water railing with gentle relaxed posture',
    pose: {
      head: { headPitch: 0.02, headYaw: -0.05, headRoll: 0.04, neckPitch: 0.01, neckYaw: -0.03, neckRoll: 0.02 },
      torso: { spinePitch: 0.02, spineYaw: -0.04, spineRoll: 0.02, chestPitch: 0.01, chestYaw: -0.03, chestRoll: 0.01 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: 0.0, rotYaw: -0.04, rotRoll: 0.02 },
      leftArm: { upperPitch: 0.15, upperYaw: 0.12, upperRoll: 0.45, lowerFlex: 0.35, lowerTwist: -0.10, lowerAngle: 0.15, handPitch: 0.05, handYaw: 0.10, handRoll: 0.05 },
      rightArm: { upperPitch: 0.18, upperYaw: -0.10, upperRoll: -0.45, lowerFlex: 0.38, lowerTwist: 0.10, lowerAngle: -0.15, handPitch: 0.05, handYaw: -0.10, handRoll: -0.05 },
      leftLeg: { upperPitch: 0.04, upperYaw: 0.04, upperRoll: 0.02, lowerFlex: -0.04, lowerTwist: 0.0, footPitch: 0.0, footYaw: 0.02, footRoll: 0.0 },
      rightLeg: { upperPitch: -0.02, upperYaw: -0.04, upperRoll: -0.02, lowerFlex: -0.02, lowerTwist: 0.0, footPitch: 0.0, footYaw: -0.02, footRoll: 0.0 }
    }
  },
  default: {
    id: 'default',
    label: 'Default Seated',
    desc: 'Natural dining posture with hands resting near table',
    pose: {
      head: { headPitch: 0.0, headYaw: 0.0, headRoll: 0.0, neckPitch: 0.0, neckYaw: 0.0, neckRoll: 0.0 },
      torso: { spinePitch: -0.04, spineYaw: 0.0, spineRoll: 0.0, chestPitch: -0.02, chestYaw: 0.0, chestRoll: 0.0 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: 0.0, rotYaw: 0.0, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.12, upperYaw: -0.22, upperRoll: 1.12, lowerFlex: 0.40, lowerTwist: -0.10, lowerAngle: 0.18, handPitch: 0.10, handYaw: 0.25, handRoll: 0.10 },
      rightArm: { upperPitch: 0.12, upperYaw: 0.22, upperRoll: -1.12, lowerFlex: 0.40, lowerTwist: 0.10, lowerAngle: -0.18, handPitch: 0.10, handYaw: -0.25, handRoll: -0.10 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  },
  hands_on_table: {
    id: 'hands_on_table',
    label: 'Hands on Table',
    desc: 'Arms forward with palms rested flat on the dining table',
    pose: {
      head: { headPitch: 0.05, headYaw: 0.0, headRoll: 0.0, neckPitch: 0.02, neckYaw: 0.0, neckRoll: 0.0 },
      torso: { spinePitch: 0.04, spineYaw: 0.0, spineRoll: 0.0, chestPitch: 0.02, chestYaw: 0.0, chestRoll: 0.0 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: 0.02, rotYaw: 0.0, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.85, upperYaw: 0.10, upperRoll: 0.75, lowerFlex: 1.10, lowerTwist: -0.30, lowerAngle: 0.20, handPitch: -0.20, handYaw: 0.05, handRoll: 0.15 },
      rightArm: { upperPitch: 0.85, upperYaw: -0.10, upperRoll: -0.75, lowerFlex: 1.10, lowerTwist: 0.30, lowerAngle: -0.20, handPitch: -0.20, handYaw: -0.05, handRoll: -0.15 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  },
  clasped_hands: {
    id: 'clasped_hands',
    label: 'Clasped Hands',
    desc: 'Attentive seated posture with hands clasped together in front',
    pose: {
      head: { headPitch: 0.02, headYaw: 0.0, headRoll: 0.04, neckPitch: 0.02, neckYaw: 0.0, neckRoll: 0.02 },
      torso: { spinePitch: 0.02, spineYaw: 0.0, spineRoll: 0.0, chestPitch: 0.01, chestYaw: 0.0, chestRoll: 0.0 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: 0.0, rotYaw: 0.0, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.75, upperYaw: 0.30, upperRoll: 0.65, lowerFlex: 1.25, lowerTwist: -0.40, lowerAngle: 0.45, handPitch: 0.10, handYaw: 0.25, handRoll: 0.10 },
      rightArm: { upperPitch: 0.75, upperYaw: -0.30, upperRoll: -0.65, lowerFlex: 1.25, lowerTwist: 0.40, lowerAngle: -0.45, handPitch: 0.10, handYaw: -0.25, handRoll: -0.10 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  },
  relaxed_lap: {
    id: 'relaxed_lap',
    label: 'Relaxed Lap',
    desc: 'Relaxed posture with arms resting down towards the lap',
    pose: {
      head: { headPitch: -0.02, headYaw: 0.0, headRoll: 0.0, neckPitch: -0.02, neckYaw: 0.0, neckRoll: 0.0 },
      torso: { spinePitch: -0.06, spineYaw: 0.0, spineRoll: 0.0, chestPitch: -0.04, chestYaw: 0.0, chestRoll: 0.0 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: -0.02, rotYaw: 0.0, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.35, upperYaw: 0.05, upperRoll: 0.25, lowerFlex: 0.70, lowerTwist: -0.10, lowerAngle: 0.10, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 },
      rightArm: { upperPitch: 0.35, upperYaw: -0.05, upperRoll: -0.25, lowerFlex: 0.70, lowerTwist: 0.10, lowerAngle: -0.10, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  },
  crossed_legs: {
    id: 'crossed_legs',
    label: 'Crossed Legs',
    desc: 'Elegant crossed-leg posture with gentle head tilt and relaxed hands',
    pose: {
      head: { headPitch: 0.04, headYaw: -0.06, headRoll: 0.08, neckPitch: 0.02, neckYaw: -0.04, neckRoll: 0.05 },
      torso: { spinePitch: -0.02, spineYaw: 0.05, spineRoll: -0.02, chestPitch: 0.0, chestYaw: 0.04, chestRoll: -0.02 },
      hips: { posX: 0.0, posY: 0.02, posZ: 0.0, rotPitch: 0.0, rotYaw: 0.05, rotRoll: 0.04 },
      leftArm: { upperPitch: 0.45, upperYaw: 0.15, upperRoll: 0.40, lowerFlex: 0.85, lowerTwist: -0.20, lowerAngle: 0.20, handPitch: 0.05, handYaw: 0.10, handRoll: 0.05 },
      rightArm: { upperPitch: 0.50, upperYaw: -0.20, upperRoll: -0.45, lowerFlex: 0.90, lowerTwist: 0.25, lowerAngle: -0.20, handPitch: 0.05, handYaw: -0.10, handRoll: -0.05 },
      leftLeg: { upperPitch: 1.48, upperYaw: 0.12, upperRoll: 0.05, lowerFlex: -1.52, lowerTwist: -0.05, footPitch: 0.10, footYaw: 0.05, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.58, upperYaw: -0.25, upperRoll: 0.22, lowerFlex: -1.35, lowerTwist: 0.12, footPitch: 0.20, footYaw: -0.10, footRoll: 0.08 }
    }
  },
  leaning_in: {
    id: 'leaning_in',
    label: 'Leaning In',
    desc: 'Intimate posture leaning forward towards you with focused attention',
    pose: {
      head: { headPitch: 0.12, headYaw: 0.0, headRoll: 0.0, neckPitch: 0.08, neckYaw: 0.0, neckRoll: 0.0 },
      torso: { spinePitch: 0.16, spineYaw: 0.0, spineRoll: 0.0, chestPitch: 0.08, chestYaw: 0.0, chestRoll: 0.0 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.04, rotPitch: 0.06, rotYaw: 0.0, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.80, upperYaw: 0.12, upperRoll: 0.70, lowerFlex: 1.15, lowerTwist: -0.25, lowerAngle: 0.25, handPitch: -0.15, handYaw: 0.10, handRoll: 0.10 },
      rightArm: { upperPitch: 0.80, upperYaw: -0.12, upperRoll: -0.70, lowerFlex: 1.15, lowerTwist: 0.25, lowerAngle: -0.25, handPitch: -0.15, handYaw: -0.10, handRoll: -0.10 },
      leftLeg: { upperPitch: 1.42, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.42, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  },
  shy_glance: {
    id: 'shy_glance',
    label: 'Shy Glance',
    desc: 'Sweet demure posture with tilted head, side glance, and tucked hands',
    pose: {
      head: { headPitch: -0.06, headYaw: 0.18, headRoll: 0.14, neckPitch: -0.03, neckYaw: 0.12, neckRoll: 0.08 },
      torso: { spinePitch: -0.02, spineYaw: -0.06, spineRoll: 0.04, chestPitch: -0.01, chestYaw: -0.04, chestRoll: 0.03 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.0, rotPitch: 0.0, rotYaw: -0.04, rotRoll: 0.02 },
      leftArm: { upperPitch: 0.30, upperYaw: 0.10, upperRoll: 0.35, lowerFlex: 0.95, lowerTwist: -0.15, lowerAngle: 0.25, handPitch: 0.05, handYaw: 0.15, handRoll: 0.10 },
      rightArm: { upperPitch: 0.40, upperYaw: -0.15, upperRoll: -0.30, lowerFlex: 1.05, lowerTwist: 0.20, lowerAngle: -0.20, handPitch: 0.10, handYaw: -0.20, handRoll: -0.10 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.08, upperRoll: -0.02, lowerFlex: -1.50, lowerTwist: 0.02, footPitch: 0.12, footYaw: 0.02, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.08, upperRoll: 0.02, lowerFlex: -1.50, lowerTwist: -0.02, footPitch: 0.12, footYaw: -0.02, footRoll: 0.0 }
    }
  },
  thinking: {
    id: 'thinking',
    label: 'Chin Rest / Thinking',
    desc: 'Playful contemplative pose with right hand near chin and head tilted',
    pose: {
      head: { headPitch: 0.08, headYaw: -0.10, headRoll: 0.12, neckPitch: 0.04, neckYaw: -0.06, neckRoll: 0.08 },
      torso: { spinePitch: 0.06, spineYaw: 0.04, spineRoll: 0.03, chestPitch: 0.03, chestYaw: 0.02, chestRoll: 0.02 },
      hips: { posX: 0.0, posY: 0.0, posZ: 0.02, rotPitch: 0.02, rotYaw: 0.02, rotRoll: 0.0 },
      leftArm: { upperPitch: 0.70, upperYaw: 0.15, upperRoll: 0.60, lowerFlex: 1.10, lowerTwist: -0.30, lowerAngle: 0.20, handPitch: -0.10, handYaw: 0.05, handRoll: 0.10 },
      rightArm: { upperPitch: 0.95, upperYaw: -0.25, upperRoll: -0.30, lowerFlex: 1.85, lowerTwist: 0.45, lowerAngle: -0.20, handPitch: 0.15, handYaw: 0.10, handRoll: 0.20 },
      leftLeg: { upperPitch: 1.45, upperYaw: 0.04, upperRoll: -0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 },
      rightLeg: { upperPitch: 1.45, upperYaw: -0.04, upperRoll: 0.05, lowerFlex: -1.48, lowerTwist: 0.0, footPitch: 0.12, footYaw: 0.0, footRoll: 0.0 }
    }
  }
};

export function loadSavedPosePresets() {
  try {
    const raw = localStorage.getItem('yuki_date_custom_pose_presets');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.warn('[DateMode] Failed to load custom pose presets:', e);
  }
  return {};
}

export const DEFAULT_DATE_CONFIG = {
  shaders: {
    toneMapping: 'AgX',
    exposure: 0.9,
    envIntensity: 0.8
  },
  camera: {
    fov: 44,
    posX: 0.02,
    posY: 0.97,
    posZ: -0.5,
    rotY: 180,
    rotX: 0,
    far: 2000
  },
  lights: {
    ambient: {
      color: '#fff5ea',
      intensity: 0.9
    },
    keySpot: {
      color: '#ffeedd',
      intensity: 1.0,
      posX: 0.7,
      posY: -0.3,
      posZ: 1.7
    },
    candle: {
      color: '#ff9933',
      intensity: 1.5,
      posX: 0.0,
      posY: 1.52,
      posZ: 0.22
    },
    mapLights: {
      intensity: 0.05
    }
  },
  objects: {
    playerPov: { name: "Player's POV (Camera)", posX: 0.02, posY: 0.97, posZ: -0.5, rotY: 180, rotX: 0, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 },
    yuki: { name: 'Yuki Avatar', posX: 0.02, posY: -0.59, posZ: 0.62, rotY: 360, scale: 1.1, scaleX: 1.1, scaleY: 1.1, scaleZ: 1.1 },
    chair: { name: 'Dining Chair', posX: 0.08, posY: -0.32, posZ: -1.1, rotY: 5, scale: 2.75, scaleX: 2.75, scaleY: 2.75, scaleZ: 2.75 },
    table: { name: 'Dining Table', posX: 0, posY: 1.18, posZ: 0.3, rotY: 0, scale: 0.52, scaleX: 0.58, scaleY: 1.02, scaleZ: 0.58 },
    candleGLB: { name: 'Candle Hurricane', posX: 0.12, posY: 2.02, posZ: 0.4, rotY: 0, scale: 0.11, scaleX: 0.11, scaleY: 0.11, scaleZ: 0.11 },
    vaseGLB: { name: 'Flower Vase', posX: -0.16, posY: 1.99, posZ: 0.34, rotY: 77, scale: 0.40, scaleX: 0.40, scaleY: 0.40, scaleZ: 0.40 },
    cake: { name: 'Dessert Cake & Plate', posX: -0.05, posY: 1.99, posZ: 0.2, rotY: 0, scale: 0.32, scaleX: 0.32, scaleY: 0.32, scaleZ: 0.32 },
    herGlass: { name: "Yuki's Wine Glass", posX: 0.12, posY: 1.55, posZ: 0.15, rotY: 0, scale: 0.65, scaleX: 0.65, scaleY: 0.65, scaleZ: 0.65 },
    yourGlass: { name: "Player's Wine Glass", posX: -0.08, posY: 1.55, posZ: 0.32, rotY: 0, scale: 0.58, scaleX: 0.58, scaleY: 0.58, scaleZ: 0.58 },
    floor: { name: 'Terrace Floor / Ground', posX: 0, posY: -0.41, posZ: 0, rotY: 0, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 },
    bgSphere: { name: '360 Sky Dome', posX: 0, posY: -2, posZ: -2.36, rotY: 175, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 }
  },
  avatarPose: {
    head: {
      headPitch: 0.0,
      headYaw: 0.0,
      headRoll: 0.0,
      neckPitch: 0.0,
      neckYaw: 0.0,
      neckRoll: 0.0
    },
    torso: {
      spinePitch: -0.04,
      spineYaw: 0.0,
      spineRoll: 0.0,
      chestPitch: -0.02,
      chestYaw: 0.0,
      chestRoll: 0.0
    },
    hips: {
      posX: 0.0,
      posY: 0.0,
      posZ: 0.0,
      rotPitch: 0.0,
      rotYaw: 0.0,
      rotRoll: 0.0
    },
    leftArm: {
      upperPitch: 0.12,
      upperYaw: -0.22,
      upperRoll: 1.12,
      lowerFlex: 0.40,
      lowerTwist: -0.10,
      lowerAngle: 0.18,
      handPitch: 0.10,
      handYaw: 0.25,
      handRoll: 0.10
    },
    rightArm: {
      upperPitch: 0.12,
      upperYaw: 0.22,
      upperRoll: -1.12,
      lowerFlex: 0.40,
      lowerTwist: 0.10,
      lowerAngle: -0.18,
      handPitch: 0.10,
      handYaw: -0.25,
      handRoll: -0.10
    },
    leftLeg: {
      upperPitch: 1.45,
      upperYaw: 0.04,
      upperRoll: -0.05,
      lowerFlex: -1.48,
      lowerTwist: 0.0,
      footPitch: 0.12,
      footYaw: 0.0,
      footRoll: 0.0
    },
    rightLeg: {
      upperPitch: 1.45,
      upperYaw: -0.04,
      upperRoll: 0.05,
      lowerFlex: -1.48,
      lowerTwist: 0.0,
      footPitch: 0.12,
      footYaw: 0.0,
      footRoll: 0.0
    }
  }
};

export function computeConfigDiff(current, initial = DEFAULT_DATE_CONFIG) {
  const diff = {};
  if (!current || !initial) return diff;

  // 1. Shaders
  const shaderDiff = {};
  if (current.shaders?.toneMapping && current.shaders.toneMapping !== initial.shaders?.toneMapping) {
    shaderDiff.toneMapping = current.shaders.toneMapping;
  }
  if (current.shaders?.exposure !== undefined && initial.shaders?.exposure !== undefined && Math.abs(current.shaders.exposure - initial.shaders.exposure) > 0.01) {
    shaderDiff.exposure = Number(current.shaders.exposure.toFixed(2));
  }
  if (Object.keys(shaderDiff).length > 0) diff.shaders = shaderDiff;

  // 2. Camera
  const camDiff = {};
  if (current.camera?.fov !== undefined && initial.camera?.fov !== undefined && Math.abs(current.camera.fov - initial.camera.fov) > 0.1) {
    camDiff.fov = Number(current.camera.fov.toFixed(1));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.camera?.[axis] !== undefined && initial.camera?.[axis] !== undefined && Math.abs(current.camera[axis] - initial.camera[axis]) > 0.005) {
      camDiff[axis] = Number(current.camera[axis].toFixed(3));
    }
  }
  if (Object.keys(camDiff).length > 0) diff.camera = camDiff;

  // 3. Lights
  const lightsDiff = {};
  const ambDiff = {};
  const curAmbColor = normalizeColorHex(current.lights?.ambient?.color, '');
  const initAmbColor = normalizeColorHex(initial.lights?.ambient?.color, '');
  if (curAmbColor && initAmbColor && curAmbColor !== initAmbColor) {
    ambDiff.color = curAmbColor;
  }
  if (current.lights?.ambient?.intensity !== undefined && initial.lights?.ambient?.intensity !== undefined && Math.abs(current.lights.ambient.intensity - initial.lights.ambient.intensity) > 0.02) {
    ambDiff.intensity = Number(current.lights.ambient.intensity.toFixed(2));
  }
  if (Object.keys(ambDiff).length > 0) lightsDiff.ambient = ambDiff;

  const keyDiff = {};
  const curKeyColor = normalizeColorHex(current.lights?.keySpot?.color, '');
  const initKeyColor = normalizeColorHex(initial.lights?.keySpot?.color, '');
  if (curKeyColor && initKeyColor && curKeyColor !== initKeyColor) {
    keyDiff.color = curKeyColor;
  }
  if (current.lights?.keySpot?.intensity !== undefined && initial.lights?.keySpot?.intensity !== undefined && Math.abs(current.lights.keySpot.intensity - initial.lights.keySpot.intensity) > 0.02) {
    keyDiff.intensity = Number(current.lights.keySpot.intensity.toFixed(2));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.lights?.keySpot?.[axis] !== undefined && initial.lights?.keySpot?.[axis] !== undefined && Math.abs(current.lights.keySpot[axis] - initial.lights.keySpot[axis]) > 0.005) {
      keyDiff[axis] = Number(current.lights.keySpot[axis].toFixed(3));
    }
  }
  if (Object.keys(keyDiff).length > 0) lightsDiff.keySpot = keyDiff;

  const candleDiff = {};
  const curCandleColor = normalizeColorHex(current.lights?.candle?.color, '');
  const initCandleColor = normalizeColorHex(initial.lights?.candle?.color, '');
  if (curCandleColor && initCandleColor && curCandleColor !== initCandleColor) {
    candleDiff.color = curCandleColor;
  }
  if (current.lights?.candle?.intensity !== undefined && initial.lights?.candle?.intensity !== undefined && Math.abs(current.lights.candle.intensity - initial.lights.candle.intensity) > 0.02) {
    candleDiff.intensity = Number(current.lights.candle.intensity.toFixed(2));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.lights?.candle?.[axis] !== undefined && initial.lights?.candle?.[axis] !== undefined && Math.abs(current.lights.candle[axis] - initial.lights.candle[axis]) > 0.005) {
      candleDiff[axis] = Number(current.lights.candle[axis].toFixed(3));
    }
  }
  if (Object.keys(candleDiff).length > 0) lightsDiff.candle = candleDiff;
  if (Object.keys(lightsDiff).length > 0) diff.lights = lightsDiff;

  // 4. Objects
  const objectsDiff = {};
  if (initial.objects) {
    for (const [key, initObj] of Object.entries(initial.objects)) {
      const curObj = current.objects?.[key];
      if (!curObj || !initObj) continue;
      const objChanges = {};
      for (const prop of ['posX', 'posY', 'posZ']) {
        if (curObj[prop] !== undefined && initObj[prop] !== undefined && Math.abs(curObj[prop] - initObj[prop]) > 0.005) {
          objChanges[prop] = Number(curObj[prop].toFixed(3));
        }
      }
      if (curObj.rotY !== undefined && initObj.rotY !== undefined && Math.abs(curObj.rotY - initObj.rotY) > 0.5) {
        objChanges.rotY = Math.round(curObj.rotY);
      }
      if (curObj.scale !== undefined && initObj.scale !== undefined && Math.abs(curObj.scale - initObj.scale) > 0.01) {
        objChanges.scale = Number(curObj.scale.toFixed(3));
      }
      for (const axis of ['scaleX', 'scaleY', 'scaleZ']) {
        if (curObj[axis] !== undefined && initObj[axis] !== undefined && Math.abs(curObj[axis] - initObj[axis]) > 0.01) {
          objChanges[axis] = Number(curObj[axis].toFixed(3));
        }
      }
      if (Object.keys(objChanges).length > 0) {
        objectsDiff[key] = { name: initObj.name, ...objChanges };
      }
    }
  }
  if (Object.keys(objectsDiff).length > 0) diff.objects = objectsDiff;

  // 5. Avatar Pose
  if (current.avatarPose && initial.avatarPose) {
    const poseDiff = {};
    const poseSections = ['head', 'torso', 'hips', 'leftLeg', 'rightLeg', 'leftArm', 'rightArm'];
    for (const sec of poseSections) {
      const curPart = current.avatarPose?.[sec];
      const initPart = initial.avatarPose?.[sec];
      if (!curPart || !initPart) continue;
      const partChanges = {};
      for (const prop in initPart) {
        if (curPart[prop] !== undefined && initPart[prop] !== undefined && Math.abs(curPart[prop] - initPart[prop]) > 0.005) {
          partChanges[prop] = Number(curPart[prop].toFixed(2));
        }
      }
      if (Object.keys(partChanges).length > 0) {
        poseDiff[sec] = partChanges;
      }
    }
    if (Object.keys(poseDiff).length > 0) diff.avatarPose = poseDiff;
  }

  return diff;
}

export function countModifiedFields(diff) {
  let count = 0;
  if (diff.shaders) count += Object.keys(diff.shaders).length;
  if (diff.camera) count += Object.keys(diff.camera).length;
  if (diff.lights) {
    for (const l in diff.lights) count += Object.keys(diff.lights[l]).length;
  }
  if (diff.objects) {
    for (const o in diff.objects) {
      count += Object.keys(diff.objects[o]).filter((k) => k !== 'name').length;
    }
  }
  if (diff.avatarPose) {
    for (const side in diff.avatarPose) {
      count += Object.keys(diff.avatarPose[side]).length;
    }
  }
  return count;
}

export function loadSavedProfiles() {
  try {
    const raw = localStorage.getItem('yuki_date_custom_profiles');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.warn('[DateMode] Failed to load custom profiles:', e);
  }
  return {};
}

export function loadMapDefaultProfiles() {
  try {
    const raw = localStorage.getItem('yuki_date_map_default_profiles');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.warn('[DateMode] Failed to load map default profiles:', e);
  }
  return {};
}

export function saveMapDefaultProfiles(mapProfiles) {
  try {
    localStorage.setItem('yuki_date_map_default_profiles', JSON.stringify(mapProfiles));
  } catch (e) {
    console.warn('[DateMode] Failed to save map default profiles:', e);
  }
}

/**
 * Resolves the initial full DateConfig for a destination, prioritizing bound map profiles
 * or merging scenario-defined shaders, lighting, and layout defaults cleanly over DEFAULT_DATE_CONFIG.
 */
export function getMapInitialConfig(destId, allScenarios = DEFAULT_SCENARIOS, savedProfiles = {}, mapDefaultProfiles = {}) {
  const sc = allScenarios?.[destId] || DEFAULT_SCENARIOS[destId] || DEFAULT_SCENARIOS.marine_drive_night;
  const boundProfId = mapDefaultProfiles?.[destId];
  if (boundProfId && boundProfId !== 'default' && savedProfiles?.[boundProfId]?.config) {
    return mergeConfig(DEFAULT_DATE_CONFIG, savedProfiles[boundProfId].config);
  }

  const base = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG));
  if (sc) {
    if (sc.toneMapping) base.shaders.toneMapping = sc.toneMapping;
    if (sc.exposure !== undefined) base.shaders.exposure = sc.exposure;
    if (sc.envIntensity !== undefined) base.shaders.envIntensity = sc.envIntensity;
    if (sc.ambientColor !== undefined) base.lights.ambient.color = normalizeColorHex(sc.ambientColor, '#fff5ea');
    if (sc.ambientIntensity !== undefined) base.lights.ambient.intensity = sc.ambientIntensity;
    if (sc.spotColor !== undefined) base.lights.keySpot.color = normalizeColorHex(sc.spotColor, '#ffeedd');
    if (sc.spotIntensity !== undefined) base.lights.keySpot.intensity = sc.spotIntensity;
    if (sc.candleColor !== undefined) base.lights.candle.color = normalizeColorHex(sc.candleColor, '#ff9933');
    if (sc.candleIntensity !== undefined) base.lights.candle.intensity = sc.candleIntensity;
    if (sc.mapLightsIntensity !== undefined) {
      if (!base.lights.mapLights) base.lights.mapLights = { intensity: 0.05 };
      base.lights.mapLights.intensity = sc.mapLightsIntensity;
    }
    const mapPos = sc.defaultPositions || MAP_POSITION_PRESETS[destId]?.positions || MAP_POSITION_PRESETS.standard_dining.positions;
    if (mapPos?.camera) Object.assign(base.camera, mapPos.camera);
    if (mapPos?.objects) {
      for (const k in mapPos.objects) {
        base.objects[k] = { ...(base.objects[k] || {}), ...mapPos.objects[k] };
      }
    }
  }
  return base;
}

export function createProceduralWaterNormalsTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  // Multi-octave sinusoidal rippling water normal generator
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;

      // Slopes dh/du and dh/dv for ripples
      const dhdu =
        Math.cos(u * 6.0 + v * 3.0) * 0.4 +
        Math.cos(u * 12.0 - v * 8.0) * 0.25 +
        Math.cos(u * 24.0 + v * 16.0) * 0.12 +
        Math.cos(u * 4.0 - v * 10.0) * 0.3;

      const dhdv =
        Math.sin(u * 3.0 + v * 6.0) * 0.4 +
        Math.sin(u * 8.0 - v * 12.0) * 0.25 +
        Math.sin(u * 16.0 + v * 24.0) * 0.12 +
        Math.sin(-u * 10.0 + v * 4.0) * 0.3;

      let nx = -dhdu * 1.5;
      let ny = -dhdv * 1.5;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function mergeConfig(base, custom) {
  if (!custom) return JSON.parse(JSON.stringify(base));
  const result = JSON.parse(JSON.stringify(base));
  if (custom.shaders) Object.assign(result.shaders, custom.shaders);
  if (custom.camera) Object.assign(result.camera, custom.camera);
  if (custom.lights) {
    for (const l in custom.lights) {
      result.lights[l] = { ...(result.lights[l] || {}), ...custom.lights[l] };
    }
  }
  if (custom.objects) {
    for (const o in custom.objects) {
      result.objects[o] = { ...(result.objects[o] || {}), ...custom.objects[o] };
    }
  }
  if (custom.avatarPose) {
    result.avatarPose = result.avatarPose || {};
    for (const sec in custom.avatarPose) {
      result.avatarPose[sec] = { ...(result.avatarPose[sec] || {}), ...custom.avatarPose[sec] };
    }
  }
  return result;
}

export function findSelectableAncestor(mesh, sceneObjects) {
  let curr = mesh;
  while (curr) {
    for (const [key, obj] of Object.entries(sceneObjects)) {
      if (curr === obj) return key;
    }
    curr = curr.parent;
  }
  return null;
}

export default function DateModeApp() {
  const canvasRef = useRef(null);

  // GPU & Initialization state
  const [gpuCheck, setGpuCheck] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);

  // Scenarios & Destination Atmosphere
  const [customScenarios, setCustomScenarios] = useState(() => loadCustomScenarios());
  const allScenarios = useMemo(() => ({ ...DEFAULT_SCENARIOS, ...customScenarios }), [customScenarios]);
  const [activeDest, setActiveDest] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki_date_active_dest');
      if (saved && (DEFAULT_SCENARIOS[saved] || loadCustomScenarios()[saved])) return saved;
    } catch (_) {}
    return 'marine_drive_night';
  });
  const activeDestRef = useRef(activeDest);
  useEffect(() => {
    activeDestRef.current = activeDest;
    try {
      localStorage.setItem('yuki_date_active_dest', activeDest);
    } catch (_) {}
  }, [activeDest]);
  const isPromenade = activeDest === 'marine_drive_night';
  const [candleLit, setCandleLit] = useState(true);
  const [bgmMuted, setBgmMuted] = useState(false);

  // Scenario Manager Modal State
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [scenarioModalTab, setScenarioModalTab] = useState('list'); // 'list' | 'editor'
  const [editingScenario, setEditingScenario] = useState(null);
  const [scenarioUploadProgress, setScenarioUploadProgress] = useState(false);
  const [scenarioForm, setScenarioForm] = useState({
    id: '',
    type: '3d_model',
    title: '',
    subtitle: '',
    assetUrl: '',
    customPrompt: '',
    welcomeDialogue: '',
    showDefaultTable: true,
    ambientColor: 0xffeedd,
    ambientIntensity: 1.2,
    spotColor: 0xffe8c0,
    spotIntensity: 2.0,
    candleColor: 0xffaa44,
    modelTransform: { posX: 0, posY: -0.2, posZ: 0, rotY: 0, scale: 1.0 },
    defaultPositions: null
  });
  const [mapPositionsToast, setMapPositionsToast] = useState('');

  // Immersive Hide UI State & Mouse Inactivity Auto-Hide
  const [isUiHidden, setIsUiHidden] = useState(false);
  const [isUserInactive, setIsUserInactive] = useState(false);

  // Ambient Venue BGM State (Web Audio API Synthesized Soundscapes)
  const [isBgmEnabled, setIsBgmEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki_date_bgm_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (_) { return true; }
  });
  const [bgmVolume, setBgmVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki_date_bgm_volume');
      return saved !== null ? Number(saved) : 0.22;
    } catch (_) { return 0.22; }
  });

  // Character & Interaction
  const [dialogueText, setDialogueText] = useState(DEFAULT_SCENARIOS.cute_cafe.welcomeDialogue);
  const [characterMood, setCharacterMood] = useState('happy');
  const [inputText, setInputText] = useState('');
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;

  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;

  const [voiceState, setVoiceState] = useState({
    isVoiceCommandMode: false,
    isTalkMode: false,
    isSessionActive: false,
    isListening: false,
    muteVoice: false
  });
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;

  const [muteVoice, setMuteVoice] = useState(() => {
    try {
      return localStorage.getItem('yuki-mute-voice') === 'true';
    } catch (_) {
      return false;
    }
  });
  const muteVoiceRef = useRef(muteVoice);
  muteVoiceRef.current = muteVoice;

  const [isThinking, setIsThinking] = useState(false);
  const isThinkingRef = useRef(isThinking);
  isThinkingRef.current = isThinking;

  const proactiveDateTimerRef = useRef(null);
  const scheduleProactiveDateCheckRef = useRef(null);

  const [polaroidFlash, setPolaroidFlash] = useState(false);
  const turnFinishedRef = useRef(false);
  const customStageMeshRef = useRef(null);
  const loadedStageUrlRef = useRef(null);
  const waterMeshRef = useRef(null);
  const scenarioFileInputRef = useRef(null);

  // Facial Expressions, Gestures & Live Model Swapping Refs
  const currentExprRef = useRef('happy');
  const lastDialogueTimeRef = useRef(Date.now());
  const activeGestureRef = useRef(null);
  const loadVrmModelRef = useRef(null);
  const activeModelNameRef = useRef(null);
  const vrmLoadSeqRef = useRef(0);
  const loadingModelUrlRef = useRef(null);

  // Three.js internal references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const vrmRef = useRef(null);
  const candleLightRef = useRef(null);
  const ambientLightRef = useRef(null);
  const spotLightRef = useRef(null);
  const bgMeshRef = useRef(null);
  const pmremGeneratorRef = useRef(null);
  const currentEnvTextureRef = useRef(null);
  const stageLightsRef = useRef([]);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const animFrameIdRef = useRef(null);
  const isToastingRef = useRef(false);
  const ledScreenAnimRef = useRef(null);
  const rgbMaterialsRef = useRef([]);
  const waterMatRef = useRef(null);

  // VRMA Locomotion, Autonomous Follow AI & Stamina System
  const vrmAnimationMixerRef = useRef(null);
  const vrmLocomotionActionsRef = useRef({});
  const locomotionStateRef = useRef('idle'); // 'idle' | 'slow_walk' | 'fast_walk' | 'run'
  const yukiStaminaRef = useRef(100.0);
  const isExhaustedRef = useRef(false);
  const [yukiStaminaUI, setYukiStaminaUI] = useState(100);
  const [isExhaustedUI, setIsExhaustedUI] = useState(false);
  const yukiIsFollowingRef = useRef(false);
  const playerJumpVelRef = useRef(0.0);
  const yukiJumpVelRef = useRef(0.0);
  const playerIsGroundedRef = useRef(true);
  const yukiIsGroundedRef = useRef(true);
  const yukiJumpCooldownRef = useRef(0.0);
  const lastStaminaUiUpdateRef = useRef(0);
  const lastDialogueFatigueTimeRef = useRef(0);

  // First-Person 360° Mouse Look & Head Rotation State
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const camYawRef = useRef(0);
  const camPitchRef = useRef(0);
  const targetYawRef = useRef(0);
  const targetPitchRef = useRef(0);

  // Settings & Dev Mode UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [devInspectorCollapsed, setDevInspectorCollapsed] = useState(false);
  const [devTab, setDevTab] = useState('objects'); // 'objects' | 'pose' | 'lights' | 'shaders' | 'diff'
  const [selectedObjectId, setSelectedObjectId] = useState('yuki');
  const [savedProfiles, setSavedProfiles] = useState(() => loadSavedProfiles());
  const [mapDefaultProfiles, setMapDefaultProfiles] = useState(() => loadMapDefaultProfiles());
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState(() => {
    try {
      const savedDest = localStorage.getItem('yuki_date_active_dest') || 'marine_drive_night';
      const mapDefaults = loadMapDefaultProfiles();
      const boundId = mapDefaults[savedDest];
      if (boundId) return boundId;
      return localStorage.getItem('yuki_date_active_profile_id') || 'default';
    } catch (_) {
      return 'default';
    }
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileSaveSuccess, setProfileSaveSuccess] = useState(false);

  const [devConfig, setDevConfig] = useState(() => {
    try {
      const savedDest = localStorage.getItem('yuki_date_active_dest') || 'marine_drive_night';
      const profiles = loadSavedProfiles();
      const mapDefaults = loadMapDefaultProfiles();
      const customScenarios = loadCustomScenarios();
      const allScenarios = { ...DEFAULT_SCENARIOS, ...customScenarios };
      return getMapInitialConfig(savedDest, allScenarios, profiles, mapDefaults);
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG));
    }
  });
  const devConfigRef = useRef(devConfig);
  useEffect(() => {
    devConfigRef.current = devConfig;
  }, [devConfig]);
  const [poseSelectedCategory, setPoseSelectedCategory] = useState('head'); // 'head' | 'torso' | 'hips' | 'legs' | 'arms' | 'placement'
  const [poseSelectedArm, setPoseSelectedArm] = useState('leftArm'); // 'leftArm' | 'rightArm'
  const [poseSelectedLeg, setPoseSelectedLeg] = useState('leftLeg'); // 'leftLeg' | 'rightLeg'
  const [customPosePresets, setCustomPosePresets] = useState(() => loadSavedPosePresets());
  const [isSavingCustomPose, setIsSavingCustomPose] = useState(false);
  const [customPoseNameInput, setCustomPoseNameInput] = useState('');
  const [customPoseSaveSuccess, setCustomPoseSaveSuccess] = useState(false);
  const [dateSettingsPoseExpanded, setDateSettingsPoseExpanded] = useState(true);
  const [copiedDiff, setCopiedDiff] = useState(false);
  const [independentAxisScale, setIndependentAxisScale] = useState(false);

  // Custom Background & Vertical Framing State
  const [customBgUrl, setCustomBgUrl] = useState(() => {
    try { return localStorage.getItem('yuki_date_custom_bg') || null; } catch (_) { return null; }
  });
  const [customBgName, setCustomBgName] = useState(() => {
    try { return localStorage.getItem('yuki_date_custom_bg_name') || ''; } catch (_) { return ''; }
  });
  const [bgVerticalScale, setBgVerticalScale] = useState(1.0);
  const [bgVerticalOffset, setBgVerticalOffset] = useState(0.0);
  const fileInputRef = useRef(null);

  // Ground Floor Texture & Style State
  const [floorStyle, setFloorStyle] = useState(() => {
    try { return localStorage.getItem('yuki_date_floor_style') || 'wood'; } catch (_) { return 'wood'; }
  });
  const [customFloorUrl, setCustomFloorUrl] = useState(() => {
    try { return localStorage.getItem('yuki_date_custom_floor') || null; } catch (_) { return null; }
  });
  const [customFloorName, setCustomFloorName] = useState(() => {
    try { return localStorage.getItem('yuki_date_custom_floor_name') || ''; } catch (_) { return ''; }
  });
  const floorInputRef = useRef(null);
  const floorMeshRef = useRef(null);

  // References for Raycasting, Object mapping & BoxHelper
  const sceneObjectsRef = useRef({});
  const boxHelperRef = useRef(null);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const devModeRef = useRef(false);

  useEffect(() => {
    devModeRef.current = devMode;
  }, [devMode]);

  // Update Selection Box Helper in Dev Mode
  useEffect(() => {
    if (!devMode) {
      if (boxHelperRef.current) {
        sceneRef.current?.remove(boxHelperRef.current);
        boxHelperRef.current.dispose?.();
        boxHelperRef.current = null;
      }
      return;
    }

    if (boxHelperRef.current) {
      sceneRef.current?.remove(boxHelperRef.current);
      boxHelperRef.current.dispose?.();
      boxHelperRef.current = null;
    }

    if (selectedObjectId && selectedObjectId !== 'playerPov' && sceneObjectsRef.current[selectedObjectId] && sceneRef.current) {
      const targetObj = sceneObjectsRef.current[selectedObjectId];
      const helper = new THREE.BoxHelper(targetObj, 0xc084fc);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.85;
      sceneRef.current.add(helper);
      boxHelperRef.current = helper;
    }
  }, [selectedObjectId, devMode]);

  // Strict Kokoro Lip-Sync References (Matching main app useAudioPlayback / AvatarViewer)
  const audioLevelRef = useRef(0);
  const visemeLevelsRef = useRef({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, intensity: 0 });
  const currentVisemesRef = useRef(null);
  const socketRef = useRef(null);
  const dateModeChannelRef = useRef(null);

  const postDateModeMessage = useCallback((msg) => {
    try {
      if (!dateModeChannelRef.current) {
        dateModeChannelRef.current = new BroadcastChannel('yuki_date_mode_channel');
      }
      dateModeChannelRef.current.postMessage(msg);
    } catch (e) {
      console.warn('[DateMode] BroadcastChannel postMessage error:', e);
    }
    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(msg));
      }
    } catch (_) {}
  }, []);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioSourceRef = useRef(null);
  const persistentAudioRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isAudioPlayingRef = useRef(false);
  const playNextAudioRef = useRef(null);
  const accumulatedDialogueRef = useRef('');
  const characterMoodRef = useRef(characterMood);

  // Sync character mood to internal ref (Render loop smoothly animates and ducks facial morphs)
  useEffect(() => {
    characterMoodRef.current = characterMood;
  }, [characterMood]);

  // Broadcast Date Mode active state across windows and backend to suppress duplicate main-app audio and desktop boredom/nudges
  useEffect(() => {
    const syncBackend = (active) => {
      try {
        fetch(`${API_BASE}/api/date-mode/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active })
        }).catch(() => {});
      } catch (_) {}
    };

    try {
      localStorage.setItem('yuki_date_mode_active', 'true');
      postDateModeMessage({ active: true });
      syncBackend(true);
    } catch (_) {}

    const handleBeforeUnload = () => {
      try {
        if (proactiveDateTimerRef.current) {
          clearTimeout(proactiveDateTimerRef.current);
          proactiveDateTimerRef.current = null;
        }
        localStorage.setItem('yuki_date_mode_active', 'false');
        postDateModeMessage({ active: false });
        syncBackend(false);
      } catch (_) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, []);

  // Seated Gesture Trigger helper
  const triggerSeatedGesture = useCallback((animKey) => {
    if (!animKey) return;
    const key = String(animKey).toLowerCase().trim();
    const gestureType = SEATED_GESTURE_MAP[key] || 'seated_nod';
    const durations = {
      seated_nod: 1.8,
      seated_shake: 1.9,
      seated_shy: 2.6,
      seated_laugh: 2.4,
      seated_sleepy: 3.2,
      seated_smug: 2.0,
      seated_lean_in: 3.0,
      seated_cheers: 2.5
    };
    activeGestureRef.current = {
      type: gestureType,
      startTime: Date.now(),
      duration: durations[gestureType] || 2.0
    };
    if (gestureType === 'seated_cheers') {
      isToastingRef.current = true;
      playWineClinkSound();
    }
  }, []);

  // Ambient BGM Toggle & Volume Handlers
  const handleToggleBgm = useCallback(() => {
    setIsBgmEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem('yuki_date_bgm_enabled', JSON.stringify(next)); } catch (_) {}
      if (next) {
        dateAmbienceEngine.setVolume(bgmVolume);
        dateAmbienceEngine.start(activeDest);
      } else {
        dateAmbienceEngine.stop(true);
      }
      return next;
    });
  }, [activeDest, bgmVolume]);

  const handleBgmVolumeChange = useCallback((newVol) => {
    const val = Math.max(0, Math.min(1, Number(newVol) || 0));
    setBgmVolume(val);
    try { localStorage.setItem('yuki_date_bgm_volume', String(val)); } catch (_) {}
    dateAmbienceEngine.setVolume(val);
  }, []);

  // Mouse Inactivity Auto-Hide: Fades secondary UI chrome after 4s of stillness
  useEffect(() => {
    let timer = null;
    const resetTimer = () => {
      setIsUserInactive(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsUserInactive(true);
      }, 4000);
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('mousedown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    timer = setTimeout(() => setIsUserInactive(true), 4000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, []);

  // Ambient BGM Lifecycle & Venue Synchronization
  useEffect(() => {
    if (isBgmEnabled) {
      dateAmbienceEngine.setVolume(bgmVolume);
      const timer = setTimeout(() => {
        dateAmbienceEngine.start(activeDest);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      dateAmbienceEngine.stop(true);
    }
  }, [activeDest, isBgmEnabled]);

  // Clean stop BGM on unmount
  useEffect(() => {
    return () => {
      dateAmbienceEngine.stop(true);
    };
  }, []);

  // Live VRM Model Swapping BroadcastChannel Listener
  useEffect(() => {
    let modelChannel = null;
    try {
      modelChannel = new BroadcastChannel('yuki_model_channel');
      modelChannel.onmessage = (evt) => {
        if (evt.data?.type === 'model_changed' && evt.data.model) {
          const newModel = evt.data.model;
          if (newModel !== activeModelNameRef.current || (!vrmRef.current && !loadingModelUrlRef.current)) {
            const modelUrl = `${API_BASE}/api/models/vrm/files/${encodeURIComponent(newModel)}?t=${Date.now()}`;
            loadVrmModelRef.current?.(modelUrl, newModel);
          }
        }
      };
    } catch (_) {}
    return () => {
      try { modelChannel?.close(); } catch (_) {}
    };
  }, []);

  // --------------------------------------------------------------------------
  // DYNAMIC WINDOW TITLE (Reflects Date Mode & Active Map)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const sc = allScenarios[activeDest] || DEFAULT_SCENARIOS[activeDest] || DEFAULT_SCENARIOS.cute_cafe;
    const title = sc?.title ? `Yuki AI - Date Mode: ${sc.title}` : 'Yuki AI - Date Mode';
    document.title = title;
    try {
      window.electronAPI?.setDateWindowTitle?.(title);
    } catch (_) {}
  }, [activeDest, allScenarios]);

  // --------------------------------------------------------------------------
  // MAP-SPECIFIC DEFAULT POSITIONS ENGINE
  // --------------------------------------------------------------------------
  const applyMapPositions = useCallback((positions) => {
    if (!positions) return;

    setDevConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (positions.camera) {
        next.camera = { ...next.camera, ...positions.camera };
      }
      if (positions.objects) {
        for (const [key, objDef] of Object.entries(positions.objects)) {
          if (next.objects[key]) {
            next.objects[key] = { ...next.objects[key], ...objDef };
          }
        }
      }
      const resolvedRotY = positions.objects?.playerPov?.rotY ?? positions.camera?.rotY;
      const resolvedRotX = positions.objects?.playerPov?.rotX ?? positions.camera?.rotX;
      if (resolvedRotY !== undefined) {
        if (next.camera) next.camera.rotY = resolvedRotY;
        if (next.objects?.playerPov) next.objects.playerPov.rotY = resolvedRotY;
      }
      if (resolvedRotX !== undefined) {
        if (next.camera) next.camera.rotX = resolvedRotX;
        if (next.objects?.playerPov) next.objects.playerPov.rotX = resolvedRotX;
      }
      return next;
    });

    if (positions.camera && cameraRef.current) {
      if (positions.camera.posX !== undefined) cameraRef.current.position.x = positions.camera.posX;
      if (positions.camera.posY !== undefined) cameraRef.current.position.y = positions.camera.posY;
      if (positions.camera.posZ !== undefined) cameraRef.current.position.z = positions.camera.posZ;
      let needsUpdate = false;
      if (positions.camera.fov !== undefined && cameraRef.current.fov !== positions.camera.fov) {
        cameraRef.current.fov = positions.camera.fov;
        needsUpdate = true;
      }
      const targetFar = positions.camera.far ?? 2000;
      if (cameraRef.current.far !== targetFar) {
        cameraRef.current.far = targetFar;
        needsUpdate = true;
      }
      if (needsUpdate) {
        cameraRef.current.updateProjectionMatrix();
      }
    }

    const targetRotY = positions.objects?.playerPov?.rotY ?? positions.camera?.rotY;
    if (targetRotY !== undefined) {
      const rad = (targetRotY * Math.PI) / 180;
      targetYawRef.current = rad;
      camYawRef.current = rad;
    }
    const targetRotX = positions.objects?.playerPov?.rotX ?? positions.camera?.rotX;
    if (targetRotX !== undefined) {
      const rad = (targetRotX * Math.PI) / 180;
      targetPitchRef.current = rad;
      camPitchRef.current = rad;
    }

    if (positions.objects) {
      for (const [key, objDef] of Object.entries(positions.objects)) {
        if (key === 'playerPov') continue;
        const obj = sceneObjectsRef.current[key];
        if (obj) {
          if (objDef.posX !== undefined && objDef.posY !== undefined && objDef.posZ !== undefined) {
            obj.position.set(objDef.posX, objDef.posY, objDef.posZ);
          }
          if (objDef.rotY !== undefined) {
            if (key === 'yuki' && vrmRef.current?.isVRM1) {
              obj.rotation.y = ((objDef.rotY - 180) * Math.PI) / 180;
            } else {
              obj.rotation.y = (objDef.rotY || 0) * (Math.PI / 180);
            }
          }
          if (objDef.scale !== undefined || objDef.scaleX !== undefined) {
            const sx = objDef.scaleX ?? objDef.scale ?? 1;
            const sy = objDef.scaleY ?? objDef.scale ?? 1;
            const sz = objDef.scaleZ ?? objDef.scale ?? 1;
            obj.scale.set(sx, sy, sz);
          }
          obj.updateMatrix?.();
        }
      }
    }
  }, []);

  // Unified 3D scene updater across renderer, camera, lights, meshes, and poses
  const applyConfigToScene = useCallback((cfg) => {
    if (!cfg) return;
    setDevConfig(cfg);
    devConfigRef.current = cfg;

    if (rendererRef.current && cfg.shaders) {
      if (cfg.shaders.toneMapping) {
        rendererRef.current.toneMapping = TONE_MAPPINGS[cfg.shaders.toneMapping] || THREE.AgXToneMapping;
      }
      if (cfg.shaders.exposure !== undefined) {
        rendererRef.current.toneMappingExposure = cfg.shaders.exposure;
      }
    }

    if (cameraRef.current && cfg.camera) {
      let needsUpdate = false;
      if (cfg.camera.fov !== undefined && cameraRef.current.fov !== cfg.camera.fov) {
        cameraRef.current.fov = cfg.camera.fov;
        needsUpdate = true;
      }
      if (cfg.camera.posX !== undefined && cfg.camera.posY !== undefined && cfg.camera.posZ !== undefined) {
        cameraRef.current.position.set(cfg.camera.posX, cfg.camera.posY, cfg.camera.posZ);
      }
      const targetFar = cfg.camera.far ?? 2000;
      if (cameraRef.current.far !== targetFar) {
        cameraRef.current.far = targetFar;
        needsUpdate = true;
      }
      if (needsUpdate) {
        cameraRef.current.updateProjectionMatrix?.();
      }
    }

    const resolvedRotY = cfg.objects?.playerPov?.rotY ?? cfg.camera?.rotY;
    if (resolvedRotY !== undefined) {
      const rad = (resolvedRotY * Math.PI) / 180;
      targetYawRef.current = rad;
      camYawRef.current = rad;
    }
    const resolvedRotX = cfg.objects?.playerPov?.rotX ?? cfg.camera?.rotX;
    if (resolvedRotX !== undefined) {
      const rad = (resolvedRotX * Math.PI) / 180;
      targetPitchRef.current = rad;
      camPitchRef.current = rad;
    }

    if (cfg.lights) {
      if (ambientLightRef.current && cfg.lights.ambient) {
        if (cfg.lights.ambient.color !== undefined) ambientLightRef.current.color.set(cfg.lights.ambient.color);
        if (cfg.lights.ambient.intensity !== undefined) ambientLightRef.current.intensity = cfg.lights.ambient.intensity;
      }
      if (spotLightRef.current && cfg.lights.keySpot) {
        if (cfg.lights.keySpot.color !== undefined) spotLightRef.current.color.set(cfg.lights.keySpot.color);
        if (cfg.lights.keySpot.intensity !== undefined) spotLightRef.current.intensity = cfg.lights.keySpot.intensity;
        if (cfg.lights.keySpot.posX !== undefined) {
          spotLightRef.current.position.set(cfg.lights.keySpot.posX, cfg.lights.keySpot.posY, cfg.lights.keySpot.posZ);
        }
      }
      if (candleLightRef.current && cfg.lights.candle) {
        if (cfg.lights.candle.color !== undefined) candleLightRef.current.color.set(cfg.lights.candle.color);
        if (cfg.lights.candle.intensity !== undefined) candleLightRef.current.intensity = cfg.lights.candle.intensity;
        if (cfg.lights.candle.posX !== undefined) {
          candleLightRef.current.position.set(cfg.lights.candle.posX, cfg.lights.candle.posY, cfg.lights.candle.posZ);
        }
      }
      if (cfg.lights.mapLights && stageLightsRef.current?.length > 0) {
        const mlInt = cfg.lights.mapLights.intensity ?? 0.05;
        stageLightsRef.current.forEach((l) => {
          if (l.isLight) l.intensity = mlInt;
        });
      }
    }

    if (cfg.objects) {
      for (const [key, objDef] of Object.entries(cfg.objects)) {
        if (key === 'playerPov') continue;
        const obj = sceneObjectsRef.current[key];
        if (obj) {
          if (objDef.posX !== undefined && objDef.posY !== undefined && objDef.posZ !== undefined) {
            obj.position.set(objDef.posX, objDef.posY, objDef.posZ);
          }
          if (objDef.rotY !== undefined) {
            if (key === 'yuki' && vrmRef.current?.isVRM1) {
              obj.rotation.y = ((objDef.rotY - 180) * Math.PI) / 180;
            } else {
              obj.rotation.y = (objDef.rotY || 0) * (Math.PI / 180);
            }
          }
          const sx = objDef.scaleX ?? objDef.scale ?? 1.0;
          const sy = objDef.scaleY ?? objDef.scale ?? 1.0;
          const sz = objDef.scaleZ ?? objDef.scale ?? 1.0;
          obj.scale.set(sx, sy, sz);
          obj.updateMatrix?.();
        }
      }
    }

    if (boxHelperRef.current) {
      boxHelperRef.current.update();
    }
  }, []);

  const handleSelectProfile = useCallback((profileId) => {
    setActiveProfileId(profileId);
    try {
      localStorage.setItem('yuki_date_active_profile_id', profileId);
    } catch (_) {}

    let targetCfg;
    if (profileId === 'default' || !savedProfiles[profileId]?.config) {
      targetCfg = getMapInitialConfig(activeDest, allScenarios, savedProfiles, { [activeDest]: 'default' });
    } else {
      targetCfg = mergeConfig(DEFAULT_DATE_CONFIG, savedProfiles[profileId].config);
    }
    applyConfigToScene(targetCfg);
  }, [activeDest, allScenarios, savedProfiles, applyConfigToScene]);

  const handleSaveCurrentAsMapDefault = useCallback(() => {
    const currentScenario = allScenarios[activeDest] || DEFAULT_SCENARIOS[activeDest] || DEFAULT_SCENARIOS.cute_cafe;
    if (!currentScenario) return;

    if (activeProfileId !== 'default' && savedProfiles[activeProfileId]) {
      const updatedProfile = {
        ...savedProfiles[activeProfileId],
        updatedAt: new Date().toISOString(),
        config: JSON.parse(JSON.stringify(devConfigRef.current))
      };
      const updatedProfiles = {
        ...savedProfiles,
        [activeProfileId]: updatedProfile
      };
      setSavedProfiles(updatedProfiles);
      try {
        localStorage.setItem('yuki_date_custom_profiles', JSON.stringify(updatedProfiles));
      } catch (_) {}

      const updatedMapProfiles = {
        ...mapDefaultProfiles,
        [activeDest]: activeProfileId
      };
      setMapDefaultProfiles(updatedMapProfiles);
      saveMapDefaultProfiles(updatedMapProfiles);

      setMapPositionsToast(`Saved "${savedProfiles[activeProfileId].name}" as default preset for "${currentScenario.title}"!`);
    } else {
      const currentRotY = Math.round(((targetYawRef.current || 0) * 180) / Math.PI);
      const currentRotX = Math.round(((targetPitchRef.current || 0) * 180) / Math.PI);

      const currentPositions = {
        camera: {
          fov: devConfigRef.current.camera?.fov ?? 42,
          posX: devConfigRef.current.camera?.posX ?? 0,
          posY: devConfigRef.current.camera?.posY ?? 2.3,
          posZ: devConfigRef.current.camera?.posZ ?? 0.45,
          rotY: currentRotY,
          rotX: currentRotX,
          far: devConfigRef.current.camera?.far ?? 2000
        },
        objects: {}
      };

      ['playerPov', 'yuki', 'table', 'chair', 'candleGLB', 'vaseGLB', 'cake', 'herGlass', 'yourGlass', 'floor'].forEach((k) => {
        if (devConfigRef.current.objects?.[k]) {
          currentPositions.objects[k] = { ...devConfigRef.current.objects[k] };
          if (k === 'playerPov') {
            currentPositions.objects[k].rotY = currentRotY;
            currentPositions.objects[k].rotX = currentRotX;
          }
        }
      });

      const updatedScenario = {
        ...currentScenario,
        defaultPositions: currentPositions,
        toneMapping: devConfigRef.current.shaders?.toneMapping || currentScenario.toneMapping || 'AgX',
        exposure: devConfigRef.current.shaders?.exposure ?? currentScenario.exposure ?? 0.9,
        ambientColor: normalizeColorHex(devConfigRef.current.lights?.ambient?.color, currentScenario.ambientColor),
        ambientIntensity: devConfigRef.current.lights?.ambient?.intensity ?? currentScenario.ambientIntensity,
        spotColor: normalizeColorHex(devConfigRef.current.lights?.keySpot?.color, currentScenario.spotColor),
        spotIntensity: devConfigRef.current.lights?.keySpot?.intensity ?? currentScenario.spotIntensity,
        candleColor: normalizeColorHex(devConfigRef.current.lights?.candle?.color, currentScenario.candleColor),
        candleIntensity: devConfigRef.current.lights?.candle?.intensity ?? currentScenario.candleIntensity,
        mapLightsIntensity: devConfigRef.current.lights?.mapLights?.intensity ?? currentScenario.mapLightsIntensity
      };

      setCustomScenarios((prev) => {
        const updated = { ...prev, [activeDest]: updatedScenario };
        saveCustomScenarios(updated);
        return updated;
      });

      const updatedMapProfiles = {
        ...mapDefaultProfiles,
        [activeDest]: 'default'
      };
      setMapDefaultProfiles(updatedMapProfiles);
      saveMapDefaultProfiles(updatedMapProfiles);

      setMapPositionsToast(`Saved current layout, lighting & shaders as default for "${currentScenario.title}"!`);
    }

    setTimeout(() => setMapPositionsToast(''), 3500);
  }, [activeDest, allScenarios, activeProfileId, savedProfiles, mapDefaultProfiles]);

  const handleResetToMapDefaults = useCallback(() => {
    const sc = allScenarios[activeDest] || DEFAULT_SCENARIOS[activeDest] || DEFAULT_SCENARIOS.cute_cafe;
    const boundProfId = mapDefaultProfiles[activeDest];
    if (boundProfId && boundProfId !== 'default' && savedProfiles[boundProfId]?.config) {
      handleSelectProfile(boundProfId);
      setMapPositionsToast(`Restored default profile "${savedProfiles[boundProfId].name}" for "${sc.title}"!`);
      setTimeout(() => setMapPositionsToast(''), 3000);
      return;
    }

    const targetCfg = getMapInitialConfig(activeDest, allScenarios, savedProfiles, { [activeDest]: 'default' });
    setActiveProfileId('default');
    try { localStorage.setItem('yuki_date_active_profile_id', 'default'); } catch (_) {}
    applyConfigToScene(targetCfg);

    setMapPositionsToast(`Restored default layout and lighting for "${sc.title}"!`);
    setTimeout(() => setMapPositionsToast(''), 3000);
  }, [activeDest, allScenarios, mapDefaultProfiles, savedProfiles, applyConfigToScene, handleSelectProfile]);

  // 1. DEDICATED GPU CHECK ON MOUNT & SAFETY WATCHDOG
  useEffect(() => {
    const gpuResult = inspectWebGLGPU();
    setGpuCheck(gpuResult);
    if (!gpuResult.ok) {
      setIsInitializing(false);
    }
    // Safety watchdog: Ensure the loading screen is never permanently stuck even if assets lag or fail
    const watchdog = setTimeout(() => {
      setIsInitializing(false);
    }, 5000);
    return () => clearTimeout(watchdog);
  }, []);

  // 1B. Dynamic Stage / Background & Lighting Sync (Seamless destination transitions)
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return;

    let isCancelled = false;

    const scenario = allScenarios[activeDest] || DEFAULT_SCENARIOS[activeDest] || DEFAULT_SCENARIOS.cute_cafe;
    if (!scenario) return;

    // 1. Resolve and apply map-specific default profile and layout on destination change
    const boundProfileId = mapDefaultProfiles[activeDest] || 'default';
    if (boundProfileId !== activeProfileId) {
      setActiveProfileId(boundProfileId);
      try {
        localStorage.setItem('yuki_date_active_profile_id', boundProfileId);
      } catch (_) {}
    }

    const targetCfg = getMapInitialConfig(activeDest, allScenarios, savedProfiles, mapDefaultProfiles);
    applyConfigToScene(targetCfg);

    // Broadcast active scenario to App.jsx so main app speech/chat inherits date prompt
    postDateModeMessage({
      type: 'date_scenario_update',
      scenario: {
        id: scenario.id,
        title: scenario.title,
        subtitle: scenario.subtitle,
        customPrompt: scenario.customPrompt || scenario.prompt
      }
    });

    // Ensure camera far clipping plane accommodates vast outdoor scenarios like marine_drive_night
    if (cameraRef.current) {
      const scenarioFar = scenario.cameraFar ?? (scenario.id === 'marine_drive_night' ? 2000 : 2000);
      if (cameraRef.current.far < scenarioFar) {
        cameraRef.current.far = scenarioFar;
        cameraRef.current.updateProjectionMatrix();
      }
    }

    // Complete stage teardown helper: disposes meshes, water reflector, lights, canvas textures, and env maps
    const unloadCurrentStage = () => {
      if (customStageMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(customStageMeshRef.current);
        disposeHierarchy(customStageMeshRef.current);
        customStageMeshRef.current = null;
        loadedStageUrlRef.current = null;
      }
      if (waterMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(waterMeshRef.current);
        waterMeshRef.current.geometry?.dispose?.();
        if (waterMeshRef.current.material) {
          waterMeshRef.current.material.uniforms?.['mirrorSampler']?.value?.dispose?.();
          waterMeshRef.current.material.dispose?.();
        }
        waterMeshRef.current = null;
      }
      stageLightsRef.current = [];
      ledScreenAnimRef.current = null;
      rgbMaterialsRef.current = [];
      if (currentEnvTextureRef.current) {
        currentEnvTextureRef.current.dispose?.();
        currentEnvTextureRef.current = null;
      }
    };

    // Unload the previous map stage immediately on destination switch
    unloadCurrentStage();

    // Handle 3D Stage Model vs 360 Panorama
    if (scenario.type === '3d_model') {
      if (bgMeshRef.current) {
        bgMeshRef.current.visible = false;
      }
      const isNight = (scenario.id || '').includes('night') || (scenario.id || '') === 'marine_drive_night';
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(isNight ? 0x02040a : 0x6bc3fc);
      }

      const modelUrl = scenario.assetUrl || scenario.bg;
      if (modelUrl && sceneRef.current) {
        setIsMapLoading(true);
        loadedStageUrlRef.current = modelUrl;

        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
            modelUrl,
            (gltf) => {
              setIsMapLoading(false);
              if (isCancelled) {
                disposeHierarchy(gltf.scene);
                return;
              }
              const stage = gltf.scene;
              const tf = scenario.modelTransform || { posX: 0, posY: -0.2, posZ: 0, rotY: 0, scale: 1.0 };
              const s = tf.scale || 1.0;
              stage.scale.set(tf.scaleX ?? s, tf.scaleY ?? s, tf.scaleZ ?? s);
              stage.position.set(tf.posX ?? 0, tf.posY ?? -0.2, tf.posZ ?? 0);
              stage.rotation.y = (tf.rotY ?? 0) * (Math.PI / 180);
              const mapLightScale = devConfigRef.current?.lights?.mapLights?.intensity ?? scenario.mapLightsIntensity ?? 0.05;
              sanitizePbrMaterials(stage, { castShadow: true, receiveShadow: true, keepLights: true, lightIntensityScale: mapLightScale });
              if (sceneRef.current && !isCancelled) {
                sceneRef.current.add(stage);
                customStageMeshRef.current = stage;
                const embeddedLights = [];
                stage.traverse((c) => {
                  if (c.isLight) embeddedLights.push(c);
                });
                stageLightsRef.current = embeddedLights;

                if (pmremGeneratorRef.current) {
                  if (currentEnvTextureRef.current) {
                    currentEnvTextureRef.current.dispose();
                  }
                  const roomEnv = new RoomEnvironment();
                  const envTexture = pmremGeneratorRef.current.fromScene(roomEnv).texture;
                  sceneRef.current.environment = null;
                  currentEnvTextureRef.current = envTexture;

                  const targetIntensity = scenario.envIntensity ?? 0.8;
                  stage.traverse((c) => {
                    if (c.isMesh && c.material) {
                      const mats = Array.isArray(c.material) ? c.material : [c.material];
                      mats.forEach((m) => {
                        const mName = (m.name || '').toLowerCase();
                        const isReflective = (typeof m.metalness === 'number' && m.metalness > 0.05) ||
                          (typeof m.roughness === 'number' && m.roughness < 0.45) ||
                          mName.includes('gold') || mName.includes('brass') || mName.includes('chrome') ||
                          mName.includes('metal') || mName.includes('cutlery') || mName.includes('silver') ||
                          mName.includes('glass') || mName.includes('mirror') || mName.includes('pedestal') ||
                          mName.includes('cup') || mName.includes('rim');
                        if (isReflective) {
                          m.envMap = envTexture;
                          m.envMapIntensity = targetIntensity;
                          m.needsUpdate = true;
                        }
                      });
                    }
                  });
                }

                const isNight = (scenario.id || '').includes('night') || (scenario.id || '') === 'marine_drive_night';
                if (!isNight) {
                  const skyTexture = createCuteSkyGradientTexture();
                  stage.traverse((c) => {
                    if (c.isMesh) {
                      const mNames = (Array.isArray(c.material) ? c.material : [c.material])
                        .map((m) => (m?.name || '').toLowerCase());
                      const isSky = (c.name || '').toLowerCase().includes('sky') ||
                        mNames.some((n) => n.includes('sky'));
                      if (isSky) {
                        c.material = new THREE.MeshBasicMaterial({
                          map: skyTexture,
                          side: THREE.DoubleSide,
                          depthWrite: false
                        });
                        c.material.needsUpdate = true;
                      }
                    }
                  });
                  if (sceneRef.current) {
                    sceneRef.current.background = new THREE.Color(0x6bc3fc);
                  }
                } else {
                  if (sceneRef.current) {
                    sceneRef.current.background = new THREE.Color(0x02040a);
                  }

                  // 1. Initialize 3 Unique Animated LED Billboard Screens (Anime, Ads, News)
                  const createScreenContext = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 512;
                    canvas.height = 512;
                    const ctx = canvas.getContext('2d');
                    const tex = new THREE.CanvasTexture(canvas);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.wrapS = THREE.ClampToEdgeWrapping;
                    tex.wrapT = THREE.ClampToEdgeWrapping;
                    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
                    return { canvas, ctx, tex, mat };
                  };

                  const screenAnime = createScreenContext();
                  const screenAds = createScreenContext();
                  const screenNews = createScreenContext();

                  ledScreenAnimRef.current = {
                    anime: screenAnime,
                    ads: screenAds,
                    news: screenNews
                  };

                  // 2. Discover RGB Materials, Hide Static River Mesh, & Extract Normal Map
                  const rgbList = [];
                  let waterNormalMap = null;

                  stage.traverse((c) => {
                    if (c.isMesh) {
                      const cName = (c.name || '').toLowerCase();
                      if (cName.includes('led_screen_aurora')) {
                        c.material = screenAnime.mat;
                      } else if (cName.includes('led_screen_wf_r1')) {
                        c.material = screenAds.mat;
                      } else if (cName.includes('led_screen_wf_l2')) {
                        c.material = screenNews.mat;
                      } else if (cName.includes('water') || cName.includes('river')) {
                        // Hide static glTF river surface to prevent z-fighting with the dynamic Water reflector
                        c.visible = false;
                        const m = Array.isArray(c.material) ? c.material[0] : c.material;
                        if (m?.normalMap) {
                          waterNormalMap = m.normalMap;
                        }
                      }

                      const mats = Array.isArray(c.material) ? c.material : [c.material];
                      mats.forEach((m) => {
                        if (!m) return;
                        const mName = (m.name || '').toLowerCase();
                        if (mName.includes('cylinder_neon') ||
                            mName.includes('diamond_truss') ||
                            mName.includes('diamond_cyan') ||
                            mName.includes('lotus_') ||
                            mName.includes('solar_ring') ||
                            mName.includes('spiralblue') ||
                            mName.includes('swfc_portal')) {
                          if (!rgbList.some((item) => item.mat === m)) {
                            rgbList.push({ mat: m, name: mName });
                          }
                        }
                      });
                    }
                  });
                  rgbMaterialsRef.current = rgbList;

                  // 3. Create Dynamic Water Reflector Plane for Marine Drive River
                  if (scenario.id === 'marine_drive_night' && sceneRef.current) {
                    const waterNormals = waterNormalMap || createProceduralWaterNormalsTexture();
                    waterNormals.wrapS = THREE.RepeatWrapping;
                    waterNormals.wrapT = THREE.RepeatWrapping;

                    // Exact river dimensions: river spans X from -260 to 0 (width 260, center X = -130), Z from -550 to 550 (height 1100)
                    const waterGeometry = new THREE.PlaneGeometry(260, 1100);
                    const water = new Water(waterGeometry, {
                      textureWidth: 1024,
                      textureHeight: 1024,
                      waterNormals: waterNormals,
                      sunDirection: new THREE.Vector3(0.1, 0.9, 0.2).normalize(),
                      sunColor: 0x223850,
                      waterColor: 0x020814,
                      distortionScale: 1.15,
                      fog: sceneRef.current.fog !== undefined
                    });
                    water.rotation.x = -Math.PI / 2;
                    const waterY = scenario.waterLevel ?? -2.35;
                    water.position.set(-130, waterY, 0);
                    water.receiveShadow = true;
                    sceneRef.current.add(water);
                    waterMeshRef.current = water;
                  }
                }

                // Apply active toneMapping and exposure
                if (rendererRef.current) {
                  const activeTone = devConfigRef.current?.shaders?.toneMapping || scenario.toneMapping || 'AgX';
                  rendererRef.current.toneMapping = TONE_MAPPINGS[activeTone] || THREE.AgXToneMapping;
                  const activeExp = devConfigRef.current?.shaders?.exposure ?? scenario.exposure ?? 0.9;
                  rendererRef.current.toneMappingExposure = activeExp;
                }
              }
            },
            undefined,
            (err) => {
              setIsMapLoading(false);
              console.warn('[DateMode] 3D stage model load warning:', err);
            }
          );
        }

      // Toggle dining table & props visibility based on scenario settings
      const showTable = scenario.showDefaultTable !== false;
      ['table', 'herGlass', 'yourGlass', 'cake', 'chair', 'candleGLB', 'vaseGLB'].forEach((objKey) => {
        if (sceneObjectsRef.current[objKey]) {
          sceneObjectsRef.current[objKey].visible = showTable;
        }
      });
      if (floorMeshRef.current) {
        floorMeshRef.current.visible = showTable;
      }
      if (candleLightRef.current) {
        candleLightRef.current.visible = showTable;
      }
    } else {
      // Panorama Mode
      setIsMapLoading(true);
      unloadCurrentStage();

      if (bgMeshRef.current) {
        bgMeshRef.current.visible = true;
        const imgUrl = scenario.assetUrl || scenario.bg;
        if (imgUrl) {
          const textureLoader = new THREE.TextureLoader();
          textureLoader.load(
            imgUrl,
            (newTex) => {
              setIsMapLoading(false);
              if (isCancelled) {
                newTex.dispose();
                return;
              }
              newTex.colorSpace = THREE.SRGBColorSpace;
              newTex.minFilter = THREE.LinearFilter;
              newTex.magFilter = THREE.LinearFilter;
              newTex.generateMipmaps = false;
              if (rendererRef.current) {
                newTex.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
              }
              newTex.needsUpdate = true;
              if (bgMeshRef.current?.material) {
                if (bgMeshRef.current.material.map) {
                  bgMeshRef.current.material.map.dispose();
                }
                bgMeshRef.current.material.map = newTex;
                bgMeshRef.current.material.needsUpdate = true;
              }
              if (pmremGeneratorRef.current && sceneRef.current) {
                if (currentEnvTextureRef.current) {
                  currentEnvTextureRef.current.dispose();
                }
                const panoEnv = pmremGeneratorRef.current.fromEquirectangular(newTex).texture;
                sceneRef.current.environment = panoEnv;
                currentEnvTextureRef.current = panoEnv;
              }
            },
            undefined,
            () => setIsMapLoading(false)
          );
        } else {
          setIsMapLoading(false);
        }
      } else {
        setIsMapLoading(false);
      }

      ['table', 'herGlass', 'yourGlass', 'cake', 'chair', 'candleGLB', 'vaseGLB'].forEach((objKey) => {
        if (sceneObjectsRef.current[objKey]) {
          sceneObjectsRef.current[objKey].visible = true;
        }
      });
      if (floorMeshRef.current) {
        floorMeshRef.current.visible = true;
      }
    }

    return () => {
      isCancelled = true;
      unloadCurrentStage();
    };
  }, [activeDest, allScenarios, mapDefaultProfiles, savedProfiles, applyConfigToScene, sceneReady]);

  // 2. KOKORO AUDIO PIPELINE & 256-FFT SPECTRAL ANALYSER (Strict Parity with useAudioPlayback)
  const setupAudioPipeline = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.25;
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
      }

      if (!persistentAudioRef.current) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        const source = ctx.createMediaElementSource(audio);
        source.connect(analyserRef.current);
        audioSourceRef.current = source;
        persistentAudioRef.current = audio;
      }
    } catch (e) {
      console.warn('[DateMode] Audio pipeline init note:', e);
    }
  }, []);

  // Proactive Date Initiation Trigger
  const triggerProactiveDateInitiation = useCallback(() => {
    // Guards:
    // 1. Is thinking?
    if (isThinkingRef.current) return;
    // 2. Is audio playing or audio in queue?
    if (isAudioPlayingRef.current || (audioQueueRef.current && audioQueueRef.current.length > 0)) return;
    // 3. Is user actively typing in the input box?
    if (inputTextRef.current && inputTextRef.current.trim().length > 0) return;
    // 4. Is mic actively capturing speech or listening mode processing?
    if (voiceStateRef.current?.isListening || isListeningRef.current) return;
    // 5. Is WebSocket open?
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    // 6. Has at least 8 seconds elapsed since Yuki's last speech / turn?
    const elapsedSinceDialogue = (Date.now() - (lastDialogueTimeRef.current || 0)) / 1000;
    if (elapsedSinceDialogue < 8) return;

    console.log('[DateMode] Proactive conversation starter triggered after', Math.round(elapsedSinceDialogue), 'seconds of quiet.');

    setIsThinking(true);
    accumulatedDialogueRef.current = '';
    turnFinishedRef.current = false;

    const dest = allScenarios[activeDest] || DEFAULT_SCENARIOS['cute_cafe'];
    socketRef.current.send(JSON.stringify({
      type: 'chat',
      message: '[SYSTEM EVENT: DATE_PROACTIVE_INITIATION]',
      is_date_mode: true,
      context_mode: 'date_mode',
      is_proactive_date_topic: true,
      date_setting: {
        id: activeDest,
        title: dest.title,
        subtitle: dest.subtitle,
        atmosphere: dest.subtitle || dest.title,
        custom_prompt: dest.customPrompt || dest.prompt
      }
    }));
  }, [activeDest, allScenarios]);

  const scheduleProactiveDateCheck = useCallback(() => {
    if (proactiveDateTimerRef.current) {
      clearTimeout(proactiveDateTimerRef.current);
      proactiveDateTimerRef.current = null;
    }
    // Random quiet duration between 10 and 30 seconds (10000ms - 30000ms)
    const randomDelayMs = Math.floor(Math.random() * 20000) + 10000;
    proactiveDateTimerRef.current = setTimeout(() => {
      triggerProactiveDateInitiation();
    }, randomDelayMs);
  }, [triggerProactiveDateInitiation]);

  scheduleProactiveDateCheckRef.current = scheduleProactiveDateCheck;

  const playNextAudioInQueue = useCallback(() => {
    if (!audioQueueRef.current || audioQueueRef.current.length === 0) {
      isAudioPlayingRef.current = false;
      dateAmbienceEngine.setDucked(false);
      postDateModeMessage({
        type: 'yuki_speaking_state',
        speaking: false,
        playback_finished: turnFinishedRef.current
      });
      if (turnFinishedRef.current) {
        scheduleProactiveDateCheck();
      }
      return;
    }

    isAudioPlayingRef.current = true;
    dateAmbienceEngine.setDucked(true);
    postDateModeMessage({ type: 'yuki_speaking_state', speaking: true });

    const nextItem = audioQueueRef.current.shift();
    currentVisemesRef.current = nextItem.visemes || null;
    setupAudioPipeline();

    // If Yuki's spoken voice is muted, skip audio playback and simulate timing so speech text displays naturally
    if (muteVoiceRef.current) {
      const simDuration = Math.min(4000, Math.max(1200, (nextItem.text?.length || 20) * 55));
      setTimeout(() => {
        currentVisemesRef.current = null;
        if (playNextAudioRef.current) {
          playNextAudioRef.current();
        }
      }, simDuration);
      return;
    }

    const audioEl = persistentAudioRef.current;
    if (!audioEl) {
      isAudioPlayingRef.current = false;
      currentVisemesRef.current = null;
      dateAmbienceEngine.setDucked(false);
      postDateModeMessage({
        type: 'yuki_speaking_state',
        speaking: false,
        playback_finished: turnFinishedRef.current
      });
      if (turnFinishedRef.current) {
        scheduleProactiveDateCheck();
      }
      return;
    }

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    audioEl.src = nextItem.url;
    audioEl.load();

    audioEl.onended = () => {
      currentVisemesRef.current = null;
      if (playNextAudioRef.current) {
        playNextAudioRef.current();
      }
    };

    audioEl.onerror = (e) => {
      console.warn('[DateMode] Audio playback error for chunk:', e);
      currentVisemesRef.current = null;
      if (playNextAudioRef.current) {
        playNextAudioRef.current();
      }
    };

    audioEl.play().catch((err) => {
      console.warn('[DateMode] Audio playback blocked/failed:', err);
      currentVisemesRef.current = null;
      if (playNextAudioRef.current) {
        playNextAudioRef.current();
      }
    });
  }, [setupAudioPipeline, postDateModeMessage]);

  playNextAudioRef.current = playNextAudioInQueue;

  const stopAllDateAudio = useCallback(() => {
    if (proactiveDateTimerRef.current) {
      clearTimeout(proactiveDateTimerRef.current);
      proactiveDateTimerRef.current = null;
    }
    audioQueueRef.current = [];
    currentVisemesRef.current = null;
    isAudioPlayingRef.current = false;
    dateAmbienceEngine.setDucked(false);
    postDateModeMessage({ type: 'yuki_speaking_state', speaking: false, playback_finished: true });
    if (persistentAudioRef.current) {
      persistentAudioRef.current.pause();
      persistentAudioRef.current.removeAttribute('src');
      persistentAudioRef.current.load();
    }
  }, [postDateModeMessage]);

  // Connect to backend WebSocket for live chat, Kokoro TTS audio streaming, and viseme analysis
  useEffect(() => {
    if (!gpuCheck?.ok) return;

    let ws = null;
    let reconnectTimeout = null;

    const connectWs = () => {
      try {
        ws = new WebSocket(WS_BASE);
        socketRef.current = ws;

        ws.onopen = () => {
          console.log('[DateMode] WebSocket connection established to', WS_BASE);
          try {
            ws.send(JSON.stringify({ type: 'date_mode_status', active: true }));
          } catch (_) {}
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);

            if (data.type === 'turn_start') {
              accumulatedDialogueRef.current = '';
              turnFinishedRef.current = false;
              setIsThinking(true);
              if (data.user_message && !data.user_message.startsWith('[SYSTEM EVENT:')) {
                setDialogueText(`"${data.user_message}"`);
              } else {
                setDialogueText('');
              }
            } else if (data.type === 'status') {
              if (data.status === 'thinking') {
                setIsThinking(true);
                accumulatedDialogueRef.current = '';
                turnFinishedRef.current = false;
              } else if (data.status === 'idle') {
                setIsThinking(false);
              }
            } else if (data.type === 'voice_transcript_resolved') {
              accumulatedDialogueRef.current = '';
              turnFinishedRef.current = false;
              setIsThinking(true);
              if (data.transcript) {
                setDialogueText(`"${data.transcript}"`);
              }
            } else if (data.type === 'text_stream') {
              if (turnFinishedRef.current) {
                accumulatedDialogueRef.current = '';
                turnFinishedRef.current = false;
              }
              if (data.final === false) {
                // Intermediate reasoning / tool execution status
                setIsThinking(true);
                return;
              }
              setIsThinking(false);
              accumulatedDialogueRef.current += data.text || '';
              const { cleanText } = parseResponseTags(accumulatedDialogueRef.current, {
                onEmotion: (emotionName) => {
                  const mapped = LLM_EMOTION_MAP[emotionName] || emotionName;
                  currentExprRef.current = mapped;
                  setCharacterMood(mapped);
                  lastDialogueTimeRef.current = Date.now();
                },
                onAnimation: (animName) => {
                  triggerSeatedGesture(animName);
                }
              });
              setDialogueText(cleanText);
            } else if (data.type === 'audio_chunk') {
              const audioUrl = data.audio_url || (data.audio ? `data:audio/wav;base64,${data.audio}` : null);
              if (audioUrl) {
                const chunkItem = {
                  url: audioUrl,
                  text: data.text || data.speech_text || '',
                  index: typeof data.index === 'number' ? data.index : audioQueueRef.current.length,
                  visemes: data.visemes || null
                };
                audioQueueRef.current.push(chunkItem);
                audioQueueRef.current.sort((a, b) => a.index - b.index);

                if (!isAudioPlayingRef.current) {
                  playNextAudioInQueue();
                }
              }
            } else if (data.type === 'stream_done') {
              setIsThinking(false);
              turnFinishedRef.current = true;
              lastDialogueTimeRef.current = Date.now();
              if ((!audioQueueRef.current || audioQueueRef.current.length === 0) && !isAudioPlayingRef.current) {
                postDateModeMessage({ type: 'yuki_speaking_state', speaking: false, playback_finished: true });
                scheduleProactiveDateCheck();
              }
            } else if (data.type === 'mood_update') {
              if (data.mood?.expression) {
                const mapped = LLM_EMOTION_MAP[data.mood.expression] || data.mood.expression;
                currentExprRef.current = mapped;
                setCharacterMood(mapped);
                lastDialogueTimeRef.current = Date.now();
              }
            } else if (data.type === 'profile_update') {
              const newModel = data.profile?.settings?.active_vrm_model;
              if (newModel && (newModel !== activeModelNameRef.current || (!vrmRef.current && !loadingModelUrlRef.current))) {
                const modelUrl = `${API_BASE}/api/models/vrm/files/${encodeURIComponent(newModel)}?t=${Date.now()}`;
                loadVrmModelRef.current?.(modelUrl, newModel);
              }
            } else if (data.type === 'tool_result') {
              if (data.tool === 'change_avatar_outfit' || data.tool === 'jarvis_change_avatar_outfit') {
                fetch(`${API_BASE}/api/profile`)
                  .then((r) => r.json())
                  .then((prof) => {
                    const newModel = prof?.settings?.active_vrm_model;
                    if (newModel && (newModel !== activeModelNameRef.current || (!vrmRef.current && !loadingModelUrlRef.current))) {
                      const modelUrl = `${API_BASE}/api/models/vrm/files/${encodeURIComponent(newModel)}?t=${Date.now()}`;
                      loadVrmModelRef.current?.(modelUrl, newModel);
                    }
                  })
                  .catch(() => {});
              }
            } else if (data.type === 'turn_interrupted') {
              setIsThinking(false);
              turnFinishedRef.current = true;
              stopAllDateAudio();
            } else if (data.type === 'voice_state') {
              setVoiceState(data);
              setIsListening(Boolean(data.isListening));
              if (data.muteVoice !== undefined) {
                setMuteVoice(Boolean(data.muteVoice));
              }
            } else if (data.type === 'listening_state') {
              const l = Boolean(data.isListening);
              setIsListening(l);
              setVoiceState((prev) => ({ ...prev, isListening: l }));
            }
          } catch (err) {
            console.warn('[DateMode] Error parsing WebSocket message:', err);
          }
        };

        ws.onclose = () => {
          console.log('[DateMode] WebSocket disconnected. Reconnecting in 2s...');
          reconnectTimeout = setTimeout(connectWs, 2000);
        };

        ws.onerror = (err) => {
          console.warn('[DateMode] WebSocket error:', err);
        };
      } catch (e) {
        console.warn('[DateMode] WebSocket initialization error:', e);
        reconnectTimeout = setTimeout(connectWs, 2000);
      }
    };

    connectWs();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      stopAllDateAudio();
    };
  }, [gpuCheck, playNextAudioInQueue, stopAllDateAudio]);

  // 3. THREE.JS 3D SCENE SETUP (7-Pillar Electron Efficiency Architecture)
  useEffect(() => {
    if (!gpuCheck?.ok || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Pillar 1 & 2: Opaque Window + Hardware Swapchain (Composited normally with DOM)
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      powerPreference: 'high-performance',
      antialias: true,
      depth: true,
      stencil: false
    });

    const activeCfg = devConfigRef.current || DEFAULT_DATE_CONFIG;

    // Pillar 4: Clamp Device Pixel Ratio to 1.25 to prevent 4K GPU fill bottlenecks
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setSize(width, height);
    const shaderCfg = activeCfg.shaders || DEFAULT_DATE_CONFIG.shaders;
    renderer.toneMapping = TONE_MAPPINGS[shaderCfg.toneMapping] || THREE.AgXToneMapping;
    renderer.toneMappingExposure = shaderCfg.exposure ?? 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6bc3fc);
    sceneRef.current = scene;

    // Image-Based Lighting (IBL) & Specular Environment Reflections
    // Provides realistic specular gleam to metals (gold, brass, chrome, cutlery) and glass
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    pmremGeneratorRef.current = pmremGenerator;

    const roomEnv = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(roomEnv).texture;
    // CRITICAL: Keep global scene.environment = null so VRM MToon cel shaders are not washed out by 360° white lightbox.
    // Specular reflections are applied selectively to metallic/reflective PBR materials via material.envMap.
    scene.environment = null;
    currentEnvTextureRef.current = envTexture;

    // First-Person Perspective Camera (Eye-level seated position across the dining table)
    const currentDest = allScenarios[activeDest] || DEFAULT_SCENARIOS[activeDest] || DEFAULT_SCENARIOS.cute_cafe;
    const camCfg = activeCfg.camera || DEFAULT_DATE_CONFIG.camera;
    const targetFar = camCfg.far || currentDest?.cameraFar || 2000;
    const camera = new THREE.PerspectiveCamera(camCfg.fov ?? 42, width / height, 0.1, targetFar);
    camera.rotation.order = 'YXZ';
    camera.position.set(camCfg.posX ?? 0, camCfg.posY ?? 2.3, camCfg.posZ ?? 0.45);
    cameraRef.current = camera;
    sceneObjectsRef.current.playerPov = camera;

    // Lighting Configuration
    const is3DModel = currentDest?.type === '3d_model';
    const showDefaultTable = currentDest?.showDefaultTable !== false;
    const ambCfg = activeCfg.lights?.ambient || DEFAULT_DATE_CONFIG.lights.ambient;
    const ambColor = normalizeColorHex(ambCfg.color ?? currentDest.ambientColor, '#fff5ea');
    const ambIntensity = ambCfg.intensity ?? currentDest.ambientIntensity ?? 0.45;
    const ambientLight = new THREE.AmbientLight(ambColor, ambIntensity);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const spotCfg = activeCfg.lights?.keySpot || DEFAULT_DATE_CONFIG.lights.keySpot;
    const spotColor = normalizeColorHex(spotCfg.color ?? currentDest.spotColor, '#ffeedd');
    const spotIntensity = spotCfg.intensity ?? currentDest.spotIntensity ?? 1.0;
    const keySpot = new THREE.DirectionalLight(spotColor, spotIntensity);
    keySpot.position.set(spotCfg.posX ?? 0.7, spotCfg.posY ?? -0.3, spotCfg.posZ ?? 1.7);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.width = 1024;
    keySpot.shadow.mapSize.height = 1024;
    keySpot.shadow.bias = -0.0005;
    scene.add(keySpot);
    spotLightRef.current = keySpot;

    // Warm Candle Point Light at tabletop (cube shadow disabled to protect MAX_FRAGMENT_UNIFORM_VECTORS limit)
    const candleCfg = activeCfg.lights?.candle || DEFAULT_DATE_CONFIG.lights.candle;
    const candleColor = normalizeColorHex(candleCfg.color || currentDest.candleColor, '#ff9933');
    const candleLight = new THREE.PointLight(candleColor, candleCfg.intensity ?? 1.5, 4.0, 2.0);
    candleLight.position.set(candleCfg.posX ?? 0.0, candleCfg.posY ?? 1.52, candleCfg.posZ ?? 0.22);
    candleLight.castShadow = false;
    scene.add(candleLight);
    candleLightRef.current = candleLight;

    // Ground floor terrace to anchor the Tokyo night scene
    const floorGeo = new THREE.CircleGeometry(6.5, 64);
    const activeFloorConfig = FLOOR_TEXTURES[floorStyle] || FLOOR_TEXTURES.wood;
    const initialFloorUrl = customFloorUrl || activeFloorConfig.url;
    const floorTexLoader = new THREE.TextureLoader();
    const floorTex = floorTexLoader.load(
      initialFloorUrl,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(activeFloorConfig.repeat[0], activeFloorConfig.repeat[1]);
        tex.colorSpace = THREE.SRGBColorSpace;
        if (renderer) {
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        tex.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.warn('[DateMode] Failed to load floor texture:', err);
      }
    );
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(activeFloorConfig.repeat[0], activeFloorConfig.repeat[1]);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) {
      floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: activeFloorConfig.roughness,
      metalness: activeFloorConfig.metalness
    });
    const floorObj = activeCfg.objects?.floor || DEFAULT_DATE_CONFIG.objects.floor;
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(floorObj.posX ?? 0, floorObj.posY ?? -0.41, floorObj.posZ ?? 0);
    floorMesh.rotation.y = (floorObj.rotY ?? 0) * (Math.PI / 180);
    floorMesh.scale.set(floorObj.scaleX ?? floorObj.scale ?? 1.0, floorObj.scaleY ?? floorObj.scale ?? 1.0, floorObj.scaleZ ?? floorObj.scale ?? 1.0);
    floorMesh.receiveShadow = true;
    floorMesh.visible = showDefaultTable;
    scene.add(floorMesh);
    floorMeshRef.current = floorMesh;
    sceneObjectsRef.current.floor = floorMesh;

    // Full 360° Equirectangular Panoramic Sky Environment (No black voids)
    const textureLoader = new THREE.TextureLoader();
    const initialBg = customBgUrl || currentDest.bg;
    if (!is3DModel && initialBg) {
      textureLoader.load(initialBg, (bgTex) => {
        bgTex.colorSpace = THREE.SRGBColorSpace;
        bgTex.minFilter = THREE.LinearFilter;
        bgTex.magFilter = THREE.LinearFilter;
        bgTex.generateMipmaps = false;
        bgTex.wrapS = THREE.RepeatWrapping;
        bgTex.wrapT = THREE.ClampToEdgeWrapping;
        bgTex.repeat.set(1, bgVerticalScale);
        bgTex.offset.set(0, bgVerticalOffset);
        if (renderer) {
          bgTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        bgTex.needsUpdate = true;
        const bgGeo = new THREE.SphereGeometry(35, 60, 40);
        bgGeo.scale(-1, 1, 1);
        const bgMat = new THREE.MeshBasicMaterial({
          map: bgTex,
          depthWrite: false
        });
        const bgObj = activeCfg.objects?.bgSphere || DEFAULT_DATE_CONFIG.objects.bgSphere;
        const bgMesh = new THREE.Mesh(bgGeo, bgMat);
        bgMesh.position.set(bgObj.posX ?? 0, bgObj.posY ?? -2, bgObj.posZ ?? -2.36);
        bgMesh.rotation.y = (bgObj.rotY ?? 175) * (Math.PI / 180);
        bgMesh.scale.set(bgObj.scaleX ?? bgObj.scale ?? 1.0, bgObj.scaleY ?? bgObj.scale ?? 1.0, bgObj.scaleZ ?? bgObj.scale ?? 1.0);
        scene.add(bgMesh);
        bgMeshRef.current = bgMesh;
        sceneObjectsRef.current.bgSphere = bgMesh;
      });
    } else {
      const bgGeo = new THREE.SphereGeometry(35, 60, 40);
      bgGeo.scale(-1, 1, 1);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: false });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.visible = false;
      scene.add(bgMesh);
      bgMeshRef.current = bgMesh;
      sceneObjectsRef.current.bgSphere = bgMesh;
    }

    // ------------------------------------------------------------------------
    // TABLETOP & PROPS (Procedural PBR + CC0 GLB Assets)
    // ------------------------------------------------------------------------
    // Dining Table (radius 0.42m, surface height 0.68m)
    const tableObj = activeCfg.objects?.table || DEFAULT_DATE_CONFIG.objects.table;
    const tableGroup = new THREE.Group();
    tableGroup.position.set(tableObj.posX ?? 0, tableObj.posY ?? 1.21, tableObj.posZ ?? 0.32);
    tableGroup.rotation.y = (tableObj.rotY ?? 0) * (Math.PI / 180);
    tableGroup.scale.set(tableObj.scaleX ?? tableObj.scale ?? 0.53, tableObj.scaleY ?? tableObj.scale ?? 1.05, tableObj.scaleZ ?? tableObj.scale ?? 0.6);

    const tableTopGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.035, 48);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x22130e,
      roughness: 0.25,
      metalness: 0.08
    });
    const tableTop = new THREE.Mesh(tableTopGeo, tableMat);
    tableTop.position.set(0, 0.68, 0);
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);

    // Gold/brass edge trim for luxury dining aesthetics
    const rimGeo = new THREE.TorusGeometry(0.421, 0.005, 16, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.85,
      roughness: 0.2
    });
    const tableRim = new THREE.Mesh(rimGeo, rimMat);
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.set(0, 0.697, 0);
    tableGroup.add(tableRim);

    // Pedestal stem & base
    const legGeo = new THREE.CylinderGeometry(0.04, 0.07, 0.65, 24);
    const legMesh = new THREE.Mesh(legGeo, tableMat);
    legMesh.position.set(0, 0.325, 0);
    tableGroup.add(legMesh);

    const baseGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.02, 32);
    const baseMesh = new THREE.Mesh(baseGeo, tableMat);
    baseMesh.position.set(0, 0.01, 0);
    tableGroup.add(baseMesh);

    tableGroup.visible = showDefaultTable;
    scene.add(tableGroup);
    sceneObjectsRef.current.table = tableGroup;

    // High-performance clean glass (avoids MAX_FRAGMENT_UNIFORM_VECTORS shader overflow)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      envMap: envTexture,
      envMapIntensity: 0.8
    });
    const glassGeo = new THREE.CylinderGeometry(0.038, 0.012, 0.12, 24, 1, true);

    const wineMat = new THREE.MeshStandardMaterial({
      color: 0x6e0918,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
      envMap: envTexture,
      envMapIntensity: 0.8
    });
    const wineGeo = new THREE.CylinderGeometry(0.034, 0.01, 0.06, 24);

    // Yuki's wine glass group (across table)
    const herObj = activeCfg.objects?.herGlass || DEFAULT_DATE_CONFIG.objects.herGlass;
    const herGlassGroup = new THREE.Group();
    herGlassGroup.position.set(herObj.posX ?? 0.13, herObj.posY ?? 1.58, herObj.posZ ?? 0.16);
    herGlassGroup.rotation.y = (herObj.rotY ?? 0) * (Math.PI / 180);
    herGlassGroup.scale.set(herObj.scaleX ?? herObj.scale ?? 0.67, herObj.scaleY ?? herObj.scale ?? 0.67, herObj.scaleZ ?? herObj.scale ?? 0.67);
    const herGlass = new THREE.Mesh(glassGeo, glassMat);
    herGlass.position.set(0, 0, 0);
    herGlassGroup.add(herGlass);
    const herWine = new THREE.Mesh(wineGeo, wineMat);
    herWine.position.set(0, -0.03, 0);
    herGlassGroup.add(herWine);
    herGlassGroup.visible = showDefaultTable;
    scene.add(herGlassGroup);
    sceneObjectsRef.current.herGlass = herGlassGroup;

    // Player's wine glass group (foreground left)
    const yourObj = activeCfg.objects?.yourGlass || DEFAULT_DATE_CONFIG.objects.yourGlass;
    const yourGlassGroup = new THREE.Group();
    yourGlassGroup.position.set(yourObj.posX ?? -0.09, yourObj.posY ?? 1.58, yourObj.posZ ?? 0.34);
    yourGlassGroup.rotation.y = (yourObj.rotY ?? 0) * (Math.PI / 180);
    yourGlassGroup.scale.set(yourObj.scaleX ?? yourObj.scale ?? 0.6, yourObj.scaleY ?? yourObj.scale ?? 0.6, yourObj.scaleZ ?? yourObj.scale ?? 0.6);
    const yourGlass = new THREE.Mesh(glassGeo, glassMat);
    yourGlass.position.set(0, 0, 0);
    yourGlassGroup.add(yourGlass);
    const yourWine = new THREE.Mesh(wineGeo, wineMat);
    yourWine.position.set(0, -0.03, 0);
    yourGlassGroup.add(yourWine);
    yourGlassGroup.visible = showDefaultTable;
    scene.add(yourGlassGroup);
    sceneObjectsRef.current.yourGlass = yourGlassGroup;

    // Dessert Plate with Strawberry Cake Group (Table interaction prop)
    const cakeObj = activeCfg.objects?.cake || DEFAULT_DATE_CONFIG.objects.cake;
    const cakeGroup = new THREE.Group();
    cakeGroup.position.set(cakeObj.posX ?? 0, cakeObj.posY ?? 2.02, cakeObj.posZ ?? 0.19);
    cakeGroup.rotation.y = (cakeObj.rotY ?? 0) * (Math.PI / 180);
    cakeGroup.scale.set(cakeObj.scaleX ?? cakeObj.scale ?? 0.34, cakeObj.scaleY ?? cakeObj.scale ?? 0.34, cakeObj.scaleZ ?? cakeObj.scale ?? 0.34);

    const plateGeo = new THREE.CylinderGeometry(0.10, 0.08, 0.012, 32);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.15 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0, 0);
    plate.receiveShadow = true;
    cakeGroup.add(plate);

    const cakeGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.035, 24);
    const cakeMat = new THREE.MeshStandardMaterial({ color: 0x4a2311, roughness: 0.7 });
    const cake = new THREE.Mesh(cakeGeo, cakeMat);
    cake.position.set(0, 0.024, 0);
    cakeGroup.add(cake);

    const berryGeo = new THREE.SphereGeometry(0.015, 16, 16);
    const berryMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, roughness: 0.3 });
    const berry = new THREE.Mesh(berryGeo, berryMat);
    berry.position.set(0, 0.049, 0);
    cakeGroup.add(berry);

    cakeGroup.visible = showDefaultTable;
    scene.add(cakeGroup);
    sceneObjectsRef.current.cake = cakeGroup;

    // 4. Load CC0 GLB Assets from 3d_assets/date (Dining Chair, Candle Hurricane, Flower Vase)
    const gltfLoader = new GLTFLoader();

    // Procedural Luxury Dining Chair (0 KB, zero download overhead, matches dining table)
    const chairGroup = new THREE.Group();
    const chairVelvetMat = new THREE.MeshStandardMaterial({
      color: 0x1f2430,
      roughness: 0.85,
      metalness: 0.05
    });
    const chairWoodMat = new THREE.MeshStandardMaterial({
      color: 0x24150e,
      roughness: 0.35,
      metalness: 0.08
    });
    const chairBrassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.25,
      metalness: 0.85
    });

    // 1. Tapered Legs (with brass caps)
    const legPositions = [
      { x: -0.17, z: 0.14, rx: 0.05, rz: -0.06 },
      { x: 0.17, z: 0.14, rx: 0.05, rz: 0.06 },
      { x: -0.16, z: -0.15, rx: -0.07, rz: -0.06 },
      { x: 0.16, z: -0.15, rx: -0.07, rz: 0.06 }
    ];
    legPositions.forEach((lp) => {
      const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.007, 0.24, 16), chairWoodMat);
      legMesh.position.set(lp.x, 0.12, lp.z);
      legMesh.rotation.set(lp.rx, 0, lp.rz);
      legMesh.castShadow = true;
      legMesh.receiveShadow = true;
      chairGroup.add(legMesh);

      const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0075, 0.035, 16), chairBrassMat);
      capMesh.position.set(lp.x * 1.05, 0.018, lp.z * 1.05);
      capMesh.rotation.set(lp.rx, 0, lp.rz);
      capMesh.castShadow = true;
      chairGroup.add(capMesh);
    });

    // 2. Seat Base & Padded Velvet Cushion
    const seatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.21, 0.025, 32), chairWoodMat);
    seatBase.position.set(0, 0.23, 0);
    seatBase.scale.set(1.0, 1.0, 0.95);
    seatBase.castShadow = true;
    seatBase.receiveShadow = true;
    chairGroup.add(seatBase);

    const seatCushion = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.22, 0.045, 32), chairVelvetMat);
    seatCushion.position.set(0, 0.258, 0);
    seatCushion.scale.set(1.0, 1.0, 0.95);
    seatCushion.castShadow = true;
    seatCushion.receiveShadow = true;
    chairGroup.add(seatCushion);

    // 3. Curved Ergonomic Backrest
    const backrestGeo = new THREE.CylinderGeometry(0.23, 0.24, 0.38, 32, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
    const backrestShell = new THREE.Mesh(backrestGeo, chairWoodMat);
    backrestShell.position.set(0, 0.44, -0.04);
    backrestShell.rotation.x = -0.08;
    backrestShell.castShadow = true;
    backrestShell.receiveShadow = true;
    chairGroup.add(backrestShell);

    const backrestInnerGeo = new THREE.CylinderGeometry(0.22, 0.23, 0.36, 32, 1, true, -Math.PI * 0.40, Math.PI * 0.80);
    const backrestCushion = new THREE.Mesh(backrestInnerGeo, chairVelvetMat);
    backrestCushion.position.set(0, 0.44, -0.035);
    backrestCushion.rotation.x = -0.08;
    backrestCushion.castShadow = true;
    backrestCushion.receiveShadow = true;
    chairGroup.add(backrestCushion);

    // Position & apply devConfig transform
    const cObj = devConfigRef.current?.objects?.chair || DEFAULT_DATE_CONFIG.objects.chair;
    chairGroup.scale.set(cObj.scaleX ?? cObj.scale ?? 2.79, cObj.scaleY ?? cObj.scale ?? 2.79, cObj.scaleZ ?? cObj.scale ?? 2.79);
    chairGroup.position.set(cObj.posX ?? 0.09, cObj.posY ?? -0.31, cObj.posZ ?? -1.15);
    chairGroup.rotation.y = (cObj.rotY ?? 7) * (Math.PI / 180);
    chairGroup.visible = showDefaultTable;
    scene.add(chairGroup);
    sceneObjectsRef.current.chair = chairGroup;

    // Candle Hurricane on table center
    gltfLoader.load(resolveAssetPath('3d_assets/date/GlassHurricaneCandleHolder.glb'), (gltf) => {
      const candle = gltf.scene;
      const cObj = devConfigRef.current?.objects?.candleGLB || DEFAULT_DATE_CONFIG.objects.candleGLB;
      candle.scale.set(cObj.scaleX ?? cObj.scale ?? 0.12, cObj.scaleY ?? cObj.scale ?? 0.12, cObj.scaleZ ?? cObj.scale ?? 0.12);
      candle.position.set(cObj.posX ?? 0, cObj.posY ?? 2.05, cObj.posZ ?? 0.43);
      candle.rotation.y = (cObj.rotY ?? 0) * (Math.PI / 180);
      sanitizePbrMaterials(candle, { castShadow: false, receiveShadow: true });
      candle.visible = showDefaultTable;
      scene.add(candle);
      sceneObjectsRef.current.candleGLB = candle;
    }, undefined, (err) => console.warn('[DateMode] Candle load note:', err));

    // Flower Vase with Roses
    gltfLoader.load(resolveAssetPath('3d_assets/date/GlassVaseFlowers.glb'), (gltf) => {
      const vase = gltf.scene;
      const vObj = devConfigRef.current?.objects?.vaseGLB || DEFAULT_DATE_CONFIG.objects.vaseGLB;
      vase.scale.set(vObj.scaleX ?? vObj.scale ?? 0.41, vObj.scaleY ?? vObj.scale ?? 0.41, vObj.scaleZ ?? vObj.scale ?? 0.41);
      vase.position.set(vObj.posX ?? -0.15, vObj.posY ?? 2.02, vObj.posZ ?? 0.36);
      vase.rotation.y = (vObj.rotY ?? 77) * (Math.PI / 180);
      sanitizePbrMaterials(vase, { castShadow: false, receiveShadow: true });
      vase.visible = showDefaultTable;
      scene.add(vase);
      sceneObjectsRef.current.vaseGLB = vase;
    }, undefined, (err) => console.warn('[DateMode] Vase load note:', err));

    // ------------------------------------------------------------------------
    // 5. LOAD YUKI'S VRM AVATAR IN SEATED DINING POSE
    // ------------------------------------------------------------------------
    const vrmLoader = new GLTFLoader();
    vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

    const loadVrmModel = (url, modelName = null) => {
      if (!url) return;

      // 1. Deduplicate: Ignore if this exact model is already active and mounted
      if (modelName) {
        if (activeModelNameRef.current === modelName && vrmRef.current) {
          return;
        }
        activeModelNameRef.current = modelName;
      }
      // 2. Concurrency guard: Ignore if an identical download is already in flight
      if (loadingModelUrlRef.current === url) {
        return;
      }
      loadingModelUrlRef.current = url;

      // 3. Monotonic sequence token: Discards superseded loads if model changes mid-download
      const currentLoadId = ++vrmLoadSeqRef.current;

      vrmLoader.load(
        url,
        (gltf) => {
          loadingModelUrlRef.current = null;
          // Superseded check: If a newer load was started, drop and deepDispose this one
          if (currentLoadId !== vrmLoadSeqRef.current) {
            try {
              VRMUtils.deepDispose?.(gltf.scene);
            } catch (_) {}
            return;
          }

          try {
            const vrm = gltf.userData.vrm;
            if (!vrm) {
              console.warn('[DateMode] Loaded model does not contain VRM data:', gltf);
              return;
            }

            // Cleanly remove and dispose any existing VRM before mounting the new one
            if (vrmAnimationMixerRef.current) {
              try {
                vrmAnimationMixerRef.current.stopAllAction();
              } catch (_) {}
              vrmAnimationMixerRef.current = null;
            }
            vrmLocomotionActionsRef.current = {};
            if (vrmRef.current?.scene) {
              try {
                scene.remove(vrmRef.current.scene);
                VRMUtils.deepDispose?.(vrmRef.current.scene);
              } catch (_) {}
              vrmRef.current = null;
            }
            if (sceneObjectsRef.current.yuki) {
              try {
                scene.remove(sceneObjectsRef.current.yuki);
              } catch (_) {}
              sceneObjectsRef.current.yuki = null;
            }

            vrmRef.current = vrm;
            scene.add(vrm.scene);
            sceneObjectsRef.current.yuki = vrm.scene;

            const extensionsUsed = gltf.parser?.json?.extensionsUsed || [];
            const isVRM1 = extensionsUsed.some(ext => ext.includes('VRMC_vrm'));
            vrm.isVRM1 = isVRM1;

            try {
              if (typeof VRMUtils.removeUnnecessaryVertices === 'function') {
                VRMUtils.removeUnnecessaryVertices(vrm.scene);
              }
              if (typeof VRMUtils.removeUnnecessaryJoints === 'function') {
                VRMUtils.removeUnnecessaryJoints(vrm.scene);
              }
            } catch (err) {
              console.warn("[DateMode] VRMUtils optimization note:", err);
            }

            // Position Yuki sitting naturally on the chair cushion across the table
            const yObj = devConfigRef.current?.objects?.yuki || DEFAULT_DATE_CONFIG.objects.yuki;
            vrm.scene.position.set(yObj.posX ?? 0, yObj.posY ?? 0.68, yObj.posZ ?? -0.2);
            vrm.scene.scale.set(yObj.scaleX ?? yObj.scale ?? 1.12, yObj.scaleY ?? yObj.scale ?? 1.12, yObj.scaleZ ?? yObj.scale ?? 1.12);
            const yRot = yObj.rotY ?? 178;
            vrm.scene.rotation.y = isVRM1 ? ((yRot - 180) * Math.PI / 180) : (yRot * Math.PI / 180);

            vrm.scene.traverse((child) => {
              child.frustumCulled = false;
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                  const materials = Array.isArray(child.material) ? child.material : [child.material];
                  materials.forEach((mat) => {
                    if (mat.transparent || (mat.alphaTest !== undefined && mat.alphaTest > 0)) {
                      mat.alphaToCoverage = true;
                      mat.needsUpdate = true;
                    }
                  });
                }
              }
            });

            // Initial pleasant expression using multi-version fallback
            try {
              setExpressionValue(vrm, 'happy', 0.20);
              setExpressionValue(vrm, 'relaxed', 0.30);
            } catch (e) {
              console.warn('[DateMode] Initial expression setup note:', e);
            }

            // Initialize AnimationMixer for companion locomotion animations
            try {
              if (vrm.lookAt && !vrm.scene.children.some((obj) => obj instanceof VRMLookAtQuaternionProxy)) {
                const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
                proxy.name = 'VRMLookAtQuaternionProxy';
                vrm.scene.add(proxy);
              }

              const mixer = new THREE.AnimationMixer(vrm.scene);
              vrmAnimationMixerRef.current = mixer;
              vrmLocomotionActionsRef.current = {};
              locomotionStateRef.current = 'idle';

              const vrmaLoader = new GLTFLoader();
              vrmaLoader.register((parser) => {
                const plugin = new VRMAnimationLoaderPlugin(parser);
                const origAfterRoot = plugin.afterRoot.bind(plugin);
                plugin.afterRoot = async (gltfAnim) => {
                  const ext = parser.json?.extensions?.VRMC_vrm_animation;
                  if (ext && !ext.specVersion) ext.specVersion = '1.0';
                  return origAfterRoot(gltfAnim);
                };
                return plugin;
              });

              const loadLocomotionClip = (key, animPath) => {
                vrmaLoader.load(animPath, (gltfAnim) => {
                  const vrmAnim = gltfAnim.userData.vrmAnimation || gltfAnim.userData.vrmAnimations?.[0];
                  if (vrmAnim && vrmRef.current === vrm) {
                    const clip = createVRMAnimationClip(vrmAnim, vrm);
                    const action = mixer.clipAction(clip);
                    if (key === 'jump') {
                      action.setLoop(THREE.LoopOnce);
                      action.clampWhenFinished = true;
                    } else {
                      action.setLoop(THREE.LoopRepeat);
                    }
                    vrmLocomotionActionsRef.current[key] = action;
                    if (key === 'idle') {
                      action.play();
                      action.setEffectiveWeight(1.0);
                    }
                  }
                }, undefined, (err) => {
                  console.warn(`[DateMode] Locomotion clip note (${key}):`, err);
                });
              };

              loadLocomotionClip('idle', './animations/idle_utsuwa_1.vrma');
              loadLocomotionClip('walk', './animations/walk.vrma');
              loadLocomotionClip('run', './animations/run.vrma');
              loadLocomotionClip('jump', './animations/joyful_jump.vrma');
            } catch (mixerErr) {
              console.warn('[DateMode] AnimationMixer setup note:', mixerErr);
            }
          } catch (err) {
            console.error('[DateMode] Error processing VRM model:', err);
          } finally {
            setIsInitializing(false);
          }
        },
        undefined,
        (err) => {
          loadingModelUrlRef.current = null;
          console.error('[DateMode] Error loading VRM model from:', url, err);
          setIsInitializing(false);
        }
      );
    };

    loadVrmModelRef.current = loadVrmModel;

    // Fetch user's active model from profile or fallback to default
    fetch(`${API_BASE}/api/profile`)
      .then((r) => r.json())
      .then((prof) => {
        const modelName = prof?.settings?.active_vrm_model || 'default.vrm';
        if (activeModelNameRef.current === modelName && (vrmRef.current || loadingModelUrlRef.current)) {
          return;
        }
        const modelUrl = `${API_BASE}/api/models/vrm/files/${encodeURIComponent(modelName)}?t=${Date.now()}`;
        loadVrmModel(modelUrl, modelName);
      })
      .catch((err) => {
        console.warn('[DateMode] Profile fetch error, falling back to default.vrm:', err);
        if (vrmRef.current || loadingModelUrlRef.current) return;
        const fallbackUrl = `${API_BASE}/api/models/vrm/files/default.vrm?t=${Date.now()}`;
        loadVrmModel(fallbackUrl, 'default.vrm');
      });

    // ------------------------------------------------------------------------
    // 6. FIRST-PERSON MOUSE LOOK & ANIMATION RENDER LOOP
    // ------------------------------------------------------------------------
    const clock = new THREE.Clock();
    let physicsAccumulator = 0;
    const physicsDelta = 1.0 / 60.0; // Fixed 60Hz physics tick

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
      mousePosRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1
      };

      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        dragStartRef.current = { x: e.clientX, y: e.clientY };

        const SENSITIVITY = 0.0035;
        targetYawRef.current -= dx * SENSITIVITY;
        targetPitchRef.current = THREE.MathUtils.clamp(
          targetPitchRef.current - dy * SENSITIVITY,
          -0.75,
          0.75
        );
      }
    };

    const handleMouseUp = (e) => {
      isDraggingRef.current = false;
      setIsDragging(false);

      // Dev Mode 3D Object Click-to-Select via Raycasting
      if (devModeRef.current && canvasRef.current && cameraRef.current && sceneRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x;
        const dy = e.clientY - mouseDownPosRef.current.y;
        const dist = Math.hypot(dx, dy);

        // Click detection threshold (< 6 pixels of movement)
        if (dist < 6) {
          const rect = canvasRef.current.getBoundingClientRect();
          const mouseNorm = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
          );

          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(mouseNorm, cameraRef.current);

          const targets = Object.values(sceneObjectsRef.current).filter(Boolean);
          const intersects = raycaster.intersectObjects(targets, true);

          if (intersects.length > 0) {
            const hitKey = findSelectableAncestor(intersects[0].object, sceneObjectsRef.current);
            if (hitKey) {
              setSelectedObjectId(hitKey);
              setDevTab('objects');
            }
          }
        }
      }
    };

    const handleDoubleClick = () => {
      targetYawRef.current = 0;
      targetPitchRef.current = 0;
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Promenade First-Person Walking & Running Controls (WASD, Arrow Keys, Shift Sprint & Space Jump)
    const activeKeys = new Set();
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) {
        if (e.code === 'Space') {
          e.preventDefault();
        }
        activeKeys.add(e.code);
      }
    };
    const handleKeyUp = (e) => {
      activeKeys.delete(e.code);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Persistent Expression State, Eyebrows & Procedural Wink
    let currentHappy = 0.20;
    let currentRelaxed = 0.30;
    let currentSurprised = 0.0;
    let currentAngry = 0.0;
    let currentSad = 0.0;
    let currentBrowUp = 0.0;
    let currentBrowDown = 0.0;

    let winkStage = 'idle';
    let winkVal = 0.0;
    let winkProgress = 0;
    let winkHoldTimer = 0;

    let smoothedAa = 0;
    let smoothedIh = 0;
    let smoothedOu = 0;
    let smoothedEe = 0;
    let smoothedOh = 0;

    let blinkTimer = 0;
    let blinkProgress = 0;
    let isBlinking = false;
    let nextBlinkInterval = 3.5;
    const blinkDuration = 0.22;

    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsedTime = clock.getElapsedTime();

      // Dynamic RGB Keyboard Color Waves on Skyscraper Landmarks
      if (rgbMaterialsRef.current?.length > 0) {
        const t = elapsedTime;
        rgbMaterialsRef.current.forEach(({ mat, name }) => {
          if (!mat) return;
          if (name.includes('cylinder_neonpink')) {
            const hue = (t * 0.25 + 0.9) % 1.0;
            if (mat.color) mat.color.setHSL(hue, 0.95, 0.55);
            if (mat.emissive) mat.emissive.setHSL(hue, 0.95, 0.55);
          } else if (name.includes('cylinder_neoncyan')) {
            const hue = (t * 0.25 + 0.45) % 1.0;
            if (mat.color) mat.color.setHSL(hue, 0.95, 0.55);
            if (mat.emissive) mat.emissive.setHSL(hue, 0.95, 0.55);
          } else if (name.includes('diamond_truss') || name.includes('diamond_cyan')) {
            const hue = (0.52 + 0.14 * Math.sin(t * 1.2)) % 1.0;
            if (mat.color) mat.color.setHSL(hue, 0.9, 0.6);
            if (mat.emissive) mat.emissive.setHSL(hue, 0.9, 0.6);
          } else if (name.includes('lotus_')) {
            const hue = (0.78 + 0.16 * Math.sin(t * 0.8)) % 1.0;
            if (mat.color) mat.color.setHSL(hue, 0.92, 0.55);
            if (mat.emissive) mat.emissive.setHSL(hue, 0.92, 0.55);
          } else if (name.includes('solar_ring')) {
            const hue = (0.08 + 0.05 * Math.sin(t * 1.5)) % 1.0;
            if (mat.color) mat.color.setHSL(hue, 1.0, 0.55);
            if (mat.emissive) mat.emissive.setHSL(hue, 1.0, 0.55);
          } else if (name.includes('spiralblue')) {
            const pulse = 0.7 + 0.3 * Math.sin(t * 3.0);
            if (mat.color) mat.color.setRGB(0.1 * pulse, 0.85 * pulse, 1.0 * pulse);
            if (mat.emissive) mat.emissive.setRGB(0.1 * pulse, 0.85 * pulse, 1.0 * pulse);
          }
        });
      }

      // 3 Unique Dynamic Waterfront LED Screens (Anime, Commercial Ads, Financial News)
      if (ledScreenAnimRef.current) {
        const t = elapsedTime;
        const { anime, ads, news } = ledScreenAnimRef.current;

        // 1. ANIME / YUKI LIVE CONCERT SCREEN
        if (anime) {
          const { ctx, tex, canvas } = anime;
          const w = canvas.width;
          const h = canvas.height;
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, '#1a0033');
          grad.addColorStop(0.5, '#3b0066');
          grad.addColorStop(1, '#0d001a');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          ctx.fillStyle = '#ff77e9';
          for (let i = 0; i < 15; i++) {
            const sx = (i * 37 + Math.sin(t + i) * 20) % w;
            const sy = (i * 31 + Math.cos(t * 0.8 + i) * 20) % (h - 100);
            ctx.fillRect(sx, sy, 3, 3);
          }

          ctx.fillStyle = '#ff0077';
          ctx.fillRect(0, 0, w, 55);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 26px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('★ PROJECT YUKI LIVE TOUR ★', w / 2, 38);

          const faceY = 160 + Math.sin(t * 4.0) * 8;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(w / 2, faceY, 55, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff3399';
          ctx.beginPath();
          ctx.moveTo(w / 2 - 40, faceY - 35);
          ctx.lineTo(w / 2 - 60, faceY - 75);
          ctx.lineTo(w / 2 - 20, faceY - 50);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(w / 2 + 40, faceY - 35);
          ctx.lineTo(w / 2 + 60, faceY - 75);
          ctx.lineTo(w / 2 + 20, faceY - 50);
          ctx.fill();

          const isBlink = Math.sin(t * 2.5) > 0.92;
          ctx.fillStyle = '#331133';
          if (isBlink) {
            ctx.fillRect(w / 2 - 25, faceY - 5, 14, 3);
            ctx.fillRect(w / 2 + 11, faceY - 5, 14, 3);
          } else {
            ctx.beginPath();
            ctx.arc(w / 2 - 18, faceY - 5, 7, 0, Math.PI * 2);
            ctx.arc(w / 2 + 18, faceY - 5, 7, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = 'rgba(255, 100, 150, 0.6)';
          ctx.beginPath();
          ctx.arc(w / 2 - 30, faceY + 12, 10, 0, Math.PI * 2);
          ctx.arc(w / 2 + 30, faceY + 12, 10, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff3388';
          ctx.font = '28px sans-serif';
          const heartY1 = (h - 120 - ((t * 80) % 200));
          const heartY2 = (h - 120 - (((t + 1) * 80) % 200));
          ctx.fillText('♥', w / 2 - 110, heartY1);
          ctx.fillText('♥', w / 2 + 110, heartY2);

          const numBars = 16;
          const barW = (w - 60) / numBars;
          for (let b = 0; b < numBars; b++) {
            const bh = 30 + Math.abs(Math.sin(t * 6.0 + b * 0.5)) * 90;
            ctx.fillStyle = `hsl(${(t * 50 + b * 15) % 360}, 100%, 65%)`;
            ctx.fillRect(30 + b * barW, h - 60 - bh, barW - 4, bh);
          }

          ctx.fillStyle = '#110022';
          ctx.fillRect(0, h - 45, w, 45);
          ctx.fillStyle = '#00ffff';
          ctx.font = 'bold 20px monospace';
          ctx.textAlign = 'left';
          const lyricX = (w - ((t * 120) % (w + 600)));
          ctx.fillText('♪ KISEKI NO YORU NI • WITH MASTER FOREVER ♪', lyricX, h - 16);

          tex.needsUpdate = true;
        }

        // 2. COMMERCIAL BRAND ADS SCREEN
        if (ads) {
          const { ctx, tex, canvas } = ads;
          const w = canvas.width;
          const h = canvas.height;
          const adCycle = Math.floor(t / 6) % 2;

          if (adCycle === 0) {
            const bgGrad = ctx.createLinearGradient(0, 0, w, h);
            bgGrad.addColorStop(0, '#001a33');
            bgGrad.addColorStop(1, '#000511');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 8; i++) {
              const ly = 120 + i * 28;
              const lx = ((t * 250 + i * 80) % (w + 100)) - 50;
              ctx.beginPath();
              ctx.moveTo(lx, ly);
              ctx.lineTo(lx + 80, ly);
              ctx.stroke();
            }

            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(w / 2 - 120, 230);
            ctx.lineTo(w / 2 - 70, 195);
            ctx.lineTo(w / 2 + 40, 195);
            ctx.lineTo(w / 2 + 110, 230);
            ctx.lineTo(w / 2 + 130, 250);
            ctx.lineTo(w / 2 - 130, 250);
            ctx.closePath();
            ctx.stroke();

            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.arc(w / 2 - 75, 250, 18, 0, Math.PI * 2);
            ctx.arc(w / 2 + 75, 250, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('CYBER HORIZON EV', w / 2, 85);
            ctx.fillStyle = '#00e5ff';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText('THE APEX OF ACCELERATION', w / 2, 120);

            ctx.fillStyle = '#ffaa00';
            ctx.font = 'bold 22px monospace';
            ctx.fillText('0-100 KM/H IN 1.9S • RANGE 1,200KM', w / 2, 330);
          } else {
            const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
            bgGrad.addColorStop(0, '#1f1500');
            bgGrad.addColorStop(0.5, '#3d2c00');
            bgGrad.addColorStop(1, '#0a0700');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, w, h);

            ctx.save();
            ctx.translate(w / 2, 200);
            ctx.rotate(t * 0.5);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, 75, 0, Math.PI * 2);
            ctx.stroke();
            ctx.rotate(-t * 1.2);
            ctx.strokeStyle = '#ff9900';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 50, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 34px serif';
            ctx.textAlign = 'center';
            ctx.fillText('CHRONO QUANTUM', w / 2, 75);
            ctx.fillStyle = '#ffd700';
            ctx.font = 'italic 18px serif';
            ctx.fillText('GENEVA • SHANGHAI • TOKYO', w / 2, 105);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText('TIME IS THE ULTIMATE LUXURY', w / 2, 320);
          }

          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, h - 40, w, 40);
          ctx.fillStyle = '#aaaaaa';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('RESERVE YOUR ALLOCATION AT PUDONG FLAGSHIP', w / 2, h - 15);

          tex.needsUpdate = true;
        }

        // 3. METROPOLIS FINANCIAL & WEATHER NEWS CHANNEL
        if (news) {
          const { ctx, tex, canvas } = news;
          const w = canvas.width;
          const h = canvas.height;

          ctx.fillStyle = '#051025';
          ctx.fillRect(0, 0, w, h);

          ctx.fillStyle = '#cc0022';
          ctx.fillRect(0, 0, w, 55);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 26px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('● LIVE  METROPOLIS NEWS 24', 15, 38);

          const d = new Date();
          const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          ctx.textAlign = 'right';
          ctx.font = 'bold 22px monospace';
          ctx.fillText(timeStr, w - 15, 38);

          ctx.save();
          ctx.translate(110, 160);
          ctx.strokeStyle = '#005588';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 60, 0, Math.PI * 2);
          ctx.arc(0, 0, 40, 0, Math.PI * 2);
          ctx.arc(0, 0, 20, 0, Math.PI * 2);
          ctx.stroke();

          ctx.rotate(t * 2.0);
          const radarGrad = ctx.createLinearGradient(0, 0, 60, 0);
          radarGrad.addColorStop(0, 'rgba(0, 255, 128, 0.6)');
          radarGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = radarGrad;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 60, 0, 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          ctx.textAlign = 'left';
          ctx.fillStyle = '#00ffff';
          ctx.font = 'bold 22px sans-serif';
          ctx.fillText('SHANGHAI 24°C', 190, 135);
          ctx.fillStyle = '#ffffff';
          ctx.font = '16px sans-serif';
          ctx.fillText('Humidity: 62%  Wind: 4 m/s', 190, 162);
          ctx.fillStyle = '#00ff88';
          ctx.fillText('Air Quality: 18 (EXCELLENT)', 190, 188);

          ctx.fillStyle = '#0a1a36';
          ctx.fillRect(15, 230, w - 30, 120);

          ctx.font = 'bold 18px monospace';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('SHCOMP', 25, 260);
          ctx.fillStyle = '#00ff66';
          ctx.fillText('3,482.10 ▲ +1.4%', 130, 260);

          ctx.fillStyle = '#ffffff';
          ctx.fillText('HANGSENG', 25, 292);
          ctx.fillStyle = '#00ff66';
          ctx.fillText('18,920.30 ▲ +1.8%', 130, 292);

          ctx.fillStyle = '#ffffff';
          ctx.fillText('NASDAQ', 25, 324);
          ctx.fillStyle = '#00ff66';
          ctx.fillText('19,240.50 ▲ +0.9%', 130, 324);

          ctx.fillStyle = '#ffd700';
          ctx.fillRect(0, h - 50, w, 50);
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 20px sans-serif';
          const newsText = 'BREAKING: HUANGPU RIVER MIDNIGHT LIGHT FESTIVAL WELCOMES RECORD FLEET • AI COMPANION PROMENADE UNVEILED • ';
          const newsX = (w - ((t * 130) % (w + 800)));
          ctx.fillText(newsText + newsText, newsX, h - 18);

          tex.needsUpdate = true;
        }
      }

      // Flowing river water wave ripples animation
      if (waterMatRef.current?.normalMap) {
        waterMatRef.current.normalMap.offset.x = (elapsedTime * 0.015) % 1.0;
        waterMatRef.current.normalMap.offset.y = (elapsedTime * 0.008) % 1.0;
      }

      // Smooth interpolation for head rotation (Euler YXZ)
      camYawRef.current += (targetYawRef.current - camYawRef.current) * 0.08;
      camPitchRef.current += (targetPitchRef.current - camPitchRef.current) * 0.08;

      // Subtle cursor hover gaze parallax when not dragging
      const subtleGazeYaw = !isDraggingRef.current ? (mousePosRef.current.x * 0.04) : 0;
      const subtleGazePitch = !isDraggingRef.current ? (mousePosRef.current.y * 0.03) : 0;

      const finalYaw = camYawRef.current - subtleGazeYaw;
      const finalPitch = THREE.MathUtils.clamp(camPitchRef.current + subtleGazePitch, -0.75, 0.75);

      camera.rotation.set(finalPitch, finalYaw, 0, 'YXZ');

      // ========================================================================
      // FIRST-PERSON NAVIGATION, AUTONOMOUS FOLLOW AI & GROUND RAYCAST GRAVITY
      // ========================================================================
      const currentDestId = activeDestRef.current || activeDest;
      const isPromenade = currentDestId === 'marine_drive_night';

      // Downward Surface Raycasting Gravity Engine
      const downRaycaster = new THREE.Raycaster();
      const downDir = new THREE.Vector3(0, -1, 0);

      const getGroundHeight = (x, z, currentY = 0) => {
        const colliders = [];
        if (customStageMeshRef.current) colliders.push(customStageMeshRef.current);
        if (floorMeshRef.current) colliders.push(floorMeshRef.current);
        if (colliders.length === 0) return 0.0;

        const rayOrigin = new THREE.Vector3(x, currentY + 2.5, z);
        downRaycaster.set(rayOrigin, downDir);
        downRaycaster.far = 10.0;

        try {
          const hits = downRaycaster.intersectObjects(colliders, true);
          for (let i = 0; i < hits.length; i++) {
            const hit = hits[i];
            if (hit.face && hit.face.normal) {
              const worldNorm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
              if (worldNorm.y > 0.35) {
                return hit.point.y;
              }
            } else {
              return hit.point.y;
            }
          }
        } catch (_) {}
        return 0.0;
      };

      // Helper for shortest-path angular rotation interpolation
      const lerpAngle = (from, to, t) => {
        let diff = (to - from) % (Math.PI * 2);
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > Math.PI) diff -= Math.PI * 2;
        return from + diff * Math.min(1.0, Math.max(0.0, t));
      };

      // Helper for cross-fading VRMA locomotion clips
      const transitionLocomotion = (newState, speedRatio = 1.0) => {
        const actions = vrmLocomotionActionsRef.current;
        if (!actions) return;
        const curState = locomotionStateRef.current;
        const nextAction = actions[newState];
        if (!nextAction) return;

        if (curState !== newState) {
          const prevAction = actions[curState];
          if (prevAction && prevAction !== nextAction) {
            nextAction.reset();
            nextAction.enabled = true;
            nextAction.setEffectiveTimeScale(speedRatio);
            nextAction.setEffectiveWeight(1.0);
            prevAction.crossFadeTo(nextAction, newState === 'jump' ? 0.12 : 0.25, true);
            nextAction.play();
          } else {
            nextAction.reset();
            nextAction.enabled = true;
            nextAction.setEffectiveTimeScale(speedRatio);
            nextAction.setEffectiveWeight(1.0);
            nextAction.play();
          }
          locomotionStateRef.current = newState;
        } else {
          nextAction.setEffectiveTimeScale(speedRatio);
        }
      };

      if (isPromenade) {
        // 1. Player First-Person Movement with Shift Sprint & Spacebar Jump
        let moveForward = 0;
        let moveSide = 0;
        if (activeKeys.has('KeyW') || activeKeys.has('ArrowUp')) moveForward += 1;
        if (activeKeys.has('KeyS') || activeKeys.has('ArrowDown')) moveForward -= 1;
        if (activeKeys.has('KeyD') || activeKeys.has('ArrowRight')) moveSide += 1;
        if (activeKeys.has('KeyA') || activeKeys.has('ArrowLeft')) moveSide -= 1;

        const isMoving = moveForward !== 0 || moveSide !== 0;
        const isPlayerRunning = isMoving && (activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight'));

        if (isMoving) {
          const playerSpeed = (isPlayerRunning ? 5.0 : 2.0) * delta;
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), finalYaw);
          const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), finalYaw);

          const moveVec = new THREE.Vector3()
            .addScaledVector(forward, moveForward)
            .addScaledVector(right, moveSide)
            .normalize()
            .multiplyScalar(playerSpeed);

          // Boundaries on promenade deck: X in [1.0, 7.2], Z in [-52.0, 52.0]
          camera.position.x = THREE.MathUtils.clamp(camera.position.x + moveVec.x, 1.0, 7.2);
          camera.position.z = THREE.MathUtils.clamp(camera.position.z + moveVec.z, -52.0, 52.0);
        }

        // Spacebar Jump Trigger for Player
        if (activeKeys.has('Space') && playerIsGroundedRef.current) {
          playerVerticalVelRef.current = 5.2;
          playerIsGroundedRef.current = false;

          // Yuki jumps playfully with user if grounded
          if (yukiIsGroundedRef.current && yukiJumpCooldownRef.current <= 0) {
            yukiJumpCooldownRef.current = 0.8;
            setTimeout(() => {
              if (vrmRef.current?.scene && yukiIsGroundedRef.current) {
                yukiVerticalVelRef.current = 4.8;
                yukiIsGroundedRef.current = false;
                transitionLocomotion('jump');
              }
            }, 120);
          }
        }

        // Jump Physics & Ground Raycast Gravity for Player Camera
        const playerFloorY = getGroundHeight(camera.position.x, camera.position.z, camera.position.y - 1.68);
        const baseCamY = playerFloorY + 1.68;

        if (!playerIsGroundedRef.current || playerVerticalVelRef.current > 0) {
          playerVerticalVelRef.current -= 17.0 * delta;
          camera.position.y += playerVerticalVelRef.current * delta;
          if (camera.position.y <= baseCamY) {
            camera.position.y = baseCamY;
            playerVerticalVelRef.current = 0;
            playerIsGroundedRef.current = true;
          }
        } else {
          // Dynamic organic head bob on ground
          const strollFreq = isPlayerRunning ? 13.5 : 8.0;
          const strollAmp = isPlayerRunning ? 0.032 : 0.015;
          const headBob = isMoving ? Math.sin(elapsedTime * strollFreq) * strollAmp : 0;
          const targetCamY = baseCamY + headBob;
          camera.position.y += (targetCamY - camera.position.y) * 0.25;
          playerIsGroundedRef.current = true;
        }

        // 2. Autonomous Companion Follow AI & Locomotion State Machine for Yuki
        if (vrmRef.current?.scene) {
          const vrm = vrmRef.current;
          const isVRM1 = !!vrm.isVRM1;

          // Vertical Gravity & Jump for Yuki
          const yukiFloorY = getGroundHeight(vrm.scene.position.x, vrm.scene.position.z, vrm.scene.position.y);
          if (yukiJumpCooldownRef.current > 0) {
            yukiJumpCooldownRef.current -= delta;
          }

          if (!yukiIsGroundedRef.current || yukiVerticalVelRef.current > 0) {
            yukiVerticalVelRef.current -= 17.0 * delta;
            vrm.scene.position.y += yukiVerticalVelRef.current * delta;
            if (vrm.scene.position.y <= yukiFloorY) {
              vrm.scene.position.y = yukiFloorY;
              yukiVerticalVelRef.current = 0;
              yukiIsGroundedRef.current = true;
            }
          } else {
            vrm.scene.position.y += (yukiFloorY - vrm.scene.position.y) * 0.25;
            yukiIsGroundedRef.current = true;
          }

          // Distance and vector from Yuki to Player (world space, completely independent of mouse look)
          const toPlayerX = camera.position.x - vrm.scene.position.x;
          const toPlayerZ = camera.position.z - vrm.scene.position.z;
          const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);

          // State hysteresis: start following if player moves > 2.5m away; stop when within 1.5m
          if (!yukiIsFollowingRef.current) {
            if (distToPlayer > 2.5) {
              yukiIsFollowingRef.current = true;
            }
          } else {
            if (distToPlayer <= 1.5) {
              yukiIsFollowingRef.current = false;
            }
          }

          let targetLocomotion = 'idle';
          let yukiSpeed = 0.0;
          let speedRatio = 1.0;

          if (!yukiIsGroundedRef.current) {
            targetLocomotion = 'jump';
            speedRatio = 1.0;
          } else if (yukiIsFollowingRef.current && distToPlayer > 1.4) {
            // Companion target point ~1.3m from player along the line to Yuki
            const dirX = toPlayerX / distToPlayer;
            const dirZ = toPlayerZ / distToPlayer;

            const targetX = camera.position.x - dirX * 1.3;
            const targetZ = camera.position.z - dirZ * 1.3;
            const stepX = targetX - vrm.scene.position.x;
            const stepZ = targetZ - vrm.scene.position.z;
            const distToStep = Math.hypot(stepX, stepZ);

            if (distToStep > 0.05) {
              const stepDirX = stepX / distToStep;
              const stepDirZ = stepZ / distToStep;

              if (distToPlayer >= 5.0) {
                if (isExhaustedRef.current) {
                  targetLocomotion = 'walk';
                  yukiSpeed = 2.0;
                  speedRatio = 1.0;
                } else {
                  targetLocomotion = 'run';
                  yukiSpeed = 4.8;
                  speedRatio = 1.0;
                }
              } else if (distToPlayer >= 2.8) {
                targetLocomotion = 'walk';
                yukiSpeed = 3.0;
                speedRatio = 1.35;
              } else {
                targetLocomotion = 'walk';
                yukiSpeed = 1.8;
                speedRatio = 0.9;
              }

              const moveStep = Math.min(distToStep, yukiSpeed * delta);
              vrm.scene.position.x += stepDirX * moveStep;
              vrm.scene.position.z += stepDirZ * moveStep;
              vrm.scene.position.x = THREE.MathUtils.clamp(vrm.scene.position.x, 0.9, 7.1);
              vrm.scene.position.z = THREE.MathUtils.clamp(vrm.scene.position.z, -52.0, 52.0);

              // Turn to face movement direction
              // In VRM 1.0 forward is -Z (0 offset), in VRM 0.0 forward is +Z (+PI offset)
              const moveAngle = Math.atan2(stepDirX, stepDirZ);
              const targetRot = isVRM1 ? moveAngle : moveAngle + Math.PI;
              vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, targetRot, delta * 8.0);
            } else {
              yukiIsFollowingRef.current = false;
              targetLocomotion = 'idle';
            }
          } else {
            // Idle and face player warmly
            targetLocomotion = 'idle';
            yukiSpeed = 0.0;
            speedRatio = 1.0;

            const toPlayerAngle = Math.atan2(toPlayerX, toPlayerZ);
            const targetRot = isVRM1 ? toPlayerAngle : toPlayerAngle + Math.PI;
            vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, targetRot, delta * 4.0);
          }

          // Cross-fade animation clip according to locomotion state
          transitionLocomotion(targetLocomotion, speedRatio);
          vrmAnimationMixerRef.current?.update(delta);

          // 3. Stamina Quota & Fatigue Panting Engine
          if (targetLocomotion === 'run') {
            yukiStaminaRef.current = Math.max(0, yukiStaminaRef.current - delta * 12.0);
          } else if (targetLocomotion === 'walk' && speedRatio > 1.1) {
            yukiStaminaRef.current = Math.max(0, yukiStaminaRef.current - delta * 2.5);
          } else if (targetLocomotion === 'walk') {
            yukiStaminaRef.current = Math.min(100, yukiStaminaRef.current + delta * 3.5);
          } else {
            yukiStaminaRef.current = Math.min(100, yukiStaminaRef.current + delta * 9.0);
          }

          const stam = yukiStaminaRef.current;
          if (stam < 20) {
            if (!isExhaustedRef.current) {
              isExhaustedRef.current = true;
              setIsExhaustedUI(true);
              const now = Date.now();
              if (now - lastDialogueFatigueTimeRef.current > 22000) {
                lastDialogueFatigueTimeRef.current = now;
                setMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    content: "*pants heavily* Haa... haa... Wait for me, Master! You run too fast... I'm out of breath!",
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                ]);
              }
            }
          } else if (stam > 50) {
            if (isExhaustedRef.current) {
              isExhaustedRef.current = false;
              setIsExhaustedUI(false);
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: "*takes a deep breath and smiles* Phew... okay! I caught my breath. Let's keep going!",
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
              ]);
            }
          }

          // Throttle UI update to avoid React render thrashing
          if (elapsedTime - lastStaminaUiUpdateRef.current > 0.22) {
            lastStaminaUiUpdateRef.current = elapsedTime;
            setYukiStaminaUI(Math.round(stam));
          }
        }
      }

      // Flickering romantic candle light
      if (candleLightRef.current) {
        if (candleLit) {
          const flicker = Math.sin(elapsedTime * 8.5) * 0.15 + Math.sin(elapsedTime * 21.3) * 0.08;
          candleLightRef.current.intensity = 2.1 + flicker;
        } else {
          candleLightRef.current.intensity = 0.0;
        }
      }

      // Real-time Stage Props Animation (Cafe Clock & Cloud Drift)
      if (customStageMeshRef.current) {
        // Continuous celestial cloud atmospheric drift
        const clouds = customStageMeshRef.current.getObjectByName('Sky_Clouds_Root');
        if (clouds) {
          clouds.rotation.y += delta * 0.012;
        }

        // Live Clock Hands tracking computer system time
        const hourHand = customStageMeshRef.current.getObjectByName('Clock_Hour_Hand');
        const minHand = customStageMeshRef.current.getObjectByName('Clock_Minute_Hand');
        const secHand = customStageMeshRef.current.getObjectByName('Clock_Second_Hand');
        if (hourHand || minHand || secHand) {
          const now = new Date();
          const ms = now.getMilliseconds();
          const s = now.getSeconds() + ms / 1000;
          const m = now.getMinutes() + s / 60;
          const h = (now.getHours() % 12) + m / 60;

          if (secHand) secHand.rotation.y = -(s / 60) * Math.PI * 2;
          if (minHand) minHand.rotation.y = -(m / 60) * Math.PI * 2;
          if (hourHand) hourHand.rotation.y = -(h / 12) * Math.PI * 2;
        }
      }

      // Real-time river water wave ripple animation
      if (waterMeshRef.current?.material?.uniforms?.['time']) {
        waterMeshRef.current.material.uniforms['time'].value += delta * 0.35;
      }

      // Procedural Wink Animation State Machine
      const curExpr = currentExprRef.current || characterMoodRef.current || 'happy';
      if (curExpr === 'wink') {
        if (winkStage === 'idle') {
          winkStage = 'closing';
          winkProgress = 0;
        } else if (winkStage === 'closing') {
          winkProgress += delta / 0.50;
          const t = Math.min(1.0, winkProgress);
          winkVal = t * t * (3 - 2 * t);
          if (winkProgress >= 1.0) {
            winkStage = 'holding';
            winkHoldTimer = 0;
          }
        } else if (winkStage === 'holding') {
          winkVal = 1.0;
          winkHoldTimer += delta;
          if (winkHoldTimer >= 0.75) {
            winkStage = 'opening';
            winkProgress = 0;
          }
        } else if (winkStage === 'opening') {
          winkProgress += delta / 0.45;
          const t = Math.min(1.0, winkProgress);
          winkVal = 1.0 - (t * t * (3 - 2 * t));
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

      // Dynamic Mood Expression Target Calculation
      let targetHappy = 0.18;
      let targetRelaxed = 0.28;
      let targetSurprised = 0.0;
      let targetAngry = 0.0;
      let targetSad = 0.0;
      let targetBrowUp = 0.0;
      let targetBrowDown = 0.0;

      if (curExpr && curExpr !== 'neutral') {
        const emotionDef = EMOTIONS[curExpr];
        if (curExpr === 'wink') {
          targetRelaxed = 0.55;
          targetHappy = 0.20;
          targetBrowUp = 0.12;
        } else if (curExpr === 'smug') {
          targetHappy = 0.0;
          targetRelaxed = 0.85;
          targetBrowUp = 0.16;
        } else if (curExpr === 'happy') {
          targetHappy = 0.35;
          targetRelaxed = 0.70;
          targetBrowUp = 0.15;
        } else if (curExpr === 'embarrassed' || curExpr === 'blush') {
          targetHappy = 0.30;
          targetRelaxed = 0.40;
          targetBrowDown = 0.20;
          targetBrowUp = 0.15;
        } else if (emotionDef && emotionDef.blendShapes) {
          const bs = emotionDef.blendShapes;
          targetHappy = bs.happy || 0.0;
          targetSad = bs.sad || 0.0;
          targetAngry = bs.angry || 0.0;
          targetSurprised = bs.surprised || 0.0;
          targetRelaxed = bs.relaxed || 0.0;
          targetBrowUp = (bs.browUp || 0.0) * 0.6;
          targetBrowDown = (bs.browDown || 0.0) * 0.6;
        } else if (curExpr === 'sad') {
          targetSad = 0.75;
          targetBrowDown = 0.30;
        } else if (curExpr === 'angry') {
          targetAngry = 0.75;
          targetBrowDown = 0.45;
        } else if (curExpr === 'surprised') {
          targetSurprised = 0.75;
          targetBrowUp = 0.45;
        } else if (curExpr === 'relaxed') {
          targetRelaxed = 0.75;
          targetBrowUp = 0.08;
        }
      }

      // Organic emotion decay: ease back toward warm resting smile after conversation pause
      const timeSinceDialogue = Date.now() - lastDialogueTimeRef.current;
      if (turnFinishedRef.current && timeSinceDialogue > 4500) {
        const decayProgress = Math.min(1.0, (timeSinceDialogue - 4500) / 2500);
        targetHappy = THREE.MathUtils.lerp(targetHappy, 0.18, decayProgress);
        targetRelaxed = THREE.MathUtils.lerp(targetRelaxed, 0.28, decayProgress);
        targetSad = THREE.MathUtils.lerp(targetSad, 0.0, decayProgress);
        targetAngry = THREE.MathUtils.lerp(targetAngry, 0.0, decayProgress);
        targetSurprised = THREE.MathUtils.lerp(targetSurprised, 0.0, decayProgress);
        targetBrowUp = THREE.MathUtils.lerp(targetBrowUp, 0.0, decayProgress);
        targetBrowDown = THREE.MathUtils.lerp(targetBrowDown, 0.0, decayProgress);
      }

      const exprSpeed = 5.5;
      currentHappy += (targetHappy - currentHappy) * delta * exprSpeed;
      currentRelaxed += (targetRelaxed - currentRelaxed) * delta * exprSpeed;
      currentSurprised += (targetSurprised - currentSurprised) * delta * exprSpeed;
      currentAngry += (targetAngry - currentAngry) * delta * exprSpeed;
      currentSad += (targetSad - currentSad) * delta * exprSpeed;
      currentBrowUp += (targetBrowUp - currentBrowUp) * delta * exprSpeed;
      currentBrowDown += (targetBrowDown - currentBrowDown) * delta * exprSpeed;

      // Audio & Viseme Analysis (Strict Kokoro Phonetic Lip-Sync + 4-Band Formant Fallback)
      const audioEl = persistentAudioRef.current;
      const isAudioActive = isAudioPlayingRef.current && audioEl && !audioEl.paused && !audioEl.ended;

      let normalizedVol = 0;
      let targetAa = 0, targetIh = 0, targetOu = 0, targetEe = 0, targetOh = 0;
      let hasActiveCue = false;

      if (isAudioActive && analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const avg = sum / bufferLength;
        normalizedVol = Math.min(1.0, (avg / 128.0) * 1.6);
        audioLevelRef.current = normalizedVol;

        const getBandEnergy = (startBin, endBin) => {
          let bSum = 0;
          const start = Math.max(0, startBin);
          const end = Math.min(dataArray.length, endBin);
          for (let i = start; i < end; i++) bSum += dataArray[i];
          return (bSum / (Math.max(1, end - start) * 255.0));
        };

        const currentVisemes = currentVisemesRef.current;
        const curTime = audioEl.currentTime || 0;
        let activeCue = null;
        let nextCue = null;

        if (currentVisemes && currentVisemes.length > 0) {
          for (let i = 0; i < currentVisemes.length; i++) {
            const cue = currentVisemes[i];
            if (curTime >= cue.start && curTime <= cue.end) {
              activeCue = cue;
              nextCue = (i + 1 < currentVisemes.length) ? currentVisemes[i + 1] : null;
              break;
            }
          }
        }

        if (activeCue) {
          hasActiveCue = true;
          const v = activeCue.viseme;
          const w = activeCue.weight;
          const energyFactor = w > 0 ? Math.min(1.20, Math.max(0.40, normalizedVol * 1.85)) : 0.0;
          const effectiveW = w * energyFactor;

          if (v === 'aa') targetAa = effectiveW;
          else if (v === 'ih') targetIh = effectiveW;
          else if (v === 'ou') targetOu = effectiveW;
          else if (v === 'ee') targetEe = effectiveW;
          else if (v === 'oh') targetOh = effectiveW;

          const cueDur = Math.max(0.04, activeCue.end - activeCue.start);
          const fadeWindow = Math.min(0.055, cueDur * 0.40);
          const remaining = activeCue.end - curTime;
          if (nextCue && remaining < fadeWindow) {
            const rawBlend = Math.max(0, Math.min(1, (fadeWindow - remaining) / fadeWindow));
            const blend = rawBlend * rawBlend * (3 - 2 * rawBlend); // Smoothstep S-curve
            const lerp = (a, b, t) => a + (b - a) * t;
            const nv = nextCue.viseme;
            const nw = nextCue.weight * (nextCue.weight > 0 ? energyFactor : 0.0);
            if (nv === 'aa') targetAa = lerp(targetAa, nw, blend);
            else if (nv === 'ih') targetIh = lerp(targetIh, nw, blend);
            else if (nv === 'ou') targetOu = lerp(targetOu, nw, blend);
            else if (nv === 'ee') targetEe = lerp(targetEe, nw, blend);
            else if (nv === 'oh') targetOh = lerp(targetOh, nw, blend);
          }
        } else {
          // 4-band acoustic formant analysis fallback
          const bF1 = getBandEnergy(2, 5);       // Jaw opening (aa)
          const bF2Low = getBandEnergy(6, 9);    // Back rounded (ou, oh)
          const bF2High = getBandEnergy(10, 16); // Front spread (ih, ee)
          const bSib = getBandEnergy(21, 46);    // Sibilance / consonants

          if (normalizedVol > 0.02) {
            const isConsonant = (bSib > 0.07) && (bSib > bF1 * 0.82);
            if (isConsonant) {
              targetAa = Math.min(0.04, bF1 * 0.12);
              targetIh = Math.min(0.18, bSib * 1.2);
              targetEe = 0.03;
              targetOu = 0.0;
              targetOh = 0.0;
            } else {
              const f1Net = Math.max(0, bF1 - 0.035);
              targetAa = Math.min(0.36, f1Net * 1.4);
              const f2Spread = Math.max(0, bF2High - (bF2Low * 0.65));
              targetIh = Math.min(0.30, f2Spread * 1.5);
              const f2Round = Math.max(0, bF2Low - 0.03);
              targetOh = Math.min(0.26, f2Round * 1.3);
              targetOu = Math.min(0.22, Math.max(0, bF2Low - bF2High) * 1.3);
              targetEe = Math.min(0.24, (targetAa * 0.35) + (targetIh * 0.65));
            }
          }
        }

        const attackRate = hasActiveCue ? 19.0 : 34.0;
        const decayRate = hasActiveCue ? 13.0 : 16.0;
        const smoothViseme = (curr, target) => {
          const rate = target > curr ? attackRate : decayRate;
          return curr + (target - curr) * Math.min(1.0, delta * rate);
        };

        smoothedAa = smoothViseme(smoothedAa, targetAa);
        smoothedIh = smoothViseme(smoothedIh, targetIh);
        smoothedOu = smoothViseme(smoothedOu, targetOu);
        smoothedEe = smoothViseme(smoothedEe, targetEe);
        smoothedOh = smoothViseme(smoothedOh, targetOh);

        visemeLevelsRef.current = {
          aa: smoothedAa,
          ih: smoothedIh,
          ou: smoothedOu,
          ee: smoothedEe,
          oh: smoothedOh,
          intensity: normalizedVol
        };
      } else {
        audioLevelRef.current = 0;
        smoothedAa = 0;
        smoothedIh = 0;
        smoothedOu = 0;
        smoothedEe = 0;
        smoothedOh = 0;
        visemeLevelsRef.current = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, intensity: 0 };
      }

      // VRM Update: Seated Dining Pose, Breathing, Eye Tracking & Strict Kokoro Lip-Sync Parity
      if (vrmRef.current) {
        const vrm = vrmRef.current;
        const isVRM1 = !!vrm.isVRM1;
        const xMult = isVRM1 ? -1 : 1;
        const zMult = isVRM1 ? -1 : 1;

        const activePose = devConfigRef.current?.avatarPose || DEFAULT_DATE_CONFIG.avatarPose;
        const lLegPose = activePose?.leftLeg || DEFAULT_DATE_CONFIG.avatarPose.leftLeg;
        const rLegPose = activePose?.rightLeg || DEFAULT_DATE_CONFIG.avatarPose.rightLeg;
        const torsoPose = activePose?.torso || DEFAULT_DATE_CONFIG.avatarPose.torso;
        const headPose = activePose?.head || DEFAULT_DATE_CONFIG.avatarPose.head;
        const hipsPose = activePose?.hips || DEFAULT_DATE_CONFIG.avatarPose.hips;
        const lPose = activePose?.leftArm || DEFAULT_DATE_CONFIG.avatarPose.leftArm;
        const rPose = activePose?.rightArm || DEFAULT_DATE_CONFIG.avatarPose.rightArm;

        // Apply seated dining posture on humanoid bones only when NOT in promenade stroll
        if (!isPromenade) {
          const leftUpperLeg = getBoneNode(vrm, 'leftUpperLeg');
          const rightUpperLeg = getBoneNode(vrm, 'rightUpperLeg');
          const leftLowerLeg = getBoneNode(vrm, 'leftLowerLeg');
          const rightLowerLeg = getBoneNode(vrm, 'rightLowerLeg');

          if (leftUpperLeg) leftUpperLeg.rotation.set((lLegPose.upperPitch ?? 1.45) * xMult, lLegPose.upperYaw ?? 0.04, (lLegPose.upperRoll ?? -0.05) * zMult);
          if (rightUpperLeg) rightUpperLeg.rotation.set((rLegPose.upperPitch ?? 1.45) * xMult, rLegPose.upperYaw ?? -0.04, (rLegPose.upperRoll ?? 0.05) * zMult);
          if (leftLowerLeg) leftLowerLeg.rotation.set((lLegPose.lowerFlex ?? -1.48) * xMult, lLegPose.lowerTwist ?? 0, 0);
          if (rightLowerLeg) rightLowerLeg.rotation.set((rLegPose.lowerFlex ?? -1.48) * xMult, rLegPose.lowerTwist ?? 0, 0);

          const leftFoot = getBoneNode(vrm, 'leftFoot');
          const rightFoot = getBoneNode(vrm, 'rightFoot');
          if (leftFoot) leftFoot.rotation.set((lLegPose.footPitch ?? 0.12) * xMult, lLegPose.footYaw ?? 0, (lLegPose.footRoll ?? 0) * zMult);
          if (rightFoot) rightFoot.rotation.set((rLegPose.footPitch ?? 0.12) * xMult, rLegPose.footYaw ?? 0, (rLegPose.footRoll ?? 0) * zMult);

          // Hips & Pelvis Position Offset and Rotation
          const hips = getBoneNode(vrm, 'hips');
          if (hips) {
            if (!hips.userData.initialPosition) {
              hips.userData.initialPosition = hips.position.clone();
            }
            const initPos = hips.userData.initialPosition;
            hips.position.set(
              initPos.x + (hipsPose.posX ?? 0),
              initPos.y + (hipsPose.posY ?? 0),
              initPos.z + (hipsPose.posZ ?? 0)
            );
            hips.rotation.set(
              (hipsPose.rotPitch ?? 0) * xMult,
              (hipsPose.rotYaw ?? 0),
              (hipsPose.rotRoll ?? 0) * zMult
            );
          }
        }

        // Seated Procedural Gestures Evaluation
        let gestureNeckPitch = 0;
        let gestureNeckYaw = 0;
        let gestureNeckRoll = 0;
        let gestureHeadPitch = 0;
        let gestureHeadYaw = 0;
        let gestureHeadRoll = 0;
        let gestureSpinePitch = 0;
        let gestureChestPitch = 0;

        if (activeGestureRef.current) {
          const g = activeGestureRef.current;
          const elapsed = (Date.now() - g.startTime) / 1000;
          const progress = Math.min(1.0, elapsed / g.duration);

          if (progress >= 1.0) {
            activeGestureRef.current = null;
            if (g.type === 'seated_cheers') {
              isToastingRef.current = false;
            }
          } else {
            // Smooth bell envelope: ease in - hold - ease out
            const envelope = Math.sin(progress * Math.PI);

            if (g.type === 'seated_nod') {
              const nodAngle = Math.sin(progress * Math.PI * 2 * 2.0) * 0.12 * envelope;
              gestureNeckPitch = nodAngle * 0.4;
              gestureHeadPitch = nodAngle * 0.6;
            } else if (g.type === 'seated_shake') {
              const shakeAngle = Math.sin(progress * Math.PI * 2 * 2.0) * 0.14 * envelope;
              gestureNeckYaw = shakeAngle * 0.4;
              gestureHeadYaw = shakeAngle * 0.6;
            } else if (g.type === 'seated_shy') {
              gestureNeckRoll = 0.08 * envelope;
              gestureHeadRoll = 0.08 * envelope;
              gestureHeadPitch = -0.06 * envelope;
              gestureHeadYaw = 0.09 * envelope;
            } else if (g.type === 'seated_laugh') {
              const giggleBounce = Math.sin(progress * Math.PI * 2 * 6.5) * 0.04 * envelope;
              gestureHeadPitch = giggleBounce * 0.3;
              gestureChestPitch = giggleBounce * 0.2;
            } else if (g.type === 'seated_sleepy') {
              gestureNeckPitch = -0.12 * envelope;
              gestureHeadPitch = -0.10 * envelope;
              gestureNeckRoll = 0.04 * envelope;
            } else if (g.type === 'seated_smug') {
              gestureHeadPitch = 0.08 * envelope;
              gestureHeadRoll = -0.06 * envelope;
            } else if (g.type === 'seated_lean_in') {
              gestureSpinePitch = 0.08 * envelope;
              gestureChestPitch = 0.04 * envelope;
            } else if (g.type === 'seated_cheers') {
              isToastingRef.current = progress < 0.85;
            }
          }
        }

        if (isPromenade) {
          // In promenade stroll, AnimationMixer drives spine, chest, arms, and legs.
          // Add heavy panting heave to chest & spine when exhausted
          if (isExhaustedRef.current) {
            const chest = getBoneNode(vrm, 'chest');
            const spine = getBoneNode(vrm, 'spine');
            const pantHeave = Math.sin(elapsedTime * 13.5) * 0.04;
            if (chest) chest.rotation.x += pantHeave * xMult;
            if (spine) spine.rotation.x += (pantHeave * 0.6) * xMult;
          }
        } else {
          // Upper body natural breathing & seated gestures
          const spine = getBoneNode(vrm, 'spine');
          const chest = getBoneNode(vrm, 'chest');
          const neck = getBoneNode(vrm, 'neck');
          const head = getBoneNode(vrm, 'head');

          if (spine) {
            spine.rotation.set(
              ((torsoPose.spinePitch ?? -0.04) + Math.sin(elapsedTime * 1.8) * 0.012 + gestureSpinePitch) * xMult,
              (torsoPose.spineYaw ?? 0),
              ((torsoPose.spineRoll ?? 0) + Math.sin(elapsedTime * 0.9) * 0.005) * zMult
            );
          }
          if (chest) {
            chest.rotation.set(
              ((torsoPose.chestPitch ?? -0.02) + Math.sin(elapsedTime * 1.8) * 0.008 + gestureChestPitch) * xMult,
              (torsoPose.chestYaw ?? 0),
              (torsoPose.chestRoll ?? 0) * zMult
            );
          }
          if (neck) {
            neck.rotation.set(
              ((headPose.neckPitch ?? 0) + gestureNeckPitch) * xMult,
              (headPose.neckYaw ?? 0) + gestureNeckYaw,
              ((headPose.neckRoll ?? 0) + gestureNeckRoll) * zMult
            );
          }
          if (head) {
            head.rotation.set(
              ((headPose.headPitch ?? 0) + gestureHeadPitch) * xMult,
              (headPose.headYaw ?? 0) + gestureHeadYaw,
              ((headPose.headRoll ?? 0) + gestureHeadRoll) * zMult
            );
          }

          // Arms & Hands: Seated dining pose fine-tuning / raising for cheers
          const leftUpperArm = getBoneNode(vrm, 'leftUpperArm');
          const leftLowerArm = getBoneNode(vrm, 'leftLowerArm');
          const leftHand = getBoneNode(vrm, 'leftHand');
          const rightUpperArm = getBoneNode(vrm, 'rightUpperArm');
          const rightLowerArm = getBoneNode(vrm, 'rightLowerArm');
          const rightHand = getBoneNode(vrm, 'rightHand');

          if (leftUpperArm) leftUpperArm.rotation.set((lPose.upperPitch ?? 0.70) * xMult, lPose.upperYaw ?? 0.15, (lPose.upperRoll ?? 0.90) * zMult);
          if (leftLowerArm) leftLowerArm.rotation.set((lPose.lowerFlex ?? 0.95) * xMult, lPose.lowerTwist ?? -0.15, (lPose.lowerAngle ?? 0.35) * zMult);
          if (leftHand) leftHand.rotation.set((lPose.handPitch ?? 0.0) * xMult, lPose.handYaw ?? 0.0, (lPose.handRoll ?? 0.0) * zMult);

          if (isToastingRef.current) {
            if (rightUpperArm) rightUpperArm.rotation.set(0.95 * xMult, -0.30, -0.45 * zMult);
            if (rightLowerArm) rightLowerArm.rotation.set(0.85 * xMult, 0.20, 0.25 * zMult);
            if (rightHand) rightHand.rotation.set(-0.10 * xMult, 0.10, 0.05 * zMult);
          } else {
            if (rightUpperArm) rightUpperArm.rotation.set((rPose.upperPitch ?? 0.70) * xMult, rPose.upperYaw ?? -0.15, (rPose.upperRoll ?? -0.90) * zMult);
            if (rightLowerArm) rightLowerArm.rotation.set((rPose.lowerFlex ?? 0.95) * xMult, rPose.lowerTwist ?? 0.15, (rPose.lowerAngle ?? -0.35) * zMult);
            if (rightHand) rightHand.rotation.set((rPose.handPitch ?? 0.0) * xMult, rPose.handYaw ?? 0.0, (rPose.handRoll ?? 0.0) * zMult);
          }
        }

        // Natural eye contact tracking with player camera
        if (vrm.lookAt) {
          vrm.lookAt.target = camera;
        }

        // Speech Ducking & Lip-Sync Morph Application (Identical parity with AvatarViewer.jsx)
        if (vrm.expressionManager || vrm.blendShapeProxy) {
          const vLevels = visemeLevelsRef.current;
          const aVol = audioLevelRef.current;
          const speaking = isAudioActive && ((aVol > 0.015) || (vLevels && vLevels.intensity > 0.015));

          // Speech Ducking: Attenuate resting mood smile / relaxed mouth morphs while speech is active
          // This prevents jaw stretching and vertex collision between happy and visemes
          const activeSpeechIntensity = (vLevels && vLevels.intensity > 0) ? vLevels.intensity : Math.min(1.0, aVol * 1.5);
          const speechDampen = speaking ? Math.max(0.08, 1.0 - (activeSpeechIntensity * 0.90)) : 1.0;

          const finalHappy = Math.max(0, Math.min(1, currentHappy * speechDampen));
          const finalRelaxed = Math.max(0, Math.min(1, currentRelaxed * speechDampen));

          setExpressionValue(vrm, 'happy', finalHappy);
          setExpressionValue(vrm, 'relaxed', finalRelaxed);
          setExpressionValue(vrm, 'surprised', currentSurprised);
          setExpressionValue(vrm, 'angry', currentAngry);
          setExpressionValue(vrm, 'sad', currentSad);
          setExpressionValue(vrm, 'browUp', currentBrowUp);
          setExpressionValue(vrm, 'browDown', currentBrowDown);

          if (speaking) {
            setExpressionValue(vrm, 'aa', THREE.MathUtils.clamp(vLevels.aa || 0, 0, 0.76));
            setExpressionValue(vrm, 'ih', THREE.MathUtils.clamp(vLevels.ih || 0, 0, 0.38));
            setExpressionValue(vrm, 'ou', THREE.MathUtils.clamp(vLevels.ou || 0, 0, 0.56));
            setExpressionValue(vrm, 'ee', THREE.MathUtils.clamp(vLevels.ee || 0, 0, 0.36));
            setExpressionValue(vrm, 'oh', THREE.MathUtils.clamp(vLevels.oh || 0, 0, 0.70));
          } else if (isPromenade && isExhaustedRef.current) {
            // Rhythmic panting mouth opening
            const pantOpen = 0.22 + Math.sin(elapsedTime * 13.5) * 0.16;
            setExpressionValue(vrm, 'aa', pantOpen);
            setExpressionValue(vrm, 'ih', 0);
            setExpressionValue(vrm, 'ou', 0);
            setExpressionValue(vrm, 'ee', 0);
            setExpressionValue(vrm, 'oh', pantOpen * 0.35);
          } else {
            setExpressionValue(vrm, 'aa', 0);
            setExpressionValue(vrm, 'ih', 0);
            setExpressionValue(vrm, 'ou', 0);
            setExpressionValue(vrm, 'ee', 0);
            setExpressionValue(vrm, 'oh', 0);
          }

          // Natural periodic eye blinking & procedural wink coordination
          blinkTimer += delta;
          if (blinkTimer >= nextBlinkInterval) {
            isBlinking = true;
            blinkProgress += delta / blinkDuration;
            if (blinkProgress >= 1.0) {
              isBlinking = false;
              blinkProgress = 0;
              blinkTimer = 0;
              nextBlinkInterval = 3.0 + Math.random() * 4.0;
            }
          }
          const blinkVal = isBlinking ? Math.sin(blinkProgress * Math.PI) : 0.0;

          if (curExpr === 'wink' && winkVal > 0) {
            setExpressionValue(vrm, 'blinkRight', winkVal);
            setExpressionValue(vrm, 'blink', 0);
          } else {
            setExpressionValue(vrm, 'blinkRight', 0);
            setExpressionValue(vrm, 'blink', blinkVal);
          }

          if (typeof vrm.expressionManager?.update === 'function') {
            vrm.expressionManager.update();
          }
        }

        // Fixed 60Hz VRM SpringBone physics tick (eliminates CPU spikes on 144Hz screens)
        physicsAccumulator += delta;
        while (physicsAccumulator >= physicsDelta) {
          vrm.update(physicsDelta);
          physicsAccumulator -= physicsDelta;
        }
      }

      if (boxHelperRef.current) {
        boxHelperRef.current.update();
      }

      renderer.render(scene, camera);
    };

    setSceneReady(true);
    animate();

    return () => {
      setSceneReady(false);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);

      if (boxHelperRef.current) {
        sceneRef.current?.remove(boxHelperRef.current);
        boxHelperRef.current.dispose?.();
        boxHelperRef.current = null;
      }

      // Deep disposal of all Three.js geometries, textures, and renderer
      if (sceneRef.current) {
        sceneRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        });
      }
      vrmLoadSeqRef.current++;
      loadingModelUrlRef.current = null;
      if (vrmRef.current?.scene) {
        VRMUtils.deepDispose(vrmRef.current.scene);
      }
      if (pmremGeneratorRef.current) {
        pmremGeneratorRef.current.dispose();
        pmremGeneratorRef.current = null;
      }
      if (currentEnvTextureRef.current) {
        currentEnvTextureRef.current.dispose();
        currentEnvTextureRef.current = null;
      }
      renderer.dispose();
    };
  }, [gpuCheck]);

  // Schedule initial proactive check after 3D scene finishes initializing
  useEffect(() => {
    if (sceneReady) {
      scheduleProactiveDateCheck();
    }
  }, [sceneReady, scheduleProactiveDateCheck]);

  // --------------------------------------------------------------------------
  // TABLETOP INTERACTIVE ACTIONS
  // --------------------------------------------------------------------------
  // 1. Toast / Cheers
  const handleToastCheers = () => {
    playWineClinkSound();
    if (activeDest === 'cute_cafe') {
      setDialogueText("Cheers! Taking a warm sip of coffee with you is my favorite part of the day.");
    } else {
      setDialogueText("Kanpai! Cheers! Here's to us, a wonderful evening, and making more happy memories together!");
    }
    if (vrmRef.current?.expressionManager) {
      vrmRef.current.expressionManager.setValue('happy', 0.85);
      vrmRef.current.expressionManager.setValue('surprised', 0.2);
    }
    isToastingRef.current = true;
    setTimeout(() => {
      isToastingRef.current = false;
      if (vrmRef.current?.expressionManager) {
        vrmRef.current.expressionManager.setValue('happy', 0.4);
        vrmRef.current.expressionManager.setValue('surprised', 0.0);
      }
    }, 2400);
  };

  // 2. Feed Dessert Interaction
  const handleFeedDessert = () => {
    setDialogueText("Mmm! That's so sweet and delicious! Ah, wait... did you feed me? That's so embarrassing, but thank you!");
    if (vrmRef.current?.expressionManager) {
      vrmRef.current.expressionManager.setValue('happy', 0.75);
      vrmRef.current.expressionManager.setValue('aa', 0.28);
      setTimeout(() => {
        if (vrmRef.current?.expressionManager) {
          vrmRef.current.expressionManager.setValue('aa', 0);
          vrmRef.current.expressionManager.setValue('happy', 0.5);
        }
      }, 1500);
    }
  };

  // 3. Candlelight Mode Toggle
  const handleToggleCandle = () => {
    setCandleLit((prev) => {
      const next = !prev;
      setDialogueText(next ? "The warm candle makes everything feel so cozy." : "Dimming the lights makes the skyline shine even brighter...");
      return next;
    });
  };

  // 4. Gaze Eye Contact
  const handleGaze = () => {
    setDialogueText("W-why are you staring at me like that? You're making my heart skip a beat... but don't look away.");
    if (vrmRef.current?.expressionManager) {
      vrmRef.current.expressionManager.setValue('happy', 0.9);
      vrmRef.current.expressionManager.setValue('relaxed', 0.4);
    }
  };

  // 5. Polaroid Photo Shutter
  const handleCapturePolaroid = () => {
    playCameraShutterSound();
    setPolaroidFlash(true);

    setTimeout(() => {
      if (!canvasRef.current) return;
      const webglCanvas = canvasRef.current;

      // Offscreen canvas to composite authentic styled Polaroid border
      const pCanvas = document.createElement('canvas');
      const pWidth = 1200;
      const pHeight = 1450;
      pCanvas.width = pWidth;
      pCanvas.height = pHeight;
      const ctx = pCanvas.getContext('2d');

      // White vintage polaroid card
      ctx.fillStyle = '#f8f8f6';
      ctx.fillRect(0, 0, pWidth, pHeight);

      // Card border drop shadow simulation
      ctx.strokeStyle = '#e0dfdb';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, pWidth - 4, pHeight - 4);

      // Draw 3D scene photo
      const photoWidth = 1080;
      const photoHeight = 1080;
      const photoX = (pWidth - photoWidth) / 2;
      const photoY = 60;
      ctx.drawImage(webglCanvas, photoX, photoY, photoWidth, photoHeight);

      // Bottom handwritten stamp text
      ctx.fillStyle = '#2d2d2d';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      const destTitle = DESTINATIONS[activeDest]?.title || 'Date Night';
      const dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      ctx.fillText(`Yuki AI  •  ${destTitle}  •  ${dateStr}`, pWidth / 2, 1260);

      ctx.fillStyle = '#7a7a7a';
      ctx.font = '24px monospace';
      ctx.fillText('"A memory to cherish forever"', pWidth / 2, 1320);

      // Trigger automatic PNG download
      const link = document.createElement('a');
      link.download = `Yuki_Date_Memory_${Date.now()}.png`;
      link.href = pCanvas.toDataURL('image/png');
      link.click();

      setPolaroidFlash(false);
    }, 150);
  };

  // Chat message submission
  const handleSendMessage = (textToSend = inputText) => {
    const trimmed = (typeof textToSend === 'string' ? textToSend : inputText || '').trim();
    if (!trimmed) return;

    if (proactiveDateTimerRef.current) {
      clearTimeout(proactiveDateTimerRef.current);
      proactiveDateTimerRef.current = null;
    }
    lastDialogueTimeRef.current = Date.now();

    // Interrupt any active voice playback
    stopAllDateAudio();

    setIsThinking(true);
    accumulatedDialogueRef.current = '';
    turnFinishedRef.current = false;
    setDialogueText(`"${trimmed}"`);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const dest = allScenarios[activeDest] || DEFAULT_SCENARIOS['cute_cafe'];
      socketRef.current.send(JSON.stringify({
        type: 'chat',
        message: trimmed,
        is_date_mode: true,
        context_mode: 'date_mode',
        date_setting: {
          id: activeDest,
          title: dest.title,
          subtitle: dest.subtitle,
          atmosphere: dest.subtitle || dest.title,
          custom_prompt: dest.customPrompt || dest.prompt
        }
      }));
    } else {
      console.warn('[DateMode] WebSocket not connected (readyState:', socketRef.current?.readyState, ')');
      setIsThinking(false);
      setDialogueText("I couldn't reach the server just now. Is Yuki's backend active?");
    }
    setInputText('');
  };

  // --------------------------------------------------------------------------
  // DEV MODE TRANSFORM & PARAMETER UPDATERS
  // --------------------------------------------------------------------------
  const updateObjectTransform = (objKey, prop, value) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    setDevConfig((prev) => {
      const curObj = prev.objects[objKey] || {};
      const updated = { ...curObj, [prop]: numVal };
      if (prop === 'scale') {
        updated.scaleX = numVal;
        updated.scaleY = numVal;
        updated.scaleZ = numVal;
      }
      return {
        ...prev,
        objects: {
          ...prev.objects,
          [objKey]: updated
        }
      };
    });

    const targetObj = sceneObjectsRef.current[objKey];
    if (!targetObj) return;

    if (objKey === 'playerPov') {
      if (cameraRef.current) {
        if (prop === 'posX') cameraRef.current.position.x = numVal;
        else if (prop === 'posY') cameraRef.current.position.y = numVal;
        else if (prop === 'posZ') cameraRef.current.position.z = numVal;
        else if (prop === 'fov') cameraRef.current.fov = numVal;
        else if (prop === 'far') cameraRef.current.far = numVal;
        else if (prop === 'rotY') {
          const rad = (numVal * Math.PI) / 180;
          targetYawRef.current = rad;
          camYawRef.current = rad;
        } else if (prop === 'rotX') {
          const rad = (numVal * Math.PI) / 180;
          targetPitchRef.current = rad;
          camPitchRef.current = rad;
        }
        cameraRef.current.updateProjectionMatrix?.();
      }
      setDevConfig((prev) => ({
        ...prev,
        camera: {
          ...prev.camera,
          [prop]: numVal
        },
        objects: {
          ...prev.objects,
          playerPov: {
            ...prev.objects.playerPov,
            [prop]: numVal
          }
        }
      }));
      return;
    }

    if (prop === 'posX') targetObj.position.x = numVal;
    else if (prop === 'posY') targetObj.position.y = numVal;
    else if (prop === 'posZ') targetObj.position.z = numVal;
    else if (prop === 'rotY') targetObj.rotation.y = numVal * (Math.PI / 180);
    else if (prop === 'scale') {
      targetObj.scale.set(numVal, numVal, numVal);
    } else if (prop === 'scaleX') {
      targetObj.scale.x = numVal;
    } else if (prop === 'scaleY') {
      targetObj.scale.y = numVal;
    } else if (prop === 'scaleZ') {
      targetObj.scale.z = numVal;
    }

    targetObj.updateMatrix?.();
    if (boxHelperRef.current) {
      boxHelperRef.current.update();
    }
  };

  const updateLightParam = (lightKey, prop, value) => {
    let processedVal;
    if (prop === 'color') {
      processedVal = normalizeColorHex(value);
    } else {
      const isNum = typeof value === 'number' || !isNaN(parseFloat(value));
      processedVal = isNum ? parseFloat(value) : value;
    }

    setDevConfig((prev) => ({
      ...prev,
      lights: {
        ...prev.lights,
        [lightKey]: {
          ...prev.lights[lightKey],
          [prop]: processedVal
        }
      }
    }));

    if (lightKey === 'ambient') {
      if (prop === 'color' && ambientLightRef.current) ambientLightRef.current.color.set(processedVal);
      if (prop === 'intensity' && ambientLightRef.current) ambientLightRef.current.intensity = processedVal;
    } else if (lightKey === 'keySpot') {
      if (prop === 'color' && spotLightRef.current) spotLightRef.current.color.set(processedVal);
      if (prop === 'intensity' && spotLightRef.current) spotLightRef.current.intensity = processedVal;
      if (prop === 'posX' && spotLightRef.current) spotLightRef.current.position.x = processedVal;
      if (prop === 'posY' && spotLightRef.current) spotLightRef.current.position.y = processedVal;
      if (prop === 'posZ' && spotLightRef.current) spotLightRef.current.position.z = processedVal;
    } else if (lightKey === 'candle') {
      if (prop === 'color' && candleLightRef.current) candleLightRef.current.color.set(processedVal);
      if (prop === 'intensity' && candleLightRef.current) candleLightRef.current.intensity = processedVal;
      if (prop === 'posX' && candleLightRef.current) candleLightRef.current.position.x = processedVal;
      if (prop === 'posY' && candleLightRef.current) candleLightRef.current.position.y = processedVal;
      if (prop === 'posZ' && candleLightRef.current) candleLightRef.current.position.z = processedVal;
    } else if (lightKey === 'mapLights') {
      if (prop === 'intensity') {
        stageLightsRef.current.forEach((l) => {
          const base = l.userData.baseIntensity ?? l.intensity;
          l.intensity = base * processedVal;
        });
      }
    }
  };

  const updateShaderParam = (prop, value) => {
    const isNum = prop === 'exposure' || prop === 'envIntensity';
    const processedVal = isNum ? parseFloat(value) : value;

    setDevConfig((prev) => ({
      ...prev,
      shaders: {
        ...prev.shaders,
        [prop]: processedVal
      }
    }));

    if (prop === 'exposure' && rendererRef.current) {
      rendererRef.current.toneMappingExposure = processedVal;
    } else if (prop === 'envIntensity') {
      if (sceneRef.current) sceneRef.current.environmentIntensity = processedVal;
      if (customStageMeshRef.current) {
        customStageMeshRef.current.traverse((child) => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (m.envMap) {
                m.envMapIntensity = processedVal;
              }
            });
          }
        });
      }
    } else if (prop === 'toneMapping' && rendererRef.current) {
      rendererRef.current.toneMapping = TONE_MAPPINGS[processedVal] || THREE.ACESFilmicToneMapping;
      if (sceneRef.current) {
        sceneRef.current.traverse((child) => {
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => { m.needsUpdate = true; });
          }
        });
      }
    }
  };

  const updateCameraParam = (prop, value) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    setDevConfig((prev) => ({
      ...prev,
      camera: {
        ...prev.camera,
        [prop]: numVal
      },
      objects: {
        ...prev.objects,
        playerPov: {
          ...prev.objects.playerPov,
          [prop]: numVal
        }
      }
    }));

    if (!cameraRef.current) return;
    if (prop === 'fov') {
      cameraRef.current.fov = numVal;
      cameraRef.current.updateProjectionMatrix();
    } else if (prop === 'posX') {
      cameraRef.current.position.x = numVal;
    } else if (prop === 'posY') {
      cameraRef.current.position.y = numVal;
    } else if (prop === 'posZ') {
      cameraRef.current.position.z = numVal;
    } else if (prop === 'rotY') {
      const rad = (numVal * Math.PI) / 180;
      targetYawRef.current = rad;
      camYawRef.current = rad;
    } else if (prop === 'rotX') {
      const rad = (numVal * Math.PI) / 180;
      targetPitchRef.current = rad;
      camPitchRef.current = rad;
    }
  };

  // --------------------------------------------------------------------------
  // LISTENING MODE & IMMERSION (HIDE UI) CONTROLS
  // --------------------------------------------------------------------------
  const handleToggleVoiceInput = useCallback(() => {
    postDateModeMessage({ type: 'toggle_voice_input' });
  }, [postDateModeMessage]);

  const handleToggleListening = handleToggleVoiceInput;

  const handleToggleMuteVoice = useCallback(() => {
    setMuteVoice((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('yuki-mute-voice', String(next));
      } catch (_) {}
      postDateModeMessage({ type: 'toggle_mute_voice', muteVoice: next });
      return next;
    });
  }, [postDateModeMessage]);

  // Listen for voice_state, listening_state, and mute_voice_state updates from App.jsx and request initial state
  useEffect(() => {
    try {
      if (!dateModeChannelRef.current) {
        dateModeChannelRef.current = new BroadcastChannel('yuki_date_mode_channel');
      }
      const dateChannel = dateModeChannelRef.current;
      dateChannel.onmessage = (evt) => {
        if (!evt.data) return;
        if (evt.data.type === 'voice_state') {
          setVoiceState(evt.data);
          setIsListening(Boolean(evt.data.isListening));
          if (evt.data.muteVoice !== undefined) {
            setMuteVoice(Boolean(evt.data.muteVoice));
          }
        } else if (evt.data.type === 'listening_state') {
          const l = Boolean(evt.data.isListening);
          setIsListening(l);
          setVoiceState((prev) => ({ ...prev, isListening: l }));
        } else if (evt.data.type === 'mute_voice_state') {
          setMuteVoice(Boolean(evt.data.muteVoice));
        }
      };
      postDateModeMessage({ type: 'request_voice_state' });
      postDateModeMessage({ type: 'request_listening_state' });
    } catch (_) {}

    return () => {
      try {
        if (dateModeChannelRef.current) {
          dateModeChannelRef.current.close();
          dateModeChannelRef.current = null;
        }
      } catch (_) {}
    };
  }, [postDateModeMessage]);

  // Hotkey listener: 'H' toggles hide/show UI, 'Escape' restores UI
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setIsUiHidden((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (isUiHidden) {
          e.preventDefault();
          setIsUiHidden(false);
        } else if (showScenarioModal) {
          setShowScenarioModal(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUiHidden, showScenarioModal]);

  // --------------------------------------------------------------------------
  // CUSTOM DATE SCENARIO & ASSET MANAGEMENT (3D Stages & 360 Panoramas)
  // --------------------------------------------------------------------------
  const handleOpenScenarioEditor = (scenario = null) => {
    if (scenario) {
      setScenarioForm({
        id: scenario.id,
        type: scenario.type || '3d_model',
        title: scenario.title || '',
        subtitle: scenario.subtitle || '',
        assetUrl: scenario.assetUrl || scenario.bg || '',
        customPrompt: scenario.customPrompt || scenario.prompt || '',
        welcomeDialogue: scenario.welcomeDialogue || '',
        showDefaultTable: scenario.showDefaultTable !== false,
        ambientColor: scenario.ambientColor ?? 0xffeedd,
        ambientIntensity: scenario.ambientIntensity ?? 1.2,
        spotColor: scenario.spotColor ?? 0xffe8c0,
        spotIntensity: scenario.spotIntensity ?? 2.0,
        candleColor: scenario.candleColor ?? 0xffaa44,
        modelTransform: scenario.modelTransform || { posX: 0, posY: -0.2, posZ: 0, rotY: 0, scale: 1.0 },
        waterLevel: scenario.waterLevel ?? (scenario.id === 'marine_drive_night' ? -2.35 : undefined),
        defaultPositions: scenario.defaultPositions || null
      });
      setEditingScenario(scenario.id);
    } else {
      const newId = `custom_map_${Date.now()}`;
      setScenarioForm({
        id: newId,
        type: '3d_model',
        title: 'New Date Scenario',
        subtitle: 'A custom romantic date environment',
        assetUrl: '',
        customPrompt: 'You and Master are on a special date in this custom setting. Yuki is relaxed, romantic, and playful.',
        welcomeDialogue: "I'm so excited to spend time here with you! What should we do first?",
        showDefaultTable: true,
        ambientColor: 0xffeedd,
        ambientIntensity: 1.2,
        spotColor: 0xffe8c0,
        spotIntensity: 2.0,
        candleColor: 0xffaa44,
        modelTransform: { posX: 0, posY: -0.2, posZ: 0, rotY: 0, scale: 1.0 },
        defaultPositions: JSON.parse(JSON.stringify(MAP_POSITION_PRESETS.standard_dining.positions))
      });
      setEditingScenario(null);
    }
    setScenarioModalTab('editor');
    setShowScenarioModal(true);
  };

  const handleCaptureCurrentPositions = () => {
    const currentPositions = {
      camera: {
        fov: devConfigRef.current.camera?.fov ?? 42,
        posX: devConfigRef.current.camera?.posX ?? 0,
        posY: devConfigRef.current.camera?.posY ?? 2.3,
        posZ: devConfigRef.current.camera?.posZ ?? 0.45
      },
      objects: {}
    };
    ['playerPov', 'yuki', 'table', 'chair', 'candleGLB', 'vaseGLB', 'cake', 'herGlass', 'yourGlass', 'floor'].forEach((k) => {
      if (devConfigRef.current.objects?.[k]) {
        currentPositions.objects[k] = { ...devConfigRef.current.objects[k] };
      }
    });
    setScenarioForm((prev) => ({ ...prev, defaultPositions: currentPositions }));
    setMapPositionsToast('Captured current scene positions as map defaults!');
    setTimeout(() => setMapPositionsToast(''), 3000);
  };

  const handleSelectPositionPreset = (presetKey) => {
    const preset = MAP_POSITION_PRESETS[presetKey];
    if (!preset) return;
    setScenarioForm((prev) => ({ ...prev, defaultPositions: JSON.parse(JSON.stringify(preset.positions)) }));
    applyMapPositions(preset.positions);
    setMapPositionsToast(`Applied "${preset.name}" layout!`);
    setTimeout(() => setMapPositionsToast(''), 3000);
  };

  const handleUploadScenarioAsset = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScenarioUploadProgress(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const is3d = ['glb', 'gltf'].includes(ext);

      // Create immediate local object URL
      const localUrl = URL.createObjectURL(file);

      // Upload to backend
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/api/date/assets/upload`, {
        method: 'POST',
        body: formData
      });

      let finalUrl = localUrl;
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) {
          finalUrl = `${API_BASE}${data.url}`;
        }
      }

      setScenarioForm((prev) => ({
        ...prev,
        assetUrl: finalUrl,
        type: is3d ? '3d_model' : 'panorama',
        title: prev.title === 'New Date Scenario' ? file.name.replace(/\.[^/.]+$/, '').replace(/[_0-9-]+/g, ' ').trim() : prev.title
      }));
    } catch (err) {
      console.warn('[DateMode] Asset upload notice:', err);
    } finally {
      setScenarioUploadProgress(false);
    }
  };

  const handleSaveScenario = () => {
    if (!scenarioForm.title.trim()) return;
    const scenarioToSave = {
      ...scenarioForm,
      id: scenarioForm.id || `custom_map_${Date.now()}`
    };

    setCustomScenarios((prev) => {
      const updated = { ...prev, [scenarioToSave.id]: scenarioToSave };
      saveCustomScenarios(updated);
      return updated;
    });

    setActiveDest(scenarioToSave.id);
    if (scenarioToSave.defaultPositions) {
      applyMapPositions(scenarioToSave.defaultPositions);
    }
    if (scenarioToSave.welcomeDialogue) {
      setDialogueText(scenarioToSave.welcomeDialogue);
    }
    setMapPositionsToast(`Saved map "${scenarioToSave.title}" with default positions!`);
    setTimeout(() => setMapPositionsToast(''), 3000);
    setShowScenarioModal(false);
  };

  const handleDeleteScenario = (idToDelete) => {
    if (DEFAULT_SCENARIOS[idToDelete]) return; // Cannot delete built-in defaults
    setCustomScenarios((prev) => {
      const updated = { ...prev };
      delete updated[idToDelete];
      saveCustomScenarios(updated);
      return updated;
    });
    if (activeDest === idToDelete) {
      setActiveDest('cute_cafe');
    }
    setShowScenarioModal(false);
  };

  // Upload and Custom Panorama Management
  const handleUploadCustomBg = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      setCustomBgUrl(dataUrl);
      setCustomBgName(file.name);
      try {
        localStorage.setItem('yuki_date_custom_bg', dataUrl);
        localStorage.setItem('yuki_date_custom_bg_name', file.name);
      } catch (_) {}

      // Apply to Three.js immediately with full texture sharpness
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(dataUrl, (newTex) => {
        newTex.colorSpace = THREE.SRGBColorSpace;
        newTex.minFilter = THREE.LinearFilter;
        newTex.magFilter = THREE.LinearFilter;
        newTex.generateMipmaps = false;
        newTex.wrapS = THREE.RepeatWrapping;
        newTex.wrapT = THREE.ClampToEdgeWrapping;
        newTex.repeat.set(1, bgVerticalScale);
        newTex.offset.set(0, bgVerticalOffset);
        if (rendererRef.current) {
          newTex.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
        }
        newTex.needsUpdate = true;
        if (bgMeshRef.current?.material) {
          if (bgMeshRef.current.material.map) {
            bgMeshRef.current.material.map.dispose();
          }
          bgMeshRef.current.material.map = newTex;
          bgMeshRef.current.material.needsUpdate = true;
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleClearCustomBg = () => {
    setCustomBgUrl(null);
    setCustomBgName('');
    try {
      localStorage.removeItem('yuki_date_custom_bg');
      localStorage.removeItem('yuki_date_custom_bg_name');
    } catch (_) {}

    const dest = DESTINATIONS[activeDest];
    if (dest && bgMeshRef.current) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(dest.bg, (newTex) => {
        newTex.colorSpace = THREE.SRGBColorSpace;
        newTex.minFilter = THREE.LinearFilter;
        newTex.magFilter = THREE.LinearFilter;
        newTex.generateMipmaps = false;
        newTex.wrapS = THREE.RepeatWrapping;
        newTex.wrapT = THREE.ClampToEdgeWrapping;
        newTex.repeat.set(1, bgVerticalScale);
        newTex.offset.set(0, bgVerticalOffset);
        if (rendererRef.current) {
          newTex.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
        }
        newTex.needsUpdate = true;
        if (bgMeshRef.current.material) {
          if (bgMeshRef.current.material.map) {
            bgMeshRef.current.material.map.dispose();
          }
          bgMeshRef.current.material.map = newTex;
          bgMeshRef.current.material.needsUpdate = true;
        }
      });
    }
  };

  const updateBgVerticalFraming = (scale, offset) => {
    const s = typeof scale === 'number' ? scale : parseFloat(scale);
    const o = typeof offset === 'number' ? offset : parseFloat(offset);
    if (!isNaN(s)) setBgVerticalScale(s);
    if (!isNaN(o)) setBgVerticalOffset(o);

    if (bgMeshRef.current?.material?.map) {
      const map = bgMeshRef.current.material.map;
      map.wrapT = THREE.ClampToEdgeWrapping;
      if (!isNaN(s)) map.repeat.y = s;
      if (!isNaN(o)) map.offset.y = o;
      map.needsUpdate = true;
    }
  };

  // Floor Texture Management
  const applyFloorTexture = useCallback((url, repeat = [3, 3], roughness = 0.35, metalness = 0.15) => {
    if (!floorMeshRef.current) return;
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (rendererRef.current) {
        tex.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
      }
      tex.needsUpdate = true;
      if (floorMeshRef.current?.material) {
        if (floorMeshRef.current.material.map) {
          floorMeshRef.current.material.map.dispose();
        }
        floorMeshRef.current.material.map = tex;
        floorMeshRef.current.material.roughness = roughness;
        floorMeshRef.current.material.metalness = metalness;
        floorMeshRef.current.material.needsUpdate = true;
      }
    }, undefined, (err) => {
      console.warn('[DateMode] Error loading floor texture:', err);
    });
  }, []);

  const handleSelectFloorStyle = (styleId) => {
    setFloorStyle(styleId);
    setCustomFloorUrl(null);
    setCustomFloorName('');
    try {
      localStorage.setItem('yuki_date_floor_style', styleId);
      localStorage.removeItem('yuki_date_custom_floor');
      localStorage.removeItem('yuki_date_custom_floor_name');
    } catch (_) {}
    const config = FLOOR_TEXTURES[styleId] || FLOOR_TEXTURES.wood;
    applyFloorTexture(config.url, config.repeat, config.roughness, config.metalness);
  };

  const handleCustomFloorUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      setCustomFloorUrl(dataUrl);
      setCustomFloorName(file.name);
      try {
        localStorage.setItem('yuki_date_custom_floor', dataUrl);
        localStorage.setItem('yuki_date_custom_floor_name', file.name);
      } catch (_) {}
      applyFloorTexture(dataUrl, [3, 3], 0.35, 0.15);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleClearCustomFloor = () => {
    setCustomFloorUrl(null);
    setCustomFloorName('');
    try {
      localStorage.removeItem('yuki_date_custom_floor');
      localStorage.removeItem('yuki_date_custom_floor_name');
    } catch (_) {}
    const config = FLOOR_TEXTURES[floorStyle] || FLOOR_TEXTURES.wood;
    applyFloorTexture(config.url, config.repeat, config.roughness, config.metalness);
  };

  // 1. Reset only the currently selected object back to its initial default
  const handleResetSelectedObject = (objKey = selectedObjectId) => {
    if (!objKey || !DEFAULT_DATE_CONFIG.objects[objKey]) return;
    const defObj = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.objects[objKey]));

    setDevConfig((prev) => ({
      ...prev,
      objects: {
        ...prev.objects,
        [objKey]: defObj
      }
    }));

    if (objKey === 'playerPov') {
      const defCam = DEFAULT_DATE_CONFIG.camera;
      if (cameraRef.current) {
        cameraRef.current.position.set(defCam.posX, defCam.posY, defCam.posZ);
        cameraRef.current.updateProjectionMatrix?.();
      }
      const rotYRad = ((defCam.rotY || 0) * Math.PI) / 180;
      targetYawRef.current = rotYRad;
      camYawRef.current = rotYRad;
      const rotXRad = ((defCam.rotX || 0) * Math.PI) / 180;
      targetPitchRef.current = rotXRad;
      camPitchRef.current = rotXRad;
      setDevConfig((prev) => ({
        ...prev,
        camera: { ...prev.camera, posX: defCam.posX, posY: defCam.posY, posZ: defCam.posZ, rotY: defCam.rotY || 0, rotX: defCam.rotX || 0 }
      }));
      return;
    }

    const targetObj = sceneObjectsRef.current[objKey];
    if (targetObj) {
      targetObj.position.set(defObj.posX, defObj.posY, defObj.posZ);
      targetObj.rotation.y = (defObj.rotY || 0) * (Math.PI / 180);
      const sx = defObj.scaleX ?? defObj.scale ?? 1.0;
      const sy = defObj.scaleY ?? defObj.scale ?? 1.0;
      const sz = defObj.scaleZ ?? defObj.scale ?? 1.0;
      targetObj.scale.set(sx, sy, sz);
      targetObj.updateMatrix?.();
    }

    if (boxHelperRef.current) {
      boxHelperRef.current.update();
    }
  };

  // 2. Reset all objects in the Objects tab back to default
  const handleResetObjectsTab = () => {
    const defObjects = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.objects));
    const defCam = DEFAULT_DATE_CONFIG.camera;
    const rotYRad = ((defCam.rotY || 0) * Math.PI) / 180;
    targetYawRef.current = rotYRad;
    camYawRef.current = rotYRad;
    const rotXRad = ((defCam.rotX || 0) * Math.PI) / 180;
    targetPitchRef.current = rotXRad;
    camPitchRef.current = rotXRad;
    setDevConfig((prev) => ({
      ...prev,
      camera: { ...prev.camera, posX: defCam.posX, posY: defCam.posY, posZ: defCam.posZ, rotY: defCam.rotY || 0, rotX: defCam.rotX || 0 },
      objects: defObjects
    }));

    if (cameraRef.current) {
      cameraRef.current.position.set(defCam.posX, defCam.posY, defCam.posZ);
      cameraRef.current.updateProjectionMatrix?.();
    }

    for (const [key, objDef] of Object.entries(defObjects)) {
      if (key === 'playerPov') continue;
      const obj = sceneObjectsRef.current[key];
      if (obj) {
        obj.position.set(objDef.posX, objDef.posY, objDef.posZ);
        obj.rotation.y = (objDef.rotY || 0) * (Math.PI / 180);
        obj.scale.set(objDef.scaleX ?? objDef.scale, objDef.scaleY ?? objDef.scale, objDef.scaleZ ?? objDef.scale);
        obj.updateMatrix?.();
      }
    }

    if (boxHelperRef.current) {
      boxHelperRef.current.update();
    }
  };

  // 3. Reset all lighting in the Lights tab back to default
  const handleResetLightsTab = () => {
    const defLights = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.lights));
    setDevConfig((prev) => ({
      ...prev,
      lights: defLights
    }));

    if (ambientLightRef.current) {
      ambientLightRef.current.color.set(defLights.ambient.color);
      ambientLightRef.current.intensity = defLights.ambient.intensity;
    }
    if (spotLightRef.current) {
      spotLightRef.current.color.set(defLights.keySpot.color);
      spotLightRef.current.intensity = defLights.keySpot.intensity;
      spotLightRef.current.position.set(defLights.keySpot.posX, defLights.keySpot.posY, defLights.keySpot.posZ);
    }
    if (candleLightRef.current) {
      candleLightRef.current.color.set(defLights.candle.color);
      candleLightRef.current.intensity = defLights.candle.intensity;
      candleLightRef.current.position.set(defLights.candle.posX, defLights.candle.posY, defLights.candle.posZ);
    }
  };

  // 4. Reset shaders, camera, and panorama framing in the Shaders tab back to default
  const handleResetShadersTab = () => {
    const defShaders = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.shaders));
    const defCamera = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.camera));
    const rotYRad = ((defCamera.rotY || 0) * Math.PI) / 180;
    targetYawRef.current = rotYRad;
    camYawRef.current = rotYRad;
    const rotXRad = ((defCamera.rotX || 0) * Math.PI) / 180;
    targetPitchRef.current = rotXRad;
    camPitchRef.current = rotXRad;
    setDevConfig((prev) => ({
      ...prev,
      shaders: defShaders,
      camera: defCamera
    }));

    if (rendererRef.current) {
      rendererRef.current.toneMapping = TONE_MAPPINGS[defShaders.toneMapping] || THREE.ACESFilmicToneMapping;
      rendererRef.current.toneMappingExposure = defShaders.exposure;
    }
    if (cameraRef.current) {
      cameraRef.current.fov = defCamera.fov;
      cameraRef.current.position.set(defCamera.posX, defCamera.posY, defCamera.posZ);
      cameraRef.current.updateProjectionMatrix();
    }
    updateBgVerticalFraming(1.0, 0.0);
  };

  const allPosePresets = useMemo(() => ({
    ...POSE_PRESETS,
    ...customPosePresets
  }), [customPosePresets]);

  // 5. Update avatar pose parameters in real time
  const updateAvatarPose = (part, prop, rawVal) => {
    const val = typeof rawVal === 'number' ? rawVal : parseFloat(rawVal) || 0;
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: {
        ...prev.avatarPose,
        [part]: {
          ...prev.avatarPose?.[part],
          [prop]: Number(val.toFixed(2))
        }
      }
    }));
  };

  // 6. Reset all pose parameters back to default seated posture
  const handleResetPoseTab = () => {
    const defPose = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.avatarPose));
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: defPose
    }));
  };

  // 7. Reset single pose part (head, torso, hips, leftArm, rightArm, leftLeg, rightLeg)
  const handleResetPosePart = (part) => {
    if (!DEFAULT_DATE_CONFIG.avatarPose?.[part]) return;
    const defPart = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.avatarPose[part]));
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: {
        ...prev.avatarPose,
        [part]: defPart
      }
    }));
  };
  const handleResetArm = handleResetPosePart;

  // 8. Mirror arm pose from sourceSide to targetSide
  const mirrorArmPose = (sourceSide, targetSide) => {
    setDevConfig((prev) => {
      const src = prev.avatarPose?.[sourceSide] || DEFAULT_DATE_CONFIG.avatarPose[sourceSide];
      if (!src) return prev;
      return {
        ...prev,
        avatarPose: {
          ...prev.avatarPose,
          [targetSide]: {
            upperPitch: Number(src.upperPitch.toFixed(2)),
            upperYaw: Number((-src.upperYaw).toFixed(2)),
            upperRoll: Number((-src.upperRoll).toFixed(2)),
            lowerFlex: Number(src.lowerFlex.toFixed(2)),
            lowerTwist: Number((-src.lowerTwist).toFixed(2)),
            lowerAngle: Number((-src.lowerAngle).toFixed(2)),
            handPitch: Number(src.handPitch.toFixed(2)),
            handYaw: Number((-src.handYaw).toFixed(2)),
            handRoll: Number((-src.handRoll).toFixed(2))
          }
        }
      };
    });
  };

  // 9. Mirror leg pose from sourceSide to targetSide
  const mirrorLegPose = (sourceSide, targetSide) => {
    setDevConfig((prev) => {
      const src = prev.avatarPose?.[sourceSide] || DEFAULT_DATE_CONFIG.avatarPose[sourceSide];
      if (!src) return prev;
      return {
        ...prev,
        avatarPose: {
          ...prev.avatarPose,
          [targetSide]: {
            upperPitch: Number(src.upperPitch.toFixed(2)),
            upperYaw: Number((-src.upperYaw).toFixed(2)),
            upperRoll: Number((-src.upperRoll).toFixed(2)),
            lowerFlex: Number(src.lowerFlex.toFixed(2)),
            lowerTwist: Number((-src.lowerTwist).toFixed(2)),
            footPitch: Number(src.footPitch.toFixed(2)),
            footYaw: Number((-src.footYaw).toFixed(2)),
            footRoll: Number((-src.footRoll).toFixed(2))
          }
        }
      };
    });
  };

  // 10. Apply pose preset (built-in or user custom)
  const applyPosePreset = (presetId) => {
    const target = allPosePresets[presetId];
    if (!target) return;
    setDevConfig((prev) => {
      const merged = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.avatarPose));
      for (const k in target.pose) {
        merged[k] = { ...merged[k], ...target.pose[k] };
      }
      return {
        ...prev,
        avatarPose: merged
      };
    });
  };

  // 11. Save current pose as a custom user preset
  const handleSaveCustomPosePreset = (name) => {
    const cleanName = (name || '').trim();
    if (!cleanName) return;
    const id = 'custom_pose_' + Date.now();
    const newPreset = {
      id,
      label: cleanName,
      desc: 'Custom user pose',
      isCustom: true,
      pose: JSON.parse(JSON.stringify(devConfig.avatarPose || DEFAULT_DATE_CONFIG.avatarPose))
    };
    setCustomPosePresets((prev) => {
      const updated = { ...prev, [id]: newPreset };
      try {
        localStorage.setItem('yuki_date_custom_pose_presets', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save custom pose preset:', e);
      }
      return updated;
    });
    setCustomPoseSaveSuccess(true);
    setTimeout(() => setCustomPoseSaveSuccess(false), 2200);
    setCustomPoseNameInput('');
    setIsSavingCustomPose(false);
  };

  // 12. Delete custom pose preset
  const handleDeleteCustomPosePreset = (id) => {
    setCustomPosePresets((prev) => {
      const updated = { ...prev };
      delete updated[id];
      try {
        localStorage.setItem('yuki_date_custom_pose_presets', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to delete custom pose preset:', e);
      }
      return updated;
    });
  };

  const handleSaveCurrentAsProfile = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const newId = `profile_${Date.now()}`;
    const newProfile = {
      id: newId,
      name: trimmed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: JSON.parse(JSON.stringify(devConfig))
    };

    const updated = {
      ...savedProfiles,
      [newId]: newProfile
    };

    setSavedProfiles(updated);
    setActiveProfileId(newId);
    try {
      localStorage.setItem('yuki_date_custom_profiles', JSON.stringify(updated));
      localStorage.setItem('yuki_date_active_profile_id', newId);
    } catch (e) {
      console.warn('[DateMode] Failed to save profile:', e);
    }

    setIsSavingProfile(false);
    setProfileNameInput('');
    setProfileSaveSuccess(true);
    setTimeout(() => setProfileSaveSuccess(false), 2200);
  };

  const handleOverwriteCurrentProfile = () => {
    if (activeProfileId === 'default' || !savedProfiles[activeProfileId]) return;
    const cur = savedProfiles[activeProfileId];
    const updatedProfile = {
      ...cur,
      updatedAt: new Date().toISOString(),
      config: JSON.parse(JSON.stringify(devConfig))
    };
    const updated = {
      ...savedProfiles,
      [activeProfileId]: updatedProfile
    };
    setSavedProfiles(updated);
    try {
      localStorage.setItem('yuki_date_custom_profiles', JSON.stringify(updated));
    } catch (e) {
      console.warn('[DateMode] Failed to overwrite profile:', e);
    }
    setProfileSaveSuccess(true);
    setTimeout(() => setProfileSaveSuccess(false), 2200);
  };

  const handleDeleteProfile = (profileId) => {
    if (profileId === 'default') return;
    const updated = { ...savedProfiles };
    delete updated[profileId];
    setSavedProfiles(updated);
    try {
      localStorage.setItem('yuki_date_custom_profiles', JSON.stringify(updated));
    } catch (_) {}

    if (activeProfileId === profileId) {
      handleSelectProfile('default');
    }
  };

  const handleResetAllDefaults = () => {
    handleSelectProfile('default');
  };

  const activeDiff = computeConfigDiff(devConfig, DEFAULT_DATE_CONFIG);
  const modifiedCount = countModifiedFields(activeDiff);

  const baseForActiveProfile = activeProfileId !== 'default' && savedProfiles[activeProfileId]?.config
    ? mergeConfig(DEFAULT_DATE_CONFIG, savedProfiles[activeProfileId].config)
    : DEFAULT_DATE_CONFIG;
  const isProfileModified = countModifiedFields(computeConfigDiff(devConfig, baseForActiveProfile)) > 0;

  const handleCopyDiff = () => {
    const jsonStr = JSON.stringify(activeDiff, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopiedDiff(true);
      setTimeout(() => setCopiedDiff(false), 2200);
    });
  };

  // Recenter first-person camera view
  const handleRecenterView = () => {
    targetYawRef.current = 0;
    targetPitchRef.current = 0;
  };

  // Exit Date Mode and restore Main Window
  const handleExitDateMode = () => {
    if (window.electronAPI?.closeDateWindow) {
      window.electronAPI.closeDateWindow();
    } else {
      window.close();
    }
  };

  const handleResetYukiPlacement = () => {
    const def = DEFAULT_DATE_CONFIG.objects.yuki;
    ['posX', 'posY', 'posZ', 'rotY', 'scale'].forEach((p) => {
      if (def[p] !== undefined) {
        updateObjectTransform('yuki', p, def[p]);
      }
    });
  };

  const renderAvatarPoseControls = ({ isDevMode = false } = {}) => {
    const renderPoseSlider = (part, propKey, label, desc, minVal, maxVal, step = 0.02) => {
      const curVal = devConfig.avatarPose?.[part]?.[propKey] ?? DEFAULT_DATE_CONFIG.avatarPose?.[part]?.[propKey] ?? 0;
      return (
        <div key={propKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', color: '#e4e4e7', fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: '9px', color: '#71717a' }}>{desc}</span>
            </div>
            <input
              type="number"
              step={step}
              value={curVal}
              onChange={(e) => updateAvatarPose(part, propKey, e.target.value)}
              style={{
                width: '60px',
                padding: '2px 6px',
                background: '#18181b',
                border: '1px solid rgba(63, 63, 70, 0.7)',
                borderRadius: '6px',
                color: '#c4b5fd',
                fontFamily: 'monospace',
                fontSize: '11px',
                textAlign: 'right',
                outline: 'none'
              }}
            />
          </div>
          <input
            type="range"
            min={minVal}
            max={maxVal}
            step={step}
            value={curVal}
            onChange={(e) => updateAvatarPose(part, propKey, e.target.value)}
            style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
          />
        </div>
      );
    };

    const renderPlacementSlider = (propKey, label, desc, minVal, maxVal, step = 0.01) => {
      const curVal = devConfig.objects?.yuki?.[propKey] ?? DEFAULT_DATE_CONFIG.objects.yuki[propKey] ?? 0;
      return (
        <div key={propKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', color: '#e4e4e7', fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: '9px', color: '#71717a' }}>{desc}</span>
            </div>
            <input
              type="number"
              step={step}
              value={curVal}
              onChange={(e) => updateObjectTransform('yuki', propKey, e.target.value)}
              style={{
                width: '60px',
                padding: '2px 6px',
                background: '#18181b',
                border: '1px solid rgba(63, 63, 70, 0.7)',
                borderRadius: '6px',
                color: '#c4b5fd',
                fontFamily: 'monospace',
                fontSize: '11px',
                textAlign: 'right',
                outline: 'none'
              }}
            />
          </div>
          <input
            type="range"
            min={minVal}
            max={maxVal}
            step={step}
            value={curVal}
            onChange={(e) => updateObjectTransform('yuki', propKey, e.target.value)}
            style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
          />
        </div>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Curated & Custom Pose Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles style={{ width: '12px', height: '12px', color: '#c084fc' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Pose Presets
              </span>
            </div>
            {!isSavingCustomPose ? (
              <button
                onClick={() => setIsSavingCustomPose(true)}
                title="Save current avatar pose as a custom preset"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(124, 58, 237, 0.2)',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  borderRadius: '6px',
                  color: '#c4b5fd',
                  fontSize: '10px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <Plus style={{ width: '11px', height: '11px' }} />
                <span>Save Pose</span>
              </button>
            ) : null}
          </div>

          {/* Save Preset Inline Form */}
          {isSavingCustomPose && (
            <div style={{ display: 'flex', gap: '6px', padding: '6px 8px', background: 'rgba(24, 24, 27, 0.8)', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
              <input
                type="text"
                placeholder="Preset name (e.g. Cozy Lean)..."
                value={customPoseNameInput}
                onChange={(e) => setCustomPoseNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCustomPosePreset(customPoseNameInput);
                  if (e.key === 'Escape') setIsSavingCustomPose(false);
                }}
                autoFocus
                style={{
                  flex: 1,
                  background: '#18181b',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  color: '#f4f4f5',
                  fontSize: '11px',
                  outline: 'none'
                }}
              />
              <button
                onClick={() => handleSaveCustomPosePreset(customPoseNameInput)}
                disabled={!customPoseNameInput.trim()}
                style={{
                  padding: '4px 8px',
                  background: '#7c3aed',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: customPoseNameInput.trim() ? 'pointer' : 'not-allowed',
                  opacity: customPoseNameInput.trim() ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Check style={{ width: '12px', height: '12px' }} />
                <span>Save</span>
              </button>
              <button
                onClick={() => setIsSavingCustomPose(false)}
                style={{
                  padding: '4px 8px',
                  background: 'rgba(39, 39, 42, 0.8)',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '6px',
                  color: '#a1a1aa',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <X style={{ width: '12px', height: '12px' }} />
              </button>
            </div>
          )}

          {customPoseSaveSuccess && (
            <div style={{ fontSize: '11px', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check style={{ width: '12px', height: '12px' }} />
              <span>Custom pose preset saved successfully!</span>
            </div>
          )}

          {/* Grid of Presets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
            {Object.values(allPosePresets).map((preset) => (
              <div
                key={preset.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'stretch'
                }}
              >
                <button
                  onClick={() => applyPosePreset(preset.id)}
                  title={preset.desc}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    paddingRight: preset.isCustom ? '26px' : '8px',
                    background: '#18181b',
                    border: preset.isCustom ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(139, 92, 246, 0.25)',
                    borderRadius: '8px',
                    color: '#e4e4e7',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{preset.label}</span>
                    {preset.isCustom && (
                      <span style={{ fontSize: '9px', color: '#a78bfa', background: 'rgba(124, 58, 237, 0.2)', padding: '1px 4px', borderRadius: '4px' }}>
                        (Custom)
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '9px', color: '#71717a', lineHeight: '1.2' }}>{preset.desc}</span>
                </button>

                {preset.isCustom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustomPosePreset(preset.id);
                    }}
                    title="Delete custom pose preset"
                    style={{
                      position: 'absolute',
                      right: '4px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: '#71717a',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#71717a')}
                  >
                    <Trash2 style={{ width: '12px', height: '12px' }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body Part Category Switcher Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          {[
            { id: 'head', label: 'Head & Neck' },
            { id: 'torso', label: 'Chest & Torso' },
            { id: 'hips', label: 'Hips & Pelvis' },
            { id: 'legs', label: 'Legs & Knees' },
            { id: 'arms', label: 'Arms & Hands' },
            { id: 'placement', label: 'Placement' }
          ].map((cat) => {
            const isSelected = poseSelectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setPoseSelectedCategory(cat.id)}
                style={{
                  padding: '6px 4px',
                  background: isSelected ? '#7c3aed' : 'rgba(39, 39, 42, 0.6)',
                  border: isSelected ? '1px solid #a78bfa' : '1px solid rgba(63, 63, 70, 0.4)',
                  borderRadius: '8px',
                  color: isSelected ? '#ffffff' : '#a1a1aa',
                  fontSize: '11px',
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s'
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Active Category Controls */}
        {poseSelectedCategory === 'head' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Head & Neck Orientation
              </span>
              <button
                onClick={() => handleResetPosePart('head')}
                title="Reset head and neck rotation back to default"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset Head</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Head Rotation</span>
              {renderPoseSlider('head', 'headPitch', 'Pitch (X)', 'Nod Down / Look Up', -1.20, 1.20)}
              {renderPoseSlider('head', 'headYaw', 'Yaw (Y)', 'Turn Left / Right', -1.40, 1.40)}
              {renderPoseSlider('head', 'headRoll', 'Roll (Z)', 'Tilt Side to Side', -0.80, 0.80)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Neck Alignment</span>
              {renderPoseSlider('head', 'neckPitch', 'Pitch (X)', 'Neck Forward / Back', -0.60, 0.60)}
              {renderPoseSlider('head', 'neckYaw', 'Yaw (Y)', 'Neck Turn Left / Right', -0.80, 0.80)}
              {renderPoseSlider('head', 'neckRoll', 'Roll (Z)', 'Neck Side Tilt', -0.50, 0.50)}
            </div>
          </div>
        )}

        {poseSelectedCategory === 'torso' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Chest & Torso Posture
              </span>
              <button
                onClick={() => handleResetPosePart('torso')}
                title="Reset chest and spine rotation back to default"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset Torso</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Spine & Lower Back</span>
              {renderPoseSlider('torso', 'spinePitch', 'Pitch (X)', 'Lean Forward / Slouch', -0.80, 0.80)}
              {renderPoseSlider('torso', 'spineYaw', 'Yaw (Y)', 'Torso Twist Left / Right', -0.80, 0.80)}
              {renderPoseSlider('torso', 'spineRoll', 'Roll (Z)', 'Side Arch / Tilt', -0.60, 0.60)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Chest & Upper Torso</span>
              {renderPoseSlider('torso', 'chestPitch', 'Pitch (X)', 'Chest Arch Up / Slouch', -0.60, 0.60)}
              {renderPoseSlider('torso', 'chestYaw', 'Yaw (Y)', 'Chest Twist Left / Right', -0.60, 0.60)}
              {renderPoseSlider('torso', 'chestRoll', 'Roll (Z)', 'Chest Side Tilt', -0.50, 0.50)}
            </div>
          </div>
        )}

        {poseSelectedCategory === 'hips' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Hips & Pelvis Positioning
              </span>
              <button
                onClick={() => handleResetPosePart('hips')}
                title="Reset hips and pelvis position/rotation back to default"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset Hips</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Sitting Height & Position Delta</span>
              {renderPoseSlider('hips', 'posY', 'Height Offset (Y)', 'Sitting Height fine-tune', -0.40, 0.40)}
              {renderPoseSlider('hips', 'posZ', 'Depth Offset (Z)', 'Shift Forward / Back', -0.40, 0.40)}
              {renderPoseSlider('hips', 'posX', 'Lateral Offset (X)', 'Shift Left / Right', -0.40, 0.40)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Pelvis & Hips Rotation</span>
              {renderPoseSlider('hips', 'rotPitch', 'Pitch (X)', 'Pelvis Forward / Back tilt', -0.60, 0.60)}
              {renderPoseSlider('hips', 'rotYaw', 'Yaw (Y)', 'Pelvis Twist Left / Right', -0.80, 0.80)}
              {renderPoseSlider('hips', 'rotRoll', 'Roll (Z)', 'Pelvis Side Tilt', -0.50, 0.50)}
            </div>
          </div>
        )}

        {poseSelectedCategory === 'legs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Left vs Right Leg Switcher */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {[
                { id: 'leftLeg', label: 'Left Leg & Foot' },
                { id: 'rightLeg', label: 'Right Leg & Foot' }
              ].map((leg) => {
                const isSelected = poseSelectedLeg === leg.id;
                return (
                  <button
                    key={leg.id}
                    onClick={() => setPoseSelectedLeg(leg.id)}
                    style={{
                      padding: '6px 10px',
                      background: isSelected ? '#7c3aed' : 'rgba(39, 39, 42, 0.6)',
                      border: isSelected ? '1px solid #a78bfa' : '1px solid rgba(63, 63, 70, 0.4)',
                      borderRadius: '8px',
                      color: isSelected ? '#ffffff' : '#a1a1aa',
                      fontSize: '11px',
                      fontWeight: isSelected ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {leg.label}
                  </button>
                );
              })}
            </div>

            {/* Sub-bar: Reset & Mirror Actions for Selected Leg */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <button
                onClick={() => handleResetPosePart(poseSelectedLeg)}
                title={`Reset ${poseSelectedLeg === 'leftLeg' ? 'Left' : 'Right'} leg back to defaults`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset {poseSelectedLeg === 'leftLeg' ? 'Left' : 'Right'} Leg</span>
              </button>

              <button
                onClick={() => mirrorLegPose(poseSelectedLeg, poseSelectedLeg === 'leftLeg' ? 'rightLeg' : 'leftLeg')}
                title="Mirror current pose to the opposite leg"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '6px',
                  color: '#c4b5fd',
                  fontSize: '10px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <Sliders style={{ width: '10px', height: '10px' }} />
                <span>Mirror {poseSelectedLeg === 'leftLeg' ? 'Left -> Right' : 'Right -> Left'}</span>
              </button>
            </div>

            {/* Sliders for Selected Leg */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Hip & Upper Thigh</span>
                {renderPoseSlider(poseSelectedLeg, 'upperPitch', 'Pitch (X)', 'Thigh Elevation / Seated Angle', 0.40, 2.40)}
                {renderPoseSlider(poseSelectedLeg, 'upperYaw', 'Yaw (Y)', 'Thigh Inward / Outward Turn', -1.00, 1.00)}
                {renderPoseSlider(poseSelectedLeg, 'upperRoll', 'Roll (Z)', 'Thigh Spread / Cross', -1.40, 1.40)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Knee & Shin</span>
                {renderPoseSlider(poseSelectedLeg, 'lowerFlex', 'Flex (X)', 'Knee Bend Angle', -2.60, 0.20)}
                {renderPoseSlider(poseSelectedLeg, 'lowerTwist', 'Twist (Y)', 'Lower Leg Twist', -0.80, 0.80)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Foot & Ankle</span>
                {renderPoseSlider(poseSelectedLeg, 'footPitch', 'Pitch (X)', 'Ankle Up / Down', -0.80, 0.80)}
                {renderPoseSlider(poseSelectedLeg, 'footYaw', 'Yaw (Y)', 'Foot Inward / Outward', -0.60, 0.60)}
                {renderPoseSlider(poseSelectedLeg, 'footRoll', 'Roll (Z)', 'Foot Side Tilt', -0.60, 0.60)}
              </div>
            </div>
          </div>
        )}

        {poseSelectedCategory === 'arms' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Left vs Right Arm Switcher */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {[
                { id: 'leftArm', label: 'Left Arm & Hand' },
                { id: 'rightArm', label: 'Right Arm & Hand' }
              ].map((arm) => {
                const isSelected = poseSelectedArm === arm.id;
                return (
                  <button
                    key={arm.id}
                    onClick={() => setPoseSelectedArm(arm.id)}
                    style={{
                      padding: '6px 10px',
                      background: isSelected ? '#7c3aed' : 'rgba(39, 39, 42, 0.6)',
                      border: isSelected ? '1px solid #a78bfa' : '1px solid rgba(63, 63, 70, 0.4)',
                      borderRadius: '8px',
                      color: isSelected ? '#ffffff' : '#a1a1aa',
                      fontSize: '11px',
                      fontWeight: isSelected ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {arm.label}
                  </button>
                );
              })}
            </div>

            {/* Sub-bar: Reset & Mirror Actions for Selected Arm */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <button
                onClick={() => handleResetPosePart(poseSelectedArm)}
                title={`Reset ${poseSelectedArm === 'leftArm' ? 'Left' : 'Right'} arm back to defaults`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset {poseSelectedArm === 'leftArm' ? 'Left' : 'Right'} Arm</span>
              </button>

              <button
                onClick={() => mirrorArmPose(poseSelectedArm, poseSelectedArm === 'leftArm' ? 'rightArm' : 'leftArm')}
                title="Mirror current pose to the opposite arm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '6px',
                  color: '#c4b5fd',
                  fontSize: '10px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <Sliders style={{ width: '10px', height: '10px' }} />
                <span>Mirror {poseSelectedArm === 'leftArm' ? 'Left -> Right' : 'Right -> Left'}</span>
              </button>
            </div>

            {/* Sliders for Selected Arm */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Shoulder & Upper Arm</span>
                {renderPoseSlider(poseSelectedArm, 'upperPitch', 'Pitch (X)', 'Forward / Back elevation', -1.50, 2.50)}
                {renderPoseSlider(poseSelectedArm, 'upperYaw', 'Yaw (Y)', 'Inward / Outward twist', -1.50, 1.50)}
                {renderPoseSlider(poseSelectedArm, 'upperRoll', 'Roll (Z)', 'Arm abduction / raise', -2.50, 2.50)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Elbow & Forearm</span>
                {renderPoseSlider(poseSelectedArm, 'lowerFlex', 'Flex (X)', 'Elbow bend angle', 0.00, 2.50)}
                {renderPoseSlider(poseSelectedArm, 'lowerTwist', 'Twist (Y)', 'Forearm pronation / supination', -1.50, 1.50)}
                {renderPoseSlider(poseSelectedArm, 'lowerAngle', 'Angle (Z)', 'Elbow lateral spread', -1.50, 1.50)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>Wrist & Hand Orientation</span>
                {renderPoseSlider(poseSelectedArm, 'handPitch', 'Pitch (X)', 'Wrist tilt up / down', -1.50, 1.50)}
                {renderPoseSlider(poseSelectedArm, 'handYaw', 'Yaw (Y)', 'Wrist turn left / right', -1.50, 1.50)}
                {renderPoseSlider(poseSelectedArm, 'handRoll', 'Roll (Z)', 'Hand palm rotation', -1.50, 1.50)}
              </div>
            </div>
          </div>
        )}

        {poseSelectedCategory === 'placement' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Avatar 3D Placement
              </span>
              <button
                onClick={handleResetYukiPlacement}
                title="Reset Yuki world placement back to default table position"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '10px', height: '10px' }} />
                <span>Reset Placement</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd' }}>3D Table Coordinates</span>
              {renderPlacementSlider('posX', 'Table Position X', 'Horizontal position', -1.50, 1.50, 0.01)}
              {renderPlacementSlider('posY', 'Table Position Y', 'Vertical height', -1.50, 1.50, 0.01)}
              {renderPlacementSlider('posZ', 'Table Position Z', 'Proximity to table / player', -1.50, 1.50, 0.01)}
              {renderPlacementSlider('rotY', 'Body Rotation (Y)', 'Turn angle (degrees)', 0, 360, 1)}
              {renderPlacementSlider('scale', 'Avatar Scale', 'Overall size scaling', 0.50, 2.00, 0.01)}
            </div>
          </div>
        )}

        {/* Master Reset Footer */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
          <button
            onClick={handleResetPoseTab}
            title="Reset all avatar pose joints back to default seated posture"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            <RotateCcw style={{ width: '12px', height: '12px' }} />
            <span>Reset All Posing to Default Seated</span>
          </button>
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // HARDWARE ERROR MODAL (Strict Dedicated GPU Enforcement)
  // --------------------------------------------------------------------------
  if (gpuCheck && !gpuCheck.ok) {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-zinc-900/95 border border-red-500/30 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-bold text-zinc-100 mb-2">Dedicated GPU Required</h2>
          <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
            Date Mode runs a high-performance 3D visual world and currently requires a discrete <strong>NVIDIA GeForce</strong> or <strong>AMD Radeon</strong> graphics card.
          </p>

          <div className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 mb-5 text-left">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 font-mono">Detected Graphics Device:</div>
            <div className="text-xs text-red-300 font-mono break-all">{gpuCheck.renderer}</div>
          </div>

          <p className="text-xs text-zinc-500 mb-6 leading-normal">
            To enable dedicated graphics on dual-GPU laptops, assign <strong>Yuki AI</strong> to <em>High Performance</em> inside <strong>Windows Settings &gt; System &gt; Display &gt; Graphics</strong> or your NVIDIA/AMD Control Panel.
          </p>

          <button
            onClick={handleExitDateMode}
            className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-xl transition-colors border border-zinc-700"
          >
            Return to Desktop Window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="date-app-container"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
        background: '#090d16',
        color: '#f4f4f5',
        fontFamily: 'Outfit, system-ui, -apple-system, sans-serif'
      }}
    >
      {/* Three.js 3D Viewport Canvas */}
      <canvas
        ref={canvasRef}
        className="date-canvas"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          zIndex: 1,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      />

      {/* Polaroid Camera Flash Effect */}
      {polaroidFlash && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#ffffff',
            pointerEvents: 'none',
            transition: 'opacity 0.3s ease',
            opacity: 0.9,
            zIndex: 999
          }}
        />
      )}

      {/* Loading Overlay */}
      {isInitializing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#090d16',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 500
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '2px solid rgba(139, 92, 246, 0.2)',
              borderTopColor: '#8b5cf6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '16px'
            }}
          />
          <span style={{ fontSize: '12px', color: '#a78bfa', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Entering Date Mode...
          </span>
        </div>
      )}

      {/* Floating Map Positions Notification Toast */}
      {mapPositionsToast && (
        <div
          style={{
            position: 'fixed',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 18px',
            background: 'rgba(9, 13, 22, 0.92)',
            border: '1px solid rgba(139, 92, 246, 0.5)',
            borderRadius: '9999px',
            color: '#f4f4f5',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 15px rgba(139, 92, 246, 0.25)',
            backdropFilter: 'blur(16px)',
            pointerEvents: 'none',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <MapPin style={{ width: '14px', height: '14px', color: '#c084fc' }} />
          <span>{mapPositionsToast}</span>
          <Check style={{ width: '13px', height: '13px', color: '#34d399' }} />
        </div>
      )}

      {/* Floating Show UI Pill (Visible only when UI is hidden) */}
      {isUiHidden && (
        <button
          onClick={() => setIsUiHidden(false)}
          title="Show UI (or press H)"
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 1000,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(9, 13, 22, 0.85)',
            border: '1.5px solid rgba(139, 92, 246, 0.5)',
            borderRadius: '9999px',
            color: '#f4f4f5',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.7)',
            transition: 'all 0.2s',
            pointerEvents: 'auto'
          }}
        >
          <Eye style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
          <span>Show UI (H)</span>
        </button>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* HEADER CONTROLS (Top Bar) */}
      {/* -------------------------------------------------------------------- */}
      <header
        className="date-header"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 100,
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.4) 65%, transparent 100%)',
          pointerEvents: (isUiHidden || isUserInactive) ? 'none' : 'auto',
          opacity: (isUiHidden || isUserInactive) ? 0 : 1,
          transition: 'opacity 0.35s ease'
        }}
      >
        {/* Left: Destination / Scenario Switcher & Add Map Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="date-btn-group" style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(24, 24, 27, 0.85)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '9999px', padding: '3px', backdropFilter: 'blur(12px)', maxWidth: '480px', overflowX: 'auto' }}>
            {Object.values(allScenarios).map((dest) => (
              <button
                key={dest.id}
                onClick={() => {
                  setActiveDest(dest.id);
                  if (dest.welcomeDialogue) setDialogueText(dest.welcomeDialogue);
                }}
                className={`date-btn-pill ${activeDest === dest.id ? 'active' : 'inactive'}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                  background: activeDest === dest.id ? '#7c3aed' : 'transparent',
                  color: activeDest === dest.id ? '#ffffff' : '#a1a1aa',
                  boxShadow: activeDest === dest.id ? '0 2px 8px rgba(124, 58, 237, 0.4)' : 'none'
                }}
              >
                {dest.type === '3d_model' ? (
                  <Box style={{ width: '12px', height: '12px', color: activeDest === dest.id ? '#ffffff' : '#c084fc' }} />
                ) : (
                  <ImageIcon style={{ width: '12px', height: '12px', color: activeDest === dest.id ? '#ffffff' : '#93c5fd' }} />
                )}
                <span>{dest.title}</span>
              </button>
            ))}

            {/* Add Date Map / Scenario Button */}
            <button
              onClick={() => handleOpenScenarioEditor(null)}
              title="Add New Date Map or Custom 3D Stage"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '11px',
                fontWeight: 600,
                border: '1px dashed rgba(167, 139, 250, 0.6)',
                background: 'rgba(124, 58, 237, 0.15)',
                color: '#c4b5fd',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s'
              }}
            >
              <Plus style={{ width: '12px', height: '12px' }} />
              <span>Map</span>
            </button>
          </div>
        </div>

        {/* Center: First-Person 360 Look Hint */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: 'rgba(161, 161, 170, 0.9)',
            background: 'rgba(24, 24, 27, 0.7)',
            padding: '6px 14px',
            borderRadius: '9999px',
            border: '1px solid rgba(63, 63, 70, 0.5)',
            backdropFilter: 'blur(12px)'
          }}
        >
          <Sparkles style={{ width: '12px', height: '12px', color: '#a78bfa' }} />
          <span>Drag to look around • Double-click to center</span>
        </div>

        {/* Hidden File Input for 360 Panorama Upload */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUploadCustomBg}
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
        />

        {/* Hidden File Input for Custom Floor Upload */}
        <input
          type="file"
          ref={floorInputRef}
          onChange={handleCustomFloorUpload}
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
        />

        {/* Right: Hide UI, Upload 360, Recenter, Photo, Settings & Exit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, zIndex: 110, pointerEvents: 'auto' }}>
          {/* Ambient BGM Control Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: isBgmEnabled ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.85)',
              border: isBgmEnabled ? '1px solid rgba(167, 139, 250, 0.6)' : '1px solid rgba(63, 63, 70, 0.6)',
              borderRadius: '9999px',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <button
              onClick={handleToggleBgm}
              title={isBgmEnabled ? `Ambient BGM Active (${Math.round(bgmVolume * 100)}%) - Click to Mute` : "Ambient BGM Muted - Click to Play"}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'transparent',
                border: 'none',
                color: isBgmEnabled ? '#c4b5fd' : '#a1a1aa',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                padding: '2px 4px'
              }}
            >
              {isBgmEnabled ? (
                <Music style={{ width: '13px', height: '13px', color: '#c4b5fd' }} />
              ) : (
                <VolumeX style={{ width: '13px', height: '13px', color: '#71717a' }} />
              )}
              <span>{isBgmEnabled ? 'BGM' : 'Muted'}</span>
            </button>
            {isBgmEnabled && (
              <input
                type="range"
                min="0"
                max="0.6"
                step="0.02"
                value={bgmVolume}
                onChange={(e) => handleBgmVolumeChange(parseFloat(e.target.value))}
                title={`BGM Volume: ${Math.round((bgmVolume / 0.6) * 100)}%`}
                style={{
                  width: '54px',
                  height: '4px',
                  cursor: 'pointer',
                  accentColor: '#a78bfa'
                }}
              />
            )}
          </div>

          {/* Yuki Spoken Voice Mute/Unmute Pill */}
          <button
            onClick={handleToggleMuteVoice}
            title={muteVoice ? "Yuki's Voice is Muted (Click to Unmute Voice)" : "Yuki's Voice is Active (Click to Mute Voice)"}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              background: muteVoice ? 'rgba(239, 68, 68, 0.18)' : 'rgba(24, 24, 27, 0.85)',
              border: muteVoice ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(63, 63, 70, 0.6)',
              borderRadius: '9999px',
              color: muteVoice ? '#fca5a5' : '#e4e4e7',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            {muteVoice ? (
              <VolumeX style={{ width: '13px', height: '13px', color: '#f87171' }} />
            ) : (
              <Volume2 style={{ width: '13px', height: '13px', color: '#a78bfa' }} />
            )}
            <span>{muteVoice ? 'Muted' : 'Voice'}</span>
          </button>

          {/* Hide UI Toggle Button */}
          <button
            onClick={() => setIsUiHidden(true)}
            title="Hide UI for Immersion (Press H or click to hide)"
            className="date-action-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: 'rgba(24, 24, 27, 0.85)',
              border: '1px solid rgba(63, 63, 70, 0.6)',
              color: '#e4e4e7',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <EyeOff style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
            <span>Hide UI</span>
          </button>

          {/* Upload Custom 360 Panorama Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload Custom 360° Panorama (PNG/JPG)"
            className="date-action-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: 'rgba(24, 24, 27, 0.85)',
              border: '1px solid rgba(63, 63, 70, 0.6)',
              color: '#e4e4e7',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <Upload style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
            <span>Upload 360</span>
          </button>

          {/* Recenter Head View */}
          <button
            onClick={handleRecenterView}
            title="Recenter Head View (or double-click anywhere)"
            className="date-action-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: 'rgba(24, 24, 27, 0.85)',
              border: '1px solid rgba(63, 63, 70, 0.6)',
              color: '#e4e4e7',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <RotateCcw style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
            <span>Recenter</span>
          </button>

          {/* Polaroid Snapshot Button */}
          <button
            onClick={handleCapturePolaroid}
            title="Take Polaroid Memory Photo"
            className="date-action-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: 'rgba(24, 24, 27, 0.85)',
              border: '1px solid rgba(63, 63, 70, 0.6)',
              color: '#e4e4e7',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <Camera style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
            <span>Photo</span>
          </button>

          {/* Settings Menu Button - High Contrast Vibrant Purple */}
          <button
            onClick={() => setShowSettings(true)}
            title="Date Mode Settings & Controls"
            className="date-settings-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 18px',
              background: '#7c3aed',
              border: '1.5px solid #a78bfa',
              color: '#ffffff',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 16px rgba(124, 58, 237, 0.6)',
              transition: 'all 0.15s'
            }}
          >
            <Settings style={{ width: '14px', height: '14px', color: '#ffffff' }} />
            <span>Settings</span>
            {modifiedCount > 0 && (
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34d399' }} />
            )}
          </button>

          {/* Exit Date Mode */}
          <button
            onClick={handleExitDateMode}
            title="Exit Date Mode"
            className="date-exit-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              background: 'rgba(24, 24, 27, 0.85)',
              border: '1px solid rgba(63, 63, 70, 0.6)',
              color: '#a1a1aa',
              borderRadius: '9999px',
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              transition: 'all 0.15s'
            }}
          >
            <X style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </header>

      {/* Dynamic Map Loading Spinner */}
      {isMapLoading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 24px',
            backgroundColor: 'rgba(9, 13, 22, 0.90)',
            border: '1px solid rgba(139, 92, 246, 0.5)',
            borderRadius: '16px',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(16px)',
            zIndex: 350,
            color: '#f4f4f5',
            fontSize: '13px',
            fontWeight: 500,
            pointerEvents: 'none'
          }}
        >
          <Loader2 className="animate-spin" style={{ width: '18px', height: '18px', color: '#c084fc' }} />
          <span>Loading destination...</span>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* DEV MODE FLOATING INSPECTOR PANEL */}
      {/* -------------------------------------------------------------------- */}
      {devMode && devInspectorCollapsed && (
        <button
          onClick={() => setDevInspectorCollapsed(false)}
          className="date-action-btn"
          style={{
            position: 'absolute',
            left: '20px',
            top: '72px',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            backgroundColor: 'rgba(24, 24, 27, 0.9)',
            color: '#c4b5fd',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            borderRadius: '9999px',
            fontSize: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(16px)',
            cursor: 'pointer',
            pointerEvents: 'auto'
          }}
        >
          <Sliders style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
          <span style={{ fontWeight: 500 }}>Dev Inspector</span>
          {modifiedCount > 0 && (
            <span style={{ padding: '1px 6px', borderRadius: '9999px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', fontSize: '10px', fontFamily: 'monospace' }}>
              {modifiedCount}
            </span>
          )}
          <Maximize2 style={{ width: '12px', height: '12px', color: '#a1a1aa' }} />
        </button>
      )}

      {devMode && !devInspectorCollapsed && (
        <div
          className="date-dev-inspector"
          style={{
            position: 'absolute',
            left: '20px',
            top: '72px',
            width: '340px',
            maxHeight: 'calc(100vh - 120px)',
            backgroundColor: 'rgba(9, 13, 22, 0.95)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            borderRadius: '16px',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 200,
            fontSize: '12px',
            color: '#e4e4e7',
            pointerEvents: 'auto'
          }}
        >
          {/* Inspector Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(63, 63, 70, 0.6)', background: 'rgba(24, 24, 27, 0.85)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sliders style={{ width: '15px', height: '15px', color: '#a78bfa' }} />
              <span style={{ fontWeight: 600, color: '#f4f4f5', fontSize: '13px' }}>Dev Inspector</span>
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)', fontFamily: 'monospace' }}>
                {modifiedCount} diffs
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={() => setShowDiffModal(true)}
                title="Show All Changes"
                style={{ padding: '4px', background: 'transparent', border: 'none', borderRadius: '6px', color: '#a1a1aa', cursor: 'pointer' }}
              >
                <Code style={{ width: '14px', height: '14px' }} />
              </button>
              <button
                onClick={() => setDevInspectorCollapsed(true)}
                title="Minimize Panel"
                style={{ padding: '4px', background: 'transparent', border: 'none', borderRadius: '6px', color: '#a1a1aa', cursor: 'pointer' }}
              >
                <Minimize2 style={{ width: '14px', height: '14px' }} />
              </button>
            </div>
          </div>

          {/* Profile Bar: Presets & Custom Saved Positions */}
          <div style={{ padding: '8px 12px', background: 'rgba(18, 18, 23, 0.95)', borderBottom: '1px solid rgba(63, 63, 70, 0.5)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                <Bookmark style={{ width: '13px', height: '13px', color: '#c084fc', flexShrink: 0 }} />
                <select
                  value={activeProfileId}
                  onChange={(e) => handleSelectProfile(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '4px 8px',
                    background: '#18181b',
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                    borderRadius: '6px',
                    color: '#f4f4f5',
                    fontSize: '11px',
                    fontWeight: 500,
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="default">Default (Original Layout)</option>
                  {Object.values(savedProfiles).map((prof) => (
                    <option key={prof.id} value={prof.id}>
                      {prof.name}
                    </option>
                  ))}
                </select>

                {isProfileModified && (
                  <span
                    title="Unsaved changes detected against this profile"
                    style={{ fontSize: '9px', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '1px 5px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Modified
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                {activeProfileId !== 'default' && (
                  <>
                    <button
                      onClick={handleOverwriteCurrentProfile}
                      title="Update and overwrite current saved profile with active settings"
                      style={{
                        padding: '4px 6px',
                        background: 'rgba(139, 92, 246, 0.15)',
                        border: '1px solid rgba(139, 92, 246, 0.35)',
                        borderRadius: '6px',
                        color: '#c4b5fd',
                        fontSize: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      <Save style={{ width: '11px', height: '11px' }} />
                      <span>Update</span>
                    </button>

                    <button
                      onClick={() => handleDeleteProfile(activeProfileId)}
                      title="Delete this custom profile"
                      style={{
                        padding: '4px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '6px',
                        color: '#f87171',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 style={{ width: '12px', height: '12px' }} />
                    </button>
                  </>
                )}

                <button
                  onClick={() => setIsSavingProfile((prev) => !prev)}
                  title="Save current layout as a new named custom profile"
                  style={{
                    padding: '4px 8px',
                    background: isSavingProfile ? '#7c3aed' : 'rgba(39, 39, 42, 0.8)',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus style={{ width: '11px', height: '11px' }} />
                  <span>Save As</span>
                </button>
              </div>
            </div>

            {/* Inline Save As New Profile Input Row */}
            {isSavingProfile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
                <input
                  type="text"
                  placeholder="Enter custom layout name..."
                  value={profileNameInput}
                  onChange={(e) => setProfileNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCurrentAsProfile(profileNameInput);
                    if (e.key === 'Escape') setIsSavingProfile(false);
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '4px 8px',
                    background: '#09090b',
                    border: '1px solid #a78bfa',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '11px',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={() => handleSaveCurrentAsProfile(profileNameInput)}
                  disabled={!profileNameInput.trim()}
                  style={{
                    padding: '4px 8px',
                    background: profileNameInput.trim() ? '#7c3aed' : '#27272a',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: profileNameInput.trim() ? 'pointer' : 'default'
                  }}
                >
                  Save
                </button>
                <button
                  onClick={() => { setIsSavingProfile(false); setProfileNameInput(''); }}
                  style={{
                    padding: '4px 6px',
                    background: 'transparent',
                    border: '1px solid rgba(63, 63, 70, 0.6)',
                    borderRadius: '6px',
                    color: '#a1a1aa',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {profileSaveSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#34d399', fontSize: '10px', fontWeight: 500 }}>
                <Check style={{ width: '11px', height: '11px' }} />
                <span>Profile saved successfully!</span>
              </div>
            )}
          </div>

          {/* Active Map Configuration Bar */}
          <div style={{ padding: '8px 12px', background: 'rgba(124, 58, 237, 0.12)', borderBottom: '1px solid rgba(139, 92, 246, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
              <MapPin style={{ width: '13px', height: '13px', color: '#c084fc', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '9px', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Map Default Configuration</div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f4f4f5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {allScenarios[activeDest]?.title || 'Active Map'}
                  {mapDefaultProfiles[activeDest] && savedProfiles[mapDefaultProfiles[activeDest]] && (
                    <span style={{ marginLeft: '5px', fontSize: '10px', color: '#c4b5fd', fontWeight: 400 }}>
                      ({savedProfiles[mapDefaultProfiles[activeDest]].name})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <button
                onClick={handleSaveCurrentAsMapDefault}
                title="Save current preset/profile, lighting, exposure, and 3D layout as default for this map"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: '#7c3aed',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.4)'
                }}
              >
                <Save style={{ width: '11px', height: '11px' }} />
                <span>Save as Default</span>
              </button>

              <button
                onClick={handleResetToMapDefaults}
                title="Restore this map's default profile, lighting, and positions"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(39, 39, 42, 0.8)',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '6px',
                  color: '#d4d4d8',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '11px', height: '11px' }} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Inspector Tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', padding: '6px 8px', borderBottom: '1px solid rgba(63, 63, 70, 0.5)', background: 'rgba(15, 15, 20, 0.7)' }}>
            {[
              { id: 'objects', label: 'Objects', icon: Box },
              { id: 'pose', label: 'Pose', icon: Activity },
              { id: 'lights', label: 'Lights', icon: Sun },
              { id: 'shaders', label: 'Shaders', icon: Palette },
              { id: 'diff', label: 'Diff', icon: Code }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = devTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setDevTab(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    padding: '6px 4px',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    background: isActive ? '#7c3aed' : 'transparent',
                    color: isActive ? '#ffffff' : '#a1a1aa',
                    transition: 'all 0.15s'
                  }}
                >
                  <Icon style={{ width: '12px', height: '12px' }} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Inspector Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Tab 1: Objects & Transforms */}
            {devTab === 'objects' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Tab Header with Tab-Specific Reset */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(63, 63, 70, 0.4)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>3D Object Transforms</span>
                  <button
                    onClick={handleResetObjectsTab}
                    title="Reset all objects in this scene back to defaults"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '10px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <RotateCcw style={{ width: '10px', height: '10px' }} />
                    <span>Reset Tab</span>
                  </button>
                </div>

                {/* Object Selector */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '11px', color: '#a1a1aa' }}>Target 3D Object:</label>
                    <span style={{ fontSize: '10px', color: '#a78bfa', fontFamily: 'monospace' }}>Click scene to select</span>
                  </div>
                  <select
                    value={selectedObjectId}
                    onChange={(e) => setSelectedObjectId(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: '#18181b',
                      border: '1px solid rgba(63, 63, 70, 0.8)',
                      borderRadius: '10px',
                      padding: '6px 10px',
                      fontSize: '12px',
                      color: '#f4f4f5',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {Object.entries(DEFAULT_DATE_CONFIG.objects).map(([k, v]) => (
                      <option key={k} value={k}>{v.name}</option>
                    ))}
                  </select>
                </div>

                {/* Independent Object Reset Action Bar */}
                {selectedObjectId && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    backgroundColor: 'rgba(24, 24, 27, 0.7)',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Box style={{ width: '13px', height: '13px', color: '#a78bfa' }} />
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#f4f4f5' }}>
                        {DEFAULT_DATE_CONFIG.objects[selectedObjectId]?.name || selectedObjectId}
                      </span>
                    </div>
                    <button
                      onClick={() => handleResetSelectedObject(selectedObjectId)}
                      title={`Reset only ${DEFAULT_DATE_CONFIG.objects[selectedObjectId]?.name || 'this object'} back to initial defaults`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 9px',
                        background: 'rgba(124, 58, 237, 0.25)',
                        border: '1px solid rgba(139, 92, 246, 0.45)',
                        borderRadius: '6px',
                        color: '#c4b5fd',
                        fontSize: '10px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      <RotateCcw style={{ width: '10px', height: '10px' }} />
                      <span>Reset This Object</span>
                    </button>
                  </div>
                )}

                {selectedObjectId && devConfig.objects[selectedObjectId] && (() => {
                  const cur = devConfig.objects[selectedObjectId];
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Position X */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Position X (m)</span>
                          <input
                            type="number"
                            step="0.01"
                            value={cur.posX ?? 0}
                            onChange={(e) => updateObjectTransform(selectedObjectId, 'posX', e.target.value)}
                            style={{
                              width: '64px',
                              padding: '2px 6px',
                              background: '#18181b',
                              border: '1px solid rgba(63, 63, 70, 0.7)',
                              borderRadius: '6px',
                              color: '#c4b5fd',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              textAlign: 'right',
                              outline: 'none'
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="-4.0"
                          max="4.0"
                          step="0.01"
                          value={cur.posX ?? 0}
                          onChange={(e) => updateObjectTransform(selectedObjectId, 'posX', e.target.value)}
                          style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                        />
                      </div>

                      {/* Position Y */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Position Y (m)</span>
                          <input
                            type="number"
                            step="0.01"
                            value={cur.posY ?? 0}
                            onChange={(e) => updateObjectTransform(selectedObjectId, 'posY', e.target.value)}
                            style={{
                              width: '64px',
                              padding: '2px 6px',
                              background: '#18181b',
                              border: '1px solid rgba(63, 63, 70, 0.7)',
                              borderRadius: '6px',
                              color: '#c4b5fd',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              textAlign: 'right',
                              outline: 'none'
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="-2.0"
                          max="4.0"
                          step="0.01"
                          value={cur.posY ?? 0}
                          onChange={(e) => updateObjectTransform(selectedObjectId, 'posY', e.target.value)}
                          style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                        />
                      </div>

                      {/* Position Z */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Position Z (m)</span>
                          <input
                            type="number"
                            step="0.01"
                            value={cur.posZ ?? 0}
                            onChange={(e) => updateObjectTransform(selectedObjectId, 'posZ', e.target.value)}
                            style={{
                              width: '64px',
                              padding: '2px 6px',
                              background: '#18181b',
                              border: '1px solid rgba(63, 63, 70, 0.7)',
                              borderRadius: '6px',
                              color: '#c4b5fd',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              textAlign: 'right',
                              outline: 'none'
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="-5.0"
                          max="3.0"
                          step="0.01"
                          value={cur.posZ ?? 0}
                          onChange={(e) => updateObjectTransform(selectedObjectId, 'posZ', e.target.value)}
                          style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                        />
                      </div>

                      {/* Rotation Y */}
                      {cur.rotY !== undefined && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Rotation Y (deg)</span>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="360"
                              value={Math.round(cur.rotY ?? 0)}
                              onChange={(e) => updateObjectTransform(selectedObjectId, 'rotY', e.target.value)}
                              style={{
                                width: '64px',
                                padding: '2px 6px',
                                background: '#18181b',
                                border: '1px solid rgba(63, 63, 70, 0.7)',
                                borderRadius: '6px',
                                color: '#c4b5fd',
                                fontFamily: 'monospace',
                                fontSize: '11px',
                                textAlign: 'right',
                                outline: 'none'
                              }}
                            />
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="360"
                            step="1"
                            value={cur.rotY ?? 0}
                            onChange={(e) => updateObjectTransform(selectedObjectId, 'rotY', e.target.value)}
                            style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                          />
                        </div>
                      )}

                      {/* Uniform Scale */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Uniform Scale</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.05"
                            max="5.0"
                            value={Number((cur.scale ?? 1.0).toFixed(2))}
                            onChange={(e) => updateObjectTransform(selectedObjectId, 'scale', e.target.value)}
                            style={{
                              width: '64px',
                              padding: '2px 6px',
                              background: '#18181b',
                              border: '1px solid rgba(63, 63, 70, 0.7)',
                              borderRadius: '6px',
                              color: '#c4b5fd',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              textAlign: 'right',
                              outline: 'none'
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="5.0"
                          step="0.01"
                          value={cur.scale ?? 1.0}
                          onChange={(e) => updateObjectTransform(selectedObjectId, 'scale', e.target.value)}
                          style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                        />

                        {/* Quick Presets */}
                        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((s) => {
                            const isSelected = Math.abs((cur.scale ?? 1.0) - s) < 0.02;
                            return (
                              <button
                                key={s}
                                onClick={() => updateObjectTransform(selectedObjectId, 'scale', s)}
                                style={{
                                  flex: 1,
                                  padding: '3px 0',
                                  borderRadius: '6px',
                                  fontSize: '10px',
                                  fontFamily: 'monospace',
                                  cursor: 'pointer',
                                  border: isSelected ? '1px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.5)',
                                  background: isSelected ? 'rgba(124, 58, 237, 0.3)' : 'rgba(24, 24, 27, 0.8)',
                                  color: isSelected ? '#ffffff' : '#a1a1aa'
                                }}
                              >
                                {s}x
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Independent Axis Scaling Toggle */}
                      <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(63, 63, 70, 0.5)' }}>
                        <button
                          onClick={() => setIndependentAxisScale(!independentAxisScale)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            color: '#e4e4e7',
                            padding: '4px 0',
                            cursor: 'pointer',
                            fontSize: '11px'
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Sliders style={{ width: '12px', height: '12px', color: '#a78bfa' }} />
                            <span>Independent Axis Scaling (X, Y, Z)</span>
                          </span>
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            fontFamily: 'monospace',
                            background: independentAxisScale ? 'rgba(139, 92, 246, 0.2)' : 'rgba(63, 63, 70, 0.3)',
                            color: independentAxisScale ? '#c4b5fd' : '#71717a',
                            border: independentAxisScale ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid transparent'
                          }}>
                            {independentAxisScale ? 'Active' : 'Locked'}
                          </span>
                        </button>

                        {independentAxisScale && (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            paddingTop: '8px',
                            paddingLeft: '10px',
                            borderLeft: '2px solid rgba(139, 92, 246, 0.5)',
                            marginTop: '6px'
                          }}>
                            {/* Scale X */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Scale X (Width)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.05"
                                  max="5.0"
                                  value={Number((cur.scaleX ?? cur.scale ?? 1.0).toFixed(2))}
                                  onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleX', e.target.value)}
                                  style={{
                                    width: '64px',
                                    padding: '2px 6px',
                                    background: '#18181b',
                                    border: '1px solid rgba(63, 63, 70, 0.7)',
                                    borderRadius: '6px',
                                    color: '#c4b5fd',
                                    fontFamily: 'monospace',
                                    fontSize: '11px',
                                    textAlign: 'right',
                                    outline: 'none'
                                  }}
                                />
                              </div>
                              <input
                                type="range"
                                min="0.05"
                                max="5.0"
                                step="0.01"
                                value={cur.scaleX ?? cur.scale ?? 1.0}
                                onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleX', e.target.value)}
                                style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                              />
                            </div>

                            {/* Scale Y */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Scale Y (Height)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.05"
                                  max="5.0"
                                  value={Number((cur.scaleY ?? cur.scale ?? 1.0).toFixed(2))}
                                  onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleY', e.target.value)}
                                  style={{
                                    width: '64px',
                                    padding: '2px 6px',
                                    background: '#18181b',
                                    border: '1px solid rgba(63, 63, 70, 0.7)',
                                    borderRadius: '6px',
                                    color: '#c4b5fd',
                                    fontFamily: 'monospace',
                                    fontSize: '11px',
                                    textAlign: 'right',
                                    outline: 'none'
                                  }}
                                />
                              </div>
                              <input
                                type="range"
                                min="0.05"
                                max="5.0"
                                step="0.01"
                                value={cur.scaleY ?? cur.scale ?? 1.0}
                                onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleY', e.target.value)}
                                style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                              />
                            </div>

                            {/* Scale Z */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Scale Z (Depth)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.05"
                                  max="5.0"
                                  value={Number((cur.scaleZ ?? cur.scale ?? 1.0).toFixed(2))}
                                  onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleZ', e.target.value)}
                                  style={{
                                    width: '64px',
                                    padding: '2px 6px',
                                    background: '#18181b',
                                    border: '1px solid rgba(63, 63, 70, 0.7)',
                                    borderRadius: '6px',
                                    color: '#c4b5fd',
                                    fontFamily: 'monospace',
                                    fontSize: '11px',
                                    textAlign: 'right',
                                    outline: 'none'
                                  }}
                                />
                              </div>
                              <input
                                type="range"
                                min="0.05"
                                max="5.0"
                                step="0.01"
                                value={cur.scaleZ ?? cur.scale ?? 1.0}
                                onChange={(e) => updateObjectTransform(selectedObjectId, 'scaleZ', e.target.value)}
                                style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Tab: Avatar Pose (Full Humanoid Body Positioning & Presets) */}
            {devTab === 'pose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(63, 63, 70, 0.4)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Yuki Avatar Pose & Body Positioning</span>
                  <button
                    onClick={handleResetPoseTab}
                    title="Reset all avatar pose joints back to default seated posture"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '10px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <RotateCcw style={{ width: '10px', height: '10px' }} />
                    <span>Reset All</span>
                  </button>
                </div>
                {renderAvatarPoseControls({ isDevMode: true })}
              </div>
            )}

            {/* Tab 2: Lights */}
            {devTab === 'lights' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Tab Header with Tab-Specific Reset */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(63, 63, 70, 0.4)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scene Lighting</span>
                  <button
                    onClick={handleResetLightsTab}
                    title="Reset all lights back to default parameters"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '10px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <RotateCcw style={{ width: '10px', height: '10px' }} />
                    <span>Reset Tab</span>
                  </button>
                </div>

                {/* Ambient Light Card */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(63, 63, 70, 0.5)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Ambient Light</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={normalizeColorHex(devConfig.lights?.ambient?.color, '#281932')}
                      onChange={(e) => updateLightParam('ambient', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{normalizeColorHex(devConfig.lights?.ambient?.color, '#281932')}</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#a1a1aa', marginBottom: '4px' }}>
                      <span>Intensity</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{devConfig.lights?.ambient?.intensity?.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="4.0"
                      step="0.05"
                      value={devConfig.lights?.ambient?.intensity ?? 1.4}
                      onChange={(e) => updateLightParam('ambient', 'intensity', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Key Spotlight Card */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(63, 63, 70, 0.5)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Key Directional Spotlight</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={normalizeColorHex(devConfig.lights?.keySpot?.color, '#ffeedd')}
                      onChange={(e) => updateLightParam('keySpot', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{normalizeColorHex(devConfig.lights?.keySpot?.color, '#ffeedd')}</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#a1a1aa', marginBottom: '4px' }}>
                      <span>Intensity</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{devConfig.lights?.keySpot?.intensity?.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="5.0"
                      step="0.1"
                      value={devConfig.lights?.keySpot?.intensity ?? 2.2}
                      onChange={(e) => updateLightParam('keySpot', 'intensity', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', paddingTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos X</span>
                      <input
                        type="number"
                        step="0.1"
                        value={devConfig.lights?.keySpot?.posX ?? 0.6}
                        onChange={(e) => updateLightParam('keySpot', 'posX', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos Y</span>
                      <input
                        type="number"
                        step="0.1"
                        value={devConfig.lights?.keySpot?.posY ?? 2.6}
                        onChange={(e) => updateLightParam('keySpot', 'posY', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos Z</span>
                      <input
                        type="number"
                        step="0.1"
                        value={devConfig.lights?.keySpot?.posZ ?? 1.2}
                        onChange={(e) => updateLightParam('keySpot', 'posZ', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Candle Point Light Card */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(63, 63, 70, 0.5)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Candle Point Light</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={normalizeColorHex(devConfig.lights?.candle?.color, '#ff9933')}
                      onChange={(e) => updateLightParam('candle', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{normalizeColorHex(devConfig.lights?.candle?.color, '#ff9933')}</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#a1a1aa', marginBottom: '4px' }}>
                      <span>Intensity</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{devConfig.lights?.candle?.intensity?.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="5.0"
                      step="0.1"
                      value={devConfig.lights?.candle?.intensity ?? 2.1}
                      onChange={(e) => updateLightParam('candle', 'intensity', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', paddingTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos X</span>
                      <input
                        type="number"
                        step="0.05"
                        value={devConfig.lights?.candle?.posX ?? 0.0}
                        onChange={(e) => updateLightParam('candle', 'posX', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos Y</span>
                      <input
                        type="number"
                        step="0.05"
                        value={devConfig.lights?.candle?.posY ?? 0.82}
                        onChange={(e) => updateLightParam('candle', 'posY', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', color: '#71717a', display: 'block', marginBottom: '2px' }}>Pos Z</span>
                      <input
                        type="number"
                        step="0.05"
                        value={devConfig.lights?.candle?.posZ ?? -0.18}
                        onChange={(e) => updateLightParam('candle', 'posZ', e.target.value)}
                        style={{ width: '100%', background: '#09090b', border: '1px solid rgba(63, 63, 70, 0.7)', borderRadius: '4px', padding: '3px 4px', fontSize: '10px', fontFamily: 'monospace', color: '#f4f4f5' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Embedded Map Lights Card (for 3D stages like Cute Cafe) */}
                {stageLightsRef.current?.length > 0 && (
                  <div style={{ background: 'rgba(24, 24, 27, 0.6)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.4)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Map Built-in Lights</span>
                      <span style={{ fontSize: '9px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
                        {stageLightsRef.current.length} Blender Lights
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#71717a' }}>Controls the Sun, table pendant lamps, sunbeams, and wall sconces imported from Blender.</span>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#a1a1aa', marginBottom: '4px' }}>
                        <span>Intensity Scale</span>
                        <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{(devConfig.lights?.mapLights?.intensity ?? 1.0).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="2.5"
                        step="0.05"
                        value={devConfig.lights?.mapLights?.intensity ?? 1.0}
                        onChange={(e) => updateLightParam('mapLights', 'intensity', e.target.value)}
                        style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Shaders & Camera */}
            {devTab === 'shaders' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Tab Header with Tab-Specific Reset */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(63, 63, 70, 0.4)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shaders & Camera</span>
                  <button
                    onClick={handleResetShadersTab}
                    title="Reset shaders, camera settings, and panorama framing back to defaults"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '10px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <RotateCcw style={{ width: '10px', height: '10px' }} />
                    <span>Reset Tab</span>
                  </button>
                </div>

                {/* Tone Mapping */}
                <div>
                  <label style={{ fontSize: '11px', color: '#a1a1aa', display: 'block', marginBottom: '4px' }}>Tone Mapping Shader</label>
                  <select
                    value={devConfig.shaders?.toneMapping || 'ACESFilmic'}
                    onChange={(e) => updateShaderParam('toneMapping', e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: '#18181b',
                      border: '1px solid rgba(63, 63, 70, 0.8)',
                      borderRadius: '10px',
                      padding: '6px 10px',
                      fontSize: '12px',
                      color: '#f4f4f5',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {Object.keys(TONE_MAPPINGS).map((tm) => (
                      <option key={tm} value={tm}>{tm}</option>
                    ))}
                  </select>
                </div>

                {/* Exposure */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Exposure</span>
                    <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{devConfig.shaders?.exposure?.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.05"
                    value={devConfig.shaders?.exposure ?? 1.1}
                    onChange={(e) => updateShaderParam('exposure', e.target.value)}
                    style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                  />
                </div>

                {/* Environment Reflection / Shine (IBL) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Environment Reflection (Gold/Metal Shine)</span>
                    <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{(devConfig.shaders?.envIntensity ?? 1.0).toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="2.5"
                    step="0.05"
                    value={devConfig.shaders?.envIntensity ?? 1.0}
                    onChange={(e) => updateShaderParam('envIntensity', e.target.value)}
                    style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                  />
                </div>

                {/* Camera Settings Card */}
                <div style={{ borderTop: '1px solid rgba(63, 63, 70, 0.5)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Camera Parameters</span>

                  {/* FOV */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Field of View (FOV)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{Math.round(devConfig.camera?.fov ?? 42)}°</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="95"
                      step="1"
                      value={devConfig.camera?.fov ?? 42}
                      onChange={(e) => updateCameraParam('fov', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Lateral Position X */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Lateral Position (X)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{devConfig.camera?.posX?.toFixed(2)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-3.0"
                      max="3.0"
                      step="0.01"
                      value={devConfig.camera?.posX ?? 0}
                      onChange={(e) => updateCameraParam('posX', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Eye Height */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Eye Height (Y)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{devConfig.camera?.posY?.toFixed(2)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-1.5"
                      max="3.5"
                      step="0.01"
                      value={devConfig.camera?.posY ?? 1.05}
                      onChange={(e) => updateCameraParam('posY', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Distance */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Distance (Z)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{devConfig.camera?.posZ?.toFixed(2)}m</span>
                    </div>
                    <input
                      type="range"
                      min="-4.0"
                      max="4.0"
                      step="0.01"
                      value={devConfig.camera?.posZ ?? 0.55}
                      onChange={(e) => updateCameraParam('posZ', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Look Direction (Yaw / Rot Y) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Look Direction (Yaw / Rot Y)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{Math.round(devConfig.camera?.rotY ?? 0)}°</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="1"
                      value={Math.round(devConfig.camera?.rotY ?? 0)}
                      onChange={(e) => updateCameraParam('rotY', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Look Tilt (Pitch / Rot X) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Look Tilt (Pitch / Rot X)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{Math.round(devConfig.camera?.rotX ?? 0)}°</span>
                    </div>
                    <input
                      type="range"
                      min="-60"
                      max="60"
                      step="1"
                      value={Math.round(devConfig.camera?.rotX ?? 0)}
                      onChange={(e) => updateCameraParam('rotX', e.target.value)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* 360 Panorama Framing Card */}
                <div style={{ borderTop: '1px solid rgba(63, 63, 70, 0.5)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>360° Panorama Framing</span>
                    <button
                      onClick={() => updateBgVerticalFraming(1.0, 0.0)}
                      style={{
                        padding: '2px 6px',
                        background: '#27272a',
                        border: '1px solid rgba(63, 63, 70, 0.6)',
                        borderRadius: '4px',
                        color: '#c4b5fd',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  {/* Scale */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Vertical Scale (Fit)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{bgVerticalScale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="2.2"
                      step="0.02"
                      value={bgVerticalScale}
                      onChange={(e) => updateBgVerticalFraming(parseFloat(e.target.value), bgVerticalOffset)}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Offset */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Horizon Offset (Y)</span>
                      <span style={{ color: '#c4b5fd', fontFamily: 'monospace', fontSize: '11px' }}>{bgVerticalOffset.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="-0.5"
                      max="0.5"
                      step="0.01"
                      value={bgVerticalOffset}
                      onChange={(e) => updateBgVerticalFraming(bgVerticalScale, parseFloat(e.target.value))}
                      style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Presets */}
                  <div style={{ display: 'flex', gap: '4px', paddingTop: '4px' }}>
                    {[
                      { label: 'Full 0.75x', scale: 0.75, offset: 0.0 },
                      { label: '1.0x Default', scale: 1.0, offset: 0.0 },
                      { label: 'Sky Focus', scale: 0.85, offset: -0.1 },
                      { label: 'Floor Focus', scale: 0.85, offset: 0.1 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        onClick={() => updateBgVerticalFraming(p.scale, p.offset)}
                        style={{
                          flex: 1,
                          padding: '4px 2px',
                          background: 'rgba(24, 24, 27, 0.8)',
                          border: '1px solid rgba(63, 63, 70, 0.5)',
                          borderRadius: '6px',
                          color: '#d4d4d8',
                          fontSize: '9px',
                          textAlign: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Diff Preview */}
            {devTab === 'diff' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Live Diff Snapshot:</span>
                  <button
                    onClick={handleCopyDiff}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      background: '#7c3aed',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#ffffff',
                      fontSize: '10px',
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    {copiedDiff ? <Check style={{ width: '12px', height: '12px' }} /> : <Copy style={{ width: '12px', height: '12px' }} />}
                    <span>{copiedDiff ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre style={{
                  background: '#000000',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '10px',
                  padding: '10px',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: '#34d399',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {modifiedCount > 0 ? JSON.stringify(activeDiff, null, 2) : '// No changes made yet'}
                </pre>

                {/* Saved Custom Profiles Section */}
                <div style={{ borderTop: '1px solid rgba(63, 63, 70, 0.5)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Bookmark style={{ width: '12px', height: '12px', color: '#c084fc' }} />
                      Saved Profiles ({Object.keys(savedProfiles).length + 1})
                    </span>
                  </div>

                  {/* Profile Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                    {/* Default Profile Entry */}
                    <div
                      style={{
                        padding: '6px 8px',
                        background: activeProfileId === 'default' ? 'rgba(124, 58, 237, 0.15)' : '#18181b',
                        border: activeProfileId === 'default' ? '1px solid #a78bfa' : '1px solid rgba(63, 63, 70, 0.4)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: activeProfileId === 'default' ? '#c4b5fd' : '#f4f4f5' }}>Default (Original Layout)</span>
                        <span style={{ fontSize: '9px', color: '#71717a' }}>Factory scene preset</span>
                      </div>
                      <button
                        onClick={() => handleSelectProfile('default')}
                        disabled={activeProfileId === 'default'}
                        style={{
                          padding: '3px 8px',
                          background: activeProfileId === 'default' ? 'transparent' : '#27272a',
                          border: '1px solid rgba(63, 63, 70, 0.6)',
                          borderRadius: '5px',
                          color: activeProfileId === 'default' ? '#34d399' : '#e4e4e7',
                          fontSize: '10px',
                          cursor: activeProfileId === 'default' ? 'default' : 'pointer'
                        }}
                      >
                        {activeProfileId === 'default' ? 'Active' : 'Load'}
                      </button>
                    </div>

                    {/* Custom Profiles */}
                    {Object.values(savedProfiles).map((prof) => {
                      const isActive = activeProfileId === prof.id;
                      return (
                        <div
                          key={prof.id}
                          style={{
                            padding: '6px 8px',
                            background: isActive ? 'rgba(124, 58, 237, 0.15)' : '#18181b',
                            border: isActive ? '1px solid #a78bfa' : '1px solid rgba(63, 63, 70, 0.4)',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '6px'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: isActive ? '#c4b5fd' : '#f4f4f5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {prof.name}
                            </span>
                            <span style={{ fontSize: '9px', color: '#71717a' }}>
                              Saved {new Date(prof.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                            <button
                              onClick={() => handleSelectProfile(prof.id)}
                              disabled={isActive}
                              style={{
                                padding: '3px 8px',
                                background: isActive ? 'transparent' : '#27272a',
                                border: '1px solid rgba(63, 63, 70, 0.6)',
                                borderRadius: '5px',
                                color: isActive ? '#34d399' : '#e4e4e7',
                                fontSize: '10px',
                                cursor: isActive ? 'default' : 'pointer'
                              }}
                            >
                              {isActive ? 'Active' : 'Load'}
                            </button>

                            <button
                              onClick={() => handleDeleteProfile(prof.id)}
                              title="Delete this custom profile"
                              style={{
                                padding: '3px 5px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '5px',
                                color: '#f87171',
                                cursor: 'pointer'
                              }}
                            >
                              <Trash2 style={{ width: '10px', height: '10px' }} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={() => setShowDiffModal(true)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#18181b',
                    border: '1px solid rgba(63, 63, 70, 0.7)',
                    borderRadius: '10px',
                    color: '#f4f4f5',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Open Full Diff Exporter
                </button>
              </div>
            )}
          </div>

          {/* Inspector Footer */}
          <div style={{
            padding: '10px 14px',
            borderTop: '1px solid rgba(63, 63, 70, 0.6)',
            background: 'rgba(24, 24, 27, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={handleResetToMapDefaults}
                title="Reset to this map's default positions"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 8px',
                  background: 'rgba(124, 58, 237, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '8px',
                  color: '#c4b5fd',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw style={{ width: '11px', height: '11px' }} />
                <span>Map Defaults</span>
              </button>

              <button
                onClick={handleResetAllDefaults}
                title="Reset All Changes Across All Tabs to Factory Defaults"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <Trash2 style={{ width: '11px', height: '11px' }} />
                <span>Factory Reset</span>
              </button>
            </div>

            <button
              onClick={() => setShowDiffModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                background: '#7c3aed',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              <Code style={{ width: '12px', height: '12px' }} />
              <span>Show All Changes ({modifiedCount})</span>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* DATE MODE SETTINGS MODAL */}
      {/* -------------------------------------------------------------------- */}
      {showSettings && (
        <div
          className="date-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(10px)',
            userSelect: 'none',
            fontFamily: 'Outfit, system-ui, sans-serif'
          }}
        >
          <div
            className="date-modal-content"
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: '#090d16',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
              color: '#f4f4f5',
              maxHeight: '88vh',
              overflowY: 'auto'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(63, 63, 70, 0.6)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings style={{ width: '20px', height: '20px', color: '#a78bfa' }} />
                <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#f4f4f5', margin: 0 }}>Date Mode Settings</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                style={{ background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', padding: '4px', borderRadius: '8px' }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* Atmosphere Destination */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' }}>Atmosphere</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {Object.values(DESTINATIONS).map((dest) => (
                  <button
                    key={dest.id}
                    onClick={() => {
                      setActiveDest(dest.id);
                      setDialogueText(dest.welcomeDialogue);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 500,
                      border: (activeDest === dest.id && !customBgUrl) ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.6)',
                      background: (activeDest === dest.id && !customBgUrl) ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.8)',
                      color: (activeDest === dest.id && !customBgUrl) ? '#ffffff' : '#a1a1aa',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                  >
                    {dest.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Yuki Avatar Pose & Body Positioning Card */}
            <div style={{ background: 'rgba(24, 24, 27, 0.8)', border: '1px solid rgba(139, 92, 246, 0.4)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <User style={{ width: '16px', height: '16px', color: '#a78bfa' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7' }}>Yuki Avatar Pose & Body Positioning</span>
                </div>
                <button
                  onClick={() => setDateSettingsPoseExpanded(!dateSettingsPoseExpanded)}
                  style={{
                    background: 'rgba(39, 39, 42, 0.6)',
                    border: '1px solid rgba(63, 63, 70, 0.5)',
                    borderRadius: '6px',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                    padding: '3px 8px',
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>{dateSettingsPoseExpanded ? 'Collapse' : 'Expand Controls'}</span>
                  {dateSettingsPoseExpanded ? <ChevronUp style={{ width: '12px', height: '12px' }} /> : <ChevronDown style={{ width: '12px', height: '12px' }} />}
                </button>
              </div>
              <p style={{ fontSize: '11px', color: '#71717a', margin: 0, lineHeight: '1.4' }}>
                Control Yuki's head, chest, torso, hips, arms, and legs to place her in any seated or expressive pose you want.
              </p>
              {dateSettingsPoseExpanded && renderAvatarPoseControls({ isDevMode: false })}
            </div>

            {/* Custom 360° Panorama Image Upload */}
            <div style={{ background: 'rgba(24, 24, 27, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4e7', fontFamily: 'monospace' }}>360° Panorama Image</span>
                <span style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontFamily: 'monospace',
                  background: customBgUrl ? 'rgba(139, 92, 246, 0.2)' : 'rgba(39, 39, 42, 0.8)',
                  color: customBgUrl ? '#c4b5fd' : '#71717a',
                  border: customBgUrl ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(63, 63, 70, 0.5)'
                }}>
                  {customBgUrl ? 'Custom Image' : 'Preset'}
                </span>
              </div>

              {customBgName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#a78bfa', background: 'rgba(139, 92, 246, 0.1)', padding: '6px 10px', borderRadius: '8px' }}>
                  <ImageIcon style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customBgName}</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: '#7c3aed',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)'
                  }}
                >
                  <Upload style={{ width: '14px', height: '14px' }} />
                  <span>Upload Custom 360° Panorama</span>
                </button>

                {customBgUrl && (
                  <button
                    onClick={handleClearCustomBg}
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(39, 39, 42, 0.8)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '10px',
                      color: '#a1a1aa',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    Reset to Preset
                  </button>
                )}
              </div>

              <p style={{ fontSize: '11px', color: '#71717a', margin: 0, lineHeight: '1.4' }}>
                Upload any 4K/8K equirectangular or wide panorama from your computer. It maps seamlessly to the 360° dome with zero cropping.
              </p>
            </div>

            {/* Panorama Vertical Crop & Framing Controls */}
            <div style={{ background: 'rgba(24, 24, 27, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4e7', display: 'block' }}>Vertical Framing & Fit</span>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>Control vertical cropping and horizon alignment</span>
                </div>
                <button
                  onClick={() => updateBgVerticalFraming(1.0, 0.0)}
                  style={{
                    fontSize: '10px',
                    color: '#a1a1aa',
                    padding: '2px 8px',
                    background: 'rgba(39, 39, 42, 0.8)',
                    border: '1px solid rgba(63, 63, 70, 0.5)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Reset Fit
                </button>
              </div>

              {/* Vertical Scale / Fit */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span style={{ color: '#a1a1aa' }}>Vertical Fit / Scale</span>
                  <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{bgVerticalScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="2.2"
                  step="0.02"
                  value={bgVerticalScale}
                  onChange={(e) => updateBgVerticalFraming(parseFloat(e.target.value), bgVerticalOffset)}
                  style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#71717a' }}>
                  <span>Show Full Picture (No Crop)</span>
                  <span>Default (1.0x)</span>
                  <span>Zoom In</span>
                </div>
              </div>

              {/* Vertical Horizon Offset */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span style={{ color: '#a1a1aa' }}>Vertical Horizon Offset</span>
                  <span style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{bgVerticalOffset.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.01"
                  value={bgVerticalOffset}
                  onChange={(e) => updateBgVerticalFraming(bgVerticalScale, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#71717a' }}>
                  <span>Pan Down</span>
                  <span>Center (0.0)</span>
                  <span>Pan Up</span>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div style={{ display: 'flex', gap: '6px', paddingTop: '4px' }}>
                {[
                  { label: 'Full Fit (0.75x)', scale: 0.75, offset: 0.0 },
                  { label: 'Standard (1.0x)', scale: 1.0, offset: 0.0 },
                  { label: 'Sky Focus', scale: 0.85, offset: -0.1 },
                  { label: 'Floor Focus', scale: 0.85, offset: 0.1 }
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => updateBgVerticalFraming(preset.scale, preset.offset)}
                    style={{
                      flex: 1,
                      padding: '6px 4px',
                      background: 'rgba(39, 39, 42, 0.7)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '8px',
                      color: '#d4d4d8',
                      fontSize: '10px',
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Terrace Ground / Floor Texture Options */}
            <div style={{ background: 'rgba(24, 24, 27, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4e7', fontFamily: 'monospace' }}>Terrace Ground / Floor Texture</span>
                <span style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontFamily: 'monospace',
                  background: customFloorUrl ? 'rgba(139, 92, 246, 0.2)' : 'rgba(39, 39, 42, 0.8)',
                  color: customFloorUrl ? '#c4b5fd' : '#71717a',
                  border: customFloorUrl ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(63, 63, 70, 0.5)'
                }}>
                  {customFloorUrl ? 'Custom Texture' : (FLOOR_TEXTURES[floorStyle]?.name || 'Preset')}
                </span>
              </div>

              {customFloorName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#a78bfa', background: 'rgba(139, 92, 246, 0.1)', padding: '6px 10px', borderRadius: '8px' }}>
                  <ImageIcon style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customFloorName}</span>
                </div>
              )}

              {/* Preset Floor Options */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {Object.values(FLOOR_TEXTURES).map((tex) => (
                  <button
                    key={tex.id}
                    onClick={() => handleSelectFloorStyle(tex.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: 500,
                      border: (floorStyle === tex.id && !customFloorUrl) ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.6)',
                      background: (floorStyle === tex.id && !customFloorUrl) ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.8)',
                      color: (floorStyle === tex.id && !customFloorUrl) ? '#ffffff' : '#a1a1aa',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s'
                    }}
                  >
                    {tex.name}
                  </button>
                ))}
              </div>

              {/* Custom Floor Upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => floorInputRef.current?.click()}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: '#7c3aed',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)'
                  }}
                >
                  <Upload style={{ width: '14px', height: '14px' }} />
                  <span>Upload Custom Floor Texture</span>
                </button>

                {customFloorUrl && (
                  <button
                    onClick={handleClearCustomFloor}
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(39, 39, 42, 0.8)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '10px',
                      color: '#a1a1aa',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    Reset to Preset
                  </button>
                )}
              </div>

              <p style={{ fontSize: '11px', color: '#71717a', margin: 0, lineHeight: '1.4' }}>
                Seamless Tokyo night deck wood, metropolitan stone tile, or upload your own 2K/4K texture.
              </p>
            </div>

            {/* Developer Mode Switch */}
            <div style={{ background: 'rgba(24, 24, 27, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '14px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ paddingRight: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders style={{ width: '16px', height: '16px', color: '#a78bfa' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7' }}>Developer Mode</span>
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    fontFamily: 'monospace',
                    background: devMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(39, 39, 42, 0.8)',
                    color: devMode ? '#c4b5fd' : '#71717a',
                    border: devMode ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(63, 63, 70, 0.5)'
                  }}>
                    {devMode ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: '#71717a', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                  Enable real-time 3D object click-to-transform, shaders, light tuning, and camera controls.
                </p>
              </div>

              {/* Custom Pill Toggle Switch */}
              <button
                onClick={() => setDevMode(!devMode)}
                style={{
                  width: '46px',
                  height: '24px',
                  borderRadius: '9999px',
                  background: devMode ? '#7c3aed' : '#3f3f46',
                  border: 'none',
                  padding: '2px',
                  cursor: 'pointer',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background-color 0.2s'
                }}
              >
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                    transform: devMode ? 'translateX(22px)' : 'translateX(0px)',
                    transition: 'transform 0.2s'
                  }}
                />
              </button>
            </div>

            {/* Export & Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
              <button
                onClick={() => {
                  setShowSettings(false);
                  setScenarioModalTab('list');
                  setShowScenarioModal(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(124, 58, 237, 0.2)',
                  border: '1px solid rgba(167, 139, 250, 0.5)',
                  borderRadius: '12px',
                  color: '#e4e4e7',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Box style={{ width: '16px', height: '16px', color: '#c084fc' }} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#f4f4f5' }}>Date Maps & 3D Stages</div>
                    <div style={{ fontSize: '10px', color: '#a1a1aa' }}>Manage Blender stages, 360 panoramas & custom prompts</div>
                  </div>
                </div>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', background: '#7c3aed', color: '#ffffff', fontFamily: 'monospace' }}>
                  {Object.keys(allScenarios).length} maps
                </span>
              </button>

              <button
                onClick={() => {
                  setShowSettings(false);
                  setShowDiffModal(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(124, 58, 237, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  borderRadius: '12px',
                  color: '#e4e4e7',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Code style={{ width: '16px', height: '16px', color: '#a78bfa' }} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#f4f4f5' }}>Show All Changes</div>
                    <div style={{ fontSize: '10px', color: '#a1a1aa' }}>View and copy configuration diff</div>
                  </div>
                </div>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', background: '#7c3aed', color: '#ffffff', fontFamily: 'monospace' }}>
                  {modifiedCount} diffs
                </span>
              </button>

              <button
                onClick={handleResetAllDefaults}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '8px',
                  background: 'rgba(24, 24, 27, 0.8)',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '12px',
                  color: '#a1a1aa',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                <Trash2 style={{ width: '14px', height: '14px' }} />
                <span>Reset All Parameters to Default</span>
              </button>

              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: '8px',
                  background: '#27272a',
                  border: '1px solid rgba(63, 63, 70, 0.6)',
                  borderRadius: '12px',
                  color: '#f4f4f5',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* SHOW ALL CHANGES DIFF EXPORTER MODAL */}
      {/* -------------------------------------------------------------------- */}
      {showDiffModal && (
        <div
          className="date-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(10px)',
            userSelect: 'none',
            fontFamily: 'Outfit, system-ui, sans-serif'
          }}
        >
          <div
            className="date-modal-content"
            style={{
              maxWidth: '600px',
              width: '100%',
              backgroundColor: '#090d16',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
              color: '#f4f4f5',
              maxHeight: '88vh',
              overflowY: 'auto'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(63, 63, 70, 0.6)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code style={{ width: '20px', height: '20px', color: '#a78bfa' }} />
                <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#f4f4f5', margin: 0 }}>Date Mode Configuration Diff</h2>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)', fontFamily: 'monospace' }}>
                  {modifiedCount} modified
                </span>
              </div>
              <button
                onClick={() => setShowDiffModal(false)}
                style={{ padding: '4px', background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', borderRadius: '6px' }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            <p style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: '1.5', margin: 0 }}>
              Here are all the custom positions, rotations, shaders, and lighting changes you made. Click <strong>Copy Changes</strong> to copy the JSON and paste it directly into our chat so I can configure things permanently!
            </p>

            {/* Formatted Code Block */}
            <div style={{ position: 'relative', flex: 1, overflow: 'hidden', borderRadius: '12px', border: '1px solid rgba(63, 63, 70, 0.7)', background: '#000000' }}>
              <pre style={{ padding: '14px', fontSize: '11px', fontFamily: 'monospace', color: '#34d399', overflowY: 'auto', maxHeight: '300px', margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.6', userSelect: 'text' }}>
                {modifiedCount > 0
                  ? JSON.stringify(activeDiff, null, 2)
                  : '// No changes made yet.\n// Adjust positions, lights, or shaders in Dev Mode to generate a diff!'}
              </pre>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px' }}>
              <button
                onClick={handleResetAllDefaults}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '10px',
                  color: '#f87171',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <Trash2 style={{ width: '14px', height: '14px' }} />
                <span>Reset All</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setShowDiffModal(false)}
                  style={{
                    padding: '8px 16px',
                    background: '#18181b',
                    border: '1px solid rgba(63, 63, 70, 0.7)',
                    borderRadius: '10px',
                    color: '#d4d4d8',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>

                <button
                  onClick={handleCopyDiff}
                  disabled={modifiedCount === 0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    background: '#7c3aed',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: modifiedCount === 0 ? 'default' : 'pointer',
                    opacity: modifiedCount === 0 ? 0.4 : 1,
                    boxShadow: '0 2px 10px rgba(124, 58, 237, 0.4)'
                  }}
                >
                  {copiedDiff ? <Check style={{ width: '14px', height: '14px' }} /> : <Copy style={{ width: '14px', height: '14px' }} />}
                  <span>{copiedDiff ? 'Copied to Clipboard!' : 'Copy Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* DATE MAPS & 3D STAGES SCENARIO MANAGER MODAL */}
      {/* -------------------------------------------------------------------- */}
      {showScenarioModal && (
        <div
          className="date-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(12px)',
            userSelect: 'none',
            fontFamily: 'Outfit, system-ui, sans-serif'
          }}
        >
          <div
            className="date-modal-content"
            style={{
              maxWidth: '720px',
              width: '100%',
              backgroundColor: '#090d16',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
              color: '#f4f4f5',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(63, 63, 70, 0.6)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box style={{ width: '20px', height: '20px', color: '#c084fc' }} />
                <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#f4f4f5', margin: 0 }}>Date Maps & 3D Stages</h2>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)', fontFamily: 'monospace' }}>
                  {Object.keys(allScenarios).length} total
                </span>
              </div>
              <button
                onClick={() => setShowScenarioModal(false)}
                style={{ padding: '4px', background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', borderRadius: '6px' }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(39, 39, 42, 0.8)', paddingBottom: '8px' }}>
              <button
                onClick={() => setScenarioModalTab('list')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: scenarioModalTab === 'list' ? '1px solid #8b5cf6' : '1px solid transparent',
                  background: scenarioModalTab === 'list' ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.6)',
                  color: scenarioModalTab === 'list' ? '#ffffff' : '#a1a1aa'
                }}
              >
                <Layers style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
                <span>Available Maps</span>
              </button>
              <button
                onClick={() => handleOpenScenarioEditor(null)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: scenarioModalTab === 'editor' ? '1px solid #8b5cf6' : '1px solid transparent',
                  background: scenarioModalTab === 'editor' ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.6)',
                  color: scenarioModalTab === 'editor' ? '#ffffff' : '#a1a1aa'
                }}
              >
                <Plus style={{ width: '14px', height: '14px', color: '#34d399' }} />
                <span>{editingScenario ? 'Edit Scenario' : 'Create / Upload New Map'}</span>
              </button>
            </div>

            {/* TAB 1: LIST VIEW */}
            {scenarioModalTab === 'list' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                  {Object.values(allScenarios).map((sc) => {
                    const isCurrent = activeDest === sc.id;
                    const isBuiltIn = Boolean(DEFAULT_SCENARIOS[sc.id]);
                    const is3d = sc.type === '3d_model';

                    return (
                      <div
                        key={sc.id}
                        style={{
                          background: isCurrent ? 'rgba(124, 58, 237, 0.15)' : 'rgba(24, 24, 27, 0.75)',
                          border: isCurrent ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.6)',
                          borderRadius: '14px',
                          padding: '14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {is3d ? (
                              <div style={{ padding: '4px 8px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#c084fc', fontWeight: 600 }}>
                                <Box style={{ width: '12px', height: '12px' }} />
                                <span>3D Stage</span>
                              </div>
                            ) : (
                              <div style={{ padding: '4px 8px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#93c5fd', fontWeight: 600 }}>
                                <ImageIcon style={{ width: '12px', height: '12px' }} />
                                <span>360° Panorama</span>
                              </div>
                            )}
                            <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'monospace' }}>
                              {isBuiltIn ? '(Built-in)' : '(Custom)'}
                            </span>
                          </div>

                          {isCurrent && (
                            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', background: '#34d399', color: '#064e3b', fontWeight: 700 }}>
                              Active
                            </span>
                          )}
                        </div>

                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>{sc.title}</div>
                          <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '2px', lineHeight: '1.4' }}>{sc.subtitle}</div>
                        </div>

                        {(sc.customPrompt || sc.prompt) && (
                          <div style={{ fontSize: '11px', color: '#d4d4d8', background: 'rgba(9, 13, 22, 0.6)', padding: '6px 8px', borderRadius: '8px', border: '1px solid rgba(63, 63, 70, 0.4)', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            Prompt: {sc.customPrompt || sc.prompt}
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '6px' }}>
                          <button
                            onClick={() => {
                              setActiveDest(sc.id);
                              if (sc.welcomeDialogue) setDialogueText(sc.welcomeDialogue);
                              setShowScenarioModal(false);
                            }}
                            style={{
                              flex: 1,
                              padding: '6px 10px',
                              background: isCurrent ? '#7c3aed' : 'rgba(39, 39, 42, 0.8)',
                              border: '1px solid rgba(63, 63, 70, 0.6)',
                              borderRadius: '8px',
                              color: '#ffffff',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            {isCurrent ? 'Current Map' : 'Activate'}
                          </button>

                          <button
                            onClick={() => handleOpenScenarioEditor(sc)}
                            title="Edit scenario settings & prompt"
                            style={{
                              padding: '6px 8px',
                              background: 'rgba(39, 39, 42, 0.8)',
                              border: '1px solid rgba(63, 63, 70, 0.6)',
                              borderRadius: '8px',
                              color: '#d4d4d8',
                              fontSize: '11px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Edit3 style={{ width: '12px', height: '12px' }} />
                            <span>Edit</span>
                          </button>

                          {!isBuiltIn && (
                            <button
                              onClick={() => handleDeleteScenario(sc.id)}
                              title="Delete custom date scenario"
                              style={{
                                padding: '6px 8px',
                                background: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                borderRadius: '8px',
                                color: '#f87171',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              <Trash2 style={{ width: '12px', height: '12px' }} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: MAP EDITOR & ASSET CONFIG */}
            {scenarioModalTab === 'editor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input
                  type="file"
                  ref={scenarioFileInputRef}
                  accept=".glb,.gltf,.png,.jpg,.jpeg,.webp"
                  onChange={handleUploadScenarioAsset}
                  style={{ display: 'none' }}
                />

                {/* Scenario Name & Subtitle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#a1a1aa', marginBottom: '4px' }}>
                      Scenario Title *
                    </label>
                    <input
                      type="text"
                      value={scenarioForm.title}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g. Cozy Book Cafe, Winter Onsen..."
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'rgba(24, 24, 27, 0.8)',
                        border: '1px solid rgba(63, 63, 70, 0.6)',
                        borderRadius: '10px',
                        color: '#f4f4f5',
                        fontSize: '12px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#a1a1aa', marginBottom: '4px' }}>
                      Atmosphere Subtitle
                    </label>
                    <input
                      type="text"
                      value={scenarioForm.subtitle}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, subtitle: e.target.value }))}
                      placeholder="e.g. Warm lights and gentle piano music"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'rgba(24, 24, 27, 0.8)',
                        border: '1px solid rgba(63, 63, 70, 0.6)',
                        borderRadius: '10px',
                        color: '#f4f4f5',
                        fontSize: '12px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                {/* Welcome Dialogue */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#a1a1aa', marginBottom: '4px' }}>
                    Welcome Dialogue (Spoken upon arrival)
                  </label>
                  <input
                    type="text"
                    value={scenarioForm.welcomeDialogue}
                    onChange={(e) => setScenarioForm((prev) => ({ ...prev, welcomeDialogue: e.target.value }))}
                    placeholder="e.g. I've been waiting for us to come here together!"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'rgba(24, 24, 27, 0.8)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '10px',
                      color: '#f4f4f5',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* Environment Type Switcher */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#a1a1aa', marginBottom: '4px' }}>
                    Environment Type
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setScenarioForm((prev) => ({ ...prev, type: '3d_model' }))}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: scenarioForm.type === '3d_model' ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.6)',
                        background: scenarioForm.type === '3d_model' ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.8)',
                        color: scenarioForm.type === '3d_model' ? '#ffffff' : '#a1a1aa',
                        cursor: 'pointer'
                      }}
                    >
                      <Box style={{ width: '14px', height: '14px', color: '#c084fc' }} />
                      <span>3D Blender Stage (.glb / .gltf)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScenarioForm((prev) => ({ ...prev, type: 'panorama' }))}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: scenarioForm.type === 'panorama' ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.6)',
                        background: scenarioForm.type === 'panorama' ? 'rgba(124, 58, 237, 0.25)' : 'rgba(24, 24, 27, 0.8)',
                        color: scenarioForm.type === 'panorama' ? '#ffffff' : '#a1a1aa',
                        cursor: 'pointer'
                      }}
                    >
                      <ImageIcon style={{ width: '14px', height: '14px', color: '#93c5fd' }} />
                      <span>360° Panoramic Texture (.png / .jpg)</span>
                    </button>
                  </div>
                </div>

                {/* Asset File Upload & URL */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>
                      {scenarioForm.type === '3d_model' ? '3D Stage Asset (.glb, .gltf)' : '360° Panorama Asset (.png, .jpg)'}
                    </span>
                    <button
                      type="button"
                      onClick={() => scenarioFileInputRef.current?.click()}
                      disabled={scenarioUploadProgress}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        background: '#7c3aed',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: scenarioUploadProgress ? 'default' : 'pointer',
                        boxShadow: '0 2px 8px rgba(124, 58, 237, 0.35)'
                      }}
                    >
                      <Upload style={{ width: '13px', height: '13px' }} />
                      <span>{scenarioUploadProgress ? 'Uploading...' : 'Upload Asset File'}</span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={scenarioForm.assetUrl}
                    onChange={(e) => setScenarioForm((prev) => ({ ...prev, assetUrl: e.target.value }))}
                    placeholder={scenarioForm.type === '3d_model' ? 'e.g. 3d_assets/date/CuteCafeMap.glb or /api/date/assets/...' : 'e.g. 3d_assets/date/sunset_terrace_360.png or /api/date/assets/...'}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'rgba(9, 13, 22, 0.8)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '8px',
                      color: '#f4f4f5',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <span style={{ fontSize: '10px', color: '#71717a' }}>
                    Upload Blender stages (.glb/.gltf) or 360° panoramas. Preset assets like <code style={{ color: '#a78bfa' }}>3d_assets/date/CuteCafeMap.glb</code> are automatically supported.
                  </span>
                </div>

                {/* Scenario-Specific System Prompt Directives */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#a1a1aa' }}>
                      Date Map Specific Prompt Directives
                    </label>
                    <span style={{ fontSize: '10px', color: '#a78bfa' }}>Injected into Yuki during date</span>
                  </div>
                  <textarea
                    rows={4}
                    value={scenarioForm.customPrompt}
                    onChange={(e) => setScenarioForm((prev) => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Define scenario-specific roleplay context for Yuki. E.g. 'You and Master are having a late-night dessert date in a cozy Parisian patisserie. You act sweet, offer bites of your pastry, and ask him about his dreams.'"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(24, 24, 27, 0.8)',
                      border: '1px solid rgba(63, 63, 70, 0.6)',
                      borderRadius: '10px',
                      color: '#f4f4f5',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* 3D Model Stage Settings (Table & Transform) */}
                {scenarioForm.type === '3d_model' && (
                  <div style={{ background: 'rgba(24, 24, 27, 0.6)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4e7' }}>Default Dining Table & Tableware</span>
                        <p style={{ fontSize: '10px', color: '#71717a', margin: '2px 0 0 0' }}>Keep default dining table, chairs, glasses, and dessert inside this 3D stage</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={scenarioForm.showDefaultTable}
                        onChange={(e) => setScenarioForm((prev) => ({ ...prev, showDefaultTable: e.target.checked }))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#7c3aed' }}
                      />
                    </div>

                    <div style={{ borderTop: '1px solid rgba(63, 63, 70, 0.4)', paddingTop: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#a1a1aa' }}>Stage Position & Scale Offsets</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '6px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: '#71717a' }}>Pos X</label>
                          <input
                            type="number"
                            step="0.1"
                            value={scenarioForm.modelTransform?.posX ?? 0}
                            onChange={(e) => setScenarioForm((prev) => ({
                              ...prev,
                              modelTransform: { ...(prev.modelTransform || {}), posX: parseFloat(e.target.value) || 0 }
                            }))}
                            style={{ width: '100%', padding: '4px 6px', background: 'rgba(9, 13, 22, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '6px', color: '#fff', fontSize: '11px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: '#71717a' }}>Pos Y</label>
                          <input
                            type="number"
                            step="0.1"
                            value={scenarioForm.modelTransform?.posY ?? -0.2}
                            onChange={(e) => setScenarioForm((prev) => ({
                              ...prev,
                              modelTransform: { ...(prev.modelTransform || {}), posY: parseFloat(e.target.value) || 0 }
                            }))}
                            style={{ width: '100%', padding: '4px 6px', background: 'rgba(9, 13, 22, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '6px', color: '#fff', fontSize: '11px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: '#71717a' }}>Pos Z</label>
                          <input
                            type="number"
                            step="0.1"
                            value={scenarioForm.modelTransform?.posZ ?? 0}
                            onChange={(e) => setScenarioForm((prev) => ({
                              ...prev,
                              modelTransform: { ...(prev.modelTransform || {}), posZ: parseFloat(e.target.value) || 0 }
                            }))}
                            style={{ width: '100%', padding: '4px 6px', background: 'rgba(9, 13, 22, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '6px', color: '#fff', fontSize: '11px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: '#71717a' }}>Scale</label>
                          <input
                            type="number"
                            step="0.1"
                            value={scenarioForm.modelTransform?.scale ?? 1.0}
                            onChange={(e) => setScenarioForm((prev) => ({
                              ...prev,
                              modelTransform: { ...(prev.modelTransform || {}), scale: parseFloat(e.target.value) || 1.0 }
                            }))}
                            style={{ width: '100%', padding: '4px 6px', background: 'rgba(9, 13, 22, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '6px', color: '#fff', fontSize: '11px' }}
                          />
                        </div>
                      </div>
                    </div>

                    {scenarioForm.id === 'marine_drive_night' && (
                      <div style={{ borderTop: '1px solid rgba(63, 63, 70, 0.4)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#a1a1aa' }}>Water Level Elevation (Y)</span>
                          <span style={{ fontSize: '10px', color: '#38bdf8' }}>{scenarioForm.waterLevel ?? -2.35}m</span>
                        </div>
                        <input
                          type="number"
                          step="0.05"
                          value={scenarioForm.waterLevel ?? -2.35}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || -2.35;
                            setScenarioForm((prev) => ({ ...prev, waterLevel: val }));
                            if (waterMeshRef.current) {
                              waterMeshRef.current.position.y = val;
                            }
                          }}
                          style={{ width: '100%', padding: '4px 6px', background: 'rgba(9, 13, 22, 0.8)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '6px', color: '#fff', fontSize: '11px' }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Lighting Overrides */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7' }}>Atmospheric Lighting Tuning</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '11px', color: '#a1a1aa' }}>Ambient Color</label>
                      <input
                        type="color"
                        value={normalizeColorHex(scenarioForm.ambientColor, '#ffeedd')}
                        onChange={(e) => setScenarioForm((prev) => ({ ...prev, ambientColor: normalizeColorHex(e.target.value) }))}
                        style={{ border: 'none', width: '28px', height: '24px', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '11px', color: '#a1a1aa' }}>Spotlight Color</label>
                      <input
                        type="color"
                        value={normalizeColorHex(scenarioForm.spotColor, '#ffe8c0')}
                        onChange={(e) => setScenarioForm((prev) => ({ ...prev, spotColor: normalizeColorHex(e.target.value) }))}
                        style={{ border: 'none', width: '28px', height: '24px', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Default Map Positions & Framing */}
                <div style={{ background: 'rgba(24, 24, 27, 0.6)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#e4e4e7' }}>Default Map Positions & Framing</span>
                    </div>
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      background: scenarioForm.defaultPositions ? 'rgba(124, 58, 237, 0.2)' : 'rgba(63, 63, 70, 0.4)',
                      color: scenarioForm.defaultPositions ? '#c4b5fd' : '#a1a1aa',
                      border: scenarioForm.defaultPositions ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid rgba(63, 63, 70, 0.5)'
                    }}>
                      {scenarioForm.defaultPositions ? 'Layout Configured' : 'Standard Preset'}
                    </span>
                  </div>

                  <p style={{ fontSize: '11px', color: '#71717a', margin: 0, lineHeight: 1.4 }}>
                    Select a camera framing & object layout preset for this map, or capture your live 3D scene positions.
                  </p>

                  {/* Layout Presets */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                    {Object.entries(MAP_POSITION_PRESETS).map(([key, preset]) => {
                      const isSelected = scenarioForm.defaultPositions && JSON.stringify(scenarioForm.defaultPositions) === JSON.stringify(preset.positions);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleSelectPositionPreset(key)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '2px',
                            padding: '8px 10px',
                            background: isSelected ? 'rgba(124, 58, 237, 0.25)' : 'rgba(9, 13, 22, 0.7)',
                            border: isSelected ? '1.5px solid #8b5cf6' : '1px solid rgba(63, 63, 70, 0.5)',
                            borderRadius: '8px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? '#c4b5fd' : '#e4e4e7' }}>
                              {preset.name}
                            </span>
                            {isSelected && <Check style={{ width: '12px', height: '12px', color: '#a78bfa' }} />}
                          </div>
                          <span style={{ fontSize: '9.5px', color: '#71717a', lineHeight: 1.2 }}>
                            {preset.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Capture & Reset Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                    <button
                      type="button"
                      onClick={handleCaptureCurrentPositions}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '7px 12px',
                        background: 'rgba(124, 58, 237, 0.15)',
                        border: '1px solid rgba(139, 92, 246, 0.4)',
                        borderRadius: '8px',
                        color: '#c4b5fd',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Camera style={{ width: '13px', height: '13px' }} />
                      <span>Capture Current Scene Positions</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectPositionPreset('standard_dining')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        padding: '7px 12px',
                        background: 'rgba(39, 39, 42, 0.7)',
                        border: '1px solid rgba(63, 63, 70, 0.5)',
                        borderRadius: '8px',
                        color: '#a1a1aa',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      <RotateCcw style={{ width: '12px', height: '12px' }} />
                      <span>Reset Layout</span>
                    </button>
                  </div>
                </div>

                {/* Editor Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid rgba(63, 63, 70, 0.6)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setScenarioModalTab('list')}
                      style={{
                        padding: '8px 14px',
                        background: 'rgba(39, 39, 42, 0.8)',
                        border: '1px solid rgba(63, 63, 70, 0.6)',
                        borderRadius: '10px',
                        color: '#a1a1aa',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Back to Maps
                    </button>

                    {editingScenario && !DEFAULT_SCENARIOS[editingScenario] && (
                      <button
                        type="button"
                        onClick={() => handleDeleteScenario(editingScenario)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 14px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          borderRadius: '10px',
                          color: '#f87171',
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 style={{ width: '13px', height: '13px' }} />
                        <span>Delete Map</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveScenario}
                    disabled={!scenarioForm.title.trim()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 20px',
                      background: '#7c3aed',
                      border: 'none',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: scenarioForm.title.trim() ? 'pointer' : 'default',
                      opacity: scenarioForm.title.trim() ? 1 : 0.4,
                      boxShadow: '0 2px 10px rgba(124, 58, 237, 0.4)'
                    }}
                  >
                    <Save style={{ width: '14px', height: '14px' }} />
                    <span>Save & Activate Map</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* FLOATING TABLETOP INTERACTION BUTTONS (Middle-Right Floating Tray) */}
      {/* -------------------------------------------------------------------- */}
      <div
        className="date-side-tray"
        style={{
          position: 'absolute',
          right: '24px',
          top: '76px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 100,
          pointerEvents: (isUiHidden || isUserInactive) ? 'none' : 'auto',
          opacity: (isUiHidden || isUserInactive) ? 0 : 1,
          transition: 'opacity 0.35s ease'
        }}
      >
        <button
          onClick={handleToastCheers}
          title={activeDest === 'cute_cafe' ? 'Sip Coffee with Yuki' : 'Toast with Yuki'}
          className="date-side-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            background: 'rgba(24, 24, 27, 0.85)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            color: '#e4e4e7',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s'
          }}
        >
          {activeDest === 'cute_cafe' ? (
            <Coffee style={{ width: '16px', height: '16px', color: '#f59e0b' }} />
          ) : (
            <Wine style={{ width: '16px', height: '16px', color: '#fb7185' }} />
          )}
          <span>{activeDest === 'cute_cafe' ? 'Sip Coffee' : 'Cheers!'}</span>
        </button>

        <button
          onClick={handleFeedDessert}
          title="Feed Her Dessert"
          className="date-side-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            background: 'rgba(24, 24, 27, 0.85)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            color: '#e4e4e7',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s'
          }}
        >
          <Cake style={{ width: '16px', height: '16px', color: '#fbbf24' }} />
          <span>Feed Dessert</span>
        </button>

        <button
          onClick={handleToggleCandle}
          title="Toggle Candle Ambiance"
          className="date-side-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            background: 'rgba(24, 24, 27, 0.85)',
            border: candleLit ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(63, 63, 70, 0.6)',
            color: candleLit ? '#fef3c7' : '#a1a1aa',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s'
          }}
        >
          <Flame style={{ width: '16px', height: '16px', color: candleLit ? '#fbbf24' : '#71717a' }} />
          <span>{candleLit ? 'Candle Lit' : 'Dim Lights'}</span>
        </button>

        <button
          onClick={handleGaze}
          title="Look into Her Eyes"
          className="date-side-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            background: 'rgba(24, 24, 27, 0.85)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            color: '#e4e4e7',
            borderRadius: '14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s'
          }}
        >
          <Heart style={{ width: '16px', height: '16px', color: '#f472b6' }} />
          <span>Eye Contact</span>
        </button>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* VISUAL NOVEL DIALOGUE & CHAT INTERACTION OVERLAY (Bottom Area) */}
      {/* -------------------------------------------------------------------- */}
      <footer
        className="date-footer"
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 48px)',
          maxWidth: '820px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 100,
          pointerEvents: isUiHidden ? 'none' : 'auto',
          opacity: isUiHidden ? 0 : 1,
          transition: 'opacity 0.25s ease'
        }}
      >
        {/* Quick Topic Chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
            pointerEvents: (isUiHidden || isUserInactive) ? 'none' : 'auto',
            opacity: (isUiHidden || isUserInactive) ? 0 : 1,
            transition: 'opacity 0.35s ease'
          }}
        >
          {[
            "You look gorgeous tonight.",
            "Cheers to us!",
            "What kind of music do you love?",
            "Tell me about your favorite memory.",
            "I'm really happy being with you."
          ].map((topic, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(topic)}
              style={{
                flexShrink: 0,
                padding: '4px 12px',
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#d4d4d8',
                border: '1px solid rgba(63, 63, 70, 0.5)',
                borderRadius: '9999px',
                fontSize: '12px',
                backdropFilter: 'blur(10px)',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {topic}
            </button>
          ))}
        </div>

        {/* Visual Novel Dialogue Card */}
        <div
          className="date-dialogue-box"
          style={{
            background: 'rgba(9, 13, 22, 0.88)',
            border: '1px solid rgba(63, 63, 70, 0.6)',
            borderRadius: '16px',
            padding: '16px 20px',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
          }}
        >
          {/* Character Name & Status Tag */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.05em', color: '#a78bfa', textTransform: 'uppercase', fontFamily: 'monospace' }}>Yuki</span>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {isPromenade && (
                <div
                  title={isExhaustedUI ? "Yuki is exhausted and out of breath!" : `Yuki's Stamina: ${yukiStaminaUI}%`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 9px',
                    borderRadius: '9999px',
                    background: isExhaustedUI ? 'rgba(239, 68, 68, 0.15)' : 'rgba(24, 24, 27, 0.7)',
                    border: isExhaustedUI ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(63, 63, 70, 0.5)',
                    transition: 'all 0.25s ease'
                  }}
                >
                  <Activity style={{ width: '12px', height: '12px', color: isExhaustedUI ? '#ef4444' : yukiStaminaUI < 40 ? '#f59e0b' : '#06b6d4' }} />
                  <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', fontFamily: 'monospace', color: isExhaustedUI ? '#fca5a5' : yukiStaminaUI < 40 ? '#fde68a' : '#a5f3fc' }}>
                    {isExhaustedUI ? 'PANTING' : `${yukiStaminaUI}%`}
                  </span>
                  <div style={{ width: '38px', height: '4px', borderRadius: '2px', background: 'rgba(255, 255, 255, 0.12)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, yukiStaminaUI))}%`,
                        height: '100%',
                        background: isExhaustedUI ? '#ef4444' : yukiStaminaUI < 40 ? '#f59e0b' : 'linear-gradient(90deg, #06b6d4, #10b981)',
                        transition: 'width 0.2s ease, background 0.3s ease'
                      }}
                    />
                  </div>
                </div>
              )}
              {isThinking && (
                <span style={{ fontSize: '12px', color: '#71717a', fontFamily: 'monospace', fontStyle: 'italic' }}>Yuki is thinking...</span>
              )}
            </div>
          </div>

          {/* Dialogue Text Box */}
          <div style={{ minHeight: '44px', fontSize: '14px', color: '#e4e4e7', lineHeight: '1.6', marginBottom: '12px' }}>
            {dialogueText}
          </div>

          {/* Interactive Chat Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', borderTop: '1px solid rgba(63, 63, 70, 0.5)' }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                if (proactiveDateTimerRef.current) {
                  clearTimeout(proactiveDateTimerRef.current);
                  proactiveDateTimerRef.current = null;
                }
              }}
              placeholder="Say something to Yuki..."
              style={{
                flex: 1,
                background: 'rgba(24, 24, 27, 0.8)',
                border: '1px solid rgba(63, 63, 70, 0.5)',
                borderRadius: '12px',
                padding: '8px 14px',
                fontSize: '12px',
                color: '#f4f4f5',
                outline: 'none'
              }}
            />

            {/* Voice Input / Microphone Toggle Button */}
            {(() => {
              const isVoiceActive = voiceState.isVoiceCommandMode || voiceState.isTalkMode;
              const isSessionActive = voiceState.isSessionActive;
              const isMicCapturing = voiceState.isListening || isListening;

              return (
                <button
                  type="button"
                  onClick={handleToggleVoiceInput}
                  title={
                    isSessionActive
                      ? "Continuous Listening Active (Speak freely to Yuki • Click to turn off)"
                      : isVoiceActive
                      ? "Voice Input Active (Listening for wake word or input • Click to turn off)"
                      : "Voice Input Inactive (Click to Activate Voice Input & Continuous Listening)"
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: isSessionActive
                      ? 'rgba(249, 115, 22, 0.22)'
                      : isVoiceActive
                      ? 'rgba(16, 185, 129, 0.22)'
                      : 'rgba(24, 24, 27, 0.8)',
                    border: isSessionActive
                      ? '1.5px solid #f97316'
                      : isVoiceActive
                      ? '1.5px solid #10b981'
                      : '1px solid rgba(63, 63, 70, 0.6)',
                    borderRadius: '12px',
                    color: isSessionActive ? '#fb923c' : isVoiceActive ? '#34d399' : '#a1a1aa',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    boxShadow: isSessionActive
                      ? '0 0 14px rgba(249, 115, 22, 0.45)'
                      : isVoiceActive
                      ? '0 0 14px rgba(16, 185, 129, 0.45)'
                      : 'none',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                >
                  {isSessionActive ? (
                    <>
                      <Mic style={{ width: '14px', height: '14px', color: '#fb923c' }} />
                      <span style={{ fontSize: '11px', letterSpacing: '0.02em', color: '#fed7aa' }}>Continuous</span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f97316' }} />
                    </>
                  ) : isVoiceActive ? (
                    <>
                      <Mic style={{ width: '14px', height: '14px', color: '#34d399' }} />
                      <span style={{ fontSize: '11px', letterSpacing: '0.02em', color: '#a7f3d0' }}>Listening</span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: isMicCapturing ? '#10b981' : '#059669' }} />
                    </>
                  ) : (
                    <>
                      <MicOff style={{ width: '14px', height: '14px', color: '#71717a' }} />
                      <span style={{ fontSize: '11px' }}>Voice Off</span>
                    </>
                  )}
                </button>
              );
            })()}

            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                padding: '8px 14px',
                background: '#7c3aed',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                cursor: inputText.trim() ? 'pointer' : 'default',
                opacity: inputText.trim() ? 1 : 0.4,
                boxShadow: inputText.trim() ? '0 2px 10px rgba(124, 58, 237, 0.4)' : 'none',
                transition: 'all 0.15s ease',
                flexShrink: 0
              }}
            >
              <Send style={{ width: '14px', height: '14px' }} />
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
