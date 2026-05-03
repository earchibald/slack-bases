import { describe, expect, it } from 'vitest';

import { applyReplacements, sortReplacementsBottomUp } from '../src/slack/replacements';

describe('sortReplacementsBottomUp', () => {
  it('sorts replacements from the end of the document to the beginning', () => {
    expect(
      sortReplacementsBottomUp([
        { end: 5, start: 0, text: 'alpha' },
        { end: 10, start: 6, text: 'beta' },
      ])
    ).toEqual([
      { end: 10, start: 6, text: 'beta' },
      { end: 5, start: 0, text: 'alpha' },
    ]);
  });
});

describe('applyReplacements', () => {
  it('applies edits from the bottom of the document upward', () => {
    const result = applyReplacements('alpha beta gamma', [
      { end: 10, start: 6, text: 'BETA' },
      { end: 5, start: 0, text: 'ALPHA' },
    ]);

    expect(result).toBe('ALPHA BETA gamma');
  });
});
