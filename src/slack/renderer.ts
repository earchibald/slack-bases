import type { LinkTargetPreference, RenderValues } from './types';

export function renderSmartLink(template: string, values: RenderValues): string {
  return template.replace(/\{(\w+)\}/g, (_match, token: keyof RenderValues) => values[token] ?? '');
}

export function buildTargetUrl(input: {
  channelId: string;
  target: LinkTargetPreference;
  teamId: string;
}): string {
  if (input.target === 'app') {
    return `slack://channel?team=${input.teamId}&id=${input.channelId}`;
  }

  return `https://slack.com/app_redirect?team=${input.teamId}&channel=${input.channelId}`;
}
