import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  Heart,
  Camera,
  Volume2,
  VolumeX,
  X,
  Send,
  Mic,
  MicOff,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Wine,
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
  Palette,
  Layers,
  Minimize2,
  Maximize2,
  Trash2,
  Upload,
  Image as ImageIcon
} from 'lucide-react';
import { API_BASE, WS_BASE } from './api';
import { stripAnimationTags, parseResponseTags } from './utils/responseParser';

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

// Resolves relative asset URLs cleanly across both dev server and packaged Electron (file:// protocol)
export function resolveAssetPath(relPath) {
  const clean = String(relPath || '').replace(/^\.?\//, '');
  return `./${clean}`;
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

// ============================================================================
// DATE DESTINATIONS CONFIGURATION
// ============================================================================
const DESTINATIONS = {
  tokyo_sky_lounge: {
    id: 'tokyo_sky_lounge',
    title: 'Tokyo Sky Lounge',
    subtitle: 'Romantic Dinner overlooking the glowing city lights',
    bg: resolveAssetPath('3d_assets/date/bg/tokyo_sky_lounge.png'),
    ambientColor: 0xff0000,
    ambientIntensity: 1.15,
    spotColor: 0xffeedd,
    spotIntensity: 2.0,
    candleColor: 0xff9933,
    welcomeDialogue: "This table has such a breathtaking view of the city tonight... I'm so glad we came here together."
  },
  beach_sunset: {
    id: 'beach_sunset',
    title: 'Sunset Beach Terrace',
    subtitle: 'Golden hour dinner listening to gentle ocean waves',
    bg: resolveAssetPath('3d_assets/date/bg/beach_sunset.png'),
    ambientColor: 0x3d1b14,
    ambientIntensity: 1.5,
    spotColor: 0xff8e40,
    spotIntensity: 2.2,
    candleColor: 0xffc470,
    welcomeDialogue: "Look at that sunset over the ocean... the golden colors are magical. Let's stay until the stars come out!"
  },
  cinema_lounge: {
    id: 'cinema_lounge',
    title: 'VIP Cinema Lounge',
    subtitle: 'Private velvet lounge seating with cinema screen ambiance',
    bg: resolveAssetPath('3d_assets/date/bg/cinema_lounge.png'),
    ambientColor: 0x140a1c,
    ambientIntensity: 1.2,
    spotColor: 0x8aa8ff,
    spotIntensity: 1.8,
    candleColor: 0xff9944,
    welcomeDialogue: "We have the whole VIP lounge to ourselves! What are you in the mood to watch tonight?"
  }
};

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
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  Linear: THREE.LinearToneMapping,
  AgX: THREE.AgXToneMapping || THREE.ACESFilmicToneMapping
};

export const POSE_PRESETS = {
  default: {
    id: 'default',
    label: 'Default Seated',
    desc: 'Natural dining posture with hands resting near table',
    pose: {
      leftArm: { upperPitch: 0.70, upperYaw: 0.15, upperRoll: 0.90, lowerFlex: 0.95, lowerTwist: -0.15, lowerAngle: 0.35, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 },
      rightArm: { upperPitch: 0.70, upperYaw: -0.15, upperRoll: -0.90, lowerFlex: 0.95, lowerTwist: 0.15, lowerAngle: -0.35, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 }
    }
  },
  hands_on_table: {
    id: 'hands_on_table',
    label: 'Hands on Table',
    desc: 'Arms forward with palms rested flat on the dining table',
    pose: {
      leftArm: { upperPitch: 0.85, upperYaw: 0.10, upperRoll: 0.75, lowerFlex: 1.10, lowerTwist: -0.30, lowerAngle: 0.20, handPitch: -0.20, handYaw: 0.05, handRoll: 0.15 },
      rightArm: { upperPitch: 0.85, upperYaw: -0.10, upperRoll: -0.75, lowerFlex: 1.10, lowerTwist: 0.30, lowerAngle: -0.20, handPitch: -0.20, handYaw: -0.05, handRoll: -0.15 }
    }
  },
  clasped_hands: {
    id: 'clasped_hands',
    label: 'Clasped Hands',
    desc: 'Attentive seated posture with hands clasped together in front',
    pose: {
      leftArm: { upperPitch: 0.75, upperYaw: 0.30, upperRoll: 0.65, lowerFlex: 1.25, lowerTwist: -0.40, lowerAngle: 0.45, handPitch: 0.10, handYaw: 0.25, handRoll: 0.10 },
      rightArm: { upperPitch: 0.75, upperYaw: -0.30, upperRoll: -0.65, lowerFlex: 1.25, lowerTwist: 0.40, lowerAngle: -0.45, handPitch: 0.10, handYaw: -0.25, handRoll: -0.10 }
    }
  },
  relaxed_lap: {
    id: 'relaxed_lap',
    label: 'Relaxed Lap',
    desc: 'Relaxed posture with arms resting down towards the lap',
    pose: {
      leftArm: { upperPitch: 0.35, upperYaw: 0.05, upperRoll: 0.25, lowerFlex: 0.70, lowerTwist: -0.10, lowerAngle: 0.10, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 },
      rightArm: { upperPitch: 0.35, upperYaw: -0.05, upperRoll: -0.25, lowerFlex: 0.70, lowerTwist: 0.10, lowerAngle: -0.10, handPitch: 0.0, handYaw: 0.0, handRoll: 0.0 }
    }
  }
};

export const DEFAULT_DATE_CONFIG = {
  shaders: {
    toneMapping: 'Reinhard',
    exposure: 1.1
  },
  camera: {
    fov: 42,
    posX: 0,
    posY: 2.3,
    posZ: 0.45
  },
  lights: {
    ambient: {
      color: '#ff0000',
      intensity: 1.15
    },
    keySpot: {
      color: '#ffeedd',
      intensity: 2.0,
      posX: 0.7,
      posY: -0.3,
      posZ: 1.7
    },
    candle: {
      color: '#ff9933',
      intensity: 2.2,
      posX: 0.0,
      posY: 1.52,
      posZ: 0.22
    }
  },
  objects: {
    playerPov: { name: "Player's POV (Camera)", posX: 0, posY: 2.3, posZ: 0.45, rotY: 0, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 },
    yuki: { name: 'Yuki Avatar', posX: 0, posY: 0.68, posZ: -0.2, rotY: 178, scale: 1.12, scaleX: 1.12, scaleY: 1.12, scaleZ: 1.12 },
    chair: { name: 'Dining Chair', posX: 0.09, posY: -0.31, posZ: -1.15, rotY: 7, scale: 2.79, scaleX: 2.79, scaleY: 2.79, scaleZ: 2.79 },
    table: { name: 'Dining Table', posX: 0, posY: 1.21, posZ: 0.32, rotY: 0, scale: 0.53, scaleX: 0.6, scaleY: 1.05, scaleZ: 0.6 },
    candleGLB: { name: 'Candle Hurricane', posX: 0, posY: 2.05, posZ: 0.43, rotY: 0, scale: 0.12, scaleX: 0.12, scaleY: 0.12, scaleZ: 0.12 },
    vaseGLB: { name: 'Flower Vase', posX: -0.15, posY: 2.02, posZ: 0.36, rotY: 77, scale: 0.41, scaleX: 0.41, scaleY: 0.41, scaleZ: 0.41 },
    bottleGLB: { name: 'Water Bottle', posX: 0.09, posY: 2.05, posZ: 0.26, rotY: 0, scale: 0.26, scaleX: 0.26, scaleY: 0.26, scaleZ: 0.26 },
    cake: { name: 'Dessert Cake & Plate', posX: 0, posY: 2.02, posZ: 0.19, rotY: 0, scale: 0.34, scaleX: 0.34, scaleY: 0.34, scaleZ: 0.34 },
    herGlass: { name: "Yuki's Wine Glass", posX: 0.13, posY: 1.58, posZ: 0.16, rotY: 0, scale: 0.67, scaleX: 0.67, scaleY: 0.67, scaleZ: 0.67 },
    yourGlass: { name: "Player's Wine Glass", posX: -0.09, posY: 1.58, posZ: 0.34, rotY: 0, scale: 0.6, scaleX: 0.6, scaleY: 0.6, scaleZ: 0.6 },
    floor: { name: 'Terrace Floor / Ground', posX: 0, posY: -0.41, posZ: 0, rotY: 0, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 },
    bgSphere: { name: '360 Sky Dome', posX: 0, posY: -2, posZ: -2.36, rotY: 175, scale: 1.0, scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 }
  },
  avatarPose: {
    leftArm: {
      upperPitch: 0.70,
      upperYaw: 0.15,
      upperRoll: 0.90,
      lowerFlex: 0.95,
      lowerTwist: -0.15,
      lowerAngle: 0.35,
      handPitch: 0.0,
      handYaw: 0.0,
      handRoll: 0.0
    },
    rightArm: {
      upperPitch: 0.70,
      upperYaw: -0.15,
      upperRoll: -0.90,
      lowerFlex: 0.95,
      lowerTwist: 0.15,
      lowerAngle: -0.35,
      handPitch: 0.0,
      handYaw: 0.0,
      handRoll: 0.0
    }
  }
};

export function computeConfigDiff(current, initial = DEFAULT_DATE_CONFIG) {
  const diff = {};

  // 1. Shaders
  const shaderDiff = {};
  if (current.shaders?.toneMapping && current.shaders.toneMapping !== initial.shaders.toneMapping) {
    shaderDiff.toneMapping = current.shaders.toneMapping;
  }
  if (current.shaders?.exposure !== undefined && Math.abs(current.shaders.exposure - initial.shaders.exposure) > 0.01) {
    shaderDiff.exposure = Number(current.shaders.exposure.toFixed(2));
  }
  if (Object.keys(shaderDiff).length > 0) diff.shaders = shaderDiff;

  // 2. Camera
  const camDiff = {};
  if (current.camera?.fov !== undefined && Math.abs(current.camera.fov - initial.camera.fov) > 0.1) {
    camDiff.fov = Number(current.camera.fov.toFixed(1));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.camera?.[axis] !== undefined && Math.abs(current.camera[axis] - initial.camera[axis]) > 0.005) {
      camDiff[axis] = Number(current.camera[axis].toFixed(3));
    }
  }
  if (Object.keys(camDiff).length > 0) diff.camera = camDiff;

  // 3. Lights
  const lightsDiff = {};
  const ambDiff = {};
  if (current.lights?.ambient?.color && current.lights.ambient.color.toLowerCase() !== initial.lights.ambient.color.toLowerCase()) {
    ambDiff.color = current.lights.ambient.color;
  }
  if (current.lights?.ambient?.intensity !== undefined && Math.abs(current.lights.ambient.intensity - initial.lights.ambient.intensity) > 0.02) {
    ambDiff.intensity = Number(current.lights.ambient.intensity.toFixed(2));
  }
  if (Object.keys(ambDiff).length > 0) lightsDiff.ambient = ambDiff;

  const keyDiff = {};
  if (current.lights?.keySpot?.color && current.lights.keySpot.color.toLowerCase() !== initial.lights.keySpot.color.toLowerCase()) {
    keyDiff.color = current.lights.keySpot.color;
  }
  if (current.lights?.keySpot?.intensity !== undefined && Math.abs(current.lights.keySpot.intensity - initial.lights.keySpot.intensity) > 0.02) {
    keyDiff.intensity = Number(current.lights.keySpot.intensity.toFixed(2));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.lights?.keySpot?.[axis] !== undefined && Math.abs(current.lights.keySpot[axis] - initial.lights.keySpot[axis]) > 0.005) {
      keyDiff[axis] = Number(current.lights.keySpot[axis].toFixed(3));
    }
  }
  if (Object.keys(keyDiff).length > 0) lightsDiff.keySpot = keyDiff;

  const candleDiff = {};
  if (current.lights?.candle?.color && current.lights.candle.color.toLowerCase() !== initial.lights.candle.color.toLowerCase()) {
    candleDiff.color = current.lights.candle.color;
  }
  if (current.lights?.candle?.intensity !== undefined && Math.abs(current.lights.candle.intensity - initial.lights.candle.intensity) > 0.02) {
    candleDiff.intensity = Number(current.lights.candle.intensity.toFixed(2));
  }
  for (const axis of ['posX', 'posY', 'posZ']) {
    if (current.lights?.candle?.[axis] !== undefined && Math.abs(current.lights.candle[axis] - initial.lights.candle[axis]) > 0.005) {
      candleDiff[axis] = Number(current.lights.candle[axis].toFixed(3));
    }
  }
  if (Object.keys(candleDiff).length > 0) lightsDiff.candle = candleDiff;
  if (Object.keys(lightsDiff).length > 0) diff.lights = lightsDiff;

  // 4. Objects
  const objectsDiff = {};
  for (const [key, initObj] of Object.entries(initial.objects)) {
    const curObj = current.objects?.[key];
    if (!curObj) continue;
    const objChanges = {};
    for (const prop of ['posX', 'posY', 'posZ']) {
      if (curObj[prop] !== undefined && Math.abs(curObj[prop] - initObj[prop]) > 0.005) {
        objChanges[prop] = Number(curObj[prop].toFixed(3));
      }
    }
    if (curObj.rotY !== undefined && Math.abs(curObj.rotY - initObj.rotY) > 0.5) {
      objChanges.rotY = Math.round(curObj.rotY);
    }
    if (curObj.scale !== undefined && Math.abs(curObj.scale - initObj.scale) > 0.01) {
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
  if (Object.keys(objectsDiff).length > 0) diff.objects = objectsDiff;

  // 5. Avatar Pose
  if (current.avatarPose) {
    const poseDiff = {};
    for (const side of ['leftArm', 'rightArm']) {
      const curArm = current.avatarPose?.[side];
      const initArm = initial.avatarPose?.[side];
      if (!curArm || !initArm) continue;
      const armChanges = {};
      for (const prop of ['upperPitch', 'upperYaw', 'upperRoll', 'lowerFlex', 'lowerTwist', 'lowerAngle', 'handPitch', 'handYaw', 'handRoll']) {
        if (curArm[prop] !== undefined && initArm[prop] !== undefined && Math.abs(curArm[prop] - initArm[prop]) > 0.005) {
          armChanges[prop] = Number(curArm[prop].toFixed(2));
        }
      }
      if (Object.keys(armChanges).length > 0) {
        poseDiff[side] = armChanges;
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
    if (custom.avatarPose.leftArm) {
      result.avatarPose.leftArm = { ...(result.avatarPose.leftArm || {}), ...custom.avatarPose.leftArm };
    }
    if (custom.avatarPose.rightArm) {
      result.avatarPose.rightArm = { ...(result.avatarPose.rightArm || {}), ...custom.avatarPose.rightArm };
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

  // Destination & Atmosphere
  const [activeDest, setActiveDest] = useState('tokyo_sky_lounge');
  const [candleLit, setCandleLit] = useState(true);
  const [bgmMuted, setBgmMuted] = useState(false);

  // Character & Interaction
  const [dialogueText, setDialogueText] = useState(DESTINATIONS.tokyo_sky_lounge.welcomeDialogue);
  const [characterMood, setCharacterMood] = useState('happy');
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [polaroidFlash, setPolaroidFlash] = useState(false);

  // Three.js internal references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const vrmRef = useRef(null);
  const candleLightRef = useRef(null);
  const ambientLightRef = useRef(null);
  const spotLightRef = useRef(null);
  const bgMeshRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const animFrameIdRef = useRef(null);
  const isToastingRef = useRef(false);

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
  const [activeProfileId, setActiveProfileId] = useState(() => {
    try {
      return localStorage.getItem('yuki_date_active_profile_id') || 'default';
    } catch (_) {
      return 'default';
    }
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileSaveSuccess, setProfileSaveSuccess] = useState(false);

  const [devConfig, setDevConfig] = useState(() => {
    const profiles = loadSavedProfiles();
    const storedId = (() => {
      try { return localStorage.getItem('yuki_date_active_profile_id') || 'default'; } catch (_) { return 'default'; }
    })();
    if (storedId !== 'default' && profiles[storedId]?.config) {
      return mergeConfig(DEFAULT_DATE_CONFIG, profiles[storedId].config);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG));
  });
  const devConfigRef = useRef(devConfig);
  useEffect(() => {
    devConfigRef.current = devConfig;
  }, [devConfig]);
  const [poseSelectedArm, setPoseSelectedArm] = useState('leftArm'); // 'leftArm' | 'rightArm'
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

  // Broadcast Date Mode active state across windows to suppress duplicate main-app audio
  useEffect(() => {
    try {
      localStorage.setItem('yuki_date_mode_active', 'true');
      const bc = new BroadcastChannel('yuki_date_mode_channel');
      bc.postMessage({ active: true });
      bc.close();
    } catch (_) {}

    const handleBeforeUnload = () => {
      try {
        localStorage.setItem('yuki_date_mode_active', 'false');
        const bc = new BroadcastChannel('yuki_date_mode_channel');
        bc.postMessage({ active: false });
        bc.close();
      } catch (_) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, []);

  // 1. DEDICATED GPU CHECK ON MOUNT
  useEffect(() => {
    const gpuResult = inspectWebGLGPU();
    setGpuCheck(gpuResult);
    if (!gpuResult.ok) {
      setIsInitializing(false);
    }
  }, []);

  // 1B. Dynamic Background Panorama & Lighting Sync (Seamless destination transitions)
  useEffect(() => {
    const dest = DESTINATIONS[activeDest];
    if (!dest) return;

    if (bgMeshRef.current) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(dest.bg, (newTex) => {
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
      });
    }

    if (ambientLightRef.current) {
      ambientLightRef.current.color.setHex(dest.ambientColor);
      ambientLightRef.current.intensity = dest.ambientIntensity;
    }
    if (spotLightRef.current) {
      spotLightRef.current.color.setHex(dest.spotColor);
      spotLightRef.current.intensity = dest.spotIntensity;
    }
    if (candleLightRef.current) {
      candleLightRef.current.color.setHex(dest.candleColor);
    }
  }, [activeDest]);

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

  const playNextAudioInQueue = useCallback(() => {
    if (!audioQueueRef.current || audioQueueRef.current.length === 0) {
      isAudioPlayingRef.current = false;
      return;
    }

    isAudioPlayingRef.current = true;
    const nextItem = audioQueueRef.current.shift();
    currentVisemesRef.current = nextItem.visemes || null;
    setupAudioPipeline();

    const audioEl = persistentAudioRef.current;
    if (!audioEl) {
      isAudioPlayingRef.current = false;
      currentVisemesRef.current = null;
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
  }, [setupAudioPipeline]);

  playNextAudioRef.current = playNextAudioInQueue;

  const stopAllDateAudio = useCallback(() => {
    audioQueueRef.current = [];
    currentVisemesRef.current = null;
    isAudioPlayingRef.current = false;
    if (persistentAudioRef.current) {
      persistentAudioRef.current.pause();
      persistentAudioRef.current.removeAttribute('src');
      persistentAudioRef.current.load();
    }
  }, []);

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
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);

            if (data.type === 'status') {
              if (data.status === 'thinking') {
                setIsThinking(true);
              } else if (data.status === 'idle') {
                setIsThinking(false);
              }
            } else if (data.type === 'text_stream') {
              if (data.final === false) {
                // Intermediate reasoning / tool execution status
                setIsThinking(true);
                return;
              }
              setIsThinking(false);
              accumulatedDialogueRef.current += data.text || '';
              const { cleanText } = parseResponseTags(accumulatedDialogueRef.current, {
                onEmotion: (emotionName) => {
                  const mapped = emotionName === 'happy' ? 'relaxed' : emotionName;
                  setCharacterMood(mapped);
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
            } else if (data.type === 'mood_update') {
              if (data.mood?.expression) {
                setCharacterMood(data.mood.expression);
              }
            } else if (data.type === 'turn_interrupted') {
              setIsThinking(false);
              stopAllDateAudio();
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
    renderer.toneMapping = TONE_MAPPINGS[shaderCfg.toneMapping] || THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = shaderCfg.exposure ?? 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    // First-Person Perspective Camera (Eye-level seated position across the dining table)
    const camCfg = activeCfg.camera || DEFAULT_DATE_CONFIG.camera;
    const camera = new THREE.PerspectiveCamera(camCfg.fov ?? 42, width / height, 0.1, 100);
    camera.rotation.order = 'YXZ';
    camera.position.set(camCfg.posX ?? 0, camCfg.posY ?? 2.3, camCfg.posZ ?? 0.45);
    cameraRef.current = camera;
    sceneObjectsRef.current.playerPov = camera;

    // Lighting Configuration
    const currentDest = DESTINATIONS[activeDest] || DESTINATIONS.tokyo_sky_lounge;
    const ambCfg = activeCfg.lights?.ambient || DEFAULT_DATE_CONFIG.lights.ambient;
    const ambientLight = new THREE.AmbientLight(ambCfg.color || currentDest.ambientColor, ambCfg.intensity ?? currentDest.ambientIntensity);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const spotCfg = activeCfg.lights?.keySpot || DEFAULT_DATE_CONFIG.lights.keySpot;
    const keySpot = new THREE.DirectionalLight(spotCfg.color || currentDest.spotColor, spotCfg.intensity ?? currentDest.spotIntensity);
    keySpot.position.set(spotCfg.posX ?? 0.7, spotCfg.posY ?? -0.3, spotCfg.posZ ?? 1.7);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.width = 1024;
    keySpot.shadow.mapSize.height = 1024;
    keySpot.shadow.bias = -0.0005;
    scene.add(keySpot);
    spotLightRef.current = keySpot;

    // Warm Candle Point Light at tabletop
    const candleCfg = activeCfg.lights?.candle || DEFAULT_DATE_CONFIG.lights.candle;
    const candleLight = new THREE.PointLight(candleCfg.color || currentDest.candleColor, candleCfg.intensity ?? 2.2, 4.0, 2.0);
    candleLight.position.set(candleCfg.posX ?? 0.0, candleCfg.posY ?? 1.52, candleCfg.posZ ?? 0.22);
    candleLight.castShadow = true;
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
    scene.add(floorMesh);
    floorMeshRef.current = floorMesh;
    sceneObjectsRef.current.floor = floorMesh;

    // Full 360° Equirectangular Panoramic Sky Environment (No black voids)
    const textureLoader = new THREE.TextureLoader();
    const initialBg = customBgUrl || currentDest.bg;
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

    scene.add(tableGroup);
    sceneObjectsRef.current.table = tableGroup;

    // Physical Transmission Wine Glasses (Zero-overhead Three.js PBR)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95,
      roughness: 0.05,
      ior: 1.5,
      transparent: true,
      opacity: 1.0,
      metalness: 0.0,
      clearcoat: 1.0
    });
    const glassGeo = new THREE.CylinderGeometry(0.038, 0.012, 0.12, 24, 1, true);

    const wineMat = new THREE.MeshStandardMaterial({
      color: 0x6e0918,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85
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

    scene.add(cakeGroup);
    sceneObjectsRef.current.cake = cakeGroup;

    // 4. Load CC0 GLB Assets from 3d_assets/date (Dining Chair, Candle Hurricane, Flower Vase, Water Bottle)
    const gltfLoader = new GLTFLoader();

    // Dining Chair under Yuki - facing +Z towards player
    gltfLoader.load(resolveAssetPath('3d_assets/date/SheenChair.glb'), (gltf) => {
      const chair = gltf.scene;
      const cObj = devConfigRef.current?.objects?.chair || DEFAULT_DATE_CONFIG.objects.chair;
      chair.scale.set(cObj.scaleX ?? cObj.scale ?? 2.79, cObj.scaleY ?? cObj.scale ?? 2.79, cObj.scaleZ ?? cObj.scale ?? 2.79);
      chair.position.set(cObj.posX ?? 0.09, cObj.posY ?? -0.31, cObj.posZ ?? -1.15);
      chair.rotation.y = (cObj.rotY ?? 7) * (Math.PI / 180);
      chair.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(chair);
      sceneObjectsRef.current.chair = chair;
    }, undefined, (err) => console.warn('[DateMode] Chair load note:', err));

    // Candle Hurricane on table center
    gltfLoader.load(resolveAssetPath('3d_assets/date/GlassHurricaneCandleHolder.glb'), (gltf) => {
      const candle = gltf.scene;
      const cObj = devConfigRef.current?.objects?.candleGLB || DEFAULT_DATE_CONFIG.objects.candleGLB;
      candle.scale.set(cObj.scaleX ?? cObj.scale ?? 0.12, cObj.scaleY ?? cObj.scale ?? 0.12, cObj.scaleZ ?? cObj.scale ?? 0.12);
      candle.position.set(cObj.posX ?? 0, cObj.posY ?? 2.05, cObj.posZ ?? 0.43);
      candle.rotation.y = (cObj.rotY ?? 0) * (Math.PI / 180);
      candle.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
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
      vase.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(vase);
      sceneObjectsRef.current.vaseGLB = vase;
    }, undefined, (err) => console.warn('[DateMode] Vase load note:', err));

    // Water Bottle on table side
    gltfLoader.load(resolveAssetPath('3d_assets/date/WaterBottle.glb'), (gltf) => {
      const bottle = gltf.scene;
      const bObj = devConfigRef.current?.objects?.bottleGLB || DEFAULT_DATE_CONFIG.objects.bottleGLB;
      bottle.scale.set(bObj.scaleX ?? bObj.scale ?? 0.26, bObj.scaleY ?? bObj.scale ?? 0.26, bObj.scaleZ ?? bObj.scale ?? 0.26);
      bottle.position.set(bObj.posX ?? 0.09, bObj.posY ?? 2.05, bObj.posZ ?? 0.26);
      bottle.rotation.y = (bObj.rotY ?? 0) * (Math.PI / 180);
      bottle.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(bottle);
      sceneObjectsRef.current.bottleGLB = bottle;
    }, undefined, () => {});

    // ------------------------------------------------------------------------
    // 5. LOAD YUKI'S VRM AVATAR IN SEATED DINING POSE
    // ------------------------------------------------------------------------
    const vrmLoader = new GLTFLoader();
    vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

    const loadVrmModel = (url) => {
      vrmLoader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData.vrm;
          if (!vrm) return;

          vrmRef.current = vrm;
          scene.add(vrm.scene);
          sceneObjectsRef.current.yuki = vrm.scene;

          const extensionsUsed = gltf.parser?.json?.extensionsUsed || [];
          const isVRM1 = extensionsUsed.some(ext => ext.includes('VRMC_vrm'));
          vrm.isVRM1 = isVRM1;

          try {
            VRMUtils.combineSkeletons(vrm.scene);
            VRMUtils.combineMorphs(vrm);
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
          setExpressionValue(vrm, 'happy', 0.35);
          setExpressionValue(vrm, 'relaxed', 0.25);

          setIsInitializing(false);
        },
        undefined,
        (err) => {
          console.error('[DateMode] Error loading VRM model from:', url, err);
          setIsInitializing(false);
        }
      );
    };

    // Fetch user's active model from profile or fallback to default
    fetch(`${API_BASE}/api/profile`)
      .then((r) => r.json())
      .then((prof) => {
        const modelName = prof?.settings?.active_vrm_model || 'default.vrm';
        const modelUrl = `${API_BASE}/api/models/vrm/files/${encodeURIComponent(modelName)}?t=${Date.now()}`;
        loadVrmModel(modelUrl);
      })
      .catch((err) => {
        console.warn('[DateMode] Profile fetch error, falling back to default.vrm:', err);
        const fallbackUrl = `${API_BASE}/api/models/vrm/files/default.vrm?t=${Date.now()}`;
        loadVrmModel(fallbackUrl);
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
        targetYawRef.current = THREE.MathUtils.clamp(
          targetYawRef.current - dx * SENSITIVITY,
          -1.45,
          1.45
        );
        targetPitchRef.current = THREE.MathUtils.clamp(
          targetPitchRef.current - dy * SENSITIVITY,
          -0.55,
          0.45
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

    // Persistent Expression State & Natural Blinking
    let currentHappy = 0.35;
    let currentRelaxed = 0.25;
    let currentSurprised = 0.0;
    let currentAngry = 0.0;
    let currentSad = 0.0;

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

      // Smooth interpolation for head rotation (Euler YXZ)
      camYawRef.current += (targetYawRef.current - camYawRef.current) * 0.08;
      camPitchRef.current += (targetPitchRef.current - camPitchRef.current) * 0.08;

      // Subtle cursor hover gaze parallax when not dragging
      const subtleGazeYaw = !isDraggingRef.current ? (mousePosRef.current.x * 0.04) : 0;
      const subtleGazePitch = !isDraggingRef.current ? (mousePosRef.current.y * 0.03) : 0;

      const finalYaw = THREE.MathUtils.clamp(camYawRef.current - subtleGazeYaw, -1.45, 1.45);
      const finalPitch = THREE.MathUtils.clamp(camPitchRef.current + subtleGazePitch, -0.55, 0.45);

      camera.rotation.set(finalPitch, finalYaw, 0, 'YXZ');

      // Flickering romantic candle light
      if (candleLightRef.current) {
        if (candleLit) {
          const flicker = Math.sin(elapsedTime * 8.5) * 0.15 + Math.sin(elapsedTime * 21.3) * 0.08;
          candleLightRef.current.intensity = 2.1 + flicker;
        } else {
          candleLightRef.current.intensity = 0.0;
        }
      }

      // Dynamic Mood Expression Target Calculation
      let targetHappy = 0.35;
      let targetRelaxed = 0.25;
      let targetSurprised = 0.0;
      let targetAngry = 0.0;
      let targetSad = 0.0;

      const cm = characterMoodRef.current;
      if (cm === 'happy') {
        targetHappy = 0.55;
        targetRelaxed = 0.20;
      } else if (cm === 'relaxed') {
        targetRelaxed = 0.60;
        targetHappy = 0.25;
      } else if (cm === 'surprised') {
        targetSurprised = 0.60;
        targetHappy = 0.10;
      } else if (cm === 'angry') {
        targetAngry = 0.50;
        targetHappy = 0.0;
        targetRelaxed = 0.0;
      } else if (cm === 'sad') {
        targetSad = 0.40;
        targetHappy = 0.0;
        targetRelaxed = 0.0;
      }

      const exprSpeed = 5.5;
      currentHappy += (targetHappy - currentHappy) * delta * exprSpeed;
      currentRelaxed += (targetRelaxed - currentRelaxed) * delta * exprSpeed;
      currentSurprised += (targetSurprised - currentSurprised) * delta * exprSpeed;
      currentAngry += (targetAngry - currentAngry) * delta * exprSpeed;
      currentSad += (targetSad - currentSad) * delta * exprSpeed;

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

        // Apply seated dining posture on humanoid bones every frame (VRM 0 & VRM 1 coordinate parity)
        const leftUpperLeg = getBoneNode(vrm, 'leftUpperLeg');
        const rightUpperLeg = getBoneNode(vrm, 'rightUpperLeg');
        const leftLowerLeg = getBoneNode(vrm, 'leftLowerLeg');
        const rightLowerLeg = getBoneNode(vrm, 'rightLowerLeg');

        if (leftUpperLeg) leftUpperLeg.rotation.set(1.45 * xMult, 0.04, -0.05 * zMult);
        if (rightUpperLeg) rightUpperLeg.rotation.set(1.45 * xMult, -0.04, 0.05 * zMult);
        if (leftLowerLeg) leftLowerLeg.rotation.set(-1.48 * xMult, 0, 0);
        if (rightLowerLeg) rightLowerLeg.rotation.set(-1.48 * xMult, 0, 0);

        const leftFoot = getBoneNode(vrm, 'leftFoot');
        const rightFoot = getBoneNode(vrm, 'rightFoot');
        if (leftFoot) leftFoot.rotation.set(0.12 * xMult, 0, 0);
        if (rightFoot) rightFoot.rotation.set(0.12 * xMult, 0, 0);

        // Upper body natural breathing
        const spine = getBoneNode(vrm, 'spine');
        const chest = getBoneNode(vrm, 'chest');
        if (spine) {
          spine.rotation.set((-0.04 + Math.sin(elapsedTime * 1.8) * 0.012) * xMult, 0, Math.sin(elapsedTime * 0.9) * 0.005 * zMult);
        }
        if (chest) {
          chest.rotation.set((-0.02 + Math.sin(elapsedTime * 1.8) * 0.008) * xMult, 0, 0);
        }

        // Arms & Hands: Seated dining pose fine-tuning / raising for cheers
        const leftUpperArm = getBoneNode(vrm, 'leftUpperArm');
        const leftLowerArm = getBoneNode(vrm, 'leftLowerArm');
        const leftHand = getBoneNode(vrm, 'leftHand');
        const rightUpperArm = getBoneNode(vrm, 'rightUpperArm');
        const rightLowerArm = getBoneNode(vrm, 'rightLowerArm');
        const rightHand = getBoneNode(vrm, 'rightHand');

        const activePose = devConfigRef.current?.avatarPose || DEFAULT_DATE_CONFIG.avatarPose;
        const lPose = activePose?.leftArm || DEFAULT_DATE_CONFIG.avatarPose.leftArm;
        const rPose = activePose?.rightArm || DEFAULT_DATE_CONFIG.avatarPose.rightArm;

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

          if (speaking) {
            setExpressionValue(vrm, 'aa', THREE.MathUtils.clamp(vLevels.aa || 0, 0, 0.76));
            setExpressionValue(vrm, 'ih', THREE.MathUtils.clamp(vLevels.ih || 0, 0, 0.38));
            setExpressionValue(vrm, 'ou', THREE.MathUtils.clamp(vLevels.ou || 0, 0, 0.56));
            setExpressionValue(vrm, 'ee', THREE.MathUtils.clamp(vLevels.ee || 0, 0, 0.36));
            setExpressionValue(vrm, 'oh', THREE.MathUtils.clamp(vLevels.oh || 0, 0, 0.70));
          } else {
            setExpressionValue(vrm, 'aa', 0);
            setExpressionValue(vrm, 'ih', 0);
            setExpressionValue(vrm, 'ou', 0);
            setExpressionValue(vrm, 'ee', 0);
            setExpressionValue(vrm, 'oh', 0);
          }

          // Natural periodic eye blinking
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
          setExpressionValue(vrm, 'blink', blinkVal);

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

    animate();

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleResize);
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
      if (vrmRef.current?.scene) {
        VRMUtils.deepDispose(vrmRef.current.scene);
      }
      renderer.dispose();
    };
  }, [gpuCheck]);

  // --------------------------------------------------------------------------
  // TABLETOP INTERACTIVE ACTIONS
  // --------------------------------------------------------------------------
  // 1. Toast / Cheers
  const handleToastCheers = () => {
    playWineClinkSound();
    setDialogueText("Kanpai! Cheers! Here's to us, a wonderful evening, and making more happy memories together!");
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

    // Interrupt any active voice playback
    stopAllDateAudio();

    setIsThinking(true);
    accumulatedDialogueRef.current = '';
    setDialogueText(`"${trimmed}"`);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const dest = DESTINATIONS[activeDest] || DESTINATIONS['tokyo_sky_lounge'];
      socketRef.current.send(JSON.stringify({
        type: 'chat',
        message: trimmed,
        is_date_mode: true,
        context_mode: 'date_mode',
        date_setting: {
          id: activeDest,
          title: dest.title,
          subtitle: dest.subtitle,
          atmosphere: dest.subtitle || dest.title
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
        cameraRef.current.updateProjectionMatrix?.();
      }
      setDevConfig((prev) => ({
        ...prev,
        camera: {
          ...prev.camera,
          [prop]: numVal
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
    const isNum = typeof value === 'number' || (!isNaN(parseFloat(value)) && prop !== 'color');
    const processedVal = isNum ? parseFloat(value) : value;

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
    }
  };

  const updateShaderParam = (prop, value) => {
    const isNum = prop === 'exposure';
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
    }
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
      setDevConfig((prev) => ({
        ...prev,
        camera: { ...prev.camera, posX: defCam.posX, posY: defCam.posY, posZ: defCam.posZ }
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
    setDevConfig((prev) => ({
      ...prev,
      camera: { ...prev.camera, posX: defCam.posX, posY: defCam.posY, posZ: defCam.posZ },
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

  // 5. Update avatar pose parameters in real time
  const updateAvatarPose = (side, prop, rawVal) => {
    const val = typeof rawVal === 'number' ? rawVal : parseFloat(rawVal) || 0;
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: {
        ...prev.avatarPose,
        [side]: {
          ...prev.avatarPose?.[side],
          [prop]: Number(val.toFixed(2))
        }
      }
    }));
  };

  // 6. Reset all pose parameters in the Pose tab back to default
  const handleResetPoseTab = () => {
    const defPose = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.avatarPose));
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: defPose
    }));
  };

  // 7. Reset single arm pose back to default
  const handleResetArm = (side) => {
    if (!DEFAULT_DATE_CONFIG.avatarPose?.[side]) return;
    const defArm = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG.avatarPose[side]));
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: {
        ...prev.avatarPose,
        [side]: defArm
      }
    }));
  };

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

  // 9. Apply curated pose preset
  const applyPosePreset = (presetId) => {
    const target = POSE_PRESETS[presetId];
    if (!target) return;
    setDevConfig((prev) => ({
      ...prev,
      avatarPose: JSON.parse(JSON.stringify(target.pose))
    }));
  };

  // Unified 3D scene updater across renderer, camera, lights, meshes, and poses
  const applyConfigToScene = (cfg) => {
    setDevConfig(cfg);
    devConfigRef.current = cfg;

    if (rendererRef.current && cfg.shaders) {
      if (cfg.shaders.toneMapping) {
        rendererRef.current.toneMapping = TONE_MAPPINGS[cfg.shaders.toneMapping] || THREE.ACESFilmicToneMapping;
      }
      if (cfg.shaders.exposure !== undefined) {
        rendererRef.current.toneMappingExposure = cfg.shaders.exposure;
      }
    }

    if (cameraRef.current && cfg.camera) {
      if (cfg.camera.fov !== undefined) cameraRef.current.fov = cfg.camera.fov;
      if (cfg.camera.posX !== undefined && cfg.camera.posY !== undefined && cfg.camera.posZ !== undefined) {
        cameraRef.current.position.set(cfg.camera.posX, cfg.camera.posY, cfg.camera.posZ);
      }
      cameraRef.current.updateProjectionMatrix?.();
    }

    if (cfg.lights) {
      if (ambientLightRef.current && cfg.lights.ambient) {
        if (cfg.lights.ambient.color) ambientLightRef.current.color.set(cfg.lights.ambient.color);
        if (cfg.lights.ambient.intensity !== undefined) ambientLightRef.current.intensity = cfg.lights.ambient.intensity;
      }
      if (spotLightRef.current && cfg.lights.keySpot) {
        if (cfg.lights.keySpot.color) spotLightRef.current.color.set(cfg.lights.keySpot.color);
        if (cfg.lights.keySpot.intensity !== undefined) spotLightRef.current.intensity = cfg.lights.keySpot.intensity;
        if (cfg.lights.keySpot.posX !== undefined) {
          spotLightRef.current.position.set(cfg.lights.keySpot.posX, cfg.lights.keySpot.posY, cfg.lights.keySpot.posZ);
        }
      }
      if (candleLightRef.current && cfg.lights.candle) {
        if (cfg.lights.candle.color) candleLightRef.current.color.set(cfg.lights.candle.color);
        if (cfg.lights.candle.intensity !== undefined) candleLightRef.current.intensity = cfg.lights.candle.intensity;
        if (cfg.lights.candle.posX !== undefined) {
          candleLightRef.current.position.set(cfg.lights.candle.posX, cfg.lights.candle.posY, cfg.lights.candle.posZ);
        }
      }
    }

    if (cfg.objects) {
      for (const [key, objDef] of Object.entries(cfg.objects)) {
        if (key === 'playerPov') continue;
        const obj = sceneObjectsRef.current[key];
        if (obj) {
          if (objDef.posX !== undefined) obj.position.set(objDef.posX, objDef.posY, objDef.posZ);
          if (objDef.rotY !== undefined) {
            if (key === 'yuki' && vrmRef.current?.isVRM1) {
              obj.rotation.y = ((objDef.rotY - 180) * Math.PI / 180);
            } else {
              obj.rotation.y = objDef.rotY * (Math.PI / 180);
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
  };

  const handleSelectProfile = (profileId) => {
    setActiveProfileId(profileId);
    try {
      localStorage.setItem('yuki_date_active_profile_id', profileId);
    } catch (_) {}

    let targetCfg;
    if (profileId === 'default' || !savedProfiles[profileId]?.config) {
      targetCfg = JSON.parse(JSON.stringify(DEFAULT_DATE_CONFIG));
    } else {
      targetCfg = mergeConfig(DEFAULT_DATE_CONFIG, savedProfiles[profileId].config);
    }
    applyConfigToScene(targetCfg);
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
          pointerEvents: 'auto'
        }}
      >
        {/* Left: Destination Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="date-btn-group" style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(24, 24, 27, 0.85)', border: '1px solid rgba(63, 63, 70, 0.6)', borderRadius: '9999px', padding: '3px', backdropFilter: 'blur(12px)' }}>
            {Object.values(DESTINATIONS).map((dest) => (
              <button
                key={dest.id}
                onClick={() => {
                  setActiveDest(dest.id);
                  setDialogueText(dest.welcomeDialogue);
                }}
                className={`date-btn-pill ${activeDest === dest.id ? 'active' : 'inactive'}`}
                style={{
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: activeDest === dest.id ? '#7c3aed' : 'transparent',
                  color: activeDest === dest.id ? '#ffffff' : '#a1a1aa',
                  boxShadow: activeDest === dest.id ? '0 2px 8px rgba(124, 58, 237, 0.4)' : 'none'
                }}
              >
                {dest.title}
              </button>
            ))}
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

        {/* Right: Upload BG, Recenter, Camera, Settings & Exit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, zIndex: 110, pointerEvents: 'auto' }}>
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

            {/* Tab: Avatar Pose (Arms & Hands Fine-Tuning) */}
            {devTab === 'pose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Tab Header with Tab-Specific Reset */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(63, 63, 70, 0.4)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avatar Arm & Hand Pose</span>
                  <button
                    onClick={handleResetPoseTab}
                    title="Reset both arms and hands back to initial defaults"
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

                {/* Quick Curated Pose Presets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pose Presets</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                    {Object.values(POSE_PRESETS).map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => applyPosePreset(preset.id)}
                        title={preset.desc}
                        style={{
                          padding: '6px 8px',
                          background: '#18181b',
                          border: '1px solid rgba(139, 92, 246, 0.25)',
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
                        <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{preset.label}</span>
                        <span style={{ fontSize: '9px', color: '#71717a', lineHeight: '1.2' }}>{preset.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Arm Selection & Symmetrical Tools */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', background: 'rgba(24, 24, 27, 0.6)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.4)' }}>
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

                  {/* Independent Reset & Mirror Actions for Selected Arm */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', paddingTop: '4px' }}>
                    <button
                      onClick={() => handleResetArm(poseSelectedArm)}
                      title={`Reset only ${poseSelectedArm === 'leftArm' ? 'Left' : 'Right'} arm back to defaults`}
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
                        cursor: 'pointer',
                        transition: 'all 0.15s'
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
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      <Sliders style={{ width: '10px', height: '10px' }} />
                      <span>Mirror {poseSelectedArm === 'leftArm' ? 'Left -> Right' : 'Right -> Left'}</span>
                    </button>
                  </div>
                </div>

                {/* Fine-Tuning Joint Sliders for poseSelectedArm */}
                {(() => {
                  const arm = devConfig.avatarPose?.[poseSelectedArm] || DEFAULT_DATE_CONFIG.avatarPose[poseSelectedArm];
                  if (!arm) return null;

                  const renderPoseSlider = (label, desc, propKey, minVal, maxVal, step = 0.02) => {
                    const curVal = arm[propKey] ?? 0;
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
                            onChange={(e) => updateAvatarPose(poseSelectedArm, propKey, e.target.value)}
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
                          onChange={(e) => updateAvatarPose(poseSelectedArm, propKey, e.target.value)}
                          style={{ width: '100%', height: '6px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                        />
                      </div>
                    );
                  };

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {/* Section 1: Shoulder / Upper Arm */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Shoulder & Upper Arm
                        </span>
                        {renderPoseSlider('Pitch (X)', 'Forward / Back elevation', 'upperPitch', -1.50, 2.50)}
                        {renderPoseSlider('Yaw (Y)', 'Inward / Outward twist', 'upperYaw', -1.50, 1.50)}
                        {renderPoseSlider('Roll (Z)', 'Arm abduction / raise', 'upperRoll', -2.50, 2.50)}
                      </div>

                      {/* Section 2: Elbow / Lower Arm */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Elbow & Forearm
                        </span>
                        {renderPoseSlider('Flex (X)', 'Elbow bend angle', 'lowerFlex', 0.00, 2.50)}
                        {renderPoseSlider('Twist (Y)', 'Forearm pronation / supination', 'lowerTwist', -1.50, 1.50)}
                        {renderPoseSlider('Angle (Z)', 'Elbow lateral spread', 'lowerAngle', -1.50, 1.50)}
                      </div>

                      {/* Section 3: Wrist / Hand */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(24, 24, 27, 0.5)', borderRadius: '10px', border: '1px solid rgba(63, 63, 70, 0.35)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Wrist & Hand Orientation
                        </span>
                        {renderPoseSlider('Pitch (X)', 'Wrist tilt up / down', 'handPitch', -1.50, 1.50)}
                        {renderPoseSlider('Yaw (Y)', 'Wrist turn left / right', 'handYaw', -1.50, 1.50)}
                        {renderPoseSlider('Roll (Z)', 'Hand palm rotation', 'handRoll', -1.50, 1.50)}
                      </div>
                    </div>
                  );
                })()}
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
                      value={devConfig.lights?.ambient?.color || '#281932'}
                      onChange={(e) => updateLightParam('ambient', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{devConfig.lights?.ambient?.color}</span>
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
                      value={devConfig.lights?.keySpot?.color || '#ffeedd'}
                      onChange={(e) => updateLightParam('keySpot', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{devConfig.lights?.keySpot?.color}</span>
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
                      value={devConfig.lights?.candle?.color || '#ff9933'}
                      onChange={(e) => updateLightParam('candle', 'color', e.target.value)}
                      style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(63, 63, 70, 0.8)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a1a1aa' }}>{devConfig.lights?.candle?.color}</span>
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
                      min="30"
                      max="85"
                      step="1"
                      value={devConfig.camera?.fov ?? 42}
                      onChange={(e) => updateCameraParam('fov', e.target.value)}
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
                      min="0.8"
                      max="1.5"
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
                      min="0.2"
                      max="1.2"
                      step="0.01"
                      value={devConfig.camera?.posZ ?? 0.55}
                      onChange={(e) => updateCameraParam('posZ', e.target.value)}
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
            <button
              onClick={handleResetAllDefaults}
              title="Reset All Changes Across All Tabs to Default"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                background: 'transparent',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              <Trash2 style={{ width: '12px', height: '12px' }} />
              <span>Reset All</span>
            </button>

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
          pointerEvents: 'auto'
        }}
      >
        <button
          onClick={handleToastCheers}
          title="Toast with Yuki"
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
          <Wine style={{ width: '16px', height: '16px', color: '#fb7185' }} />
          <span>Cheers!</span>
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
          pointerEvents: 'auto'
        }}
      >
        {/* Quick Topic Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
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
            {isThinking && (
              <span style={{ fontSize: '12px', color: '#71717a', fontFamily: 'monospace', fontStyle: 'italic' }}>Yuki is thinking...</span>
            )}
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
              onChange={(e) => setInputText(e.target.value)}
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

            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                padding: '8px 12px',
                background: '#7c3aed',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                cursor: inputText.trim() ? 'pointer' : 'default',
                opacity: inputText.trim() ? 1 : 0.4
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
