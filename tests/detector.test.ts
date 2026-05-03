import { describe, expect, it } from 'vitest';

import { detectCandidates } from '../src/slack/detector';

describe('detectCandidates', () => {
  it('finds permalinks, channels, and dm sentinels while skipping markdown links', () => {
    const text = [
      'Paste https://acme.slack.com/archives/C01/p1714490435123456 here',
      'Talk in #ops next',
      'Ping dm:@avery',
      '[skip](https://acme.slack.com/archives/C02/p1714490435123456)',
    ].join('\n');

    const found = detectCandidates(text, { cursorOffset: -1 });

    expect(found.map((candidate) => candidate.kind)).toEqual([
      'message-permalink',
      'channel-ref',
      'dm-sentinel',
    ]);
  });

  it('skips candidates touching the active cursor position', () => {
    const text = 'Talk in #ops next';

    expect(detectCandidates(text, { cursorOffset: 9 })).toEqual([]);
  });
});
