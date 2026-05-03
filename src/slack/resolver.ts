import { parseSlackPermalink } from './permalink';
import type { SlackService } from './service';
import type { RenderValues, SlackChannel, SlackSession, SlackUser } from './types';
import { TtlCache } from './cache';

interface ResolverDependencies {
  channelCache: TtlCache<SlackChannel>;
  failedLookupCache: TtlCache<boolean>;
  service: SlackService;
  session: SlackSession;
  userCache: TtlCache<SlackUser>;
}

export function createResolver(deps: ResolverDependencies) {
  return {
    resolveChannelRef: async (value: string) => resolveChannelRef(deps, value),
    resolveDmSentinel: async (value: string) => resolveDmSentinel(deps, value),
    resolvePermalink: async (url: string) => resolvePermalink(deps, url),
  };
}

async function resolvePermalink(deps: ResolverDependencies, url: string): Promise<RenderValues> {
  const parsed = parseSlackPermalink(url);

  if (!parsed) {
    throw new Error('Unsupported Slack permalink');
  }

  const fallback: RenderValues = {
    channel_id: parsed.channelId,
    ts: parsed.ts,
    url: parsed.url,
    workspace: parsed.workspace,
  };

  if (deps.failedLookupCache.get(parsed.url)) {
    return fallback;
  }

  try {
    const message = await deps.service.getMessage(parsed.url);

    return {
      ...fallback,
      author: message.authorName,
      author_id: message.authorId,
      channel: message.channelName,
      text: message.text,
    };
  } catch {
    deps.failedLookupCache.set(parsed.url, true);
    return fallback;
  }
}

async function resolveChannelRef(
  deps: ResolverDependencies,
  value: string
): Promise<{ channelId: string; name: string; teamId: string } | null> {
  const normalized = value.replace(/^#/, '').toLowerCase();
  const cached = deps.channelCache.get(normalized);

  if (cached) {
    return { channelId: cached.id, name: cached.name, teamId: deps.session.teamId };
  }

  if (deps.failedLookupCache.get(`channel:${normalized}`)) {
    return null;
  }

  try {
    const channel = await deps.service.getChannelByName(normalized);

    if (!channel) {
      deps.failedLookupCache.set(`channel:${normalized}`, true);
      return null;
    }

    deps.channelCache.set(normalized, channel);

    return { channelId: channel.id, name: channel.name, teamId: deps.session.teamId };
  } catch {
    deps.failedLookupCache.set(`channel:${normalized}`, true);
    return null;
  }
}

async function resolveDmSentinel(
  deps: ResolverDependencies,
  value: string
): Promise<{ displayName: string; teamId: string; userId: string } | null> {
  const normalized = value.toLowerCase();
  const cached = deps.userCache.get(normalized);

  if (cached) {
    return { displayName: cached.displayName, teamId: deps.session.teamId, userId: cached.id };
  }

  if (deps.failedLookupCache.get(`user:${normalized}`)) {
    return null;
  }

  try {
    const user = await deps.service.getUserByDmSentinel(value);

    if (!user) {
      deps.failedLookupCache.set(`user:${normalized}`, true);
      return null;
    }

    deps.userCache.set(normalized, user);

    return { displayName: user.displayName, teamId: deps.session.teamId, userId: user.id };
  } catch {
    deps.failedLookupCache.set(`user:${normalized}`, true);
    return null;
  }
}
