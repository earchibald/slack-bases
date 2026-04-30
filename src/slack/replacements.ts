import type { TextReplacement } from './types';

export function sortReplacementsBottomUp<T extends { start: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.start - left.start);
}

export function applyReplacements(text: string, replacements: TextReplacement[]): string {
  let nextText = text;

  for (const replacement of sortReplacementsBottomUp(replacements)) {
    nextText =
      nextText.slice(0, replacement.start) + replacement.text + nextText.slice(replacement.end);
  }

  return nextText;
}
