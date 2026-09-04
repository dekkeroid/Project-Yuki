import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

/**
 * Registry of available .vrma files and their aliases.
 */
export const VRMA_DEFINITIONS = {
  // Base idles & posture shifters
  relax: { url: './animations/Relax.vrma', isIdle: true },
  look_around: { url: './animations/LookAround.vrma', isIdle: true },
  weight_shift: { url: './animations/WeightShift.vrma', isIdle: true },
  sway: { url: './animations/WeightShift.vrma', isIdle: true },

  // Sitting & taskbar postures
  sitting: { url: './animations/Sit.vrma', isIdle: false },
  sit: { url: './animations/Sit.vrma', isIdle: false },
  sit_wave: { url: './animations/SitWave.vrma', isIdle: false },
  stand_up: { url: './animations/StandUp.vrma', isIdle: false },
  stand: { url: './animations/StandUp.vrma', isIdle: false },

  // Cognitive & emotional states
  thinking: { url: './animations/Thinking.vrma', isIdle: false },
  sleepy: { url: './animations/Sleepy.vrma', isIdle: false },
  napping: { url: './animations/Sleepy.vrma', isIdle: false },
  angry: { url: './animations/Angry.vrma', isIdle: false },
  pouting: { url: './animations/Angry.vrma', isIdle: false },
  sad: { url: './animations/Sad.vrma', isIdle: false },
  surprised: { url: './animations/Surprised.vrma', isIdle: false },
  shocked_recoil: { url: './animations/Surprised.vrma', isIdle: false },
  blush: { url: './animations/Blush.vrma', isIdle: false },
  shy_fidget: { url: './animations/Blush.vrma', isIdle: false },

  // Greetings & interactions
  wave: { url: './animations/Goodbye.vrma', isIdle: false },
  greeting_wave: { url: './animations/Goodbye.vrma', isIdle: false },
  wave_both: { url: './animations/WaveBoth.vrma', isIdle: false },
  salute: { url: './animations/Salute.vrma', isIdle: false },
  peace_sign: { url: './animations/PeaceSign.vrma', isIdle: false },
  peace: { url: './animations/PeaceSign.vrma', isIdle: false },
  blow_kiss: { url: './animations/BlowKiss.vrma', isIdle: false },
  kiss: { url: './animations/BlowKiss.vrma', isIdle: false },

  // Celebrations & dances
  cheering: { url: './animations/Clapping.vrma', isIdle: false },
  clap: { url: './animations/Clapping.vrma', isIdle: false },
  silly_dance: { url: './animations/SillyDance.vrma', isIdle: false },
  hip_hop_dance: { url: './animations/HipHopDance.vrma', isIdle: false },
  twist_dance: { url: './animations/TwistDance.vrma', isIdle: false },
  air_guitar: { url: './animations/Guitar.vrma', isIdle: false },
  guitar: { url: './animations/Guitar.vrma', isIdle: false },
  singing: { url: './animations/Singing.vrma', isIdle: false },
  sing: { url: './animations/Singing.vrma', isIdle: false },
  airplane: { url: './animations/Airplane.vrma', isIdle: false },
  backflip: { url: './animations/Backflip.vrma', isIdle: false },
  jump: { url: './animations/Jump.vrma', isIdle: false },

  // Activities & fidgets
  typing_air: { url: './animations/Typing.vrma', isIdle: false },
  typing: { url: './animations/Typing.vrma', isIdle: false },
  stretching: { url: './animations/Stretch.vrma', isIdle: false },
  stretch: { url: './animations/Stretch.vrma', isIdle: false },
  yawning: { url: './animations/Yawn.vrma', isIdle: false },
  yawn: { url: './animations/Yawn.vrma', isIdle: false },
  shrugging: { url: './animations/Shrug.vrma', isIdle: false },
  shrug: { url: './animations/Shrug.vrma', isIdle: false },
  walk: { url: './animations/Walk.vrma', isIdle: false }
};

