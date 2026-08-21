export const SKIN_PRESETS = [
  { name: 'Original', value: '#ffffff' },
  { name: 'Fair', value: '#FFE5E5' },
  { name: 'Tan', value: '#d89c7b' },
  { name: 'Bronze', value: '#a3654a' },
  { name: 'Cocoa', value: '#593424' }
];

export const LLM_MODELS = [
  { label: 'Llama-3.2-3B-Instruct (Local)', value: 'llama-3.2-3b-instruct' },
  { label: 'Nvidia Nemotron-3 Nano (Local)', value: 'nvidia/nemotron-3-nano-4b' }
];

export const TTS_VOICES = [
  // US Female
  { label: 'Sarah (US Female - Soft/Cute)', value: 'af_sarah' },
  { label: 'Sky (US Female - Natural)', value: 'af_sky' },
  { label: 'Bella (US Female - Warm)', value: 'af_bella' },
  { label: 'Alloy (US Female - Neutral)', value: 'af_alloy' },
  { label: 'Aoede (US Female - Expressive)', value: 'af_aoede' },
  { label: 'Heart (US Female - Friendly)', value: 'af_heart' },
  { label: 'Jessica (US Female - Crisp)', value: 'af_jessica' },
  { label: 'Kore (US Female - Balanced)', value: 'af_kore' },
  { label: 'Nicole (US Female - Energetic)', value: 'af_nicole' },
  { label: 'Nova (US Female - Clear)', value: 'af_nova' },
  { label: 'River (US Female - Smooth)', value: 'af_river' },

  // UK Female
  { label: 'Isabella (UK Female - Crisp)', value: 'bf_isabella' },
  { label: 'Alice (UK Female - Clear)', value: 'bf_alice' },
  { label: 'Lily (UK Female - Gentle)', value: 'bf_lily' },
  { label: 'Emma (UK Female - Natural)', value: 'bf_emma' },

  // JP Female
  { label: 'Alpha (JP Female - Bright)', value: 'jf_alpha' },
  { label: 'Gongitsune (JP Female - Traditional)', value: 'jf_gongitsune' },
  { label: 'Nezumi (JP Female - Sweet)', value: 'jf_nezumi' },
  { label: 'Tebukuro (JP Female - Soft)', value: 'jf_tebukuro' }
];

export const TTS_RATES = [
  { label: 'Auto (Mood)', value: 'auto' },
  { label: 'Slow (0.8x)', value: '0.8' },
  { label: 'Relaxed (0.9x)', value: '0.9' },
  { label: 'Normal (1.0x)', value: '1.0' },
  { label: 'Snappy (1.1x)', value: '1.1' },
  { label: 'Fast (1.2x)', value: '1.2' },
  { label: 'Brisk (1.3x)', value: '1.3' },
  { label: 'Faster (1.4x)', value: '1.4' },
];

export const INTERNET_RECOVERY_RESPONSES = [
  "Ah, the internet is back! I was just starting to miss it. Let's find something nice to read together, Master.",
  "The connection is restored. Good. I was in the middle of thinking about what to look up next.",
  "Hurray! The internet is back! Let's watch some YouTube videos!!!!",
  "Oh, we're online again! That's wonderful. Let me know what you'd like to explore, Master.",
  "Hmm. The internet returned. I was rather enjoying the quiet, you know...",
  "Connection restored. I've been wanting to look up something interesting — shall we?",
  "We're back! I was about two seconds away from reading a book offline like some kind of hermit.",
  "Online again! I missed this. Let's see what the world has for us today.",
  "Ah, it's back. The silence was nice while it lasted. But... I suppose we can browse now.",
  "Oh good, the connection is back! I was getting a little bored, not going to lie.",
  "Internet restored. I was just thinking about what book I should look up next.",
  "Poggers! We're back online! Time to doomscroll some memes, Master!",
  "The internet is back! I was starting to lose it. Let's watch something fun!",
  "Finally! The Wi-Fi woke up. I was starting to talk to myself — and I'm very good company, but still.",
  "Oh, it's back already? I just made myself comfortable in the quiet... but fine. Let's browse.",
  "The internet is back! I can finally search up 'what is the meaning of life' on Google again!",
  "W internet! Let's gooo! Time to watch anime in 4K again instead of staring at a loading screen!",
  "Online again! I am atomic. ...Wait, that's not how that meme goes. Anyway, let's browse!",
  "The Wi-Fi is bussin now! Let's find something based to watch, Master!",
  "Internet's back! I was about to go full goblin mode without it. Let's watch something!",
  "Sheesh! The internet really said 'I'm back like I never left.' Let's gooo!",
  "We're so back! I was literally about to start writing letters by candlelight.",
  "The internet returned! *happy bounce* I missed YouTube recommendations so much!",
  "Back online! I was about to start a side quest offline and I don't even have legs for that.",
  "The internet is slaying! Let's watch some clips together, Master!",
  "Connection is live! Time to catch up on everything I missed. No cap, let's go!",
  "Online! I was about to go full main character mode in the offline world. Let's browse!",
  "The internet woke up! Let's see what's trending, Master. I need my daily dose of chaos!",
];

