import { describe, expect, it } from 'vitest';

import { buildTargetUrl, renderSmartLink } from '../src/slack/renderer';

describe('renderSmartLink', () => {
  it('renders a hydrated template', () => {
    expect(
      renderSmartLink('[{channel} • {author}: {text}]({url})', {
        author: 'Avery',
        channel: 'ops',
        text: 'deploy failed',
        url: 'https://acme.slack.com/archives/C01/p1714490435123456',
      })
    ).toBe('[ops • Avery: deploy failed](https://acme.slack.com/archives/C01/p1714490435123456)');
  });
});

describe('buildTargetUrl', () => {
  it('returns a Slack deep link when preferred', () => {
    expect(buildTargetUrl({ channelId: 'C01', target: 'app', teamId: 'T01' })).toBe(
      'slack://channel?team=T01&id=C01'
    );
  });

  it('returns a web redirect when requested', () => {
    expect(buildTargetUrl({ channelId: 'C01', target: 'web', teamId: 'T01' })).toBe(
      'https://slack.com/app_redirect?team=T01&channel=C01'
    );
  });
});
