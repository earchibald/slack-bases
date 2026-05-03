export interface ParsedSlackPermalink {
  channelId: string;
  ts: string;
  url: string;
  workspace: string;
}

export type LinkTargetPreference = 'app' | 'web';

export type CandidateKind = 'channel-ref' | 'dm-sentinel' | 'message-permalink';

export interface CandidateMatch {
  end: number;
  kind: CandidateKind;
  start: number;
  value: string;
}

export interface TextReplacement {
  end: number;
  start: number;
  text: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackMessageMetadata {
  authorId?: string;
  authorName?: string;
  channelName?: string;
  text?: string;
}

export interface SlackUser {
  displayName: string;
  email?: string;
  id: string;
}

export interface SlackSession {
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  teamId: string;
  workspace: string;
}

export interface RenderValues {
  author?: string;
  author_id?: string;
  channel?: string;
  channel_id?: string;
  date?: string;
  is_thread?: string;
  text?: string;
  thread_ts?: string;
  time?: string;
  ts?: string;
  url: string;
  workspace?: string;
}