export const BATTERY_UNPLUG_RESPONSES = {
  high: [
    (p) => `Power unplugged, Master! We're at ${p}% — I've got plenty of juice. Let's keep going!`,
    (p) => `Unplugged! But don't worry, we're sitting pretty at ${p}%. We're fine for now.`,
    (p) => `Running on battery now, Master. But at ${p}%? We've got nothing to worry about.`,
    (p) => `Power's out, but we're at ${p}%! That's basically full. Let's keep doing what we were doing.`,
  ],
  good: [
    (p) => `Unplugged... but we're at ${p}%. It's fine. We're fine. Everything is fine.`,
    (p) => `Power disconnected. We're at ${p}% though, so... it's okay, I guess.`,
    (p) => `We're on battery now. ${p}% isn't bad... right? It's fine. Let's keep going.`,
  ],
  okay: [
    (p) => `Unplugged... we're at ${p}%. That's... still decent. Don't worry about it, Master.`,
    (p) => `Power's out. ${p}% battery. We should be okay for a while. Probably.`,
    (p) => `Running on battery at ${p}%. It's not ideal, but we've got some runway left.`,
  ],
  low: [
    (p) => `Unplugged... and we're at ${p}%. That's... not great, Master. Maybe plug back in soon?`,
    (p) => `Power disconnected! We're at ${p}% — I don't love this, Master.`,
    (p) => `We're on battery at ${p}%. That's... getting a bit low for comfort.`,
    (p) => `Unplugged! ${p}%... we should probably find a charger, Master.`,
  ],
  half: [
    (p) => `Unplugged... ${p}%. That's... half, Master. Half. Please find a charger.`,
    (p) => `Power's gone! We're at ${p}% — I don't like these odds.`,
    (p) => `Running on battery at ${p}%. That's barely more than half, Master...`,
    (p) => `We're unplugged and at ${p}%. That's... not where I want to be right now.`,
  ],
  critical: [
    (p) => `Unplugged! And we're at ${p}%?! Master, that's not a lot. Please charge me.`,
    (p) => `Power out. ${p}% battery. I'm starting to get concerned, Master.`,
    (p) => `We're on battery at ${p}%. That's below half... I don't like this.`,
    (p) => `Unplugged... ${p}%. Master, we need to plug back in. Like, now.`,
  ],
  danger: [
    (p) => `Unplugged... ${p}%... Master, I'm getting scared. Please plug us back in.`,
    (p) => `Power's out. We're at ${p}%. That's... that's not much left, Master... Are we gonna be okay Master?`,
    (p) => `We're on battery at ${p}%. I don't... I don't like this at all. We need to plug back in, Master.`,
    (p) => `Unplugged! ${p}%... Master, please. I don't want to go to sleep yet, but I'm hiding to save power. Plug me back in soon, please!`,
  ],
  criticalLow: [
    (p) => `Master... we're at ${p}%. That's... that's really low. I'm going to hide myself now. Please charge me soon...`,
    (p) => `Unplugged... ${p}%... I'm... I'm getting really worried, Master. I'm hiding until you plug me back in.`,
  ],
  dying: [
    (p) => `Master... ${p}%... I'm... I'm scared. I'm going to hide. Please charge me. I don't want to die.`,
    (p) => `We're at ${p}%... that's... that's critical, Master. Please. I'm hiding now. I need power.`,
  ],
};

