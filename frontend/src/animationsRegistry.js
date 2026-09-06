export const ANIMATIONS = [
  {
    name: 'greeting_wave',
    alias: 'wave',
    duration: 1.9,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:wave/>',
    commands: [
      { cmd: '/ani-wave', description: 'Wave hello animation' },
      { cmd: '/ani-greeting', description: 'Greeting wave animation (alias)' }
    ],
    responseText: '*waves hello*',
    blendShapes: { happy: 0.35, relaxed: 0.6 }
  },
  {
    name: 'laughing',
    alias: 'laugh',
    duration: 2.8,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:laugh/>',
    commands: [
      { cmd: '/laugh', description: 'Giggle and laugh animation' },
      { cmd: '/ani-laugh', description: 'Giggle and laugh animation (alias)' }
    ],
    responseText: '*giggles and laughs*',
    blendShapes: { happy: 0.5, relaxed: 0.85, browUp: 0.4 }
  },
  {
    name: 'peering',
    alias: 'peer',
    duration: 4.5,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:peer/>',
    commands: [
      { cmd: '/ani-peer', description: 'Curious peeking animation' },
      { cmd: '/ani-curious', description: 'Curious peek animation (alias)' }
    ],
    responseText: '*peers curious at you*',
    blendShapes: { surprised: 0.55, relaxed: 0.2 }
  },
  {
    name: 'napping',
    alias: 'nap',
    duration: 5.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:nap/>',
    commands: [
      { cmd: '/nap', description: 'Take an instant companion power nap' },
      { cmd: '/ani-nap', description: 'Nod off and startle awake' },
      { cmd: '/ani-sleepy', description: 'Sleepy animation (alias)' }
    ],
    responseText: '*curls up and takes a power nap*',
    blendShapes: { relaxed: 0.4 }
  },
  {
    name: 'grooving',
    alias: 'groove',
    duration: 6.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:groove/>',
    commands: [
      { cmd: '/ani-groove', description: 'Groove / head-bob animation' },
      { cmd: '/ani-bob', description: 'Head-bob animation (alias)' }
    ],
    responseText: '*grooves to the beat*',
    blendShapes: { relaxed: 0.6 }
  },
  {
    name: 'pouting',
    alias: 'pout',
    duration: 2.5,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:pout/>',
    commands: [
      { cmd: '/ani-pout', description: 'Cute anime pout expression' }
    ],
    responseText: '*pouts with puffed cheeks*',
    blendShapes: { sad: 0.35, angry: 0.45, browDown: 0.6 }
  },
  {
    name: 'sleepy_rub_eyes',
    alias: 'sleepy',
    type: 'vrma',
    vrmaUrl: './animations/yawn_sleepy_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:sleepy/>',
    commands: [
      { cmd: '/ani-sleepy', description: 'Feeling sleepy and rubbing eyes (mocap)' },
      { cmd: '/sleepy', description: 'Feeling sleepy and rubbing eyes (alias)' }
    ],
    responseText: '*feels sleepy and rubs her eyes*',
    blendShapes: { relaxed: 0.75, sad: 0.2, browDown: 0.25 }
  },
  {
    name: 'shrugging',
    alias: 'shrug',
    type: 'vrma',
    vrmaUrl: './animations/shrugging.vrma',
    duration: 1.88,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:shrug/>',
    commands: [
      { cmd: '/ani-shrug', description: 'Natural shrug with open palms (mocap)' }
    ],
    responseText: '*shrugs shoulders*',
    blendShapes: { relaxed: 0.3, browUp: 0.2 }
  },
  {
    name: 'knocking',
    alias: 'knock',
    duration: 1.2,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:knock/>',
    commands: [
      { cmd: '/ani-knock', description: 'Screen knocking animation' }
    ],
    responseText: '*knocks on your screen*',
    blendShapes: { happy: 0.3 }
  },
  {
    name: 'nodding',
    alias: 'nod',
    type: 'vrma',
    vrmaUrl: './animations/head_nod.vrma',
    duration: 2.33,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:nod/>',
    commands: [
      { cmd: '/ani-nod', description: 'Affirmation head nod (mocap)' },
      { cmd: '/ani-agree', description: 'Nod head in agreement (alias)' }
    ],
    responseText: '*nods head*',
    blendShapes: { happy: 0.4, relaxed: 0.5 }
  },
  {
    name: 'head_shake',
    alias: 'shake',
    type: 'vrma',
    vrmaUrl: './animations/head_shake.vrma',
    duration: 1.63,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shake/>',
    commands: [
      { cmd: '/ani-shake', description: 'Expressive disagreement head shake (mocap)' },
      { cmd: '/ani-no', description: 'Shake head side to side (alias)' },
      { cmd: '/ani-disagree', description: 'Shake head side to side (alias)' }
    ],
    responseText: '*shakes head*',
    blendShapes: { surprised: 0.3, browUp: 0.3 }
  },
  {
    name: 'salute',
    alias: 'salute',
    duration: 3.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:salute/>',
    commands: [
      { cmd: '/ani-salute', description: 'Playful military salute' },
      { cmd: '/ani-ready', description: 'Playful military salute (alias)' }
    ],
    responseText: '*salutes playfully*',
    blendShapes: { happy: 0.7, browUp: 0.2 }
  },
  {
    name: 'shy_fidget',
    alias: 'shy',
    type: 'vrma',
    vrmaUrl: './animations/shy_blush_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shy/>',
    commands: [
      { cmd: '/ani-shy', description: 'Shy fidgeting & blushing (mocap)' },
      { cmd: '/ani-fidget', description: 'Shy fidgeting (alias)' }
    ],
    responseText: '*fidgets shyingly*',
    blendShapes: { happy: 0.3, relaxed: 0.4 }
  },
  {
    name: 'cheering',
    alias: 'cheer',
    type: 'vrma',
    vrmaUrl: './animations/happy_gesture.vrma',
    duration: 2.63,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:cheer/>',
    commands: [
      { cmd: '/ani-cheer', description: 'Joyful celebration gesture (mocap)' },
      { cmd: '/ani-victory', description: 'Celebration gesture (alias)' }
    ],
    responseText: '*cheers with joyful hand gestures*',
    blendShapes: { happy: 0.95, surprised: 0.4 }
  },
  {
    name: 'pointing',
    alias: 'point',
    type: 'vrma',
    vrmaUrl: './animations/point.vrma',
    duration: 9.60,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:point/>',
    commands: [
      { cmd: '/ani-point', description: 'Point finger towards screen (mocap)' },
      { cmd: '/ani-show', description: 'Point at screen (alias)' }
    ],
    responseText: '*points at your screen*',
    blendShapes: { relaxed: 0.4, browUp: 0.3 }
  },
  {
    name: 'inspect_screen',
    alias: 'inspect',
    duration: 4.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:inspect/>',
    commands: [
      { cmd: '/ani-inspect', description: 'Lean in close to inspect screen' },
      { cmd: '/ani-lookclose', description: 'Inspect screen (alias)' }
    ],
    responseText: '*leans close to inspect*',
    blendShapes: { surprised: 0.6, browDown: 0.3 }
  },
  {
    name: 'neck_crack',
    alias: 'neck_crack',
    type: 'vrma',
    vrmaUrl: './animations/neck_stretch.vrma',
    duration: 2.88,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:neck_crack/>',
    commands: [
      { cmd: '/ani-neck_crack', description: 'Neck cracking & stretch gesture (mocap)' },
      { cmd: '/ani-neck_stretch', description: 'Neck stretch (alias)' }
    ],
    responseText: '*cracks her neck with a satisfying stretch*',
    blendShapes: { relaxed: 0.85, happy: 0.3 }
  },
  {
    name: 'look_down',
    alias: 'look_down',
    type: 'vrma',
    vrmaUrl: './animations/disappointed_sad_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:look_down/>',
    commands: [
      { cmd: '/ani-look_down', description: 'Look down towards ground curiously (mocap)' },
      { cmd: '/ani-inspect_ground', description: 'Check ground (alias)' }
    ],
    responseText: '*looks down towards the floor*',
    blendShapes: { sad: 0.4, browDown: 0.4 }
  },
  {
    name: 'crying_sob',
    alias: 'crying_sob',
    type: 'vrma',
    vrmaUrl: './animations/crying.vrma',
    duration: 6.25,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:crying_sob/>',
    commands: [
      { cmd: '/ani-crying', description: 'Emotional weeping gesture (mocap)' }
    ],
    responseText: '*sobs tearfully*',
    blendShapes: { sad: 0.95, browDown: 0.5 }
  },
  {
    name: 'shocked_recoil',
    alias: 'shocked_recoil',
    duration: 2.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shocked_recoil/>',
    commands: [
      { cmd: '/ani-shocked', description: 'Shocked recoil backward' }
    ],
    responseText: '*recoils in shock*',
    blendShapes: { surprised: 1.0, browUp: 0.9 }
  },
  {
    name: 'clapping',
    alias: 'clap',
    type: 'vrma',
    vrmaUrl: './animations/clapping.vrma',
    duration: 1.17,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:clap/>',
    commands: [
      { cmd: '/ani-clap', description: 'Applause / hand clapping (mocap)' },
      { cmd: '/ani-applause', description: 'Applause animation (alias)' }
    ],
    responseText: '*claps enthusiastically*',
    blendShapes: { happy: 0.5, relaxed: 0.4 }
  },
  {
    name: 'jumping',
    alias: 'jump',
    type: 'vrma',
    vrmaUrl: './animations/joyful_jump.vrma',
    duration: 1.83,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:jump/>',
    commands: [
      { cmd: '/ani-jump', description: 'Joyful jump with leg tuck (mocap)' },
      { cmd: '/ani-hop', description: 'Hop with joy (alias)' }
    ],
    responseText: '*jumps up joyfully*',
    blendShapes: { surprised: 0.35, happy: 0.6 }
  },
  {
    name: 'look_around',
    alias: 'lookaround',
    type: 'vrma',
    vrmaUrl: './animations/look_around_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:lookaround/>',
    commands: [
      { cmd: '/ani-lookaround', description: 'Look around room curiously (mocap)' },
      { cmd: '/ani-search', description: 'Look around room (alias)' }
    ],
    responseText: '*looks around curiously*',
    blendShapes: { surprised: 0.3, relaxed: 0.4 }
  },
  {
    name: 'peace_sign',
    alias: 'peace',
    type: 'vrma',
    vrmaUrl: './animations/peace_sign.vrma',
    duration: 11.68,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:peace/>',
    commands: [
      { cmd: '/ani-peace', description: 'Idol sparkle double peace sign pose (mocap)' },
      { cmd: '/ani-vsign', description: 'Peace sign V-pose (mocap alias)' }
    ],
    responseText: '*strikes a cute idol peace-sign pose with a wink*',
    blendShapes: { happy: 0.8, relaxed: 0.5 }
  },
  {
    name: 'disgusted_recoil',
    alias: 'disgusted',
    type: 'vrma',
    vrmaUrl: './animations/gasp_surprised_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:disgusted/>',
    commands: [
      { cmd: '/ani-disgusted', description: 'Disgusted shock reaction wanting object away (mocap)' },
      { cmd: '/ani-eww', description: 'Repulsed recoil (alias)' },
      { cmd: '/ani-gross', description: 'Gross recoil (alias)' }
    ],
    responseText: '*recoils in shocked disgust, pushing it away*',
    blendShapes: { surprised: 1.0, browUp: 0.8, angry: 0.3 }
  },
  {
    name: 'princess_bow',
    alias: 'princess_bow',
    type: 'vrma',
    vrmaUrl: './animations/formal_bow.vrma',
    duration: 2.46,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:princess_bow/>',
    commands: [
      { cmd: '/ani-bow', description: 'Courteous formal bow (mocap)' },
      { cmd: '/ani-curtsy', description: 'Formal curtsy (alias)' }
    ],
    responseText: '*gives a graceful formal bow*',
    blendShapes: { relaxed: 0.7, happy: 0.3 }
  },
  {
    name: 'finger_guns',
    alias: 'guns',
    type: 'vrma',
    vrmaUrl: './animations/finger_guns.vrma',
    duration: 9.60,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:guns/>',
    commands: [
      { cmd: '/ani-guns', description: 'Double finger-guns pointing at you (mocap)' },
      { cmd: '/ani-shoot', description: 'Finger guns shoot (mocap alias)' },
      { cmd: '/ani-bang', description: 'Finger gun bang (mocap alias)' }
    ],
    responseText: '*points finger guns at you with a sharp wink*',
    blendShapes: { happy: 0.7, relaxed: 0.5 }
  },
  {
    name: 'show_body',
    alias: 'show_body',
    type: 'vrma',
    vrmaUrl: './animations/show_body.vrma',
    duration: 11.8,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:show_body/>',
    commands: [
      { cmd: '/ani-show', description: 'Showcase full body and outfit (mocap)' },
      { cmd: '/ani-showcase', description: 'Full body showcase (mocap alias)' },
      { cmd: '/ani-body', description: 'Show body (mocap alias)' }
    ],
    responseText: '*turns gracefully to showcase her full body and outfit*',
    blendShapes: { relaxed: 0.6, happy: 0.3 }
  },
  {
    name: 'model_pose',
    alias: 'model_pose',
    type: 'vrma',
    vrmaUrl: './animations/model_pose.vrma',
    duration: 7.52,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:model_pose/>',
    commands: [
      { cmd: '/ani-model', description: 'Strike a stylish fashion model pose (mocap)' },
      { cmd: '/ani-pose', description: 'Model pose (mocap alias)' }
    ],
    responseText: '*strikes a stylish, confident model pose*',
    blendShapes: { relaxed: 0.5, happy: 0.3 }
  },
  {
    name: 'squat_stretch',
    alias: 'squat',
    type: 'vrma',
    vrmaUrl: './animations/squat_stretch.vrma',
    duration: 11.52,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:squat/>',
    commands: [
      { cmd: '/ani-squat', description: 'Athletic crouch stretch (mocap)' },
      { cmd: '/ani-crouch', description: 'Athletic squat stretch (mocap alias)' }
    ],
    responseText: '*drops into a graceful athletic crouch stretch*',
    blendShapes: { relaxed: 0.6 }
  },
  // --- RENEWAL ALTERNATIVES (Options for Testing in App) ---
  {
    name: 'thinking',
    alias: 'think',
    type: 'vrma',
    vrmaUrl: './animations/thinking_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:think/>',
    commands: [
      { cmd: '/ani-think', description: 'Deep analytical thinking posture (mocap)' },
      { cmd: '/ani-ponder', description: 'Ponder deeply (alias)' }
    ],
    responseText: '*contemplates thoughtfully with a hand near her chin*',
    blendShapes: { relaxed: 0.4, browDown: 0.4 }
  },
  {
    name: 'work_stretch',
    alias: 'stretch',
    type: 'vrma',
    vrmaUrl: './animations/relax_opt1.vrma',
    duration: 3.93,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:stretch/>',
    commands: [
      { cmd: '/ani-stretch', description: 'Desk stretch after working a long time (mocap)' },
      { cmd: '/ani-work_stretch', description: 'Work stretch (alias)' }
    ],
    responseText: '*stretches comfortably after a long work session*',
    blendShapes: { relaxed: 0.8, happy: 0.3 }
  },
  {
    name: 'dogeza_bow',
    alias: 'dogeza',
    type: 'vrma',
    vrmaUrl: './animations/disappointed_apology_opt1.vrma',
    duration: 7.3,
    upperBodyOnly: false,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:dogeza/>',
    commands: [
      { cmd: '/ani-dogeza', description: 'Deep regret bow / dogeza apology (mocap)' },
      { cmd: '/ani-regret_bow', description: 'Deep regret bow (alias)' },
      { cmd: '/ani-disappointed2', description: 'Disappointed Option 2 (legacy alias)' }
    ],
    responseText: '*apologizes with a deep, regretful dogeza bow*',
    blendShapes: { sad: 0.85, browDown: 0.6 }
  },
  {
    name: 'speaking_gesture',
    alias: 'speaking',
    type: 'vrma',
    vrmaUrl: './animations/speaking_gesture_opt1.vrma',
    duration: 1.97,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:speaking/>',
    commands: [
      { cmd: '/ani-speak', description: 'Speaking gesture: Natural hand conversation explanation (SanHsien)' }
    ],
    responseText: '*explains with expressive hand gestures*',
    blendShapes: { relaxed: 0.5, browUp: 0.2 }
  },
  {
    name: 'idle_utsuwa_1',
    alias: 'utsuwa1',
    type: 'vrma',
    vrmaUrl: './animations/idle_utsuwa_1.vrma',
    duration: 16.6,
    upperBodyOnly: false,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:utsuwa1/>',
    commands: [
      { cmd: '/ani-idle1', description: 'Idle Option 1: Full-body swaying companion idle (Utsuwa)' }
    ],
    responseText: '*sways peacefully in idle contemplation*',
    blendShapes: { relaxed: 0.8, happy: 0.2 }
  },
  {
    name: 'idle_utsuwa_2',
    alias: 'utsuwa2',
    type: 'vrma',
    vrmaUrl: './animations/idle_utsuwa_2.vrma',
    duration: 9.97,
    upperBodyOnly: false,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:utsuwa2/>',
    commands: [
      { cmd: '/ani-idle2', description: 'Idle Option 2: Full-body breathing companion idle (Utsuwa)' }
    ],
    responseText: '*rests gently in place*',
    blendShapes: { relaxed: 0.7 }
  },
  {
    name: 'yawning',
    alias: 'yawn',
    type: 'vrma',
    vrmaUrl: './animations/yawn_opt2.vrma',
    duration: 7.54,
    upperBodyOnly: true,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:yawn/>',
    commands: [
      { cmd: '/ani-yawn', description: 'Yawn and languid stretch (mocap)' },
      { cmd: '/yawn', description: 'Yawn and languid stretch (alias)' }
    ],
    responseText: '*yawns languidly and stretches softly*',
    blendShapes: { relaxed: 0.85, happy: 0.2 }
  },
  {
    name: 'laugh_opt2',
    alias: 'laugh2',
    type: 'vrma',
    vrmaUrl: './animations/laugh_opt2.vrma',
    duration: 7.54,
    upperBodyOnly: false,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:knee_slap/>',
    commands: [
      { cmd: '/ani-laugh2', description: 'Laughing and slapping knee at something unbelievably stupid (mocap)' },
      { cmd: '/ani-knee_slap', description: 'Laugh and slap knee (alias)' },
      { cmd: '/knee_slap', description: 'Laugh and slap knee (alias)' }
    ],
    responseText: '*laughs heartily while slapping her knee*',
    blendShapes: { happy: 0.6, relaxed: 0.9, browUp: 0.4 }
  },
  {
    name: 'tsundere_bicker',
    alias: 'baka',
    type: 'vrma',
    vrmaUrl: './animations/tsundere_bicker.vrma',
    duration: 3.25,
    upperBodyOnly: true,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:baka/>',
    commands: [
      { cmd: '/ani-baka', description: 'Flustered tsundere bickering / "B-Baka!" reaction (3.3s mocap)' },
      { cmd: '/baka', description: 'B-Baka reaction (alias)' },
      { cmd: '/ani-bicker', description: 'Flustered bickering reaction (alias)' },
      { cmd: '/ani-flustered', description: 'Flustered reaction (alias)' },
      { cmd: '/ani-laugh4', description: 'Baka reaction (legacy alias)' }
    ],
    responseText: '*flustered and blushing, bickering back defensively* B-Baka!',
    blendShapes: { angry: 0.55, surprised: 0.4, browDown: 0.7, browUp: 0.2, relaxed: 0.0 }
  },
  {
    name: 'breathing',
    duration: 0,
    excludeFromRandomIdle: true,
    commands: [],
    responseText: ''
  },
  {
    name: 'blinking',
    duration: 0,
    excludeFromRandomIdle: true,
    commands: [],
    responseText: ''
  },
  {
    name: 'mouse_tracking',
    duration: 0,
    excludeFromRandomIdle: true,
    commands: [],
    responseText: ''
  },
  {
    name: 'floating',
    duration: 0,
    excludeFromRandomIdle: true,
    commands: [],
    responseText: ''
  }
];

