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
  crying_sob: { url: './animations/Sad.vrma', isIdle: false },
  crying: { url: './animations/Sad.vrma', isIdle: false },
  cry: { url: './animations/Sad.vrma', isIdle: false },
  sob: { url: './animations/Sad.vrma', isIdle: false },
  disappointed_nod: { url: './animations/Sad.vrma', isIdle: false },
  disappointed: { url: './animations/Sad.vrma', isIdle: false },
  surprised: { url: './animations/Surprised.vrma', isIdle: false },
  shocked_recoil: { url: './animations/Surprised.vrma', isIdle: false },
  blush: { url: './animations/Blush.vrma', isIdle: false },
  shy_fidget: { url: './animations/Blush.vrma', isIdle: false },
  shy: { url: './animations/Blush.vrma', isIdle: false },
  fidget: { url: './animations/Blush.vrma', isIdle: false },
  giggle_cover: { url: './animations/Blush.vrma', isIdle: false },
  giggle: { url: './animations/Clapping.vrma', isIdle: false },
  laughing: { url: './animations/Clapping.vrma', isIdle: false },
  laugh: { url: './animations/Clapping.vrma', isIdle: false },
  peering: { url: './animations/LookAround.vrma', isIdle: false },
  peer: { url: './animations/LookAround.vrma', isIdle: false },
  curious: { url: './animations/LookAround.vrma', isIdle: false },
  grooving: { url: './animations/TwistDance.vrma', isIdle: false },
  groove: { url: './animations/TwistDance.vrma', isIdle: false },
  knocking: { url: './animations/Salute.vrma', isIdle: false },
  knock: { url: './animations/Salute.vrma', isIdle: false },
  nodding: { url: './animations/Relax.vrma', isIdle: false },
  nod: { url: './animations/Relax.vrma', isIdle: false },
  head_shake: { url: './animations/Shrug.vrma', isIdle: false },
  shake: { url: './animations/Shrug.vrma', isIdle: false },
  pointing: { url: './animations/Shoot.vrma', isIdle: false },
  point: { url: './animations/Shoot.vrma', isIdle: false },
  inspect_screen: { url: './animations/LookAround.vrma', isIdle: false },
  inspect: { url: './animations/LookAround.vrma', isIdle: false },

  // Greetings & interactions
  wave: { url: './animations/Goodbye.vrma', isIdle: false },
  greeting_wave: { url: './animations/Goodbye.vrma', isIdle: false },
  wave_both: { url: './animations/WaveBoth.vrma', isIdle: false },
  salute: { url: './animations/Salute.vrma', isIdle: false },
  peace_sign: { url: './animations/PeaceSign.vrma', isIdle: false },
  peace: { url: './animations/PeaceSign.vrma', isIdle: false },
  blow_kiss: { url: './animations/BlowKiss.vrma', isIdle: false },
  kiss: { url: './animations/BlowKiss.vrma', isIdle: false },
  shoot: { url: './animations/Shoot.vrma', isIdle: false },
  finger_gun: { url: './animations/Shoot.vrma', isIdle: false },
  spin: { url: './animations/Spin.vrma', isIdle: false },
  twirl: { url: './animations/Spin.vrma', isIdle: false },
  model_pose: { url: './animations/ModelPose.vrma', isIdle: false },
  pose: { url: './animations/ModelPose.vrma', isIdle: false },
  squat: { url: './animations/Squat.vrma', isIdle: false },
  crouch: { url: './animations/Squat.vrma', isIdle: false },
  sport: { url: './animations/Sport.vrma', isIdle: false },
  workout: { url: './animations/Sport.vrma', isIdle: false },
  turn_around: { url: './animations/TurnAround.vrma', isIdle: false },
  turn: { url: './animations/TurnAround.vrma', isIdle: false },

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
  shy: 'shy_fidget',
  fidget: 'shy_fidget',
  laugh: 'laughing',
  laughing: 'laughing',
  giggle: 'giggle_cover',
  giggle_cover: 'giggle_cover',
  peer: 'peering',
  peering: 'peering',
  curious: 'peering',
  groove: 'grooving',
  grooving: 'grooving',
  knock: 'knocking',
  knocking: 'knocking',
  nod: 'nodding',
  nodding: 'nodding',
  shake: 'head_shake',
  head_shake: 'head_shake',
  point: 'pointing',
  pointing: 'pointing',
  inspect: 'inspect_screen',
  inspect_screen: 'inspect_screen',
  crying: 'crying_sob',
  cry: 'crying_sob',
  sob: 'crying_sob',
  crying_sob: 'crying_sob',
  disappointed: 'disappointed_nod',
  disappointed_nod: 'disappointed_nod',
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
  shoot: 'shoot',
  finger_gun: 'shoot',
  fingergun: 'shoot',
  spin: 'spin',
  twirl: 'spin',
  model_pose: 'model_pose',
  modelpose: 'model_pose',
  pose: 'model_pose',
  squat: 'squat',
  crouch: 'squat',
  sport: 'sport',
  workout: 'sport',
  jumpingjacks: 'sport',
  turn: 'turn_around',
  turn_around: 'turn_around',
  turnaround: 'turn_around',
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
    this._thinkingTimer = null;

    // Telemetry callback for backend / diagnostics: (name, category, reason) => void
    this.onAnimationTriggered = null;

    // Dynamic idle shifting parameters
    this.idleTimer = 0;
    this.nextIdleShiftTime = this._getRandomIdleShiftInterval();

    this._onMixerFinished = this._onMixerFinished.bind(this);
    this.preloadDefinitions();
  }

  _notifyAnimation(name, category, reason) {
    if (typeof this.onAnimationTriggered === 'function') {
      try {
        this.onAnimationTriggered(name, category, reason);
      } catch (e) {
        console.warn('[VRMAnimationManager] Error in onAnimationTriggered listener:', e);
      }
    }
  }

  _getRandomIdleShiftInterval() {
    // Shift subtle idle variation every 60 to 90 seconds (natural and calm)
    return 60 + Math.random() * 30;
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

    const restHipsY = this.vrm.humanoid?.normalizedRestPose?.hips?.position?.[1] ?? 0.85;

    // Step 1: Pre-generate Relax clip to extract baseline rest tracks for all 52 humanoid bones
    let relaxTracks = [];
    const relaxDef = VRMA_DEFINITIONS.relax;
    if (relaxDef) {
      const relaxAnim = this.rawAnimations.get(relaxDef.url);
      if (relaxAnim) {
        try {
          const rawRelaxClip = createVRMAnimationClip(relaxAnim, this.vrm);
          if (rawRelaxClip && rawRelaxClip.tracks) {
            relaxTracks = rawRelaxClip.tracks;
          }
        } catch (e) {
          console.warn('[VRMAnimationManager] Could not build reference relax tracks:', e);
        }
      }
    }

    for (const [key, def] of Object.entries(VRMA_DEFINITIONS)) {
      const vrmAnim = this.rawAnimations.get(def.url);
      if (!vrmAnim) continue;

      try {
        // createVRMAnimationClip retargets humanoid bones & blendshapes to this specific model
        const clip = createVRMAnimationClip(vrmAnim, this.vrm);
        if (clip) {
          clip.name = key;

          // ROOT MOTION & POSITION TRACK SAFETY:
          // Prevent any animation from drifting laterally (X/Z), sinking, or zooming out into space
          const isSittingClip = key === 'sit' || key === 'sitting' || key === 'sit_wave';
          const isVerticalAction = key === 'jump' || key === 'squat' || key === 'crouch' || key === 'sport';

          clip.tracks = clip.tracks.filter((track) => {
            if (track.name.endsWith('.position')) {
              // Seated postures: hips move down towards taskbar/seat
              if (isSittingClip) {
                for (let i = 0; i < track.values.length; i += 3) {
                  track.values[i] = 0; // Lock lateral X to 0
                  // Clamp Y safely between 0.15m and restHipsY so model doesn't plunge through ground
                  track.values[i + 1] = Math.max(0.15, Math.min(track.values[i + 1], restHipsY + 0.1));
                  track.values[i + 2] = 0; // Lock Z to 0
                }
                return true;
              }

              // Vertical actions (jump, squat, sport workout): preserve controlled vertical bounce
              if (isVerticalAction) {
                for (let i = 0; i < track.values.length; i += 3) {
                  track.values[i] = 0; // Lock lateral X to 0
                  // Clamp Y delta safely around restHipsY
                  track.values[i + 1] = Math.max(restHipsY - 0.45, Math.min(track.values[i + 1], restHipsY + 0.6));
                  track.values[i + 2] = 0; // Lock Z to 0
                }
                return true;
              }

              // All other standing gestures and dances: drop translation track entirely
              // to guarantee 100% stationary, glitch-free in-place animation!
              return false;
            }
            return true;
          });

          // SKELETON COMPLETENESS / T-POSE PREVENTION:
          // If this clip is missing tracks for certain bones (e.g. fingers, toes, shoulders),
          // supplement with the resting pose from Relax.vrma so Three.js never falls back to bind pose (T-pose)!
          if (relaxTracks.length > 0 && key !== 'relax') {
            const existingTrackNames = new Set(clip.tracks.map((t) => t.name));
            for (const refTrack of relaxTracks) {
              if (refTrack.name.endsWith('.quaternion') && !existingTrackNames.has(refTrack.name)) {
                // Construct a 2-key resting quaternion track spanning [0, clip.duration]
                const q = [
                  refTrack.values[0] || 0,
                  refTrack.values[1] || 0,
                  refTrack.values[2] || 0,
                  refTrack.values[3] !== undefined ? refTrack.values[3] : 1
                ];
                const filledTrack = new THREE.QuaternionKeyframeTrack(
                  refTrack.name,
                  [0, clip.duration],
                  [q[0], q[1], q[2], q[3], q[0], q[1], q[2], q[3]]
                );
                clip.tracks.push(filledTrack);
              }
            }
          }

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
  playIdle(fadeDuration = 0.75, reason = 'Standing resting idle loop') {
    if (this.isSitting) {
      if (this.actions.has('sit')) {
        this._notifyAnimation('sit', 'cognitive_state', reason || 'Seated taskbar posture');
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
    this._notifyAnimation(this.baseIdleName, 'base_idle', reason);
    this._crossFadeToAction(this.baseIdleName, {
      loop: THREE.LoopRepeat,
      fadeDuration,
      clampWhenFinished: false
    });
  }

  /**
   * Toggles taskbar seated posture.
   */
  setSitting(isSitting, fadeDuration = 0.5, reason = '') {
    if (isSitting) {
      this.isSitting = true;
      this.isIdlePlaying = true;
      if (this.actions.has('sit')) {
        this._notifyAnimation('sit', 'cognitive_state', reason || 'Taskbar seated posture activated');
        this._crossFadeToAction('sit', {
          loop: THREE.LoopRepeat,
          fadeDuration,
          clampWhenFinished: false
        });
      }
    } else if (this.isSitting) {
      this.isSitting = false;
      if (this.actions.has('stand_up')) {
        this._notifyAnimation('stand_up', 'cognitive_state', reason || 'Standing up from seated posture');
        this._crossFadeToAction('stand_up', {
          loop: THREE.LoopOnce,
          fadeDuration,
          clampWhenFinished: true
        });
      } else {
        this.playIdle(fadeDuration, reason || 'Standing up from seated posture');
      }
    }
  }

  /**
   * Sets thinking cognitive state.
   * Quick conversational pauses (< 3.5s) remain in relaxed idle with procedural head tilt & brow furrow.
   * Full-body Thinking.vrma mocap only escalates if thinking is prolonged (e.g. multi-step tool execution).
   */
  setThinking(isThinking, fadeDuration = 0.4, reason = '') {
    this.isThinking = isThinking;
    if (this.isSleeping) return;

    if (this._thinkingTimer) {
      clearTimeout(this._thinkingTimer);
      this._thinkingTimer = null;
    }

    if (isThinking && !this.disabledAnimations.has('thinking')) {
      this._thinkingTimer = setTimeout(() => {
        if (this.isThinking && !this.isSleeping && this.currentActionName !== 'thinking') {
          this._notifyAnimation('thinking', 'cognitive_state', reason || 'Prolonged AI thinking / tool execution');
          this._crossFadeToAction('thinking', {
            loop: THREE.LoopRepeat,
            fadeDuration: 0.8,
            clampWhenFinished: false
          });
        }
      }, 3500);
    } else {
      if (this.currentActionName === 'thinking') {
        this.playIdle(fadeDuration, 'Thinking completed, returned to base idle');
      }
    }
  }

  /**
   * Sets sleeping / napping state.
   */
  setSleeping(isSleeping, fadeDuration = 0.6, reason = '') {
    this.isSleeping = isSleeping;
    if (isSleeping) {
      this.isSitting = false;
      this._notifyAnimation('sleepy', 'cognitive_state', reason || 'Sleep / napping mode activated');
      this._crossFadeToAction('sleepy', {
        loop: THREE.LoopRepeat,
        fadeDuration,
        clampWhenFinished: false
      });
    } else {
      if (this.currentActionName === 'sleepy') {
        this.playIdle(fadeDuration, 'Awakened from sleep, returned to base idle');
      }
    }
  }

  /**
   * Plays a one-shot or continuous action animation, returning true if handled by VRMA.
   * Respects user-disabled animations from Settings.
   */
  playAction(key, { fadeDuration = 0.5, onComplete = null, category = 'action', reason = '' } = {}) {
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

    const actionReason = reason || `Triggered action '${lowerKey}'`;
    this._notifyAnimation(lowerKey, category, actionReason);

    // Seated posture handling
    if (lowerKey === 'sit' || lowerKey === 'sitting') {
      this.isSitting = true;
      this._crossFadeToAction(lowerKey, {
        loop: THREE.LoopRepeat,
        fadeDuration: 0.6,
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

  _crossFadeToAction(name, { loop = THREE.LoopRepeat, fadeDuration = 0.5, clampWhenFinished = (loop === THREE.LoopOnce) } = {}) {
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
    nextAction.play();

    // Prevent zero-weight gap / T-pose flicker:
    // Only fade out prevAction if it is actually active and contributing weight to the skeleton.
    // Use warp = false so clip timescale ratios are never distorted during cross-fades!
    if (prevAction && prevAction !== nextAction && prevAction.enabled && prevAction.getEffectiveWeight() > 0.05) {
      prevAction.crossFadeTo(nextAction, fadeDuration, false);
    } else {
      nextAction.setEffectiveWeight(1.0);
    }

    this.currentActionName = name;
  }

  _onMixerFinished(e) {
    const finishedAction = e.action;
    const finishedClipName = finishedAction.getClip().name;

    // CRITICAL: Ignore finished events from stale/older actions that were already cross-faded out!
    if (this.currentActionName && this.currentActionName !== finishedClipName) {
      return;
    }

    if (this.onActionComplete) {
      const cb = this.onActionComplete;
      this.onActionComplete = null;
      cb(finishedClipName);
    }

    // After a one-shot finishes, smoothly return to sitting, sleeping, thinking, or base idle
    if (this.isSitting) {
      if (finishedClipName === 'stand_up' || finishedClipName === 'stand') {
        this.isSitting = false;
        this.playIdle(0.75, `Action '${finishedClipName}' finished, returning to standing base idle`);
      } else {
        this._notifyAnimation('sit', 'cognitive_state', `Action '${finishedClipName}' finished, returning to seated posture`);
        this._crossFadeToAction('sit', {
          loop: THREE.LoopRepeat,
          fadeDuration: 0.5,
          clampWhenFinished: false
        });
      }
    } else if (this.isSleeping) {
      this.setSleeping(true, 0.5, `Action '${finishedClipName}' finished, returning to sleep posture`);
    } else if (this.isThinking) {
      this.setThinking(true, 0.5, `Action '${finishedClipName}' finished, returning to thinking posture`);
    } else {
      this.playIdle(0.75, `Action '${finishedClipName}' finished, returning to base idle`);
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
            this._notifyAnimation(chosen, 'idle_variation', `Periodic subtle idle variation (${chosen})`);
            this._crossFadeToAction(chosen, {
              loop: THREE.LoopOnce,
              fadeDuration: 0.75,
              clampWhenFinished: true
            });
          }
        }
      }
    }
  }

  dispose() {
    if (this._thinkingTimer) {
      clearTimeout(this._thinkingTimer);
      this._thinkingTimer = null;
    }
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
