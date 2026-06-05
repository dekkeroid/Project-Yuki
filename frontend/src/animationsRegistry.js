export const ANIMATIONS = [
  {
    name: 'greeting_wave',
    duration: 3.5,
    excludeFromRandomIdle: true,
    commands: [
      { cmd: '/ani-wave', description: 'Wave hello animation' },
      { cmd: '/ani-greeting', description: 'Greeting wave animation (alias)' }
    ],
    responseText: '*waves hello*'
  },
  {
    name: 'laughing',
    duration: 2.8,
    excludeFromRandomIdle: true,
    commands: [
      { cmd: '/laugh', description: 'Giggle and laugh animation' },
      { cmd: '/ani-laugh', description: 'Giggle and laugh animation (alias)' }
    ],
    responseText: '*giggles and laughs*'
  },
  {
    name: 'peering',
    duration: 4.5,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-peer', description: 'Curious peeking animation' },
      { cmd: '/ani-curious', description: 'Curious peek animation (alias)' }
    ],
    responseText: '*peers curious at you*'
  },
  {
    name: 'napping',
    duration: 5.0,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-nap', description: 'Nod off and startle awake' },
      { cmd: '/ani-sleepy', description: 'Sleepy animation (alias)' }
    ],
    responseText: '*nods off and startles awake*'
  },
  {
    name: 'grooving',
    duration: 6.0,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-groove', description: 'Groove / head-bob animation' },
      { cmd: '/ani-bob', description: 'Head-bob animation (alias)' }
    ],
    responseText: '*grooves to the beat*'
  },
  {
    name: 'pouting',
    duration: 5.0,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-pout', description: 'Cross arms and pout animation' },
      { cmd: '/ani-boredarm', description: 'Bored arm animation (alias)' }
    ],
    responseText: '*crosses arms and pouts*'
  },
  {
    name: 'yawning',
    duration: 4.5,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-yawn', description: 'Yawn tiredly animation' }
    ],
    responseText: '*yawns tiredly*'
  },
  {
    name: 'shrugging',
    duration: 3.0,
    excludeFromRandomIdle: false,
    commands: [
      { cmd: '/ani-shrug', description: 'Shrug shoulders animation' }
    ],
    responseText: '*shrugs shoulders*'
  },
  {
    name: 'knocking',
    duration: 1.2,
    excludeFromRandomIdle: true,
    commands: [
      { cmd: '/ani-knock', description: 'Screen knocking animation' }
    ],
    responseText: '*knocks on your screen*'
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
