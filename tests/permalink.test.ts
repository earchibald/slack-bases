import { describe, expect, it } from 'vitest';

import { parseSlackPermalink } from '../src/slack/permalink';

describe('parseSlackPermalink', () => {
  it('parses a standard Slack message permalink', () => {
    const parsed = parseSlackPermalink(
      'https://acme.slack.com/archives/C01234567/p1714490435123456'
    );

    expect(parsed).toEqual({
      channelId: 'C01234567',
      ts: '1714490435.123456',
      url: 'https://acme.slack.com/archives/C01234567/p1714490435123456',
      workspace: 'acme',
    });
  });
});