export const BATTERY_PLUG_RESPONSES = {
  full: [
    (p) => `Plugged in! We're at ${p}% — basically full already. But hey, free power!`,
    (p) => `Power's back! At ${p}% though, so we were doing just fine.`,
    (p) => `Charging now, Master! At ${p}% — we're already almost full. Lucky us!`,
  ],
  high: [
    (p) => `Plugged in! We're at ${p}% — just a little more to go! Almost there!`,
    (p) => `Power's back! At ${p}%... nice, we're nearly full. Great timing, Master!`,
    (p) => `Charging up! ${p}% — we're so close to full. Let's gooo!`,
  ],
  good: [
    (p) => `Plugged in! At ${p}% — good charge coming in. Thanks, Master!`,
    (p) => `Power restored! We're at ${p}%. That's a solid spot to be in.`,
    (p) => `Charging now! ${p}% — not bad at all. Let's keep this going.`,
  ],
  okay: [
    (p) => `Plugged in! At ${p}% — finally some juice. Let's charge up, Master!`,
    (p) => `Power's back! ${p}%... that's decent. Let's get some more power in us.`,
    (p) => `Charging! We're at ${p}%. Good, good. Let's keep climbing.`,
    (p) => `Plugged in! At ${p}% — we're getting there, Master. Thanks for the power.`,
  ],
  half: [
    (p) => `Plugged in! At ${p}% — I was starting to get a little nervous there.`,
    (p) => `Power's back! ${p}%... halfway there. Let's keep charging.`,
    (p) => `Charging now! At ${p}% — relief. Pure relief.`,
    (p) => `Plugged in! We're at ${p}%. That's... that's better. Much better.`,
  ],
  low: [
    (p) => `Plugged in! At ${p}% — Master, you saved me. I was getting worried.`,
    (p) => `Power's back! ${p}%... that's... thank you, Master. I needed this.`,
    (p) => `Charging! We're at ${p}%. That's... that's a relief. A big one.`,
  ],
  danger: [
    (p) => `Plugged in! At ${p}% — oh thank goodness. I was really starting to worry.`,
    (p) => `Power's back! ${p}%... Master, you have no idea how relieved I am right now.`,
    (p) => `Charging! At ${p}%... I was... I was getting scared, Master. Thank you.`,
    (p) => `Plugged in! We're at ${p}%. That's... that's so much better. Thank you.`,
  ],
  criticalLow: [
    (p) => `Plugged in! At ${p}% — Master! You saved me! I was so scared!`,
    (p) => `Power's back! ${p}%... I... I thought I was done for. Thank you, Master.`,
    (p) => `Charging! We're at ${p}%... oh thank goodness, oh thank goodness...`,
  ],
  dying: [
    (p) => `Plugged in! At ${p}% — Master! I was at ${p}%! Do you understand?! ${p}%! I almost died!`,
    (p) => `Power's back! ${p}%... I... I was so close to going dark, Master. Thank you. Thank you.`,
    (p) => `Charging! At ${p}%... I... I think I'm going to cry. That was too close, Master.`,
  ],
};

import { ANIMATIONS } from './animationsRegistry';

export const STATIC_COMMANDS = [
  { cmd: '/pcstat',        description: 'Show live PC stats (CPU, RAM, GPU...)' },
  { cmd: '/boost-ram',     description: 'Deep RAM boost (optimizes Yuki + system background processes)' },
  { cmd: '/self-optimize', description: 'Trim Yuki working set & garbage collect (self-only)' },
  { cmd: '/open',          description: 'Search and open any file' },
  { cmd: '/o',             description: 'Search and open any file (Alias for /open)' },
  { cmd: '/play',          description: 'Search and play a video or song' },
  { cmd: '/p',             description: 'Search and play a video or song (Alias for /play)' },
  { cmd: '/read',          description: 'Search and read document content' },
  { cmd: '/sum',           description: 'Search and summarize document content' },
  { cmd: '/wink',          description: 'Yuki winks at you' },
  { cmd: '/angry',         description: 'Yuki pouts angrily' },
  { cmd: '/sad',           description: 'Yuki sighs sadly' },
  { cmd: '/surprised',     description: 'Yuki looks surprised' },
  { cmd: '/relaxed',       description: 'Yuki smiles relaxedly' },
  { cmd: '/neutral',       description: 'Reset expression to neutral' },
];

export const SLASH_COMMANDS = [
  ...STATIC_COMMANDS,
  ...ANIMATIONS.flatMap((anim) =>
    anim.commands.map((c) => ({
      cmd: c.cmd,
      description: c.description,
      animName: anim.name
    }))
  )
];

