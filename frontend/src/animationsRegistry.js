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
    duration: 5.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:pout/>',
    commands: [
      { cmd: '/ani-pout', description: 'Cross arms and pout animation' },
      { cmd: '/ani-boredarm', description: 'Bored arm animation (alias)' }
    ],
    responseText: '*crosses arms and pouts*',
    blendShapes: { sad: 0.4, angry: 0.3, browDown: 0.6 }
  },
  {
    name: 'yawning',
    alias: 'yawn',
    duration: 4.5,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:yawn/>',
    commands: [
      { cmd: '/ani-yawn', description: 'Yawn tiredly animation' }
    ],
    responseText: '*yawns tiredly*',
    blendShapes: { relaxed: 0.7 }
  },
  {
    name: 'shrugging',
    alias: 'shrug',
    duration: 3.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:shrug/>',
    commands: [
      { cmd: '/ani-shrug', description: 'Shrug shoulders animation' }
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
    duration: 2.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:nod/>',
    commands: [
      { cmd: '/ani-nod', description: 'Nod head in agreement' },
      { cmd: '/ani-agree', description: 'Nod head in agreement (alias)' }
    ],
    responseText: '*nods head*',
    blendShapes: { happy: 0.4, relaxed: 0.5 }
  },
  {
    name: 'head_shake',
    alias: 'shake',
    duration: 2.2,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shake/>',
    commands: [
      { cmd: '/ani-shake', description: 'Shake head side to side' },
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
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shy/>',
    commands: [
      { cmd: '/ani-shy', description: 'Shy fidgeting & blushing' },
      { cmd: '/ani-fidget', description: 'Shy fidgeting (alias)' }
    ],
    responseText: '*fidgets shyingly*',
    blendShapes: { happy: 0.3, relaxed: 0.4 }
  },
  {
    name: 'giggle_cover',
    alias: 'giggle',
    duration: 2.8,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:giggle/>',
    commands: [
      { cmd: '/ani-giggle', description: 'Cover mouth while giggling' },
      { cmd: '/ani-cover', description: 'Cover mouth while giggling (alias)' }
    ],
    responseText: '*giggles behind hand*',
    blendShapes: { happy: 0.85, browUp: 0.3 }
  },
  {
    name: 'facepalm',
    alias: 'facepalm',
    duration: 3.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:facepalm/>',
    commands: [
      { cmd: '/ani-facepalm', description: 'Hand to forehead facepalm' },
      { cmd: '/ani-oops', description: 'Facepalm animation (alias)' }
    ],
    responseText: '*facepalms*',
    blendShapes: { sad: 0.5, browDown: 0.4 }
  },
  {
    name: 'cheering',
    alias: 'cheer',
    duration: 3.2,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:cheer/>',
    commands: [
      { cmd: '/ani-cheer', description: 'Two-handed victory cheer' },
      { cmd: '/ani-victory', description: 'Victory cheer (alias)' }
    ],
    responseText: '*cheers with arms up*',
    blendShapes: { happy: 0.95, surprised: 0.4 }
  },
  {
    name: 'pointing',
    alias: 'point',
    duration: 2.8,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:point/>',
    commands: [
      { cmd: '/ani-point', description: 'Point index finger at screen' },
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
    name: 'typing_air',
    alias: 'typing',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:typing/>',
    commands: [
      { cmd: '/ani-typing', description: 'Type on invisible keyboard' },
      { cmd: '/ani-work', description: 'Type on keyboard (alias)' }
    ],
    responseText: '*types rapidly on keyboard*',
    blendShapes: { relaxed: 0.5, browDown: 0.3 }
  },
  {
    name: 'stretching',
    alias: 'stretch',
    duration: 4.2,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:stretch/>',
    commands: [
      { cmd: '/ani-stretch', description: 'Stretch arms overhead' },
      { cmd: '/ani-relax', description: 'Stretch arms overhead (alias)' }
    ],
    responseText: '*stretches arms overhead*',
    blendShapes: { relaxed: 0.9 }
  },
  {
    name: 'disappointed_nod',
    alias: 'disappointed_nod',
    duration: 3.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:disappointed_nod/>',
    commands: [
      { cmd: '/ani-disappointed', description: 'Disappointed slow nod & sigh' }
    ],
    responseText: '*nods slowly in disappointment*',
    blendShapes: { sad: 0.6, browDown: 0.4 }
  },
  {
    name: 'crying_sob',
    alias: 'crying_sob',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:crying_sob/>',
    commands: [
      { cmd: '/ani-crying', description: 'Tearful shuddering sob' }
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
  sleepy: 'napping',
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
  giggle: 'giggle_cover',
  giggle_cover: 'giggle_cover',
  cover: 'giggle_cover',
  facepalm: 'facepalm',
  oops: 'facepalm',
  cheer: 'cheering',
  cheering: 'cheering',
  victory: 'cheering',
  point: 'pointing',
  pointing: 'pointing',
  show: 'pointing',
  inspect: 'inspect_screen',
  inspect_screen: 'inspect_screen',
  lookclose: 'inspect_screen',
  typing: 'typing_air',
  typing_air: 'typing_air',
  work: 'typing_air',
  stretch: 'stretching',
  stretching: 'stretching',
  relax: 'stretching',
  disappointed_nod: 'disappointed_nod',
  crying_sob: 'crying_sob',
  shocked_recoil: 'shocked_recoil'
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