export const CANONICAL_MAP = {
  wave: 'greeting_wave',
  greeting_wave: 'greeting_wave',
  clap: 'cheering',
  cheering: 'cheering',
  sleepy: 'napping',
  napping: 'napping',
  angry: 'pouting',
  pouting: 'pouting',
  surprised: 'shocked_recoil',
  shocked_recoil: 'shocked_recoil',
  blush: 'shy_fidget',
  shy_fidget: 'shy_fidget',
  guitar: 'air_guitar',
  air_guitar: 'air_guitar',
  sing: 'singing',
  singing: 'singing',
  kiss: 'blow_kiss',
  blow_kiss: 'blow_kiss',
  hiphop: 'hip_hop_dance',
  hip_hop_dance: 'hip_hop_dance',
  silly: 'silly_dance',
  silly_dance: 'silly_dance',
  twist: 'twist_dance',
  twist_dance: 'twist_dance',
  stretch: 'stretching',
  stretching: 'stretching',
  yawn: 'yawning',
  yawning: 'yawning',
  shrug: 'shrugging',
  shrugging: 'shrugging',
  typing: 'typing_air',
  typing_air: 'typing_air',
  sit: 'sitting',
  sitting: 'sitting',
  sitwave: 'sit_wave',
  sit_wave: 'sit_wave',
  stand: 'stand_up',
  stand_up: 'stand_up',
  peace: 'peace_sign',
  peace_sign: 'peace_sign',
  sway: 'weight_shift',
  weight_shift: 'weight_shift',
  lookaround: 'look_around',
  look_around: 'look_around',
  waveboth: 'wave_both',
  wave_both: 'wave_both',
  flip: 'backflip',
  backflip: 'backflip',
  zoom: 'airplane',
  airplane: 'airplane',
  salute: 'salute',
  jump: 'jump',
  walk: 'walk',
  thinking: 'thinking'
};

