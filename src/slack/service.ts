import type { SlackChannel, SlackMessageMetadata, SlackSession, SlackUser } from './types';

export interface SlackService {
  getChannelByName(name: string): Promise<SlackChannel | null>;
  getMessage(url: string): Promise<SlackMessageMetadata>;
  getUserByDmSentinel(sentinel: string): Promise<SlackUser | null>;
}

export function createSlackService(
  session: SlackSession,
  fetchImpl: typeof fetch = fetch
): SlackService {
  return {
    getChannelByName: async (name: string) => findChannelByName(session, name, fetchImpl),
    getMessage: async (url: string) => getMessageMetadata(session, url, fetchImpl),
    getUserByDmSentinel: async (sentinel: string) => findUserByDmSentinel(session, sentinel, fetchImpl),
  };
}

async function getMessageMetadata(
  session: SlackSession,
  url: string,
  fetchImpl: typeof fetch
): Promise<SlackMessageMetadata> {
  const permalink = new URL(url);
  const channelId = permalink.pathname.split('/')[2];
  const packedTs = permalink.pathname.split('/')[3]?.slice(1);

  if (!channelId || !packedTs) {
    throw new Error('Invalid Slack permalink');
  }

  const ts = `${packedTs.slice(0, 10)}.${packedTs.slice(10)}`;
  const response = await callSlackApi<{
    messages?: Array<{ text?: string; user?: string }>;
  }>(session, fetchImpl, 'conversations.history', {
    channel: channelId,
    inclusive: 'true',
    latest: ts,
    limit: '1',
    oldest: ts,
  });

  const message = response.messages?.[0];
  const [channelName, authorName] = await Promise.all([
    getChannelName(session, channelId, fetchImpl),
    message?.user ? getUserDisplayName(session, message.user, fetchImpl) : Promise.resolve(undefined),
  ]);

  return {
    authorId: message?.user,
    authorName,
    channelName,
    text: message?.text,
  };
}

async function getChannelName(
  session: SlackSession,
  channelId: string,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  const response = await callSlackApi<{
    channel?: { name?: string };
  }>(session, fetchImpl, 'conversations.info', {
    channel: channelId,
  });

  return response.channel?.name;
}

async function getUserDisplayName(
  session: SlackSession,
  userId: string,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  const response = await callSlackApi<{
    user?: { profile?: { display_name?: string; real_name?: string } };
  }>(session, fetchImpl, 'users.info', {
    user: userId,
  });

  return response.user?.profile?.display_name || response.user?.profile?.real_name;
}

async function findChannelByName(
  session: SlackSession,
  name: string,
  fetchImpl: typeof fetch
): Promise<SlackChannel | null> {
  const response = await callSlackApi<{
    channels?: Array<{ id?: string; name?: string }>;
  }>(session, fetchImpl, 'conversations.list', {
    exclude_archived: 'true',
    limit: '1000',
    types: 'public_channel,private_channel',
  });

  const match = response.channels?.find((channel) => channel.name === name);

  if (!match?.id || !match.name) {
    return null;
  }

  return {
    id: match.id,
    name: match.name,
  };
}

async function findUserByDmSentinel(
  session: SlackSession,
  sentinel: string,
  fetchImpl: typeof fetch
): Promise<SlackUser | null> {
  const value = sentinel.replace(/^dm:/, '');

  if (value.includes('@') && !value.startsWith('@')) {
    const byEmail = await callSlackApi<{
      user?: { id?: string; profile?: { email?: string; display_name?: string; real_name?: string } };
    }>(session, fetchImpl, 'users.lookupByEmail', { email: value });
    const emailUser = byEmail.user;

    if (!emailUser?.id) {
      return null;
    }

    return {
      displayName:
        emailUser.profile?.display_name || emailUser.profile?.real_name || emailUser.profile?.email || emailUser.id,
      email: emailUser.profile?.email,
      id: emailUser.id,
    };
  }

  const normalizedName = value.replace(/^@/, '').toLowerCase();
  const response = await callSlackApi<{
    members?: Array<{
      id?: string;
      name?: string;
      profile?: { display_name?: string; email?: string; real_name?: string };
    }>;
  }>(session, fetchImpl, 'users.list', {});

  const match = response.members?.find((member) => {
    const displayName = member.profile?.display_name?.toLowerCase();
    const realName = member.profile?.real_name?.toLowerCase();
    const username = member.name?.toLowerCase();

    return normalizedName === displayName || normalizedName === realName || normalizedName === username;
  });

  if (!match?.id) {
    return null;
  }

  return {
    displayName: match.profile?.display_name || match.profile?.real_name || match.name || match.id,
    email: match.profile?.email,
    id: match.id,
  };
}

async function callSlackApi<T>(
  session: SlackSession,
  fetchImpl: typeof fetch,
  method: string,
  query: Record<string, string>
): Promise<T> {
  if (!session.accessToken) {
    throw new Error('Slack access token is missing');
  }

  const url = new URL(`https://slack.com/api/${method}`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Slack API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { error?: string; ok?: boolean } & T;

  if (!payload.ok) {
    throw new Error(payload.error ?? `Slack API request failed: ${method}`);
  }

  return payload;
}
