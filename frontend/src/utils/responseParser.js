import { LLM_ANIMATION_MAP, LLM_EMOTION_MAP } from '../animationsRegistry';

/**
 * Strips animation tags (<yuki_anim:name/>) and emotion tags (<yuki_emotion:name/>)
 * from text for UI bubbles and TTS output.
 */
export function stripAnimationTags(rawText) {
  if (!rawText || typeof rawText !== 'string') return rawText || '';
  const animRegex = /[<\[\(](?:yuki_)?anim:\s*([a-zA-Z0-9_\-]+)\s*(?:\/?>|[\]\)])/gi;
  const emotionRegex = /[<\[\(](?:yuki_)?emotion:\s*([a-zA-Z0-9_\-]+)\s*(?:\/?>|[\]\)])/gi;
  return rawText
    .replace(animRegex, '')
    .replace(emotionRegex, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Parses and strips unique animation tags (<yuki_anim:name/>, [yuki_anim:name/>, [anim: name]) and emotion tags (<yuki_emotion:name/>)
 * from LLM text streams in real time.
 * 
 * Supports formats:
 *   <yuki_anim:wave/> or <yuki_anim:wave> or [yuki_anim:wave/> or [yuki_anim:wave] or [anim: wave]
 *   <yuki_emotion:happy/> or <yuki_emotion:happy> or [yuki_emotion:happy] or [emotion: happy]
 */
export function parseResponseTags(rawText, callbacks = {}) {
  const { onAnimation, onEmotion } = callbacks;

  if (!rawText) return { cleanText: '', animations: [], emotions: [] };

  const animations = [];
  const emotions = [];

  // Match any variation of opening bracket (<, [, () and closing bracket (/>, >, ], ))
  const animRegex = /[<\[\(](?:yuki_)?anim:\s*([a-zA-Z0-9_\-]+)\s*(?:\/?>|[\]\)])/gi;
  const emotionRegex = /[<\[\(](?:yuki_)?emotion:\s*([a-zA-Z0-9_\-]+)\s*(?:\/?>|[\]\)])/gi;

  let cleanText = rawText;

  // Extract animation tags
  cleanText = cleanText.replace(animRegex, (match, tag) => {
    const animKey = (tag || '').toLowerCase();
    const mappedAnim = LLM_ANIMATION_MAP[animKey] || animKey;
    animations.push(mappedAnim);
    if (onAnimation) onAnimation(mappedAnim);
    return ''; // strip tag from visible text & TTS
  });

  // Extract emotion tags
  cleanText = cleanText.replace(emotionRegex, (match, tag) => {
    const emotionKey = (tag || '').toLowerCase();
    const mappedEmotion = LLM_EMOTION_MAP[emotionKey] || emotionKey;
    emotions.push(mappedEmotion);
    if (onEmotion) onEmotion(mappedEmotion);
    return ''; // strip tag from visible text & TTS
  });

  // Clean up any double spaces leftover from tag stripping
  cleanText = cleanText.replace(/[ \t]{2,}/g, ' ').trim();

  return { cleanText, animations, emotions };
}

