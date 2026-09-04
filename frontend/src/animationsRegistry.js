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
    responseText: '*waves hello* Hello hello! Great to see you!',
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
    responseText: '*giggles and laughs* Hehehe, that is too funny!',
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
    responseText: '*peers curious at you* Whatcha doing? Mind if I take a look?',
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
    responseText: '*grooves to the beat* Mmm, this rhythm is totally catchy!',
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
    responseText: "*crosses arms and pouts* Hmph! Don't ignore me, okay?",
    blendShapes: { sad: 0.4, angry: 0.3, browDown: 0.6 }
  },
  {
    name: 'yawning',
    alias: 'yawn',
    duration: 4.5,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:yawn/>',
    commands: [
      { cmd: '/ani-yawn', description: 'Yawn tiredly animation' },
      { cmd: '/ani-yawning', description: 'Yawn tiredly animation (alias)' }
    ],
    responseText: "*yawns tiredly* Huaaah... so sleepy. But I'm still right here with you!",
    blendShapes: { relaxed: 0.7 }
  },
  {
    name: 'shrugging',
    alias: 'shrug',
    duration: 3.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:shrug/>',
    commands: [
      { cmd: '/ani-shrug', description: 'Shrug shoulders animation' },
      { cmd: '/ani-shrugging', description: 'Shrug shoulders animation (alias)' }
    ],
    responseText: '*shrugs shoulders* Beats me! What do you think?',
    blendShapes: { relaxed: 0.3, browUp: 0.2 }
  },
  {
    name: 'knocking',
    alias: 'knock',
    duration: 1.2,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:knock/>',
    commands: [
      { cmd: '/ani-knock', description: 'Screen knocking animation' },
      { cmd: '/ani-knocking', description: 'Screen knocking animation (alias)' }
    ],
    responseText: "*knocks on your screen* Knock knock! Anyone there? Don't forget about me!",
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
      { cmd: '/ani-nodding', description: 'Nod head in agreement (alias)' },
      { cmd: '/ani-agree', description: 'Nod head in agreement (alias)' }
    ],
    responseText: '*nods head* Mm-hmm! Totally agree with you!',
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
      { cmd: '/ani-headshake', description: 'Shake head side to side (alias)' },
      { cmd: '/ani-no', description: 'Shake head side to side (alias)' },
      { cmd: '/ani-disagree', description: 'Shake head side to side (alias)' }
    ],
    responseText: '*shakes head* Nope, no way! Definitely not that!',
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
    responseText: '*salutes playfully* Aye aye! Ready for your command, Master!',
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
      { cmd: '/ani-fidget', description: 'Shy fidgeting (alias)' },
      { cmd: '/ani-shyfidget', description: 'Shy fidgeting (alias)' }
    ],
    responseText: "*fidgets shyingly* U-umm... you're making me a little shy...",
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
      { cmd: '/ani-cover', description: 'Cover mouth while giggling (alias)' },
      { cmd: '/ani-gigglecover', description: 'Cover mouth while giggling (alias)' }
    ],
    responseText: '*giggles behind hand* Hehehe, you always know how to make me laugh!',
    blendShapes: { happy: 0.85, browUp: 0.3 }
  },
  {
    name: 'cheering',
    alias: 'cheer',
    duration: 3.2,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:cheer/>',
    commands: [
      { cmd: '/ani-cheer', description: 'Two-handed victory cheer' },
      { cmd: '/ani-cheering', description: 'Two-handed victory cheer (alias)' },
      { cmd: '/ani-victory', description: 'Victory cheer (alias)' },
      { cmd: '/ani-clap', description: 'Clap / cheer hands (alias)' }
    ],
    responseText: "*cheers with arms up* Yay, you can do it! I'm cheering for you all the way!",
    blendShapes: { happy: 0.95, surprised: 0.4 }
  },
  {
    name: 'thinking',
    alias: 'think',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:think/>',
    commands: [
      { cmd: '/ani-think', description: 'Thoughtful pondering animation' },
      { cmd: '/ani-thinking', description: 'Thoughtful pondering animation (alias)' }
    ],
    responseText: '*thinks thoughtfully* Hmm, let me think about that for a second...',
    blendShapes: { relaxed: 0.5, browUp: 0.2 }
  },
  {
    name: 'jump',
    alias: 'jump',
    duration: 2.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:jump/>',
    commands: [
      { cmd: '/ani-jump', description: 'Playful jump animation' },
      { cmd: '/ani-hop', description: 'Playful jump animation (alias)' }
    ],
    responseText: '*jumps playfully* Hop! That was fun!',
    blendShapes: { happy: 0.8 }
  },
  {
    name: 'blush',
    alias: 'blush',
    duration: 3.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:blush/>',
    commands: [
      { cmd: '/ani-blush', description: 'Shy blushing animation' }
    ],
    responseText: "*blushes bashfully* Aw, stop it! You're making my face all warm...",
    blendShapes: { happy: 0.6, relaxed: 0.4 }
  },
  {
    name: 'pointing',
    alias: 'point',
    duration: 2.8,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:point/>',
    commands: [
      { cmd: '/ani-point', description: 'Point index finger at screen' },
      { cmd: '/ani-pointing', description: 'Point index finger at screen (alias)' },
      { cmd: '/ani-show', description: 'Point at screen (alias)' }
    ],
    responseText: '*points at your screen* Look right there! Check that out!',
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
      { cmd: '/ani-inspectscreen', description: 'Inspect screen (alias)' },
      { cmd: '/ani-lookclose', description: 'Inspect screen (alias)' }
    ],
    responseText: '*leans close to inspect* Ooh, let me see... what do we have here?',
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
      { cmd: '/ani-typingair', description: 'Type on keyboard (alias)' },
      { cmd: '/ani-work', description: 'Type on keyboard (alias)' }
    ],
    responseText: '*types rapidly on keyboard* Click-clack click-clack! Working hard at light speed!',
    blendShapes: { relaxed: 0.5, browDown: 0.3 }
  },
  {
    name: 'stretching',
    alias: 'stretch',
    label: 'Stretch',
    duration: 11.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:stretch/>',
    commands: [
      { cmd: '/stretch', description: 'Stretch arms overhead' },
      { cmd: '/ani-stretch', description: 'Stretch arms overhead (alias)' },
      { cmd: '/ani-stretching', description: 'Stretch arms overhead (alias)' }
    ],
    responseText: '*stretches arms overhead* Ahhh, that feels so much better! Ready to go.',
    blendShapes: { relaxed: 0.9 }
  },
  {
    name: 'disappointed_nod',
    alias: 'disappointed_nod',
    duration: 3.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:disappointed_nod/>',
    commands: [
      { cmd: '/ani-disappointed', description: 'Disappointed slow nod & sigh' },
      { cmd: '/ani-disappointednod', description: 'Disappointed slow nod (alias)' },
      { cmd: '/ani-sigh', description: 'Disappointed sigh (alias)' }
    ],
    responseText: "*nods slowly in disappointment* Sigh... that's too bad. I was really hoping for better...",
    blendShapes: { sad: 0.6, browDown: 0.4 }
  },
  {
    name: 'crying_sob',
    alias: 'crying_sob',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:crying_sob/>',
    commands: [
      { cmd: '/ani-crying', description: 'Tearful shuddering sob' },
      { cmd: '/ani-cry', description: 'Tearful cry (alias)' },
      { cmd: '/ani-sob', description: 'Tearful sob (alias)' }
    ],
    responseText: "*sobs tearfully* Waaaah... that's so sad... don't be mean to me...",
    blendShapes: { sad: 0.95, browDown: 0.5 }
  },
  {
    name: 'shocked_recoil',
    alias: 'shocked_recoil',
    duration: 2.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shocked_recoil/>',
    commands: [
      { cmd: '/ani-shocked', description: 'Shocked recoil backward' },
      { cmd: '/ani-recoil', description: 'Shocked recoil (alias)' }
    ],
    responseText: '*recoils in shock* Whoa! What was that?! You totally surprised me!',
    blendShapes: { surprised: 1.0, browUp: 0.9 }
  },
  {
    name: 'silly_dance',
    alias: 'silly_dance',
    duration: 5.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:silly_dance/>',
    commands: [
      { cmd: '/ani-sillydance', description: 'Funny cartoon waddle dance' },
      { cmd: '/ani-silly', description: 'Silly dance (alias)' },
      { cmd: '/ani-waddle', description: 'Cartoon waddle dance (alias)' }
    ],
    responseText: '*does a silly waddle dance* Waddle waddle! Look at my funny little dance!',
    blendShapes: { happy: 0.8, relaxed: 0.5 }
  },
  {
    name: 'hip_hop_dance',
    alias: 'hip_hop',
    duration: 6.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:hiphop/>',
    commands: [
      { cmd: '/ani-hiphop', description: 'Energetic hip-hop dance routine' },
      { cmd: '/ani-dance', description: 'Dance to music (alias)' },
      { cmd: '/ani-hiphopdance', description: 'Hip-hop dance (alias)' },
      { cmd: '/dance', description: 'Dance to music (alias)' }
    ],
    responseText: '*breaks into an energetic hip-hop dance* Look at these moves! How was that for style?',
    blendShapes: { happy: 0.7, excited: 0.8 }
  },
  {
    name: 'twist_dance',
    alias: 'twist',
    duration: 5.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:twist/>',
    commands: [
      { cmd: '/ani-twist', description: 'Retro 60s twist dance' },
      { cmd: '/ani-twistdance', description: 'Retro 60s twist dance (alias)' }
    ],
    responseText: '*twists and grooves happily* Twist and shout! This groove is so much fun!',
    blendShapes: { happy: 0.8, relaxed: 0.6 }
  },
  {
    name: 'air_guitar',
    alias: 'guitar',
    duration: 5.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:guitar/>',
    commands: [
      { cmd: '/ani-guitar', description: 'Rock out with an air guitar solo' },
      { cmd: '/ani-airguitar', description: 'Air guitar solo (alias)' },
      { cmd: '/ani-rock', description: 'Rock out riff (alias)' },
      { cmd: '/rock', description: 'Rock out solo (alias)' }
    ],
    responseText: "*shreds an epic air guitar solo* Yeah! Rock and roll! Bet you didn't know I could shred!",
    blendShapes: { excited: 0.9, happy: 0.6 }
  },
  {
    name: 'singing',
    alias: 'sing',
    duration: 5.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:sing/>',
    commands: [
      { cmd: '/ani-sing', description: 'Sing like an anime idol into a mic' },
      { cmd: '/ani-singing', description: 'Sing like an idol (alias)' },
      { cmd: '/ani-song', description: 'Sing song (alias)' },
      { cmd: '/sing', description: 'Sing song (alias)' }
    ],
    responseText: '*sings cheerfully with idol energy* Tra-la-la~! Hope you enjoyed my special song for you!',
    blendShapes: { happy: 0.85, relaxed: 0.4 }
  },
  {
    name: 'blow_kiss',
    alias: 'kiss',
    duration: 4.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:kiss/>',
    commands: [
      { cmd: '/ani-kiss', description: 'Blow a sweet kiss with a wink' },
      { cmd: '/ani-blowkiss', description: 'Blow a sweet kiss (alias)' },
      { cmd: '/kiss', description: 'Blow a kiss (alias)' }
    ],
    responseText: '*blows a sweet kiss with a wink* Mwah! Hope that brightens your whole day!',
    blendShapes: { wink: 0.9, happy: 0.7 }
  },
  {
    name: 'backflip',
    alias: 'backflip',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:backflip/>',
    commands: [
      { cmd: '/ani-backflip', description: 'Athletic acrobatic backflip' },
      { cmd: '/ani-flip', description: 'Acrobatic backflip (alias)' },
      { cmd: '/flip', description: 'Acrobatic backflip (alias)' }
    ],
    responseText: '*executes a stunning backflip* Ta-da! Perfect landing! Ten out of ten, right?',
    blendShapes: { excited: 0.9, surprised: 0.5 }
  },
  {
    name: 'airplane',
    alias: 'airplane',
    duration: 4.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:airplane/>',
    commands: [
      { cmd: '/ani-airplane', description: 'Arms outstretched airplane zoom' },
      { cmd: '/ani-zoom', description: 'Airplane zoom (alias)' },
      { cmd: '/zoom', description: 'Airplane zoom (alias)' }
    ],
    responseText: '*zooms around like an airplane* Zoom zoom! Clear the runway, here comes Yuki!',
    blendShapes: { happy: 0.85, excited: 0.7 }
  },
  {
    name: 'peace_sign',
    alias: 'peace',
    duration: 3.8,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:peace/>',
    commands: [
      { cmd: '/ani-peace', description: 'Classic anime peace sign pose' },
      { cmd: '/ani-peacesign', description: 'Anime peace sign (alias)' },
      { cmd: '/ani-vsign', description: 'V-sign pose (alias)' },
      { cmd: '/peace', description: 'Peace sign (alias)' }
    ],
    responseText: '*flashes a cute anime peace sign* Peace! Always here cheering you on!',
    blendShapes: { happy: 0.85, relaxed: 0.4 }
  },
  {
    name: 'wave_both',
    alias: 'wave_both',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:waveboth/>',
    commands: [
      { cmd: '/ani-waveboth', description: 'Enthusiastic two-handed wave' },
      { cmd: '/ani-wave-both', description: 'Enthusiastic two-handed wave (alias)' }
    ],
    responseText: '*waves excitedly with both hands* Hey! Over here! Woohoo!',
    blendShapes: { happy: 0.9, relaxed: 0.5 }
  },
  {
    name: 'weight_shift',
    alias: 'weight_shift',
    duration: 4.5,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:weightshift/>',
    commands: [
      { cmd: '/ani-weightshift', description: 'Natural standing weight shift' },
      { cmd: '/ani-sway', description: 'Natural standing weight shift (alias)' }
    ],
    responseText: '*shifts weight naturally from foot to foot* Just stretching my legs a bit!',
    blendShapes: { relaxed: 0.6 }
  },
  {
    name: 'look_around',
    alias: 'look_around',
    duration: 5.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:lookaround/>',
    commands: [
      { cmd: '/ani-lookaround', description: 'Curiously looks around the desktop' },
      { cmd: '/ani-look-around', description: 'Curiously look around (alias)' }
    ],
    responseText: '*looks around curiously* Hmm, wonder what interesting things are happening around here?',
    blendShapes: { relaxed: 0.5, surprised: 0.2 }
  },
  {
    name: 'sitting',
    alias: 'sit',
    duration: 5.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:sit/>',
    commands: [
      { cmd: '/ani-sit', description: 'Sit down comfortably' },
      { cmd: '/ani-sitting', description: 'Sit down comfortably (alias)' },
      { cmd: '/sit', description: 'Sit down (alias)' }
    ],
    responseText: "*sits down comfortably* Ahhh, nice and comfortable! Let's take it easy.",
    blendShapes: { relaxed: 0.8 }
  },
  {
    name: 'sit_wave',
    alias: 'sit_wave',
    duration: 4.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:sitwave/>',
    commands: [
      { cmd: '/ani-sitwave', description: 'Wave while sitting' },
      { cmd: '/ani-sit-wave', description: 'Wave while sitting (alias)' }
    ],
    responseText: '*waves cheerfully while sitting* Hey there! Still nice and cozy right here!',
    blendShapes: { happy: 0.7, relaxed: 0.6 }
  },
  {
    name: 'stand_up',
    alias: 'stand_up',
    duration: 3.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:stand/>',
    commands: [
      { cmd: '/ani-stand', description: 'Stand up to attention' },
      { cmd: '/ani-standup', description: 'Stand up (alias)' },
      { cmd: '/stand', description: 'Stand up (alias)' }
    ],
    responseText: '*stands up ready to assist* Back on my feet and ready for action!',
    blendShapes: { relaxed: 0.6 }
  },
  {
    name: 'walk',
    alias: 'walk',
    duration: 2.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:walk/>',
    commands: [
      { cmd: '/ani-walk', description: 'Natural mocap walk cycle' }
    ],
    responseText: '*walks forward smoothly* Step by step! On the move!',
    blendShapes: { relaxed: 0.5 }
  },
  {
    name: 'shoot',
    alias: 'shoot',
    duration: 4.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:shoot/>',
    commands: [
      { cmd: '/ani-shoot', description: 'Cute anime finger-gun shoot' },
      { cmd: '/ani-fingergun', description: 'Finger-gun pose (alias)' },
      { cmd: '/shoot', description: 'Finger-gun shoot (alias)' }
    ],
    responseText: '*points a cute finger gun and winks* Bang! Gotcha right in the heart!',
    blendShapes: { wink: 0.8, happy: 0.7 }
  },
  {
    name: 'spin',
    alias: 'spin',
    duration: 4.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:spin/>',
    commands: [
      { cmd: '/ani-spin', description: 'Graceful 360 spin pirouette' },
      { cmd: '/ani-twirl', description: 'Twirl in place (alias)' },
      { cmd: '/spin', description: 'Spin around (alias)' }
    ],
    responseText: '*does a graceful spin* Wheee! Look at me go!',
    blendShapes: { happy: 0.85, relaxed: 0.5 }
  },
  {
    name: 'model_pose',
    alias: 'pose',
    duration: 4.0,
    excludeFromRandomIdle: false,
    llmTag: '<yuki_anim:pose/>',
    commands: [
      { cmd: '/ani-pose', description: 'Cute idol model pose' },
      { cmd: '/ani-modelpose', description: 'Idol model pose (alias)' },
      { cmd: '/pose', description: 'Cute pose (alias)' }
    ],
    responseText: '*strikes a cute idol pose* Tada! Ready for the spotlight anytime!',
    blendShapes: { happy: 0.8, relaxed: 0.4 }
  },
  {
    name: 'squat',
    alias: 'squat',
    duration: 4.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:squat/>',
    commands: [
      { cmd: '/ani-squat', description: 'Playful crouch / squat' },
      { cmd: '/ani-crouch', description: 'Playful crouch (alias)' },
      { cmd: '/squat', description: 'Squat down (alias)' }
    ],
    responseText: '*crouches down playfully* Down here! What are we looking at?',
    blendShapes: { relaxed: 0.6 }
  },
  {
    name: 'sport',
    alias: 'sport',
    duration: 5.0,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:sport/>',
    commands: [
      { cmd: '/ani-sport', description: 'Energetic workout jumping jacks' },
      { cmd: '/ani-workout', description: 'Energetic workout (alias)' },
      { cmd: '/ani-jumpingjacks', description: 'Jumping jacks (alias)' }
    ],
    responseText: '*does a quick energetic workout* One, two, one, two! Phew, that got my energy pumping!',
    blendShapes: { excited: 0.9, happy: 0.7 }
  },
  {
    name: 'turn_around',
    alias: 'turn_around',
    duration: 4.5,
    excludeFromRandomIdle: true,
    llmTag: '<yuki_anim:turn/>',
    commands: [
      { cmd: '/ani-turn', description: 'Turns around playfully' },
      { cmd: '/ani-turnaround', description: 'Turn around (alias)' }
    ],
    responseText: '*turns around gracefully* Just checking my surroundings! Looking good!',
    blendShapes: { happy: 0.75, relaxed: 0.5 }
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
    blendShapes: { happy: 0.4, relaxed: 0.5, browUp: 0.3 }
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
  giggle_cover: 'giggle_cover',
  cover: 'giggle_cover',
  facepalm: 'disappointed_nod',
  oops: 'disappointed_nod',
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
  relax: 'relax',
  disappointed_nod: 'disappointed_nod',
  crying_sob: 'crying_sob',
  shocked_recoil: 'shocked_recoil',
  think: 'thinking',
  thinking: 'thinking',
  jump: 'jump',
  blush: 'blush',
  silly_dance: 'silly_dance',
  silly: 'silly_dance',
  hiphop: 'hip_hop_dance',
  hip_hop: 'hip_hop_dance',
  dance: 'hip_hop_dance',
  twist: 'twist_dance',
  twist_dance: 'twist_dance',
  guitar: 'air_guitar',
  air_guitar: 'air_guitar',
  rock: 'air_guitar',
  sing: 'singing',
  singing: 'singing',
  song: 'singing',
  kiss: 'blow_kiss',
  blow_kiss: 'blow_kiss',
  backflip: 'backflip',
  flip: 'backflip',
  airplane: 'airplane',
  zoom: 'airplane',
  peace: 'peace_sign',
  peace_sign: 'peace_sign',
  vsign: 'peace_sign',
  wave_both: 'wave_both',
  waveboth: 'wave_both',
  weight_shift: 'weight_shift',
  weightshift: 'weight_shift',
  sway: 'weight_shift',
  look_around: 'look_around',
  lookaround: 'look_around',
  sit: 'sitting',
  sitting: 'sitting',
  sit_wave: 'sit_wave',
  sitwave: 'sit_wave',
  stand: 'stand_up',
  stand_up: 'stand_up',
  walk: 'walk',
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
  turnaround: 'turn_around'
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