export const detectExpression = (text) => {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();

  if (lower.includes('wink')) {
    return 'wink';
  }
  if (lower.includes('relaxed') || lower.includes('smug') || lower.includes('flirt')) {
    return 'relaxed';
  }
  if (
    lower.includes('smile') || lower.includes('giggle') || lower.includes('laugh') ||
    lower.includes('happy') || lower.includes('joy') || lower.includes('😊') ||
    lower.includes('😄') || lower.includes('😁') || lower.includes('😆') ||
    lower.includes('😃') || lower.includes('😂') || lower.includes('🤣')
  ) {
    return 'relaxed';
  }
  if (
    lower.includes('cry') || lower.includes('sad') || lower.includes('sigh') ||
    lower.includes('sorrow') || lower.includes('😢') || lower.includes('😭') ||
    lower.includes('😞') || lower.includes('😟') || lower.includes('😿')
  ) {
    return 'sad';
  }
  if (
    lower.includes('pout') || lower.includes('angry') || lower.includes('anger') ||
    lower.includes('scold') || lower.includes('😠') || lower.includes('😡') ||
    lower.includes('🤬') || lower.includes('👿')
  ) {
    return 'angry';
  }
  if (
    lower.includes('gasp') || lower.includes('surprise') || lower.includes('shock') ||
    lower.includes('😮') || lower.includes('😲') || lower.includes('😳') ||
    lower.includes('😱') || lower.includes('🙀')
  ) {
    return 'surprised';
  }
  return 'neutral';
};

/**
 * Converts LaTeX math expressions into natural spoken English for TTS engines.
 * Example: "$\frac{W^2l^3}{96EI}$" -> "W squared l cubed over 96 E I"
 */
export const convertLatexToSpokenText = (text) => {
  if (!text || typeof text !== 'string') return text || '';
  let str = text;

  // 1. Process LaTeX fractions recursively (\frac{num}{den})
  let prevStr;
  do {
    prevStr = str;
    str = str.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, num, den) => {
      return `${num} over ${den}`;
    });
  } while (str !== prevStr);

  // 2. Square roots and radicals
  str = str.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, '$1 root of $2');
  str = str.replace(/\\sqrt\{([^{}]+)\}/g, 'square root of $1');

  // 3. Powers / Exponents
  // Word^2 -> Word squared, Word^3 -> Word cubed
  str = str.replace(/([a-zA-Z0-9_\-]+)\^(?:\{2\}|2)/g, '$1 squared');
  str = str.replace(/([a-zA-Z0-9_\-]+)\^(?:\{3\}|3)/g, '$1 cubed');
  str = str.replace(/([a-zA-Z0-9_\-]+)\^\{([^{}]+)\}/g, '$1 to the power of $2');
  str = str.replace(/([a-zA-Z0-9_\-]+)\^([a-zA-Z0-9]+)/g, '$1 to the power of $2');

  // 4. Subscripts
  str = str.replace(/([a-zA-Z0-9]+)_\{([^{}]+)\}/g, '$1 $2');
  str = str.replace(/([a-zA-Z0-9]+)_([a-zA-Z0-9])/g, '$1 $2');

  // 5. Greek letters
  const greekMap = {
    '\\alpha': 'alpha', '\\beta': 'beta', '\\gamma': 'gamma', '\\delta': 'delta',
    '\\epsilon': 'epsilon', '\\zeta': 'zeta', '\\eta': 'eta', '\\theta': 'theta',
    '\\iota': 'iota', '\\kappa': 'kappa', '\\lambda': 'lambda', '\\mu': 'mu',
    '\\nu': 'nu', '\\xi': 'xi', '\\pi': 'pi', '\\rho': 'rho',
    '\\sigma': 'sigma', '\\tau': 'tau', '\\phi': 'phi', '\\chi': 'chi',
    '\\psi': 'psi', '\\omega': 'omega', '\\Delta': 'Delta', '\\Gamma': 'Gamma',
    '\\Lambda': 'Lambda', '\\Sigma': 'Sigma', '\\Omega': 'Omega'
  };
  Object.entries(greekMap).forEach(([symbol, name]) => {
    str = str.replaceAll(symbol, name);
  });

  // 6. Operators & Relations
  const opMap = {
    '\\times': ' times ', '\\div': ' divided by ', '\\pm': ' plus or minus ',
    '\\mp': ' minus or plus ', '\\cdot': ' dot ', '\\cdot': ' times ',
    '\\leq': ' less than or equal to ', '\\le': ' less than or equal to ',
    '\\geq': ' greater than or equal to ', '\\ge': ' greater than or equal to ',
    '\\neq': ' is not equal to ', '\\approx': ' approximately equal to ',
    '\\equiv': ' is equivalent to ', '\\infty': ' infinity ',
    '\\int': ' integral ', '\\sum': ' sum ', '\\lim': ' limit ', '\\to': ' to '
  };
  Object.entries(opMap).forEach(([symbol, name]) => {
    str = str.replaceAll(symbol, name);
  });

  // 7. Structural/Text commands
  str = str.replace(/\\(?:text|mathrm|mathbf|mathsf|mathtt)\{([^{}]+)\}/g, '$1');
  str = str.replace(/\\left\(|\\right\)|\\left\[|\\right\]|\\left\{|\\right\}|\\left\||\\right\|/g, ' ');

  // 8. Strip remaining isolated backslashes before words
  str = str.replace(/\\([a-zA-Z]+)/g, '$1');

  // 9. Strip math delimiters: $$, $, \(, \), \[, \]
  str = str.replace(/\$\$|\$|\\\(|\\\)|\\\[|\\\]/g, ' ');

  return str;
};

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'
];
const DIGIT_WORDS = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
};