export class VRMAnimationManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.loader.crossOrigin = 'anonymous';
    this.loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    this.rawAnimations = new Map(); // url -> VRMAnimation
    this.vrm = null;
    this.mixer = null;
    this.actions = new Map(); // key -> THREE.AnimationAction
    this.disabledAnimations = new Set();

    this.currentActionName = null;
    this.baseIdleName = 'relax';
    this.isIdlePlaying = false;
    this.isThinking = false;
    this.isSleeping = false;
    this.isSitting = false;

    // Dynamic idle shifting parameters
    this.idleTimer = 0;
    this.nextIdleShiftTime = this._getRandomIdleShiftInterval();

    this._onMixerFinished = this._onMixerFinished.bind(this);
    this.preloadDefinitions();
  }

  _getRandomIdleShiftInterval() {
    // Shift idle variation every 16 to 28 seconds
    return 16 + Math.random() * 12;
  }

  /**
   * Preloads all registered .vrma files into memory cache.
   */
  async preloadDefinitions() {
    const urls = [...new Set(Object.values(VRMA_DEFINITIONS).map((def) => def.url))];
    const promises = urls.map(async (url) => {
      try {
        const gltf = await this.loader.loadAsync(url);
        const vrmAnimations = gltf.userData.vrmAnimations;
        if (vrmAnimations && vrmAnimations.length > 0) {
          this.rawAnimations.set(url, vrmAnimations[0]);
        }
      } catch (err) {
        console.warn(`[VRMAnimationManager] Failed to preload ${url}:`, err);
      }
    });

    await Promise.allSettled(promises);

    // If a VRM was attached before preloading completed, bind clips now
    if (this.vrm && this.mixer) {
      this._bindAllClips();
      if (!this.currentActionName) {
        this.playIdle();
      }
    }
  }

  /**
   * Binds this manager to a newly loaded VRM model (supports both VRM 0.0 and 1.0).
   */
  setVrm(vrm) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.removeEventListener('finished', this._onMixerFinished);
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.actions.clear();
    this.vrm = vrm;
    this.currentActionName = null;
    this.idleTimer = 0;

    if (!vrm || !vrm.scene) return;

    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener('finished', this._onMixerFinished);

    this._bindAllClips();
    this.playIdle();
  }

  _bindAllClips() {
    if (!this.vrm || !this.mixer) return;

    for (const [key, def] of Object.entries(VRMA_DEFINITIONS)) {
      const vrmAnim = this.rawAnimations.get(def.url);
      if (!vrmAnim) continue;

      try {
        // createVRMAnimationClip retargets humanoid bones & blendshapes to this specific model
        const clip = createVRMAnimationClip(vrmAnim, this.vrm);
        if (clip) {
          clip.name = key;
          const action = this.mixer.clipAction(clip);
          this.actions.set(key, action);
        }
      } catch (err) {
        console.warn(`[VRMAnimationManager] Failed to create clip for ${key}:`, err);
      }
    }
  }

  /**
   * Updates the set of animations disabled by user settings.
   */
  setDisabledAnimations(disabledList) {
    this.disabledAnimations = new Set(disabledList || []);
  }

  /**
   * Returns true if a VRMA clip is registered for this animation key or alias.
   */
  hasAnimation(key) {
    if (!key) return false;
    const lowerKey = key.toLowerCase();
    return this.actions.has(lowerKey);
  }

  /**
   * Plays the base idle animation (standing Relax or seated Sit) with smooth cross-fading.
   */
  playIdle(fadeDuration = 0.45) {
    if (this.isSitting) {
      if (this.actions.has('sit')) {
        this._crossFadeToAction('sit', {
          loop: THREE.LoopRepeat,
          fadeDuration,
          clampWhenFinished: false
        });
      }
      return;
    }
    this.isIdlePlaying = true;
    this.isThinking = false;
    this._crossFadeToAction(this.baseIdleName, {
      loop: THREE.LoopRepeat,
      fadeDuration,
      clampWhenFinished: false
    });
  }

  /**
   * Toggles taskbar seated posture.
   */
  setSitting(isSitting, fadeDuration = 0.5) {
    if (isSitting) {
      this.isSitting = true;
      this.isIdlePlaying = true;
      if (this.actions.has('sit')) {
        this._crossFadeToAction('sit', {
          loop: THREE.LoopRepeat,
          fadeDuration,
          clampWhenFinished: false
        });
      }
    } else if (this.isSitting) {
      this.isSitting = false;
      if (this.actions.has('stand_up')) {
        this._crossFadeToAction('stand_up', {
          loop: THREE.LoopOnce,
          fadeDuration,
          clampWhenFinished: true
        });
      } else {
        this.playIdle(fadeDuration);
      }
    }
  }

  /**
   * Sets thinking cognitive state (cross-fades to Thinking.vrma or returns to idle).
   */
  setThinking(isThinking, fadeDuration = 0.4) {
    this.isThinking = isThinking;
    if (this.isSleeping) return;

    if (isThinking && !this.disabledAnimations.has('thinking')) {
      this._crossFadeToAction('thinking', {
        loop: THREE.LoopRepeat,
        fadeDuration,
        clampWhenFinished: false
      });
    } else {
      if (this.currentActionName === 'thinking' || !isThinking) {
        this.playIdle(fadeDuration);
      }
    }
  }

  /**
   * Sets sleeping / napping state.
   */
  setSleeping(isSleeping, fadeDuration = 0.6) {
    this.isSleeping = isSleeping;
    if (isSleeping) {
      this.isSitting = false;
      this._crossFadeToAction('sleepy', {
        loop: THREE.LoopRepeat,
        fadeDuration,
        clampWhenFinished: false
      });
    } else {
      if (this.currentActionName === 'sleepy') {
        this.playIdle(fadeDuration);
      }
    }
  }

  /**
   * Plays a one-shot or continuous action animation, returning true if handled by VRMA.
   * Respects user-disabled animations from Settings.
   */
  playAction(key, { fadeDuration = 0.35, onComplete = null } = {}) {
    if (!key) return false;
    const lowerKey = key.toLowerCase();
    const canonical = CANONICAL_MAP[lowerKey] || lowerKey;

    // Check user disabled settings
    if (this.disabledAnimations.has(lowerKey) || this.disabledAnimations.has(canonical)) {
      return false;
    }

    if (!this.actions.has(lowerKey)) {
      return false;
    }

    this.isIdlePlaying = false;
    this.onActionComplete = onComplete;

    // Seated posture handling
    if (lowerKey === 'sit' || lowerKey === 'sitting') {
      this.isSitting = true;
      this._crossFadeToAction(lowerKey, {
        loop: THREE.LoopRepeat,
        fadeDuration: 0.5,
        clampWhenFinished: false
      });
      return true;
    }

    if (lowerKey === 'stand_up' || lowerKey === 'stand') {
      this.isSitting = false;
      this._crossFadeToAction(lowerKey, {
        loop: THREE.LoopOnce,
        fadeDuration,
        clampWhenFinished: true
      });
      return true;
    }

    if (lowerKey === 'sit_wave') {
      this._crossFadeToAction(lowerKey, {
        loop: THREE.LoopOnce,
        fadeDuration,
        clampWhenFinished: true
      });
      return true;
    }

    // Any standing one-shot action clears sitting posture
    this.isSitting = false;

    this._crossFadeToAction(lowerKey, {
      loop: THREE.LoopOnce,
      fadeDuration,
      clampWhenFinished: true
    });

    return true;
  }

  _crossFadeToAction(name, { loop = THREE.LoopRepeat, fadeDuration = 0.4, clampWhenFinished = false } = {}) {
    if (!this.mixer) return;
    const nextAction = this.actions.get(name);
    if (!nextAction) return;

    if (this.currentActionName === name && nextAction.isRunning()) {
      return;
    }

    const prevAction = this.currentActionName ? this.actions.get(this.currentActionName) : null;

    nextAction.reset();
    nextAction.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    nextAction.clampWhenFinished = clampWhenFinished;
    nextAction.weight = 1.0;
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, fadeDuration, true);
    } else {
      nextAction.fadeIn(fadeDuration);
    }

    this.currentActionName = name;
  }

  _onMixerFinished(e) {
    const finishedAction = e.action;
    const finishedClipName = finishedAction.getClip().name;

    if (this.onActionComplete) {
      const cb = this.onActionComplete;
      this.onActionComplete = null;
      cb(finishedClipName);
    }

    // After a one-shot finishes, smoothly return to sitting, sleeping, thinking, or base idle
    if (this.isSitting) {
      if (finishedClipName === 'stand_up' || finishedClipName === 'stand') {
        this.isSitting = false;
        this.playIdle(0.5);
      } else {
        this._crossFadeToAction('sit', {
          loop: THREE.LoopRepeat,
          fadeDuration: 0.45,
          clampWhenFinished: false
        });
      }
    } else if (this.isSleeping) {
      this.setSleeping(true, 0.4);
    } else if (this.isThinking) {
      this.setThinking(true, 0.4);
    } else {
      this.playIdle(0.5);
    }
  }

  /**
   * Whether a VRMA clip is currently active and controlling bone animations.
   */
  isVrmaActive() {
    return !!(this.mixer && this.currentActionName && this.actions.has(this.currentActionName));
  }

  /**
   * Update mixer and idle shifting timer each frame.
   */
  update(delta) {
    if (!this.mixer) return;

    // Cap delta to prevent animation jumping during frame drops
    const clampedDelta = Math.min(delta, 0.1);
    this.mixer.update(clampedDelta);

    // Dynamic Idle Variation Shifter:
    // When in regular standing idle mode (not sitting, not thinking, not sleeping, not in one-shot),
    // periodically cross-fade to an organic variation (look_around, weight_shift), then back to Relax.vrma.
    if (this.isIdlePlaying && !this.isThinking && !this.isSleeping && !this.isSitting) {
      this.idleTimer += clampedDelta;
      if (this.idleTimer >= this.nextIdleShiftTime) {
        this.idleTimer = 0;
        this.nextIdleShiftTime = this._getRandomIdleShiftInterval();

        if (this.currentActionName === 'relax') {
          const idleCandidates = ['look_around', 'weight_shift'].filter((key) => {
            const canonical = CANONICAL_MAP[key] || key;
            return (
              !this.disabledAnimations.has(key) &&
              !this.disabledAnimations.has(canonical) &&
              this.actions.has(key)
            );
          });

          if (idleCandidates.length > 0) {
            const chosen = idleCandidates[Math.floor(Math.random() * idleCandidates.length)];
            this._crossFadeToAction(chosen, {
              loop: THREE.LoopOnce,
              fadeDuration: 0.6,
              clampWhenFinished: false
            });
          }
        }
      }
    }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.removeEventListener('finished', this._onMixerFinished);
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }
    this.actions.clear();
    this.rawAnimations.clear();
    this.vrm = null;
  }
}