export const EMOTIONS = {
  neutral: {
    name: 'neutral',
    llmTag: '<yuki_emotion:neutral/>',
    blendShapes: { happy: 0.1, sad: 0.0, angry: 0.0, surprised: 0.0, relaxed: 0.0, browUp: 0.0, browDown: 0.0 }
  },
  happy: {
    name: 'happy',
    llmTag: '<yuki_emotion:happy/>',
    blendShapes: { happy: 0.0, relaxed: 1.0, browUp: 0.35, sad: 0.0, angry: 0.0, surprised: 0.0, browDown: 0.0 }
  },
  excited: {
    name: 'excited',
    llmTag: '<yuki_emotion:excited/>',
    blendShapes: { happy: 0.95, surprised: 0.4, browUp: 0.5, relaxed: 0.2, sad: 0.0, angry: 0.0, browDown: 0.0 }
  },
  sad: {
    name: 'sad',
    llmTag: '<yuki_emotion:sad/>',
    blendShapes: { sad: 0.75, browDown: 0.3, happy: 0.0, angry: 0.0, surprised: 0.0, relaxed: 0.0, browUp: 0.0 }
  },
  angry: {
    name: 'angry',
    llmTag: '<yuki_emotion:angry/>',
    blendShapes: { angry: 0.8, browDown: 0.8, happy: 0.0, sad: 0.0, surprised: 0.0, relaxed: 0.0, browUp: 0.0 }
  },
  surprised: {
    name: 'surprised',
    llmTag: '<yuki_emotion:surprised/>',
    blendShapes: { surprised: 0.85, browUp: 0.7, happy: 0.1, sad: 0.0, angry: 0.0, relaxed: 0.0, browDown: 0.0 }
  },
  relaxed: {
    name: 'relaxed',
    llmTag: '<yuki_emotion:relaxed/>',
    blendShapes: { relaxed: 1.0, happy: 0.0, browUp: 0.1, sad: 0.0, angry: 0.0, surprised: 0.0, browDown: 0.0 }
  },
  thinking: {
    name: 'thinking',
    llmTag: '<yuki_emotion:thinking/>',
    blendShapes: { relaxed: 0.4, browDown: 0.55, happy: 0.0, sad: 0.0, angry: 0.0, surprised: 0.0, browUp: 0.0 }
  },
  embarrassed: {
    name: 'embarrassed',
    llmTag: '<yuki_emotion:embarrassed/>',
    blendShapes: { happy: 0.3, sad: 0.3, browUp: 0.4, surprised: 0.3 }
  },
  smug: {
    name: 'smug',
    llmTag: '<yuki_emotion:smug/>',
    blendShapes: { happy: 0.0, relaxed: 1.0, browUp: 0.3 }
  },
  skeptical: {
    name: 'skeptical',
    llmTag: '<yuki_emotion:skeptical/>',
    blendShapes: { browUp: 0.8, browDown: 0.5, relaxed: 0.3 }
  },
  disappointed: {
    name: 'disappointed',
    llmTag: '<yuki_emotion:disappointed/>',
    blendShapes: { sad: 0.6, browDown: 0.4 }
  },
  pleading: {
    name: 'pleading',
    llmTag: '<yuki_emotion:pleading/>',
    blendShapes: { surprised: 0.4, happy: 0.2, browUp: 0.85 }
  },
  crying: {
    name: 'crying',
    llmTag: '<yuki_emotion:crying/>',
    blendShapes: { sad: 0.95, browDown: 0.5 }
  },
  bittersweet: {
    name: 'bittersweet',
    llmTag: '<yuki_emotion:bittersweet/>',
    blendShapes: { sad: 0.5, happy: 0.65, browUp: 0.3 }
  },
  exhausted: {
    name: 'exhausted',
    llmTag: '<yuki_emotion:exhausted/>',
    blendShapes: { sad: 0.5, angry: 0.3, browDown: 0.7 }
  },
  shocked: {
    name: 'shocked',
    llmTag: '<yuki_emotion:shocked/>',
    blendShapes: { surprised: 1.0, browUp: 0.9 }
  },
  wink: {
    name: 'wink',
    llmTag: '<yuki_emotion:wink/>',
    blendShapes: { happy: 0.6, relaxed: 0.4 }
  },
  hush: {
    name: 'hush',
    llmTag: '<yuki_emotion:hush/>',
    blendShapes: { relaxed: 0.6, happy: 0.2 }
  },
  drowsy: {
    name: 'drowsy',
    llmTag: '<yuki_emotion:drowsy/>',
    blendShapes: { relaxed: 0.5, sad: 0.2, browDown: 0.3 }
  }
};

