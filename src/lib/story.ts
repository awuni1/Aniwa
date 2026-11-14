// Shared between the landing-page story text and its 3D scene. Kept separate
// so importing it doesn't pull Three.js into the page's initial bundle.

export const CHAPTER_COUNT = 7;

/** Scroll progress (0..1) → chapter position c. Chapter i is centred at c = i + 0.5. */
export function chapterPosition(progress: number): number {
  return progress * (CHAPTER_COUNT - 1) + 0.5;
}