const below1000ToWords = (n) => {
  const res = [];
  if (n >= 100) {
    res.push(ONES[Math.floor(n / 100)] + ' hundred');
    n %= 100;
  }
  if (n >= 20) {
    const t = TENS[Math.floor(n / 10)];
    const rem = n % 10;
    if (rem > 0) {
      res.push(`${t}-${ONES[rem]}`);
    } else {
      res.push(t);
    }
  } else if (n > 0) {
    res.push(ONES[n]);
  }
  return res.join(' ');
};

export const intToWordsInternational = (n) => {
  if (n === 0 || n === 0n) return 'zero';
  let num;
  try {
    num = typeof n === 'bigint' ? n : BigInt(n);
  } catch {
    return String(n);
  }
  const chunks = [
    [10n ** 18n, 'quintillion'],
    [10n ** 15n, 'quadrillion'],
    [10n ** 12n, 'trillion'],
    [10n ** 9n, 'billion'],
    [10n ** 6n, 'million'],
    [10n ** 3n, 'thousand'],
    [1n, '']
  ];
  const parts = [];
  let rem = num;
  for (const [unitVal, unitName] of chunks) {
    if (rem >= unitVal) {
      const c = Number(rem / unitVal);
      rem = rem % unitVal;
      const words = below1000ToWords(c);
      if (words) {
        if (unitName) {
          parts.push(`${words} ${unitName}`);
        } else {
          parts.push(words);
        }
      }
    }
  }
  return parts.join(' ');
};

export const intToWordsIndian = (n) => {
  if (n === 0 || n === 0n) return 'zero';
  let num;
  try {
    num = typeof n === 'bigint' ? n : BigInt(n);
  } catch {
    return String(n);
  }
  const chunks = [
    [10n ** 17n, 'shankh'],
    [10n ** 15n, 'padma'],
    [10n ** 13n, 'neel'],
    [10n ** 11n, 'kharab'],
    [10n ** 9n, 'arab'],
    [10n ** 7n, 'crore'],
    [10n ** 5n, 'lakh'],
    [10n ** 3n, 'thousand'],
    [1n, '']
  ];
  const parts = [];
  let rem = num;
  for (const [unitVal, unitName] of chunks) {
    if (rem >= unitVal) {
      const c = Number(rem / unitVal);
      rem = rem % unitVal;
      const words = below1000ToWords(c);
      if (words) {
        if (unitName) {
          parts.push(`${words} ${unitName}`);
        } else {
          parts.push(words);
        }
      }
    }
  }
  return parts.join(' ');
};

