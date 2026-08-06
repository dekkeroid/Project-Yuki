import { LLM_ANIMATION_MAP, LLM_EMOTION_MAP } from '../animationsRegistry';

/**
 * Strips animation tags (<yuki_anim:name/>) and emotion tags (<yuki_emotion:name/>)
 * from text for UI bubbles and TTS output.
 */
export function stripAnimationTags(rawText) {
  if (!rawText || typeof rawText !== 'string') return rawText || '';
  const animRegex = /<(?:yuki_)?anim:([a-zA-Z0-9_\-]+)\/?>|\[anim:\s*([a-zA-Z0-9_\-]+)\]/gi;
  const emotionRegex = /<(?:yuki_)?emotion:([a-zA-Z0-9_\-]+)\/?>|\[emotion:\s*([a-zA-Z0-9_\-]+)\]/gi;
  return rawText.replace(animRegex, '').replace(emotionRegex, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Parses and strips unique animation tags (<yuki_anim:name/>) and emotion tags (<yuki_emotion:name/>)
 * from LLM text streams in real time.
 * 
 * Supports formats:
 *   <yuki_anim:wave/> or <yuki_anim:wave>
 *   <yuki_emotion:happy/> or <yuki_emotion:happy>
 *   Legacy/Fallback: [anim: wave], [emotion: happy]
 */
export function parseResponseTags(rawText, callbacks = {}) {
  const { onAnimation, onEmotion } = callbacks;

  if (!rawText) return { cleanText: '', animations: [], emotions: [] };

  const animations = [];
  const emotions = [];

  // Match <yuki_anim:name/> or <yuki_anim:name> or <anim:name/>
  const animRegex = /<(?:yuki_)?anim:([a-zA-Z0-9_\-]+)\/?>|\[anim:\s*([a-zA-Z0-9_\-]+)\]/gi;
  // Match <yuki_emotion:name/> or <yuki_emotion:name> or <emotion:name/>
  const emotionRegex = /<(?:yuki_)?emotion:([a-zA-Z0-9_\-]+)\/?>|\[emotion:\s*([a-zA-Z0-9_\-]+)\]/gi;

  let cleanText = rawText;

  // Extract animation tags
  cleanText = cleanText.replace(animRegex, (match, tag1, tag2) => {
    const animKey = (tag1 || tag2 || '').toLowerCase();
    const mappedAnim = LLM_ANIMATION_MAP[animKey] || animKey;
    animations.push(mappedAnim);
    if (onAnimation) onAnimation(mappedAnim);
    return ''; // strip tag from visible text & TTS
  });

  // Extract emotion tags
  cleanText = cleanText.replace(emotionRegex, (match, tag1, tag2) => {
    const emotionKey = (tag1 || tag2 || '').toLowerCase();
    const mappedEmotion = LLM_EMOTION_MAP[emotionKey] || emotionKey;
    emotions.push(mappedEmotion);
    if (onEmotion) onEmotion(mappedEmotion);
    return ''; // strip tag from visible text & TTS
  });

  // Clean up any double spaces leftover from tag stripping
  cleanText = cleanText.replace(/[ \t]{2,}/g, ' ').trim();

  return { cleanText, animations, emotions };
}

