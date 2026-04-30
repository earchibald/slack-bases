import type { ParsedSlackPermalink } from './types';

const SLACK_PERMALINK_PATTERN = /^\/archives\/([^/]+)\/p(\d{16})$/;

export function parseSlackPermalink(url: string): ParsedSlackPermalink | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const match = parsedUrl.pathname.match(SLACK_PERMALINK_PATTERN);

  if (!match) {
    return null;
  }

  const [, channelId, packedTimestamp] = match;

  return {
    channelId,
    ts: `${packedTimestamp.slice(0, 10)}.${packedTimestamp.slice(10)}`,
    url,
    workspace: parsedUrl.hostname.split('.')[0],
  };
}