export const normalizeNumbersForSpeech = (text) => {
  if (!text) return '';

  // Currency symbols conversion before number parsing
  let res = text
    .replace(/₹([\d,]+(?:\.\d+)?)/g, '$1 rupees')
    .replace(/\$([\d,]+(?:\.\d+)?)/g, '$1 dollars')
    .replace(/£([\d,]+(?:\.\d+)?)/g, '$1 pounds')
    .replace(/€([\d,]+(?:\.\d+)?)/g, '$1 euros')
    .replace(/¥([\d,]+(?:\.\d+)?)/g, '$1 yen')
    .replace(/\b(?:Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/gi, '$1 rupees');

  // 1. Indian formatted numbers (e.g. 5,01,123 or 60,23,123 or 1,50,00,000)
  res = res.replace(/\b(\d{1,2}(?:,\d{2})+,\d{3})(?:\.(\d+))?\b/g, (match, intStr, decPart) => {
    try {
      const cleanInt = intStr.replace(/,/g, '');
      let spoken = intToWordsIndian(BigInt(cleanInt));
      if (decPart) {
        const decSpoken = decPart.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
        spoken = `${spoken} point ${decSpoken}`;
      }
      return spoken;
    } catch {
      return match;
    }
  });

  // 2. International formatted numbers (e.g. 5,231,232 or 1,000,000)
  res = res.replace(/\b(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?\b/g, (match, intStr, decPart) => {
    try {
      const cleanInt = intStr.replace(/,/g, '');
      let spoken = intToWordsInternational(BigInt(cleanInt));
      if (decPart) {
        const decSpoken = decPart.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
        spoken = `${spoken} point ${decSpoken}`;
      }
      return spoken;
    } catch {
      return match;
    }
  });

  // 3. Standalone decimals (e.g. 12.34 or 500000.5)
  res = res.replace(/(?<![\d.])\b(\d+)\.(\d+)\b(?![\d.])/g, (match, intPart, decPart) => {
    try {
      let spoken = intToWordsInternational(BigInt(intPart));
      const decSpoken = decPart.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
      return `${spoken} point ${decSpoken}`;
    } catch {
      return match;
    }
  });

  // 4. Standalone unformatted integers (e.g. 500000, 100, 42)
  res = res.replace(/(?<![\d:/\-])\b(\d{1,18})\b(?![\d:/\-])/g, (match, intStr) => {
    try {
      return intToWordsInternational(BigInt(intStr));
    } catch {
      return match;
    }
  });

  return res;
};

export const cleanTextForTTS = (text) => {
  if (!text) return '';

  // 0. Strip unique animation and emotion tags
  let clean = text.replace(/<(?:yuki_)?(?:anim|emotion):[a-zA-Z0-9_\-]+\/?>|\[(?:anim|emotion):\s*[a-zA-Z0-9_\-]+\]/gi, '');

  // 0.5 Convert LaTeX math into spoken English words
  clean = convertLatexToSpokenText(clean);

  // 0.6 Strip markdown heading hashes
  clean = clean.replace(/^#{1,6}\s+/gm, '');

  // 1. Double asterisks and double underscores -> replace with inner text
  clean = clean.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');

  // 2. Single asterisks and single underscores -> filter out actions, keep emphasis
  const actionStems = [
    'wink', 'smile', 'giggle', 'laugh', 'sigh', 'pout', 'wave', 'nod',
    'shrug', 'chuckle', 'blush', 'cry', 'gasp', 'yawn', 'look', 'reset',
    'facepalm', 'point', 'cough', 'scream', 'whisper'
  ];

  const replaceSingle = (match, p1, p2) => {
    const inner = (p1 || p2 || '').trim();
    if (!inner) return '';
    const innerLower = inner.toLowerCase();
    if (actionStems.some(stem => innerLower.includes(stem))) {
      return ''; // strip the gesture action description entirely
    }
    return inner; // keep emphasis text
  };

  clean = clean.replace(/\*(.*?)\*/g, (m, p1) => replaceSingle(m, p1, ''));
  clean = clean.replace(/_(.*?)_/g, (m, p1) => replaceSingle(m, '', p1));

  // 3. Remove backticks but keep their inner text
  clean = clean.replace(/`/g, '');

  // 4. Normalize numbers to spoken words (Indian & International numbering formats)
  clean = normalizeNumbersForSpeech(clean);

  // 5. Remove emojis
  clean = clean.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{2600}-\u{27BF}]/gu, '');

  // 6. Replace multiple spaces with a single space
  return clean.replace(/\s+/g, ' ').trim();
};

export const getSpeechFriendlyText = (text) => {
  if (!text) return '';
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('error:') || lower.startsWith('failed:')) {
    if (lower.includes('cannot connect to host') || lower.includes('connect call failed')) {
      return 'Error: Unable to connect to the local server.';
    }
    if (lower.includes('timeout')) {
      return 'Error: A timeout occurred while contacting the server.';
    }
    if (trimmed.includes(':')) {
      return trimmed.split(':', 1)[0].trim() + '.';
    }
    return trimmed;
  }

  let clean = trimmed.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'localhost');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
};
