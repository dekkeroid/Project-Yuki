const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Convert a 3D-projected head anchor into viewport-safe CSS positions.
 *
 * The speech bubble is centered on Yuki's projected head, but long messages can
 * make the bubble wider/taller than the available transparent Electron window.
 * This keeps the bubble inside the viewport and moves the tail back toward the
 * original head anchor so the bubble still feels attached to her.
 */
export function computeDesktopBubblePosition({
  anchorXPercent,
  desiredBottomPercent,
  minBottomPercent = 0,
  bubbleWidth,
  bubbleHeight,
  viewportWidth,
  viewportHeight,
  margin = 16,
  arrowMargin = 16,
}) {
  const safeViewportWidth = Math.max(Number(viewportWidth) || 0, 1);
  const safeViewportHeight = Math.max(Number(viewportHeight) || 0, 1);
  const safeBubbleWidth = Math.max(Number(bubbleWidth) || 0, 1);
  const safeBubbleHeight = Math.max(Number(bubbleHeight) || 0, 1);
  const safeMargin = Math.max(Number(margin) || 0, 0);
  const safeArrowMargin = Math.max(Number(arrowMargin) || 0, 0);

  const anchorX = (Number(anchorXPercent) || 0) / 100 * safeViewportWidth;
  const desiredBottom = (Number(desiredBottomPercent) || 0) / 100 * safeViewportHeight;
  const minBottom = (Number(minBottomPercent) || 0) / 100 * safeViewportHeight;

  const minCenter = safeMargin + safeBubbleWidth / 2;
  const maxCenter = safeViewportWidth - safeMargin - safeBubbleWidth / 2;
  const centerX = minCenter <= maxCenter
    ? clamp(anchorX, minCenter, maxCenter)
    : safeViewportWidth / 2;

  const maxBottom = safeViewportHeight - safeMargin - safeBubbleHeight;
  const bottom = maxBottom >= safeMargin
    ? clamp(Math.max(desiredBottom, minBottom), safeMargin, maxBottom)
    : safeMargin;

  const bubbleLeft = centerX - safeBubbleWidth / 2;
  const maxArrowLeft = Math.max(safeArrowMargin, safeBubbleWidth - safeArrowMargin);
  const arrowLeft = clamp(anchorX - bubbleLeft, safeArrowMargin, maxArrowLeft);

  return {
    centerX,
    bottom,
    arrowLeft,
    leftPercent: centerX / safeViewportWidth * 100,
    bottomPercent: bottom / safeViewportHeight * 100,
  };
}
