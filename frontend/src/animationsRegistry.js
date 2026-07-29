export const ANIMATIONS = [
  {
    name: 'greeting_wave',
    alias: 'wave',
    duration: 3.5,
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
      { cmd: '/ani-nap', description: 'Nod off and startle awake' },
      { cmd: '/ani-sleepy', description: 'Sleepy animation (alias)' }
    ],
    responseText: '*nods off and startles awake*',
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
    blendShapes: { happy: 0.8, relaxed: 0.4, browUp: 0.2, sad: 0.0, angry: 0.0, surprised: 0.0, browDown: 0.0 }
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
    blendShapes: { relaxed: 0.8, happy: 0.25, browUp: 0.1, sad: 0.0, angry: 0.0, surprised: 0.0, browDown: 0.0 }
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
    blendShapes: { happy: 0.6, relaxed: 0.5, browUp: 0.3 }
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
  knocking: 'knocking'
};

export const LLM_EMOTION_MAP = {
  neutral: 'neutral',
  happy: 'happy',
  joy: 'happy',
  excited: 'excited',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  shocked: 'surprised',
  relaxed: 'relaxed',
  calm: 'relaxed',
  thinking: 'thinking',
  embarrassed: 'embarrassed',
  blush: 'embarrassed',
  smug: 'smug'
};
