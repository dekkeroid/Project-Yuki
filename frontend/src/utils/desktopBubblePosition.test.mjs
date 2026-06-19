import assert from 'node:assert/strict';
import { computeDesktopBubblePosition } from './desktopBubblePosition.js';

const longBubble = computeDesktopBubblePosition({
  anchorXPercent: 92,
  desiredBottomPercent: 78,
  minBottomPercent: 42,
  bubbleWidth: 340,
  bubbleHeight: 190,
  viewportWidth: 420,
  viewportHeight: 360,
  margin: 16,
  arrowMargin: 18,
});

assert.ok(longBubble.centerX >= 186, `center too far left: ${longBubble.centerX}`);
assert.ok(longBubble.centerX <= 234, `center too far right: ${longBubble.centerX}`);
assert.ok(longBubble.bottom >= 16, `bottom below viewport margin: ${longBubble.bottom}`);
assert.ok(longBubble.bottom <= 154, `top would clip above viewport: ${longBubble.bottom}`);
assert.ok(longBubble.arrowLeft >= 18, `arrow too far left: ${longBubble.arrowLeft}`);
assert.ok(longBubble.arrowLeft <= 322, `arrow too far right: ${longBubble.arrowLeft}`);

const tinyViewport = computeDesktopBubblePosition({
  anchorXPercent: 5,
  desiredBottomPercent: 90,
  minBottomPercent: 80,
  bubbleWidth: 500,
  bubbleHeight: 280,
  viewportWidth: 320,
  viewportHeight: 240,
  margin: 12,
});

assert.equal(tinyViewport.centerX, 160);
assert.equal(tinyViewport.bottom, 12);
assert.ok(tinyViewport.arrowLeft >= 16);

console.log('desktopBubblePosition tests passed');