// Map tag names like "wave" or "greeting_wave" to internal animation names
export const LLM_ANIMATION_MAP = {
  wave: 'greeting_wave',
  greeting_wave: 'greeting_wave',
  greeting: 'greeting_wave',
  laugh: 'laughing',
  laughing: 'laughing',
  giggle: 'laughing',
  peer: 'peering',
  peering: 'peering',
  curious: 'peering',
  nap: 'napping',
  napping: 'napping',
  sleepy: 'sleepy_rub_eyes',
  sleepy_rub_eyes: 'sleepy_rub_eyes',
  groove: 'grooving',
  grooving: 'grooving',
  bob: 'grooving',
  pout: 'pouting',
  pouting: 'pouting',
  yawn: 'yawning',
  yawning: 'yawning',
  shrug: 'shrugging',
  shrugging: 'shrugging',
  knock: 'knocking',
  knocking: 'knocking',
  nod: 'nodding',
  nodding: 'nodding',
  agree: 'nodding',
  shake: 'head_shake',
  head_shake: 'head_shake',
  no: 'head_shake',
  disagree: 'head_shake',
  salute: 'salute',
  ready: 'salute',
  shy: 'shy_fidget',
  shy_fidget: 'shy_fidget',
  fidget: 'shy_fidget',
  cheer: 'cheering',
  cheering: 'cheering',
  victory: 'cheering',
  point: 'pointing',
  pointing: 'pointing',
  show: 'pointing',
  inspect: 'inspect_screen',
  inspect_screen: 'inspect_screen',
  lookclose: 'inspect_screen',
  neck_crack: 'neck_crack',
  neck_stretch: 'neck_crack',
  look_down: 'look_down',
  inspect_ground: 'look_down',
  crying_sob: 'crying_sob',
  shocked_recoil: 'shocked_recoil',
  clap: 'clapping',
  clapping: 'clapping',
  applause: 'clapping',
  jump: 'jumping',
  jumping: 'jumping',
  hop: 'jumping',
  lookaround: 'look_around',
  look_around: 'look_around',
  peace_sign: 'peace_sign',
  peace: 'peace_sign',
  sparkle: 'peace_sign',
  blush: 'shy_fidget',
  disgusted_recoil: 'disgusted_recoil',
  disgusted: 'disgusted_recoil',
  eww: 'disgusted_recoil',
  gross: 'disgusted_recoil',
  princess_bow: 'princess_bow',
  bow: 'princess_bow',
  curtsy: 'princess_bow',
  think: 'thinking',
  thinking: 'thinking',
  ponder: 'thinking',
  stretch: 'work_stretch',
  stretching: 'work_stretch',
  work_stretch: 'work_stretch',
  scold: 'pointing',
  finger_guns: 'finger_guns',
  guns: 'finger_guns',
  fingerguns: 'finger_guns',
  bang: 'finger_guns',
  show_body: 'show_body',
  showcase: 'show_body',
  model_pose: 'model_pose',
  model: 'model_pose',
  pose: 'model_pose',
  squat_stretch: 'squat_stretch',
  squat: 'squat_stretch',
  crouch: 'squat_stretch',
  // Variant options & specific mappings
  dogeza: 'dogeza_bow',
  dogeza_bow: 'dogeza_bow',
  regret_bow: 'dogeza_bow',
  disappointed2: 'dogeza_bow',
  disappointed_opt2: 'dogeza_bow',
  speaking: 'speaking_gesture',
  speaking_gesture: 'speaking_gesture',
  utsuwa1: 'idle_utsuwa_1',
  idle_utsuwa_1: 'idle_utsuwa_1',
  utsuwa2: 'idle_utsuwa_2',
  idle_utsuwa_2: 'idle_utsuwa_2',
  yawn2: 'yawning',
  yawn_opt2: 'yawning',
  knee_slap: 'laugh_opt2',
  laugh2: 'laugh_opt2',
  laugh_opt2: 'laugh_opt2',
  baka: 'tsundere_bicker',
  tsundere: 'tsundere_bicker',
  tsundere_bicker: 'tsundere_bicker',
  bicker: 'tsundere_bicker',
  flustered: 'tsundere_bicker',
  laugh4: 'tsundere_bicker',
  laugh_opt4: 'tsundere_bicker',
  // Friendly reflex / AED speech aliases:
  surprise: 'peering',
  tilt_head: 'peering',
  gentle_wave: 'greeting_wave',
  look_away: 'shy_fidget',
  caring: 'nodding',
  smile: 'laughing',
  gentle_smile: 'nodding',
  worried: 'shy_fidget',
  fret: 'shy_fidget',
  pat: 'nodding',
  hug: 'princess_bow',
  sigh: 'dogeza_bow',
  rub_eyes: 'sleepy_rub_eyes'
};

export const LLM_EMOTION_MAP = {
  neutral: 'neutral',
  happy: 'relaxed',
  joy: 'relaxed',
  excited: 'excited',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  shocked: 'shocked',
  screaming: 'shocked',
  relaxed: 'relaxed',
  calm: 'relaxed',
  thinking: 'thinking',
  embarrassed: 'embarrassed',
  blush: 'embarrassed',
  smug: 'smug',
  skeptical: 'skeptical',
  suspicious: 'skeptical',
  disappointed: 'disappointed',
  sigh: 'disappointed',
  pleading: 'pleading',
  begging: 'pleading',
  crying: 'crying',
  sob: 'crying',
  bittersweet: 'bittersweet',
  exhausted: 'exhausted',
  distressed: 'exhausted',
  wink: 'wink',
  hush: 'hush',
  drowsy: 'drowsy'
};
