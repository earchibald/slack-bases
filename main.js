"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SlackBasesPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/slack/auth.ts
function buildSlackAuthorizeUrl(input) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("user_scope", input.scopes);
  if (input.teamId) {
    url.searchParams.set("team", input.teamId);
  }
  return url.toString();
}
async function completeSlackAuth(requester, input) {
  const tokenResponse = await requester({
    body: new URLSearchParams({
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri
    }),
    path: "oauth.v2.access"
  });
  const baseSession = mapSlackTokenResponse(tokenResponse, input.now);
  const identity = await requester({
    body: new URLSearchParams(),
    path: "auth.test",
    token: baseSession.accessToken
  });
  return {
    ...baseSession,
    teamId: identity.team_id ?? baseSession.teamId,
    workspace: parseWorkspaceSlug(identity.url) ?? baseSession.workspace
  };
}
async function createPkcePair(randomSource = () => crypto.getRandomValues(new Uint8Array(32))) {
  const codeVerifier = toBase64Url(randomSource());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return {
    codeChallenge: toBase64Url(new Uint8Array(digest)),
    codeVerifier
  };
}
async function refreshSlackSession(requester, input) {
  if (!input.session.refreshToken) {
    throw new Error("Missing Slack refresh token");
  }
  const tokenResponse = await requester({
    body: new URLSearchParams({
      client_id: input.clientId,
      grant_type: "refresh_token",
      refresh_token: input.session.refreshToken
    }),
    path: "oauth.v2.access"
  });
  const refreshed = mapSlackTokenResponse(tokenResponse, input.now);
  return {
    ...refreshed,
    teamId: refreshed.teamId || input.session.teamId,
    workspace: refreshed.workspace || input.session.workspace
  };
}
function mapSlackTokenResponse(payload, now = Date.now()) {
  const authedUser = payload.authed_user ?? {};
  return {
    accessToken: authedUser.access_token ?? "",
    expiresAt: authedUser.expires_in ? now + authedUser.expires_in * 1e3 : 0,
    refreshToken: authedUser.refresh_token ?? "",
    teamId: payload.team?.id ?? "",
    workspace: parseWorkspaceSlug(payload.url) ?? ""
  };
}
function parseWorkspaceSlug(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}
function toBase64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// src/slack/cache.ts
var TtlCache = class {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = /* @__PURE__ */ new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }
  set(key, value) {
    this.entries.set(key, {
      expiresAt: Date.now() + this.ttlMs,
      value
    });
  }
};

// src/slack/detector.ts
var DM_SENTINEL_PATTERN = /\bdm:([@\w.+-]+)/g;
var CHANNEL_REF_PATTERN = /(^|[\s(])#([a-z0-9._-]+)/gi;
var MESSAGE_LINK_PATTERN = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}/gi;
var MARKDOWN_LINK_PATTERN = /\[[^\]]*]\([^)]+\)/g;
var WIKILINK_PATTERN = /\[\[[^[\]]+]]/g;
function detectCandidates(text, input) {
  const excludedRanges = getExcludedRanges(text);
  const candidates = [];
  addMatches(candidates, text, MESSAGE_LINK_PATTERN, "message-permalink", excludedRanges, input.cursorOffset);
  addMatches(candidates, text, DM_SENTINEL_PATTERN, "dm-sentinel", excludedRanges, input.cursorOffset);
  for (const match of text.matchAll(CHANNEL_REF_PATTERN)) {
    const prefix = match[1] ?? "";
    const value = `#${match[2]}`;
    const start = (match.index ?? 0) + prefix.length;
    const end = start + value.length;
    if (!shouldSkipCandidate(start, end, excludedRanges, input.cursorOffset)) {
      candidates.push({ end, kind: "channel-ref", start, value });
    }
  }
  return candidates.sort((left, right) => left.start - right.start);
}
function addMatches(candidates, text, pattern, kind, excludedRanges, cursorOffset) {
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    if (!shouldSkipCandidate(start, end, excludedRanges, cursorOffset)) {
      candidates.push({ end, kind, start, value });
    }
  }
}
function getExcludedRanges(text) {
  const ranges = collectRanges(text, MARKDOWN_LINK_PATTERN);
  for (const range of collectRanges(text, WIKILINK_PATTERN)) {
    ranges.push(range);
  }
  const frontmatterRange = getFrontmatterRange(text);
  if (frontmatterRange) {
    ranges.push(frontmatterRange);
  }
  return ranges;
}
function collectRanges(text, pattern) {
  const ranges = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push({ end: start + match[0].length, start });
  }
  return ranges;
}
function getFrontmatterRange(text) {
  if (!text.startsWith("---\n")) {
    return null;
  }
  const closingIndex = text.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }
  return { end: closingIndex + 5, start: 0 };
}
function shouldSkipCandidate(start, end, excludedRanges, cursorOffset) {
  if (cursorOffset >= start && cursorOffset <= end) {
    return true;
  }
  return excludedRanges.some((range) => start < range.end && end > range.start);
}

// src/slack/renderer.ts
function renderSmartLink(template, values) {
  return template.replace(/\{(\w+)\}/g, (_match, token) => values[token] ?? "");
}
function buildTargetUrl(input) {
  if (input.target === "app") {
    return `slack://channel?team=${input.teamId}&id=${input.channelId}`;
  }
  return `https://slack.com/app_redirect?team=${input.teamId}&channel=${input.channelId}`;
}

// src/slack/engine.ts
async function planSlackLinkReplacements(text, input) {
  const candidates = detectCandidates(text, { cursorOffset: input.cursorOffset });
  const replacements = [];
  for (const candidate of candidates) {
    if (candidate.kind === "message-permalink" && input.settings.enablePermalinks) {
      const values = await input.resolver.resolvePermalink(candidate.value);
      replacements.push({
        end: candidate.end,
        start: candidate.start,
        text: renderSmartLink(input.settings.messageTemplate, {
          ...values,
          url: values.url ?? candidate.value
        })
      });
      continue;
    }
    if (candidate.kind === "channel-ref" && input.settings.enableChannels) {
      const resolved = await input.resolver.resolveChannelRef(candidate.value);
      if (resolved) {
        replacements.push({
          end: candidate.end,
          start: candidate.start,
          text: `[#${resolved.name}](${buildTargetUrl({
            channelId: resolved.channelId,
            target: input.settings.target,
            teamId: resolved.teamId
          })})`
        });
      }
      continue;
    }
    if (candidate.kind === "dm-sentinel" && input.settings.enableDmSentinels) {
      const resolved = await input.resolver.resolveDmSentinel(candidate.value);
      if (resolved) {
        replacements.push({
          end: candidate.end,
          start: candidate.start,
          text: `[DM ${resolved.displayName}](${buildUserTargetUrl(resolved.teamId, resolved.userId)})`
        });
      }
    }
  }
  return replacements;
}
function buildUserTargetUrl(teamId, userId) {
  return `slack://user?team=${teamId}&id=${userId}`;
}

// src/slack/permalink.ts
var SLACK_PERMALINK_PATTERN = /^\/archives\/([^/]+)\/p(\d{16})$/;
function parseSlackPermalink(url) {
  let parsedUrl;
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
    workspace: parsedUrl.hostname.split(".")[0]
  };
}

// src/slack/resolver.ts
function createResolver(deps) {
  return {
    resolveChannelRef: async (value) => resolveChannelRef(deps, value),
    resolveDmSentinel: async (value) => resolveDmSentinel(deps, value),
    resolvePermalink: async (url) => resolvePermalink(deps, url)
  };
}
async function resolvePermalink(deps, url) {
  const parsed = parseSlackPermalink(url);
  if (!parsed) {
    throw new Error("Unsupported Slack permalink");
  }
  const fallback = {
    channel_id: parsed.channelId,
    ts: parsed.ts,
    url: parsed.url,
    workspace: parsed.workspace
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
      text: message.text
    };
  } catch {
    deps.failedLookupCache.set(parsed.url, true);
    return fallback;
  }
}
async function resolveChannelRef(deps, value) {
  const normalized = value.replace(/^#/, "").toLowerCase();
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
async function resolveDmSentinel(deps, value) {
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

// src/slack/replacements.ts
function sortReplacementsBottomUp(items) {
  return [...items].sort((left, right) => right.start - left.start);
}
function applyReplacements(text, replacements) {
  let nextText = text;
  for (const replacement of sortReplacementsBottomUp(replacements)) {
    nextText = nextText.slice(0, replacement.start) + replacement.text + nextText.slice(replacement.end);
  }
  return nextText;
}

// src/slack/secure-session.ts
function createElectronSessionCipher() {
  const safeStorage = getElectronSafeStorage();
  if (!safeStorage) {
    return null;
  }
  return {
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    isAvailable: () => safeStorage.isEncryptionAvailable()
  };
}
function decodeSecureSession(value, cipher) {
  return JSON.parse(cipher.decrypt(value));
}
function encodeSecureSession(session, cipher) {
  if (!cipher.isAvailable()) {
    throw new Error("Secure session storage is unavailable");
  }
  return cipher.encrypt(JSON.stringify(session));
}
function getElectronSafeStorage() {
  const requireFn = globalThis.require;
  if (!requireFn) {
    return null;
  }
  let electron = {};
  try {
    electron = requireFn("electron");
  } catch {
    return null;
  }
  if (electron.remote?.safeStorage) {
    return electron.remote.safeStorage;
  }
  try {
    const electronRemote = requireFn("@electron/remote");
    if (electronRemote.safeStorage) {
      return electronRemote.safeStorage;
    }
  } catch {
  }
  return electron.safeStorage ?? null;
}

// src/slack/service.ts
function createSlackService(session, fetchImpl = fetch) {
  return {
    getChannelByName: async (name) => findChannelByName(session, name, fetchImpl),
    getMessage: async (url) => getMessageMetadata(session, url, fetchImpl),
    getUserByDmSentinel: async (sentinel) => findUserByDmSentinel(session, sentinel, fetchImpl)
  };
}
async function getMessageMetadata(session, url, fetchImpl) {
  const permalink = new URL(url);
  const channelId = permalink.pathname.split("/")[2];
  const packedTs = permalink.pathname.split("/")[3]?.slice(1);
  if (!channelId || !packedTs) {
    throw new Error("Invalid Slack permalink");
  }
  const ts = `${packedTs.slice(0, 10)}.${packedTs.slice(10)}`;
  const response = await callSlackApi(session, fetchImpl, "conversations.history", {
    channel: channelId,
    inclusive: "true",
    latest: ts,
    limit: "1",
    oldest: ts
  });
  const message = response.messages?.[0];
  const [channelName, authorName] = await Promise.all([
    getChannelName(session, channelId, fetchImpl),
    message?.user ? getUserDisplayName(session, message.user, fetchImpl) : Promise.resolve(void 0)
  ]);
  return {
    authorId: message?.user,
    authorName,
    channelName,
    text: message?.text
  };
}
async function getChannelName(session, channelId, fetchImpl) {
  const response = await callSlackApi(session, fetchImpl, "conversations.info", {
    channel: channelId
  });
  return response.channel?.name;
}
async function getUserDisplayName(session, userId, fetchImpl) {
  const response = await callSlackApi(session, fetchImpl, "users.info", {
    user: userId
  });
  return response.user?.profile?.display_name || response.user?.profile?.real_name;
}
async function findChannelByName(session, name, fetchImpl) {
  const response = await callSlackApi(session, fetchImpl, "conversations.list", {
    exclude_archived: "true",
    limit: "1000",
    types: "public_channel,private_channel"
  });
  const match = response.channels?.find((channel) => channel.name === name);
  if (!match?.id || !match.name) {
    return null;
  }
  return {
    id: match.id,
    name: match.name
  };
}
async function findUserByDmSentinel(session, sentinel, fetchImpl) {
  const value = sentinel.replace(/^dm:/, "");
  if (value.includes("@") && !value.startsWith("@")) {
    const byEmail = await callSlackApi(session, fetchImpl, "users.lookupByEmail", { email: value });
    const emailUser = byEmail.user;
    if (!emailUser?.id) {
      return null;
    }
    return {
      displayName: emailUser.profile?.display_name || emailUser.profile?.real_name || emailUser.profile?.email || emailUser.id,
      email: emailUser.profile?.email,
      id: emailUser.id
    };
  }
  const normalizedName = value.replace(/^@/, "").toLowerCase();
  const response = await callSlackApi(session, fetchImpl, "users.list", {});
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
    id: match.id
  };
}
async function callSlackApi(session, fetchImpl, method, query) {
  if (!session.accessToken) {
    throw new Error("Slack access token is missing");
  }
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${session.accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Slack API request failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error ?? `Slack API request failed: ${method}`);
  }
  return payload;
}

// src/slack/session.ts
function hasValidAccessToken(session) {
  return Boolean(session.accessToken && (!session.expiresAt || session.expiresAt > Date.now()));
}
function shouldRefreshSession(session, refreshLeewayMs = 6e4) {
  return Boolean(
    session.accessToken && session.refreshToken && session.expiresAt && session.expiresAt <= Date.now() + refreshLeewayMs
  );
}

// src/slack/single-flight.ts
var SingleFlight = class {
  constructor() {
    this.inFlight = null;
  }
  run(factory) {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = factory().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
};

// src/settings.ts
var DEFAULT_SETTINGS = {
  channelCacheTtlMs: 60 * 60 * 1e3,
  clientId: "",
  encryptedSession: "",
  enableChannels: true,
  enableDmSentinels: true,
  enablePermalinks: true,
  failedLookupTtlMs: 5 * 60 * 1e3,
  idleDelayMs: 500,
  messageTemplate: "[{channel} \u2022 {author}: {text}]({url})",
  refreshLeewayMs: 60 * 1e3,
  scopes: "channels:read,groups:read,users:read,users:read.email,channels:history,groups:history",
  session: {
    accessToken: "",
    expiresAt: 0,
    refreshToken: "",
    teamId: "",
    workspace: ""
  },
  target: "app",
  teamId: "",
  userCacheTtlMs: 60 * 60 * 1e3
};
function isValidSlackClientId(value) {
  return /^\d+\.\d+$/.test(value);
}
function mergeSettings(partial) {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    session: {
      ...DEFAULT_SETTINGS.session,
      ...partial?.session
    }
  };
}
function createPersistedSettings(settings, cipher) {
  if (!hasSessionData(settings.session)) {
    return {
      ...settings,
      encryptedSession: "",
      session: { ...DEFAULT_SETTINGS.session }
    };
  }
  if (!cipher?.isAvailable()) {
    return {
      ...settings,
      encryptedSession: "",
      session: { ...DEFAULT_SETTINGS.session }
    };
  }
  return {
    ...settings,
    encryptedSession: encodeSecureSession(settings.session, cipher),
    session: { ...DEFAULT_SETTINGS.session }
  };
}
function loadSettingsWithSession(partial, cipher) {
  const merged = mergeSettings(partial);
  if (!merged.encryptedSession || !cipher?.isAvailable()) {
    return merged;
  }
  return {
    ...merged,
    session: {
      ...DEFAULT_SETTINGS.session,
      ...decodeSecureSession(merged.encryptedSession, cipher)
    }
  };
}
function hasSessionData(session) {
  return Boolean(
    session.accessToken || session.refreshToken || session.teamId || session.workspace || session.expiresAt
  );
}

// src/main.ts
var AUTH_CALLBACK_ACTION = "slack-bases-auth";
var AUTH_RECONNECT_NOTICE_MS = 6e4;
var SlackBasesPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.channelCache = new TtlCache(DEFAULT_SETTINGS.channelCacheTtlMs);
    this.failedLookupCache = new TtlCache(DEFAULT_SETTINGS.failedLookupTtlMs);
    this.isApplyingChanges = false;
    this.lastAuthNoticeAt = 0;
    this.pendingAuthState = null;
    this.refreshTimer = null;
    this.refreshSessionGate = new SingleFlight();
    this.service = createSlackService(DEFAULT_SETTINGS.session);
    this.sessionCipher = createElectronSessionCipher();
    this.settings = DEFAULT_SETTINGS;
    this.userCache = new TtlCache(DEFAULT_SETTINGS.userCacheTtlMs);
    this.resolver = createResolver({
      channelCache: this.channelCache,
      failedLookupCache: this.failedLookupCache,
      service: this.service,
      session: this.settings.session,
      userCache: this.userCache
    });
  }
  async onload() {
    await this.loadSettings();
    this.registerObsidianProtocolHandler(AUTH_CALLBACK_ACTION, (params) => {
      void this.completeSlackConnect(params);
    });
    this.addRibbonIcon("link", "Connect Slack", () => {
      void this.connectSlack();
    });
    this.addSettingTab(new SlackBasesSettingTab(this.app, this));
    this.registerCommands();
    this.registerEditorListener();
  }
  onunload() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  async saveSettings(nextSettings) {
    const mergedSettings = mergeSettings(nextSettings ? { ...this.settings, ...nextSettings } : this.settings);
    this.settings = mergedSettings;
    await this.saveData(createPersistedSettings(mergedSettings, this.sessionCipher));
    this.rebuildRuntime();
  }
  getSettings() {
    return this.settings;
  }
  async connectSlack() {
    if (!this.settings.clientId) {
      new import_obsidian.Notice("Set your Slack client ID before connecting.");
      return;
    }
    if (this.settings.clientId && !isValidSlackClientId(this.settings.clientId)) {
      new import_obsidian.Notice(
        'Invalid Slack client ID "' + this.settings.clientId + '". Expected format: <numbers>.<numbers> (e.g., 1234567890.1234567890).'
      );
      return;
    }
    if (!this.sessionCipher?.isAvailable()) {
      new import_obsidian.Notice("Secure local storage is unavailable in this desktop environment.");
      return;
    }
    const pkcePair = await createPkcePair();
    const state = this.createStateToken();
    this.pendingAuthState = {
      codeVerifier: pkcePair.codeVerifier,
      state
    };
    window.open(
      buildSlackAuthorizeUrl({
        clientId: this.settings.clientId,
        codeChallenge: pkcePair.codeChallenge,
        redirectUri: this.getRedirectUri(),
        scopes: this.settings.scopes,
        state,
        teamId: this.settings.teamId || void 0
      }),
      "_blank"
    );
    new import_obsidian.Notice("Authorize the Slack app in your browser, then return to Obsidian.");
  }
  async disconnectSlack() {
    await this.saveSettings({
      encryptedSession: "",
      session: {
        ...DEFAULT_SETTINGS.session
      }
    });
  }
  resetChannelCache() {
    this.channelCache = new TtlCache(this.settings.channelCacheTtlMs);
    this.rebuildResolver();
  }
  resetUserCache() {
    this.userCache = new TtlCache(this.settings.userCacheTtlMs);
    this.rebuildResolver();
  }
  showConnectionStatus() {
    if (hasValidAccessToken(this.settings.session) && this.settings.session.workspace) {
      new import_obsidian.Notice(`Slack session configured for ${this.settings.session.workspace}`);
      return;
    }
    new import_obsidian.Notice("Slack is not connected.");
  }
  async loadSettings() {
    this.settings = loadSettingsWithSession(await this.loadData(), this.sessionCipher);
    this.rebuildRuntime();
  }
  rebuildRuntime() {
    this.channelCache = new TtlCache(this.settings.channelCacheTtlMs);
    this.userCache = new TtlCache(this.settings.userCacheTtlMs);
    this.failedLookupCache = new TtlCache(this.settings.failedLookupTtlMs);
    this.service = createSlackService(this.settings.session);
    this.rebuildResolver();
  }
  rebuildResolver() {
    this.resolver = createResolver({
      channelCache: this.channelCache,
      failedLookupCache: this.failedLookupCache,
      service: this.service,
      session: this.settings.session,
      userCache: this.userCache
    });
  }
  registerCommands() {
    this.addCommand({
      id: "connect-slack",
      name: "Connect Slack",
      callback: () => {
        void this.connectSlack();
      }
    });
    this.addCommand({
      id: "disconnect-slack",
      name: "Disconnect Slack",
      callback: () => {
        void this.disconnectSlack();
      }
    });
    this.addCommand({
      id: "test-slack-connection",
      name: "Test Slack connection",
      callback: () => this.showConnectionStatus()
    });
    this.addCommand({
      id: "insert-slack-link",
      name: "Insert Slack link",
      editorCallback: (editor) => {
        void this.replaceSelectionWithSlackLinks(editor);
      }
    });
    this.addCommand({
      id: "insert-slack-message-link",
      name: "Insert Slack message link",
      editorCallback: (editor) => {
        void this.replaceSelectionWithSlackLinks(editor, {
          enableChannels: false,
          enableDmSentinels: false
        });
      }
    });
    this.addCommand({
      id: "refresh-slack-people-cache",
      name: "Refresh Slack people cache",
      callback: () => {
        this.resetUserCache();
        new import_obsidian.Notice("Slack people cache cleared.");
      }
    });
    this.addCommand({
      id: "refresh-slack-channel-cache",
      name: "Refresh Slack channel cache",
      callback: () => {
        this.resetChannelCache();
        new import_obsidian.Notice("Slack channel cache cleared.");
      }
    });
    this.addCommand({
      id: "open-current-slack-ref",
      name: "Open current Slack ref",
      editorCallback: (editor) => {
        void this.openCurrentSlackRef(editor);
      }
    });
  }
  registerEditorListener() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (this.isApplyingChanges) {
          return;
        }
        if (this.refreshTimer !== null) {
          window.clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = window.setTimeout(() => {
          void this.refreshEditor(editor);
        }, this.settings.idleDelayMs);
      })
    );
  }
  async refreshEditor(editor) {
    const source = editor.getValue();
    const cursorOffset = editor.posToOffset(editor.getCursor());
    const candidates = detectCandidates(source, { cursorOffset });
    if (!candidates.length) {
      return;
    }
    if (!await this.ensureValidSession()) {
      this.maybeShowReconnectNotice();
      return;
    }
    const replacements = await planSlackLinkReplacements(source, {
      cursorOffset,
      resolver: this.resolver,
      settings: this.settings
    });
    if (!replacements.length) {
      return;
    }
    const nextValue = applyReplacements(source, replacements);
    if (nextValue === source) {
      return;
    }
    this.isApplyingChanges = true;
    try {
      editor.setValue(nextValue);
      editor.setCursor(editor.offsetToPos(cursorOffset));
    } finally {
      this.isApplyingChanges = false;
    }
  }
  async replaceSelectionWithSlackLinks(editor, overrides) {
    const selection = editor.getSelection();
    if (!selection) {
      new import_obsidian.Notice("Select Slack text first.");
      return;
    }
    if (!await this.ensureValidSession(true)) {
      return;
    }
    const replacements = await planSlackLinkReplacements(selection, {
      cursorOffset: -1,
      resolver: this.resolver,
      settings: {
        ...this.settings,
        ...overrides
      }
    });
    if (!replacements.length) {
      new import_obsidian.Notice("No Slack references found in the current selection.");
      return;
    }
    editor.replaceSelection(applyReplacements(selection, replacements));
  }
  async openCurrentSlackRef(editor) {
    const text = editor.getValue();
    const cursorOffset = editor.posToOffset(editor.getCursor());
    const candidate = detectCandidates(text, { cursorOffset }).find(
      (item) => cursorOffset >= item.start && cursorOffset <= item.end
    );
    if (!candidate) {
      new import_obsidian.Notice("No Slack reference under the cursor.");
      return;
    }
    if (!await this.ensureValidSession(true)) {
      return;
    }
    if (candidate.kind === "message-permalink") {
      window.open(candidate.value, "_blank");
      return;
    }
    if (candidate.kind === "channel-ref") {
      const resolved2 = await this.resolver.resolveChannelRef(candidate.value);
      if (!resolved2) {
        new import_obsidian.Notice("Unable to resolve that Slack channel.");
        return;
      }
      window.open(
        buildTargetUrl({
          channelId: resolved2.channelId,
          target: this.settings.target,
          teamId: resolved2.teamId
        }),
        "_blank"
      );
      return;
    }
    const resolved = await this.resolver.resolveDmSentinel(candidate.value);
    if (!resolved) {
      new import_obsidian.Notice("Unable to resolve that Slack DM.");
      return;
    }
    window.open(`slack://user?team=${resolved.teamId}&id=${resolved.userId}`, "_blank");
  }
  async completeSlackConnect(params) {
    if (params.error) {
      new import_obsidian.Notice(`Slack sign-in failed: ${params.error}`);
      this.pendingAuthState = null;
      return;
    }
    if (!params.code || !params.state || !this.pendingAuthState) {
      this.pendingAuthState = null;
      new import_obsidian.Notice("Slack sign-in callback was incomplete.");
      return;
    }
    if (params.state !== this.pendingAuthState.state) {
      this.pendingAuthState = null;
      new import_obsidian.Notice("Slack sign-in state did not match the pending request.");
      return;
    }
    try {
      const session = await completeSlackAuth(this.requestSlackApiForm.bind(this), {
        clientId: this.settings.clientId,
        code: params.code,
        codeVerifier: this.pendingAuthState.codeVerifier,
        redirectUri: this.getRedirectUri()
      });
      await this.saveSettings({ session });
      this.pendingAuthState = null;
      new import_obsidian.Notice(`Connected Slack workspace ${session.workspace || session.teamId}.`);
    } catch (error) {
      this.pendingAuthState = null;
      const message = getErrorMessage(error);
      const advice = message.includes("invalid_client") ? "Check that your Slack client ID and client secret are correct." : message.includes("invalid_grant") ? "The authorization code expired. Try connecting again." : message.includes("redirect_uri_mismatch") ? "Add obsidian://slack-bases-auth to your Slack app redirect URLs." : message.includes("invalid_client_id") ? "The Slack client ID appears invalid. Check your Slack app settings." : "";
      new import_obsidian.Notice(
        `Slack sign-in failed: ${message}${advice ? " " + advice : ""}`
      );
    }
  }
  async ensureValidSession(notifyOnMissing = false) {
    if (!hasValidAccessToken(this.settings.session)) {
      if (notifyOnMissing) {
        new import_obsidian.Notice("Connect Slack to resolve live Slack metadata.");
      }
      return false;
    }
    if (!shouldRefreshSession(this.settings.session, this.settings.refreshLeewayMs)) {
      return true;
    }
    if (!this.settings.clientId || !this.settings.session.refreshToken) {
      if (notifyOnMissing) {
        new import_obsidian.Notice("Slack session expired. Reconnect Slack.");
      }
      return false;
    }
    return this.refreshSessionGate.run(async () => {
      if (!shouldRefreshSession(this.settings.session, this.settings.refreshLeewayMs)) {
        return hasValidAccessToken(this.settings.session);
      }
      try {
        const session = await refreshSlackSession(this.requestSlackApiForm.bind(this), {
          clientId: this.settings.clientId,
          session: this.settings.session
        });
        await this.saveSettings({ session });
        return true;
      } catch (error) {
        if (notifyOnMissing) {
          new import_obsidian.Notice(`Slack session refresh failed: ${getErrorMessage(error)}`);
        }
        return false;
      }
    });
  }
  getRedirectUri() {
    return `obsidian://${AUTH_CALLBACK_ACTION}`;
  }
  maybeShowReconnectNotice() {
    if (Date.now() - this.lastAuthNoticeAt < AUTH_RECONNECT_NOTICE_MS) {
      return;
    }
    this.lastAuthNoticeAt = Date.now();
    new import_obsidian.Notice("Slack references detected. Connect Slack to enable live resolution.");
  }
  createStateToken() {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  async requestSlackApiForm(request) {
    const response = await (0, import_obsidian.requestUrl)({
      body: request.body.toString(),
      contentType: "application/x-www-form-urlencoded; charset=utf-8",
      headers: request.token ? {
        Authorization: `Bearer ${request.token}`
      } : {},
      method: "POST",
      throw: false,
      url: `https://slack.com/api/${request.path}`
    });
    if (response.status >= 400) {
      throw new Error(`Slack API request failed: ${response.status}`);
    }
    if (!response.json?.ok) {
      throw new Error(
        response.json?.error ? `Slack API error: ${response.json.error}` : `Slack API request failed: ${request.path}`
      );
    }
    return response.json;
  }
};
var SlackBasesSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const settings = this.plugin.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Slack Bases" });
    new import_obsidian.Setting(containerEl).setName("Slack connection").setDesc(
      hasValidAccessToken(settings.session) ? `Connected to ${settings.session.workspace || settings.session.teamId}.` : "Not connected."
    ).addButton(
      (button) => button.setButtonText("Connect").onClick(async () => {
        await this.plugin.connectSlack();
      })
    ).addButton(
      (button) => button.setButtonText("Disconnect").onClick(async () => {
        await this.plugin.disconnectSlack();
        this.display();
        new import_obsidian.Notice("Slack session cleared.");
      })
    );
    new import_obsidian.Setting(containerEl).setName("Client ID").setDesc("Find this in your Slack app settings (api.slack.com/apps) under Basic Information \u2192 App Credentials \u2192 Client ID. Format: <numbers>.<numbers> (e.g., 1234567890.1234567890).").addText(
      (text) => text.setValue(settings.clientId).onChange(async (value) => {
        await this.plugin.saveSettings({ clientId: value.trim() });
      })
    );
    new import_obsidian.Setting(containerEl).setName("User scopes").setDesc("Comma-separated Slack user scopes requested during Connect Slack.").addTextArea(
      (text) => text.setValue(settings.scopes).onChange(async (value) => {
        await this.plugin.saveSettings({ scopes: value.trim() || DEFAULT_SETTINGS.scopes });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Message template").setDesc("Controls how pasted Slack message permalinks render.").addTextArea(
      (text) => text.setValue(settings.messageTemplate).onChange(async (value) => {
        await this.plugin.saveSettings({ messageTemplate: value.trim() || DEFAULT_SETTINGS.messageTemplate });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Preferred link target").setDesc("Choose Slack app links or the web/app_redirect fallback.").addDropdown(
      (dropdown) => dropdown.addOption("app", "Slack app").addOption("web", "Web / app_redirect").setValue(settings.target).onChange(async (value) => {
        await this.plugin.saveSettings({ target: value === "web" ? "web" : "app" });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Idle delay").setDesc("How long the plugin waits after typing before scanning the note.").addText(
      (text) => text.setValue(String(settings.idleDelayMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          return;
        }
        await this.plugin.saveSettings({ idleDelayMs: parsed });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Refresh leeway").setDesc("How early the plugin refreshes an expiring Slack session.").addText(
      (text) => text.setValue(String(settings.refreshLeewayMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          return;
        }
        await this.plugin.saveSettings({ refreshLeewayMs: parsed });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-link channels").setDesc("Resolve #channel references after the idle delay.").addToggle(
      (toggle) => toggle.setValue(settings.enableChannels).onChange(async (value) => {
        await this.plugin.saveSettings({ enableChannels: value });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-link DM sentinels").setDesc("Resolve explicit dm:@name or dm:email references.").addToggle(
      (toggle) => toggle.setValue(settings.enableDmSentinels).onChange(async (value) => {
        await this.plugin.saveSettings({ enableDmSentinels: value });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-link pasted permalinks").setDesc("Convert pasted Slack message permalinks into smart Markdown links.").addToggle(
      (toggle) => toggle.setValue(settings.enablePermalinks).onChange(async (value) => {
        await this.plugin.saveSettings({ enablePermalinks: value });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Test Slack connection").setDesc("Check whether a local Slack session is configured.").addButton(
      (button) => button.setButtonText("Test").onClick(() => {
        this.plugin.showConnectionStatus();
      })
    );
  }
};
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3NsYWNrL2F1dGgudHMiLCAic3JjL3NsYWNrL2NhY2hlLnRzIiwgInNyYy9zbGFjay9kZXRlY3Rvci50cyIsICJzcmMvc2xhY2svcmVuZGVyZXIudHMiLCAic3JjL3NsYWNrL2VuZ2luZS50cyIsICJzcmMvc2xhY2svcGVybWFsaW5rLnRzIiwgInNyYy9zbGFjay9yZXNvbHZlci50cyIsICJzcmMvc2xhY2svcmVwbGFjZW1lbnRzLnRzIiwgInNyYy9zbGFjay9zZWN1cmUtc2Vzc2lvbi50cyIsICJzcmMvc2xhY2svc2VydmljZS50cyIsICJzcmMvc2xhY2svc2Vzc2lvbi50cyIsICJzcmMvc2xhY2svc2luZ2xlLWZsaWdodC50cyIsICJzcmMvc2V0dGluZ3MudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICByZXF1ZXN0VXJsLFxuICB0eXBlIEFwcCxcbiAgdHlwZSBFZGl0b3IsXG59IGZyb20gJ29ic2lkaWFuJztcblxuaW1wb3J0IHtcbiAgYnVpbGRTbGFja0F1dGhvcml6ZVVybCxcbiAgY29tcGxldGVTbGFja0F1dGgsXG4gIGNyZWF0ZVBrY2VQYWlyLFxuICByZWZyZXNoU2xhY2tTZXNzaW9uLFxuICB0eXBlIFNsYWNrQXBpRm9ybVJlcXVlc3QsXG59IGZyb20gJy4vc2xhY2svYXV0aCc7XG5pbXBvcnQgeyBUdGxDYWNoZSB9IGZyb20gJy4vc2xhY2svY2FjaGUnO1xuaW1wb3J0IHsgZGV0ZWN0Q2FuZGlkYXRlcyB9IGZyb20gJy4vc2xhY2svZGV0ZWN0b3InO1xuaW1wb3J0IHsgcGxhblNsYWNrTGlua1JlcGxhY2VtZW50cyB9IGZyb20gJy4vc2xhY2svZW5naW5lJztcbmltcG9ydCB7IGJ1aWxkVGFyZ2V0VXJsIH0gZnJvbSAnLi9zbGFjay9yZW5kZXJlcic7XG5pbXBvcnQgeyBjcmVhdGVSZXNvbHZlciB9IGZyb20gJy4vc2xhY2svcmVzb2x2ZXInO1xuaW1wb3J0IHsgYXBwbHlSZXBsYWNlbWVudHMgfSBmcm9tICcuL3NsYWNrL3JlcGxhY2VtZW50cyc7XG5pbXBvcnQgeyBjcmVhdGVFbGVjdHJvblNlc3Npb25DaXBoZXIgfSBmcm9tICcuL3NsYWNrL3NlY3VyZS1zZXNzaW9uJztcbmltcG9ydCB7IGNyZWF0ZVNsYWNrU2VydmljZSwgdHlwZSBTbGFja1NlcnZpY2UgfSBmcm9tICcuL3NsYWNrL3NlcnZpY2UnO1xuaW1wb3J0IHsgaGFzVmFsaWRBY2Nlc3NUb2tlbiwgc2hvdWxkUmVmcmVzaFNlc3Npb24gfSBmcm9tICcuL3NsYWNrL3Nlc3Npb24nO1xuaW1wb3J0IHsgU2luZ2xlRmxpZ2h0IH0gZnJvbSAnLi9zbGFjay9zaW5nbGUtZmxpZ2h0JztcbmltcG9ydCB0eXBlIHsgU2xhY2tDaGFubmVsLCBTbGFja1VzZXIgfSBmcm9tICcuL3NsYWNrL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgU2xhY2tCYXNlc1NldHRpbmdzIH0gZnJvbSAnLi9zZXR0aW5ncyc7XG5pbXBvcnQge1xuICBjcmVhdGVQZXJzaXN0ZWRTZXR0aW5ncyxcbiAgREVGQVVMVF9TRVRUSU5HUyxcbiAgaXNWYWxpZFNsYWNrQ2xpZW50SWQsXG4gIGxvYWRTZXR0aW5nc1dpdGhTZXNzaW9uLFxuICBtZXJnZVNldHRpbmdzLFxufSBmcm9tICcuL3NldHRpbmdzJztcblxuY29uc3QgQVVUSF9DQUxMQkFDS19BQ1RJT04gPSAnc2xhY2stYmFzZXMtYXV0aCc7XG5jb25zdCBBVVRIX1JFQ09OTkVDVF9OT1RJQ0VfTVMgPSA2MF8wMDA7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNsYWNrQmFzZXNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIGNoYW5uZWxDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja0NoYW5uZWw+KERFRkFVTFRfU0VUVElOR1MuY2hhbm5lbENhY2hlVHRsTXMpO1xuICBwcml2YXRlIGZhaWxlZExvb2t1cENhY2hlID0gbmV3IFR0bENhY2hlPGJvb2xlYW4+KERFRkFVTFRfU0VUVElOR1MuZmFpbGVkTG9va3VwVHRsTXMpO1xuICBwcml2YXRlIGlzQXBwbHlpbmdDaGFuZ2VzID0gZmFsc2U7XG4gIHByaXZhdGUgbGFzdEF1dGhOb3RpY2VBdCA9IDA7XG4gIHByaXZhdGUgcGVuZGluZ0F1dGhTdGF0ZTogeyBjb2RlVmVyaWZpZXI6IHN0cmluZzsgc3RhdGU6IHN0cmluZyB9IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVmcmVzaFRpbWVyOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWZyZXNoU2Vzc2lvbkdhdGUgPSBuZXcgU2luZ2xlRmxpZ2h0PGJvb2xlYW4+KCk7XG4gIHByaXZhdGUgc2VydmljZTogU2xhY2tTZXJ2aWNlID0gY3JlYXRlU2xhY2tTZXJ2aWNlKERFRkFVTFRfU0VUVElOR1Muc2Vzc2lvbik7XG4gIHByaXZhdGUgc2Vzc2lvbkNpcGhlciA9IGNyZWF0ZUVsZWN0cm9uU2Vzc2lvbkNpcGhlcigpO1xuICBwcml2YXRlIHNldHRpbmdzOiBTbGFja0Jhc2VzU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICBwcml2YXRlIHVzZXJDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja1VzZXI+KERFRkFVTFRfU0VUVElOR1MudXNlckNhY2hlVHRsTXMpO1xuICBwcml2YXRlIHJlc29sdmVyID0gY3JlYXRlUmVzb2x2ZXIoe1xuICAgIGNoYW5uZWxDYWNoZTogdGhpcy5jaGFubmVsQ2FjaGUsXG4gICAgZmFpbGVkTG9va3VwQ2FjaGU6IHRoaXMuZmFpbGVkTG9va3VwQ2FjaGUsXG4gICAgc2VydmljZTogdGhpcy5zZXJ2aWNlLFxuICAgIHNlc3Npb246IHRoaXMuc2V0dGluZ3Muc2Vzc2lvbixcbiAgICB1c2VyQ2FjaGU6IHRoaXMudXNlckNhY2hlLFxuICB9KTtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihBVVRIX0NBTExCQUNLX0FDVElPTiwgKHBhcmFtcykgPT4ge1xuICAgICAgdm9pZCB0aGlzLmNvbXBsZXRlU2xhY2tDb25uZWN0KHBhcmFtcyk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oJ2xpbmsnLCAnQ29ubmVjdCBTbGFjaycsICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5jb25uZWN0U2xhY2soKTtcbiAgICB9KTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFNsYWNrQmFzZXNTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgdGhpcy5yZWdpc3RlckNvbW1hbmRzKCk7XG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckxpc3RlbmVyKCk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWZyZXNoVGltZXIgIT09IG51bGwpIHtcbiAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5yZWZyZXNoVGltZXIpO1xuICAgICAgdGhpcy5yZWZyZXNoVGltZXIgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncyhuZXh0U2V0dGluZ3M/OiBQYXJ0aWFsPFNsYWNrQmFzZXNTZXR0aW5ncz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXJnZWRTZXR0aW5ncyA9IG1lcmdlU2V0dGluZ3MobmV4dFNldHRpbmdzID8geyAuLi50aGlzLnNldHRpbmdzLCAuLi5uZXh0U2V0dGluZ3MgfSA6IHRoaXMuc2V0dGluZ3MpO1xuXG4gICAgdGhpcy5zZXR0aW5ncyA9IG1lcmdlZFNldHRpbmdzO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoY3JlYXRlUGVyc2lzdGVkU2V0dGluZ3MobWVyZ2VkU2V0dGluZ3MsIHRoaXMuc2Vzc2lvbkNpcGhlcikpO1xuICAgIHRoaXMucmVidWlsZFJ1bnRpbWUoKTtcbiAgfVxuXG4gIGdldFNldHRpbmdzKCk6IFNsYWNrQmFzZXNTZXR0aW5ncyB7XG4gICAgcmV0dXJuIHRoaXMuc2V0dGluZ3M7XG4gIH1cblxuICBhc3luYyBjb25uZWN0U2xhY2soKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLmNsaWVudElkKSB7XG4gICAgICBuZXcgTm90aWNlKCdTZXQgeW91ciBTbGFjayBjbGllbnQgSUQgYmVmb3JlIGNvbm5lY3RpbmcuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuY2xpZW50SWQgJiYgIWlzVmFsaWRTbGFja0NsaWVudElkKHRoaXMuc2V0dGluZ3MuY2xpZW50SWQpKSB7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICAnSW52YWxpZCBTbGFjayBjbGllbnQgSUQgXCInICsgdGhpcy5zZXR0aW5ncy5jbGllbnRJZCArICdcIi4gRXhwZWN0ZWQgZm9ybWF0OiA8bnVtYmVycz4uPG51bWJlcnM+IChlLmcuLCAxMjM0NTY3ODkwLjEyMzQ1Njc4OTApLidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNlc3Npb25DaXBoZXI/LmlzQXZhaWxhYmxlKCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1NlY3VyZSBsb2NhbCBzdG9yYWdlIGlzIHVuYXZhaWxhYmxlIGluIHRoaXMgZGVza3RvcCBlbnZpcm9ubWVudC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwa2NlUGFpciA9IGF3YWl0IGNyZWF0ZVBrY2VQYWlyKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmNyZWF0ZVN0YXRlVG9rZW4oKTtcblxuICAgIHRoaXMucGVuZGluZ0F1dGhTdGF0ZSA9IHtcbiAgICAgIGNvZGVWZXJpZmllcjogcGtjZVBhaXIuY29kZVZlcmlmaWVyLFxuICAgICAgc3RhdGUsXG4gICAgfTtcblxuICAgIHdpbmRvdy5vcGVuKFxuICAgICAgYnVpbGRTbGFja0F1dGhvcml6ZVVybCh7XG4gICAgICAgIGNsaWVudElkOiB0aGlzLnNldHRpbmdzLmNsaWVudElkLFxuICAgICAgICBjb2RlQ2hhbGxlbmdlOiBwa2NlUGFpci5jb2RlQ2hhbGxlbmdlLFxuICAgICAgICByZWRpcmVjdFVyaTogdGhpcy5nZXRSZWRpcmVjdFVyaSgpLFxuICAgICAgICBzY29wZXM6IHRoaXMuc2V0dGluZ3Muc2NvcGVzLFxuICAgICAgICBzdGF0ZSxcbiAgICAgICAgdGVhbUlkOiB0aGlzLnNldHRpbmdzLnRlYW1JZCB8fCB1bmRlZmluZWQsXG4gICAgICB9KSxcbiAgICAgICdfYmxhbmsnXG4gICAgKTtcblxuICAgIG5ldyBOb3RpY2UoJ0F1dGhvcml6ZSB0aGUgU2xhY2sgYXBwIGluIHlvdXIgYnJvd3NlciwgdGhlbiByZXR1cm4gdG8gT2JzaWRpYW4uJyk7XG4gIH1cblxuICBhc3luYyBkaXNjb25uZWN0U2xhY2soKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3Moe1xuICAgICAgZW5jcnlwdGVkU2Vzc2lvbjogJycsXG4gICAgICBzZXNzaW9uOiB7XG4gICAgICAgIC4uLkRFRkFVTFRfU0VUVElOR1Muc2Vzc2lvbixcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZXNldENoYW5uZWxDYWNoZSgpOiB2b2lkIHtcbiAgICB0aGlzLmNoYW5uZWxDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja0NoYW5uZWw+KHRoaXMuc2V0dGluZ3MuY2hhbm5lbENhY2hlVHRsTXMpO1xuICAgIHRoaXMucmVidWlsZFJlc29sdmVyKCk7XG4gIH1cblxuICByZXNldFVzZXJDYWNoZSgpOiB2b2lkIHtcbiAgICB0aGlzLnVzZXJDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja1VzZXI+KHRoaXMuc2V0dGluZ3MudXNlckNhY2hlVHRsTXMpO1xuICAgIHRoaXMucmVidWlsZFJlc29sdmVyKCk7XG4gIH1cblxuICBzaG93Q29ubmVjdGlvblN0YXR1cygpOiB2b2lkIHtcbiAgICBpZiAoaGFzVmFsaWRBY2Nlc3NUb2tlbih0aGlzLnNldHRpbmdzLnNlc3Npb24pICYmIHRoaXMuc2V0dGluZ3Muc2Vzc2lvbi53b3Jrc3BhY2UpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFNsYWNrIHNlc3Npb24gY29uZmlndXJlZCBmb3IgJHt0aGlzLnNldHRpbmdzLnNlc3Npb24ud29ya3NwYWNlfWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoJ1NsYWNrIGlzIG5vdCBjb25uZWN0ZWQuJyk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0gbG9hZFNldHRpbmdzV2l0aFNlc3Npb24oYXdhaXQgdGhpcy5sb2FkRGF0YSgpLCB0aGlzLnNlc3Npb25DaXBoZXIpO1xuICAgIHRoaXMucmVidWlsZFJ1bnRpbWUoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVidWlsZFJ1bnRpbWUoKTogdm9pZCB7XG4gICAgdGhpcy5jaGFubmVsQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8U2xhY2tDaGFubmVsPih0aGlzLnNldHRpbmdzLmNoYW5uZWxDYWNoZVR0bE1zKTtcbiAgICB0aGlzLnVzZXJDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja1VzZXI+KHRoaXMuc2V0dGluZ3MudXNlckNhY2hlVHRsTXMpO1xuICAgIHRoaXMuZmFpbGVkTG9va3VwQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8Ym9vbGVhbj4odGhpcy5zZXR0aW5ncy5mYWlsZWRMb29rdXBUdGxNcyk7XG4gICAgdGhpcy5zZXJ2aWNlID0gY3JlYXRlU2xhY2tTZXJ2aWNlKHRoaXMuc2V0dGluZ3Muc2Vzc2lvbik7XG4gICAgdGhpcy5yZWJ1aWxkUmVzb2x2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVidWlsZFJlc29sdmVyKCk6IHZvaWQge1xuICAgIHRoaXMucmVzb2x2ZXIgPSBjcmVhdGVSZXNvbHZlcih7XG4gICAgICBjaGFubmVsQ2FjaGU6IHRoaXMuY2hhbm5lbENhY2hlLFxuICAgICAgZmFpbGVkTG9va3VwQ2FjaGU6IHRoaXMuZmFpbGVkTG9va3VwQ2FjaGUsXG4gICAgICBzZXJ2aWNlOiB0aGlzLnNlcnZpY2UsXG4gICAgICBzZXNzaW9uOiB0aGlzLnNldHRpbmdzLnNlc3Npb24sXG4gICAgICB1c2VyQ2FjaGU6IHRoaXMudXNlckNhY2hlLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZWdpc3RlckNvbW1hbmRzKCk6IHZvaWQge1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ2Nvbm5lY3Qtc2xhY2snLFxuICAgICAgbmFtZTogJ0Nvbm5lY3QgU2xhY2snLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLmNvbm5lY3RTbGFjaygpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ2Rpc2Nvbm5lY3Qtc2xhY2snLFxuICAgICAgbmFtZTogJ0Rpc2Nvbm5lY3QgU2xhY2snLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLmRpc2Nvbm5lY3RTbGFjaygpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3Rlc3Qtc2xhY2stY29ubmVjdGlvbicsXG4gICAgICBuYW1lOiAnVGVzdCBTbGFjayBjb25uZWN0aW9uJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnNob3dDb25uZWN0aW9uU3RhdHVzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdpbnNlcnQtc2xhY2stbGluaycsXG4gICAgICBuYW1lOiAnSW5zZXJ0IFNsYWNrIGxpbmsnLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3IpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLnJlcGxhY2VTZWxlY3Rpb25XaXRoU2xhY2tMaW5rcyhlZGl0b3IpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ2luc2VydC1zbGFjay1tZXNzYWdlLWxpbmsnLFxuICAgICAgbmFtZTogJ0luc2VydCBTbGFjayBtZXNzYWdlIGxpbmsnLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3IpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLnJlcGxhY2VTZWxlY3Rpb25XaXRoU2xhY2tMaW5rcyhlZGl0b3IsIHtcbiAgICAgICAgICBlbmFibGVDaGFubmVsczogZmFsc2UsXG4gICAgICAgICAgZW5hYmxlRG1TZW50aW5lbHM6IGZhbHNlLFxuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdyZWZyZXNoLXNsYWNrLXBlb3BsZS1jYWNoZScsXG4gICAgICBuYW1lOiAnUmVmcmVzaCBTbGFjayBwZW9wbGUgY2FjaGUnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgdGhpcy5yZXNldFVzZXJDYWNoZSgpO1xuICAgICAgICBuZXcgTm90aWNlKCdTbGFjayBwZW9wbGUgY2FjaGUgY2xlYXJlZC4nKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdyZWZyZXNoLXNsYWNrLWNoYW5uZWwtY2FjaGUnLFxuICAgICAgbmFtZTogJ1JlZnJlc2ggU2xhY2sgY2hhbm5lbCBjYWNoZScsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICB0aGlzLnJlc2V0Q2hhbm5lbENhY2hlKCk7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIGNoYW5uZWwgY2FjaGUgY2xlYXJlZC4nKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdvcGVuLWN1cnJlbnQtc2xhY2stcmVmJyxcbiAgICAgIG5hbWU6ICdPcGVuIGN1cnJlbnQgU2xhY2sgcmVmJyxcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5vcGVuQ3VycmVudFNsYWNrUmVmKGVkaXRvcik7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZWdpc3RlckVkaXRvckxpc3RlbmVyKCk6IHZvaWQge1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbignZWRpdG9yLWNoYW5nZScsIChlZGl0b3IpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuaXNBcHBseWluZ0NoYW5nZXMpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5yZWZyZXNoVGltZXIgIT09IG51bGwpIHtcbiAgICAgICAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRoaXMucmVmcmVzaFRpbWVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVmcmVzaFRpbWVyID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHZvaWQgdGhpcy5yZWZyZXNoRWRpdG9yKGVkaXRvcik7XG4gICAgICAgIH0sIHRoaXMuc2V0dGluZ3MuaWRsZURlbGF5TXMpO1xuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoRWRpdG9yKGVkaXRvcjogRWRpdG9yKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gZWRpdG9yLmdldFZhbHVlKCk7XG4gICAgY29uc3QgY3Vyc29yT2Zmc2V0ID0gZWRpdG9yLnBvc1RvT2Zmc2V0KGVkaXRvci5nZXRDdXJzb3IoKSk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRldGVjdENhbmRpZGF0ZXMoc291cmNlLCB7IGN1cnNvck9mZnNldCB9KTtcblxuICAgIGlmICghY2FuZGlkYXRlcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZVZhbGlkU2Vzc2lvbigpKSkge1xuICAgICAgdGhpcy5tYXliZVNob3dSZWNvbm5lY3ROb3RpY2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXBsYWNlbWVudHMgPSBhd2FpdCBwbGFuU2xhY2tMaW5rUmVwbGFjZW1lbnRzKHNvdXJjZSwge1xuICAgICAgY3Vyc29yT2Zmc2V0LFxuICAgICAgcmVzb2x2ZXI6IHRoaXMucmVzb2x2ZXIsXG4gICAgICBzZXR0aW5nczogdGhpcy5zZXR0aW5ncyxcbiAgICB9KTtcblxuICAgIGlmICghcmVwbGFjZW1lbnRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5leHRWYWx1ZSA9IGFwcGx5UmVwbGFjZW1lbnRzKHNvdXJjZSwgcmVwbGFjZW1lbnRzKTtcblxuICAgIGlmIChuZXh0VmFsdWUgPT09IHNvdXJjZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaXNBcHBseWluZ0NoYW5nZXMgPSB0cnVlO1xuXG4gICAgdHJ5IHtcbiAgICAgIGVkaXRvci5zZXRWYWx1ZShuZXh0VmFsdWUpO1xuICAgICAgZWRpdG9yLnNldEN1cnNvcihlZGl0b3Iub2Zmc2V0VG9Qb3MoY3Vyc29yT2Zmc2V0KSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuaXNBcHBseWluZ0NoYW5nZXMgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlcGxhY2VTZWxlY3Rpb25XaXRoU2xhY2tMaW5rcyhcbiAgICBlZGl0b3I6IEVkaXRvcixcbiAgICBvdmVycmlkZXM/OiBQYXJ0aWFsPFBpY2s8U2xhY2tCYXNlc1NldHRpbmdzLCAnZW5hYmxlQ2hhbm5lbHMnIHwgJ2VuYWJsZURtU2VudGluZWxzJyB8ICdlbmFibGVQZXJtYWxpbmtzJz4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5nZXRTZWxlY3Rpb24oKTtcblxuICAgIGlmICghc2VsZWN0aW9uKSB7XG4gICAgICBuZXcgTm90aWNlKCdTZWxlY3QgU2xhY2sgdGV4dCBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZVZhbGlkU2Vzc2lvbih0cnVlKSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXBsYWNlbWVudHMgPSBhd2FpdCBwbGFuU2xhY2tMaW5rUmVwbGFjZW1lbnRzKHNlbGVjdGlvbiwge1xuICAgICAgY3Vyc29yT2Zmc2V0OiAtMSxcbiAgICAgIHJlc29sdmVyOiB0aGlzLnJlc29sdmVyLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgLi4udGhpcy5zZXR0aW5ncyxcbiAgICAgICAgLi4ub3ZlcnJpZGVzLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmICghcmVwbGFjZW1lbnRzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZSgnTm8gU2xhY2sgcmVmZXJlbmNlcyBmb3VuZCBpbiB0aGUgY3VycmVudCBzZWxlY3Rpb24uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24oYXBwbHlSZXBsYWNlbWVudHMoc2VsZWN0aW9uLCByZXBsYWNlbWVudHMpKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgb3BlbkN1cnJlbnRTbGFja1JlZihlZGl0b3I6IEVkaXRvcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRleHQgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcbiAgICBjb25zdCBjdXJzb3JPZmZzZXQgPSBlZGl0b3IucG9zVG9PZmZzZXQoZWRpdG9yLmdldEN1cnNvcigpKTtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBkZXRlY3RDYW5kaWRhdGVzKHRleHQsIHsgY3Vyc29yT2Zmc2V0IH0pLmZpbmQoXG4gICAgICAoaXRlbSkgPT4gY3Vyc29yT2Zmc2V0ID49IGl0ZW0uc3RhcnQgJiYgY3Vyc29yT2Zmc2V0IDw9IGl0ZW0uZW5kXG4gICAgKTtcblxuICAgIGlmICghY2FuZGlkYXRlKSB7XG4gICAgICBuZXcgTm90aWNlKCdObyBTbGFjayByZWZlcmVuY2UgdW5kZXIgdGhlIGN1cnNvci4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZVZhbGlkU2Vzc2lvbih0cnVlKSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdtZXNzYWdlLXBlcm1hbGluaycpIHtcbiAgICAgIHdpbmRvdy5vcGVuKGNhbmRpZGF0ZS52YWx1ZSwgJ19ibGFuaycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2NoYW5uZWwtcmVmJykge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCB0aGlzLnJlc29sdmVyLnJlc29sdmVDaGFubmVsUmVmKGNhbmRpZGF0ZS52YWx1ZSk7XG5cbiAgICAgIGlmICghcmVzb2x2ZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVW5hYmxlIHRvIHJlc29sdmUgdGhhdCBTbGFjayBjaGFubmVsLicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHdpbmRvdy5vcGVuKFxuICAgICAgICBidWlsZFRhcmdldFVybCh7XG4gICAgICAgICAgY2hhbm5lbElkOiByZXNvbHZlZC5jaGFubmVsSWQsXG4gICAgICAgICAgdGFyZ2V0OiB0aGlzLnNldHRpbmdzLnRhcmdldCxcbiAgICAgICAgICB0ZWFtSWQ6IHJlc29sdmVkLnRlYW1JZCxcbiAgICAgICAgfSksXG4gICAgICAgICdfYmxhbmsnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZXNvbHZlci5yZXNvbHZlRG1TZW50aW5lbChjYW5kaWRhdGUudmFsdWUpO1xuXG4gICAgaWYgKCFyZXNvbHZlZCkge1xuICAgICAgbmV3IE5vdGljZSgnVW5hYmxlIHRvIHJlc29sdmUgdGhhdCBTbGFjayBETS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB3aW5kb3cub3Blbihgc2xhY2s6Ly91c2VyP3RlYW09JHtyZXNvbHZlZC50ZWFtSWR9JmlkPSR7cmVzb2x2ZWQudXNlcklkfWAsICdfYmxhbmsnKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29tcGxldGVTbGFja0Nvbm5lY3QocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHBhcmFtcy5lcnJvcikge1xuICAgICAgbmV3IE5vdGljZShgU2xhY2sgc2lnbi1pbiBmYWlsZWQ6ICR7cGFyYW1zLmVycm9yfWApO1xuICAgICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0gbnVsbDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXBhcmFtcy5jb2RlIHx8ICFwYXJhbXMuc3RhdGUgfHwgIXRoaXMucGVuZGluZ0F1dGhTdGF0ZSkge1xuICAgICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0gbnVsbDtcbiAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIHNpZ24taW4gY2FsbGJhY2sgd2FzIGluY29tcGxldGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHBhcmFtcy5zdGF0ZSAhPT0gdGhpcy5wZW5kaW5nQXV0aFN0YXRlLnN0YXRlKSB7XG4gICAgICB0aGlzLnBlbmRpbmdBdXRoU3RhdGUgPSBudWxsO1xuICAgICAgbmV3IE5vdGljZSgnU2xhY2sgc2lnbi1pbiBzdGF0ZSBkaWQgbm90IG1hdGNoIHRoZSBwZW5kaW5nIHJlcXVlc3QuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBjb21wbGV0ZVNsYWNrQXV0aCh0aGlzLnJlcXVlc3RTbGFja0FwaUZvcm0uYmluZCh0aGlzKSwge1xuICAgICAgICBjbGllbnRJZDogdGhpcy5zZXR0aW5ncy5jbGllbnRJZCxcbiAgICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICAgIGNvZGVWZXJpZmllcjogdGhpcy5wZW5kaW5nQXV0aFN0YXRlLmNvZGVWZXJpZmllcixcbiAgICAgICAgcmVkaXJlY3RVcmk6IHRoaXMuZ2V0UmVkaXJlY3RVcmkoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncyh7IHNlc3Npb24gfSk7XG4gICAgICB0aGlzLnBlbmRpbmdBdXRoU3RhdGUgPSBudWxsO1xuICAgICAgbmV3IE5vdGljZShgQ29ubmVjdGVkIFNsYWNrIHdvcmtzcGFjZSAke3Nlc3Npb24ud29ya3NwYWNlIHx8IHNlc3Npb24udGVhbUlkfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0gbnVsbDtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBnZXRFcnJvck1lc3NhZ2UoZXJyb3IpO1xuICAgICAgY29uc3QgYWR2aWNlID0gbWVzc2FnZS5pbmNsdWRlcygnaW52YWxpZF9jbGllbnQnKVxuICAgICAgICA/ICdDaGVjayB0aGF0IHlvdXIgU2xhY2sgY2xpZW50IElEIGFuZCBjbGllbnQgc2VjcmV0IGFyZSBjb3JyZWN0LidcbiAgICAgICAgOiBtZXNzYWdlLmluY2x1ZGVzKCdpbnZhbGlkX2dyYW50JylcbiAgICAgICAgPyAnVGhlIGF1dGhvcml6YXRpb24gY29kZSBleHBpcmVkLiBUcnkgY29ubmVjdGluZyBhZ2Fpbi4nXG4gICAgICAgIDogbWVzc2FnZS5pbmNsdWRlcygncmVkaXJlY3RfdXJpX21pc21hdGNoJylcbiAgICAgICAgPyAnQWRkIG9ic2lkaWFuOi8vc2xhY2stYmFzZXMtYXV0aCB0byB5b3VyIFNsYWNrIGFwcCByZWRpcmVjdCBVUkxzLidcbiAgICAgICAgOiBtZXNzYWdlLmluY2x1ZGVzKCdpbnZhbGlkX2NsaWVudF9pZCcpXG4gICAgICAgID8gJ1RoZSBTbGFjayBjbGllbnQgSUQgYXBwZWFycyBpbnZhbGlkLiBDaGVjayB5b3VyIFNsYWNrIGFwcCBzZXR0aW5ncy4nXG4gICAgICAgIDogJyc7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgU2xhY2sgc2lnbi1pbiBmYWlsZWQ6ICR7bWVzc2FnZX0ke2FkdmljZSA/ICcgJyArIGFkdmljZSA6ICcnfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVWYWxpZFNlc3Npb24obm90aWZ5T25NaXNzaW5nID0gZmFsc2UpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIWhhc1ZhbGlkQWNjZXNzVG9rZW4odGhpcy5zZXR0aW5ncy5zZXNzaW9uKSkge1xuICAgICAgaWYgKG5vdGlmeU9uTWlzc2luZykge1xuICAgICAgICBuZXcgTm90aWNlKCdDb25uZWN0IFNsYWNrIHRvIHJlc29sdmUgbGl2ZSBTbGFjayBtZXRhZGF0YS4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoIXNob3VsZFJlZnJlc2hTZXNzaW9uKHRoaXMuc2V0dGluZ3Muc2Vzc2lvbiwgdGhpcy5zZXR0aW5ncy5yZWZyZXNoTGVld2F5TXMpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MuY2xpZW50SWQgfHwgIXRoaXMuc2V0dGluZ3Muc2Vzc2lvbi5yZWZyZXNoVG9rZW4pIHtcbiAgICAgIGlmIChub3RpZnlPbk1pc3NpbmcpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnU2xhY2sgc2Vzc2lvbiBleHBpcmVkLiBSZWNvbm5lY3QgU2xhY2suJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVmcmVzaFNlc3Npb25HYXRlLnJ1bihhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXNob3VsZFJlZnJlc2hTZXNzaW9uKHRoaXMuc2V0dGluZ3Muc2Vzc2lvbiwgdGhpcy5zZXR0aW5ncy5yZWZyZXNoTGVld2F5TXMpKSB7XG4gICAgICAgIHJldHVybiBoYXNWYWxpZEFjY2Vzc1Rva2VuKHRoaXMuc2V0dGluZ3Muc2Vzc2lvbik7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNlc3Npb24gPSBhd2FpdCByZWZyZXNoU2xhY2tTZXNzaW9uKHRoaXMucmVxdWVzdFNsYWNrQXBpRm9ybS5iaW5kKHRoaXMpLCB7XG4gICAgICAgICAgY2xpZW50SWQ6IHRoaXMuc2V0dGluZ3MuY2xpZW50SWQsXG4gICAgICAgICAgc2Vzc2lvbjogdGhpcy5zZXR0aW5ncy5zZXNzaW9uLFxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncyh7IHNlc3Npb24gfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKG5vdGlmeU9uTWlzc2luZykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoYFNsYWNrIHNlc3Npb24gcmVmcmVzaCBmYWlsZWQ6ICR7Z2V0RXJyb3JNZXNzYWdlKGVycm9yKX1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFJlZGlyZWN0VXJpKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBvYnNpZGlhbjovLyR7QVVUSF9DQUxMQkFDS19BQ1RJT059YDtcbiAgfVxuXG4gIHByaXZhdGUgbWF5YmVTaG93UmVjb25uZWN0Tm90aWNlKCk6IHZvaWQge1xuICAgIGlmIChEYXRlLm5vdygpIC0gdGhpcy5sYXN0QXV0aE5vdGljZUF0IDwgQVVUSF9SRUNPTk5FQ1RfTk9USUNFX01TKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sYXN0QXV0aE5vdGljZUF0ID0gRGF0ZS5ub3coKTtcbiAgICBuZXcgTm90aWNlKCdTbGFjayByZWZlcmVuY2VzIGRldGVjdGVkLiBDb25uZWN0IFNsYWNrIHRvIGVuYWJsZSBsaXZlIHJlc29sdXRpb24uJyk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVN0YXRlVG9rZW4oKTogc3RyaW5nIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhuZXcgVWludDhBcnJheSgxNikpKVxuICAgICAgLnRvU3RyaW5nKCdiYXNlNjQnKVxuICAgICAgLnJlcGxhY2UoL1xcKy9nLCAnLScpXG4gICAgICAucmVwbGFjZSgvXFwvL2csICdfJylcbiAgICAgIC5yZXBsYWNlKC89KyQvZywgJycpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXF1ZXN0U2xhY2tBcGlGb3JtKHJlcXVlc3Q6IFNsYWNrQXBpRm9ybVJlcXVlc3QpOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICBib2R5OiByZXF1ZXN0LmJvZHkudG9TdHJpbmcoKSxcbiAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkOyBjaGFyc2V0PXV0Zi04JyxcbiAgICAgIGhlYWRlcnM6IHJlcXVlc3QudG9rZW5cbiAgICAgICAgPyB7XG4gICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cmVxdWVzdC50b2tlbn1gLFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7fSxcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgdGhyb3c6IGZhbHNlLFxuICAgICAgdXJsOiBgaHR0cHM6Ly9zbGFjay5jb20vYXBpLyR7cmVxdWVzdC5wYXRofWAsXG4gICAgfSk7XG5cbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID49IDQwMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTbGFjayBBUEkgcmVxdWVzdCBmYWlsZWQ6ICR7cmVzcG9uc2Uuc3RhdHVzfWApO1xuICAgIH1cblxuICAgIGlmICghcmVzcG9uc2UuanNvbj8ub2spIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgcmVzcG9uc2UuanNvbj8uZXJyb3JcbiAgICAgICAgICA/IGBTbGFjayBBUEkgZXJyb3I6ICR7cmVzcG9uc2UuanNvbi5lcnJvcn1gXG4gICAgICAgICAgOiBgU2xhY2sgQVBJIHJlcXVlc3QgZmFpbGVkOiAke3JlcXVlc3QucGF0aH1gXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZS5qc29uO1xuICB9XG59XG5cbmNsYXNzIFNsYWNrQmFzZXNTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogU2xhY2tCYXNlc1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLmdldFNldHRpbmdzKCk7XG5cbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gyJywgeyB0ZXh0OiAnU2xhY2sgQmFzZXMnIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU2xhY2sgY29ubmVjdGlvbicpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgaGFzVmFsaWRBY2Nlc3NUb2tlbihzZXR0aW5ncy5zZXNzaW9uKVxuICAgICAgICAgID8gYENvbm5lY3RlZCB0byAke3NldHRpbmdzLnNlc3Npb24ud29ya3NwYWNlIHx8IHNldHRpbmdzLnNlc3Npb24udGVhbUlkfS5gXG4gICAgICAgICAgOiAnTm90IGNvbm5lY3RlZC4nXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDb25uZWN0Jykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uY29ubmVjdFNsYWNrKCk7XG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdEaXNjb25uZWN0Jykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uZGlzY29ubmVjdFNsYWNrKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgbmV3IE5vdGljZSgnU2xhY2sgc2Vzc2lvbiBjbGVhcmVkLicpO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0NsaWVudCBJRCcpXG4gICAgICAuc2V0RGVzYygnRmluZCB0aGlzIGluIHlvdXIgU2xhY2sgYXBwIHNldHRpbmdzIChhcGkuc2xhY2suY29tL2FwcHMpIHVuZGVyIEJhc2ljIEluZm9ybWF0aW9uIFx1MjE5MiBBcHAgQ3JlZGVudGlhbHMgXHUyMTkyIENsaWVudCBJRC4gRm9ybWF0OiA8bnVtYmVycz4uPG51bWJlcnM+IChlLmcuLCAxMjM0NTY3ODkwLjEyMzQ1Njc4OTApLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShzZXR0aW5ncy5jbGllbnRJZCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgY2xpZW50SWQ6IHZhbHVlLnRyaW0oKSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdVc2VyIHNjb3BlcycpXG4gICAgICAuc2V0RGVzYygnQ29tbWEtc2VwYXJhdGVkIFNsYWNrIHVzZXIgc2NvcGVzIHJlcXVlc3RlZCBkdXJpbmcgQ29ubmVjdCBTbGFjay4nKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKHNldHRpbmdzLnNjb3Blcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgc2NvcGVzOiB2YWx1ZS50cmltKCkgfHwgREVGQVVMVF9TRVRUSU5HUy5zY29wZXMgfSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnTWVzc2FnZSB0ZW1wbGF0ZScpXG4gICAgICAuc2V0RGVzYygnQ29udHJvbHMgaG93IHBhc3RlZCBTbGFjayBtZXNzYWdlIHBlcm1hbGlua3MgcmVuZGVyLicpXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoc2V0dGluZ3MubWVzc2FnZVRlbXBsYXRlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBtZXNzYWdlVGVtcGxhdGU6IHZhbHVlLnRyaW0oKSB8fCBERUZBVUxUX1NFVFRJTkdTLm1lc3NhZ2VUZW1wbGF0ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQcmVmZXJyZWQgbGluayB0YXJnZXQnKVxuICAgICAgLnNldERlc2MoJ0Nob29zZSBTbGFjayBhcHAgbGlua3Mgb3IgdGhlIHdlYi9hcHBfcmVkaXJlY3QgZmFsbGJhY2suJylcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbignYXBwJywgJ1NsYWNrIGFwcCcpXG4gICAgICAgICAgLmFkZE9wdGlvbignd2ViJywgJ1dlYiAvIGFwcF9yZWRpcmVjdCcpXG4gICAgICAgICAgLnNldFZhbHVlKHNldHRpbmdzLnRhcmdldClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyB0YXJnZXQ6IHZhbHVlID09PSAnd2ViJyA/ICd3ZWInIDogJ2FwcCcgfSk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdJZGxlIGRlbGF5JylcbiAgICAgIC5zZXREZXNjKCdIb3cgbG9uZyB0aGUgcGx1Z2luIHdhaXRzIGFmdGVyIHR5cGluZyBiZWZvcmUgc2Nhbm5pbmcgdGhlIG5vdGUuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyhzZXR0aW5ncy5pZGxlRGVsYXlNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4ocGFyc2VkKSB8fCBwYXJzZWQgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgaWRsZURlbGF5TXM6IHBhcnNlZCB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdSZWZyZXNoIGxlZXdheScpXG4gICAgICAuc2V0RGVzYygnSG93IGVhcmx5IHRoZSBwbHVnaW4gcmVmcmVzaGVzIGFuIGV4cGlyaW5nIFNsYWNrIHNlc3Npb24uJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyhzZXR0aW5ncy5yZWZyZXNoTGVld2F5TXMpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKHBhcnNlZCkgfHwgcGFyc2VkIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IHJlZnJlc2hMZWV3YXlNczogcGFyc2VkIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0F1dG8tbGluayBjaGFubmVscycpXG4gICAgICAuc2V0RGVzYygnUmVzb2x2ZSAjY2hhbm5lbCByZWZlcmVuY2VzIGFmdGVyIHRoZSBpZGxlIGRlbGF5LicpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShzZXR0aW5ncy5lbmFibGVDaGFubmVscykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgZW5hYmxlQ2hhbm5lbHM6IHZhbHVlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0F1dG8tbGluayBETSBzZW50aW5lbHMnKVxuICAgICAgLnNldERlc2MoJ1Jlc29sdmUgZXhwbGljaXQgZG06QG5hbWUgb3IgZG06ZW1haWwgcmVmZXJlbmNlcy4nKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUoc2V0dGluZ3MuZW5hYmxlRG1TZW50aW5lbHMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IGVuYWJsZURtU2VudGluZWxzOiB2YWx1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdBdXRvLWxpbmsgcGFzdGVkIHBlcm1hbGlua3MnKVxuICAgICAgLnNldERlc2MoJ0NvbnZlcnQgcGFzdGVkIFNsYWNrIG1lc3NhZ2UgcGVybWFsaW5rcyBpbnRvIHNtYXJ0IE1hcmtkb3duIGxpbmtzLicpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShzZXR0aW5ncy5lbmFibGVQZXJtYWxpbmtzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBlbmFibGVQZXJtYWxpbmtzOiB2YWx1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdUZXN0IFNsYWNrIGNvbm5lY3Rpb24nKVxuICAgICAgLnNldERlc2MoJ0NoZWNrIHdoZXRoZXIgYSBsb2NhbCBTbGFjayBzZXNzaW9uIGlzIGNvbmZpZ3VyZWQuJylcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1Rlc3QnKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zaG93Q29ubmVjdGlvblN0YXR1cygpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRFcnJvck1lc3NhZ2UoZXJyb3I6IHVua25vd24pOiBzdHJpbmcge1xuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgU2xhY2tTZXNzaW9uIH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xhY2tBcGlGb3JtUmVxdWVzdCB7XG4gIGJvZHk6IFVSTFNlYXJjaFBhcmFtcztcbiAgcGF0aDogc3RyaW5nO1xuICB0b2tlbj86IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgU2xhY2tBcGlGb3JtUmVxdWVzdGVyID0gKHJlcXVlc3Q6IFNsYWNrQXBpRm9ybVJlcXVlc3QpID0+IFByb21pc2U8YW55PjtcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2xhY2tBdXRob3JpemVVcmwoaW5wdXQ6IHtcbiAgY2xpZW50SWQ6IHN0cmluZztcbiAgY29kZUNoYWxsZW5nZTogc3RyaW5nO1xuICByZWRpcmVjdFVyaTogc3RyaW5nO1xuICBzY29wZXM6IHN0cmluZztcbiAgc3RhdGU6IHN0cmluZztcbiAgdGVhbUlkPzogc3RyaW5nO1xufSk6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoJ2h0dHBzOi8vc2xhY2suY29tL29hdXRoL3YyL2F1dGhvcml6ZScpO1xuXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdjbGllbnRfaWQnLCBpbnB1dC5jbGllbnRJZCk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdjb2RlX2NoYWxsZW5nZScsIGlucHV0LmNvZGVDaGFsbGVuZ2UpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnY29kZV9jaGFsbGVuZ2VfbWV0aG9kJywgJ1MyNTYnKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlZGlyZWN0X3VyaScsIGlucHV0LnJlZGlyZWN0VXJpKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3Jlc3BvbnNlX3R5cGUnLCAnY29kZScpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnc3RhdGUnLCBpbnB1dC5zdGF0ZSk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd1c2VyX3Njb3BlJywgaW5wdXQuc2NvcGVzKTtcblxuICBpZiAoaW5wdXQudGVhbUlkKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3RlYW0nLCBpbnB1dC50ZWFtSWQpO1xuICB9XG5cbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29tcGxldGVTbGFja0F1dGgoXG4gIHJlcXVlc3RlcjogU2xhY2tBcGlGb3JtUmVxdWVzdGVyLFxuICBpbnB1dDoge1xuICAgIGNsaWVudElkOiBzdHJpbmc7XG4gICAgY29kZTogc3RyaW5nO1xuICAgIGNvZGVWZXJpZmllcjogc3RyaW5nO1xuICAgIG5vdz86IG51bWJlcjtcbiAgICByZWRpcmVjdFVyaTogc3RyaW5nO1xuICB9XG4pOiBQcm9taXNlPFNsYWNrU2Vzc2lvbj4ge1xuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdGVyKHtcbiAgICBib2R5OiBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGNsaWVudF9pZDogaW5wdXQuY2xpZW50SWQsXG4gICAgICBjb2RlOiBpbnB1dC5jb2RlLFxuICAgICAgY29kZV92ZXJpZmllcjogaW5wdXQuY29kZVZlcmlmaWVyLFxuICAgICAgZ3JhbnRfdHlwZTogJ2F1dGhvcml6YXRpb25fY29kZScsXG4gICAgICByZWRpcmVjdF91cmk6IGlucHV0LnJlZGlyZWN0VXJpLFxuICAgIH0pLFxuICAgIHBhdGg6ICdvYXV0aC52Mi5hY2Nlc3MnLFxuICB9KTtcbiAgY29uc3QgYmFzZVNlc3Npb24gPSBtYXBTbGFja1Rva2VuUmVzcG9uc2UodG9rZW5SZXNwb25zZSwgaW5wdXQubm93KTtcbiAgY29uc3QgaWRlbnRpdHkgPSBhd2FpdCByZXF1ZXN0ZXIoe1xuICAgIGJvZHk6IG5ldyBVUkxTZWFyY2hQYXJhbXMoKSxcbiAgICBwYXRoOiAnYXV0aC50ZXN0JyxcbiAgICB0b2tlbjogYmFzZVNlc3Npb24uYWNjZXNzVG9rZW4sXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgLi4uYmFzZVNlc3Npb24sXG4gICAgdGVhbUlkOiBpZGVudGl0eS50ZWFtX2lkID8/IGJhc2VTZXNzaW9uLnRlYW1JZCxcbiAgICB3b3Jrc3BhY2U6IHBhcnNlV29ya3NwYWNlU2x1ZyhpZGVudGl0eS51cmwpID8/IGJhc2VTZXNzaW9uLndvcmtzcGFjZSxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVBrY2VQYWlyKFxuICByYW5kb21Tb3VyY2U6ICgpID0+IFVpbnQ4QXJyYXkgPSAoKSA9PiBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKG5ldyBVaW50OEFycmF5KDMyKSlcbik6IFByb21pc2U8eyBjb2RlQ2hhbGxlbmdlOiBzdHJpbmc7IGNvZGVWZXJpZmllcjogc3RyaW5nIH0+IHtcbiAgY29uc3QgY29kZVZlcmlmaWVyID0gdG9CYXNlNjRVcmwocmFuZG9tU291cmNlKCkpO1xuICBjb25zdCBkaWdlc3QgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgnU0hBLTI1NicsIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShjb2RlVmVyaWZpZXIpKTtcblxuICByZXR1cm4ge1xuICAgIGNvZGVDaGFsbGVuZ2U6IHRvQmFzZTY0VXJsKG5ldyBVaW50OEFycmF5KGRpZ2VzdCkpLFxuICAgIGNvZGVWZXJpZmllcixcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hTbGFja1Nlc3Npb24oXG4gIHJlcXVlc3RlcjogU2xhY2tBcGlGb3JtUmVxdWVzdGVyLFxuICBpbnB1dDoge1xuICAgIGNsaWVudElkOiBzdHJpbmc7XG4gICAgbm93PzogbnVtYmVyO1xuICAgIHNlc3Npb246IFNsYWNrU2Vzc2lvbjtcbiAgfVxuKTogUHJvbWlzZTxTbGFja1Nlc3Npb24+IHtcbiAgaWYgKCFpbnB1dC5zZXNzaW9uLnJlZnJlc2hUb2tlbikge1xuICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyBTbGFjayByZWZyZXNoIHRva2VuJyk7XG4gIH1cblxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdGVyKHtcbiAgICBib2R5OiBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGNsaWVudF9pZDogaW5wdXQuY2xpZW50SWQsXG4gICAgICBncmFudF90eXBlOiAncmVmcmVzaF90b2tlbicsXG4gICAgICByZWZyZXNoX3Rva2VuOiBpbnB1dC5zZXNzaW9uLnJlZnJlc2hUb2tlbixcbiAgICB9KSxcbiAgICBwYXRoOiAnb2F1dGgudjIuYWNjZXNzJyxcbiAgfSk7XG4gIGNvbnN0IHJlZnJlc2hlZCA9IG1hcFNsYWNrVG9rZW5SZXNwb25zZSh0b2tlblJlc3BvbnNlLCBpbnB1dC5ub3cpO1xuXG4gIHJldHVybiB7XG4gICAgLi4ucmVmcmVzaGVkLFxuICAgIHRlYW1JZDogcmVmcmVzaGVkLnRlYW1JZCB8fCBpbnB1dC5zZXNzaW9uLnRlYW1JZCxcbiAgICB3b3Jrc3BhY2U6IHJlZnJlc2hlZC53b3Jrc3BhY2UgfHwgaW5wdXQuc2Vzc2lvbi53b3Jrc3BhY2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcFNsYWNrVG9rZW5SZXNwb25zZShwYXlsb2FkOiBhbnksIG5vdyA9IERhdGUubm93KCkpOiBTbGFja1Nlc3Npb24ge1xuICBjb25zdCBhdXRoZWRVc2VyID0gcGF5bG9hZC5hdXRoZWRfdXNlciA/PyB7fTtcblxuICByZXR1cm4ge1xuICAgIGFjY2Vzc1Rva2VuOiBhdXRoZWRVc2VyLmFjY2Vzc190b2tlbiA/PyAnJyxcbiAgICBleHBpcmVzQXQ6IGF1dGhlZFVzZXIuZXhwaXJlc19pbiA/IG5vdyArIGF1dGhlZFVzZXIuZXhwaXJlc19pbiAqIDEwMDAgOiAwLFxuICAgIHJlZnJlc2hUb2tlbjogYXV0aGVkVXNlci5yZWZyZXNoX3Rva2VuID8/ICcnLFxuICAgIHRlYW1JZDogcGF5bG9hZC50ZWFtPy5pZCA/PyAnJyxcbiAgICB3b3Jrc3BhY2U6IHBhcnNlV29ya3NwYWNlU2x1ZyhwYXlsb2FkLnVybCkgPz8gJycsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlV29ya3NwYWNlU2x1Zyh1cmw6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXVybCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gbmV3IFVSTCh1cmwpLmhvc3RuYW1lLnNwbGl0KCcuJylbMF0gPz8gbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9CYXNlNjRVcmwoaW5wdXQ6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICByZXR1cm4gQnVmZmVyLmZyb20oaW5wdXQpXG4gICAgLnRvU3RyaW5nKCdiYXNlNjQnKVxuICAgIC5yZXBsYWNlKC9cXCsvZywgJy0nKVxuICAgIC5yZXBsYWNlKC9cXC8vZywgJ18nKVxuICAgIC5yZXBsYWNlKC89KyQvZywgJycpO1xufVxuIiwgImV4cG9ydCBjbGFzcyBUdGxDYWNoZTxUPiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgZW50cmllcyA9IG5ldyBNYXA8c3RyaW5nLCB7IGV4cGlyZXNBdDogbnVtYmVyOyB2YWx1ZTogVCB9PigpO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdHRsTXM6IG51bWJlcikge31cblxuICBnZXQoa2V5OiBzdHJpbmcpOiBUIHwgbnVsbCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KGtleSk7XG5cbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuZXhwaXJlc0F0IDw9IERhdGUubm93KCkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUoa2V5KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiBlbnRyeS52YWx1ZTtcbiAgfVxuXG4gIHNldChrZXk6IHN0cmluZywgdmFsdWU6IFQpOiB2b2lkIHtcbiAgICB0aGlzLmVudHJpZXMuc2V0KGtleSwge1xuICAgICAgZXhwaXJlc0F0OiBEYXRlLm5vdygpICsgdGhpcy50dGxNcyxcbiAgICAgIHZhbHVlLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDYW5kaWRhdGVLaW5kLCBDYW5kaWRhdGVNYXRjaCB9IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBETV9TRU5USU5FTF9QQVRURVJOID0gL1xcYmRtOihbQFxcdy4rLV0rKS9nO1xuY29uc3QgQ0hBTk5FTF9SRUZfUEFUVEVSTiA9IC8oXnxbXFxzKF0pIyhbYS16MC05Ll8tXSspL2dpO1xuY29uc3QgTUVTU0FHRV9MSU5LX1BBVFRFUk4gPSAvaHR0cHM6XFwvXFwvW2EtejAtOS1dK1xcLnNsYWNrXFwuY29tXFwvYXJjaGl2ZXNcXC9bQS1aMC05XStcXC9wXFxkezE2fS9naTtcbmNvbnN0IE1BUktET1dOX0xJTktfUEFUVEVSTiA9IC9cXFtbXlxcXV0qXVxcKFteKV0rXFwpL2c7XG5jb25zdCBXSUtJTElOS19QQVRURVJOID0gL1xcW1xcW1teW1xcXV0rXV0vZztcblxuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdENhbmRpZGF0ZXMoXG4gIHRleHQ6IHN0cmluZyxcbiAgaW5wdXQ6IHtcbiAgICBjdXJzb3JPZmZzZXQ6IG51bWJlcjtcbiAgfVxuKTogQ2FuZGlkYXRlTWF0Y2hbXSB7XG4gIGNvbnN0IGV4Y2x1ZGVkUmFuZ2VzID0gZ2V0RXhjbHVkZWRSYW5nZXModGV4dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZXM6IENhbmRpZGF0ZU1hdGNoW10gPSBbXTtcblxuICBhZGRNYXRjaGVzKGNhbmRpZGF0ZXMsIHRleHQsIE1FU1NBR0VfTElOS19QQVRURVJOLCAnbWVzc2FnZS1wZXJtYWxpbmsnLCBleGNsdWRlZFJhbmdlcywgaW5wdXQuY3Vyc29yT2Zmc2V0KTtcbiAgYWRkTWF0Y2hlcyhjYW5kaWRhdGVzLCB0ZXh0LCBETV9TRU5USU5FTF9QQVRURVJOLCAnZG0tc2VudGluZWwnLCBleGNsdWRlZFJhbmdlcywgaW5wdXQuY3Vyc29yT2Zmc2V0KTtcblxuICBmb3IgKGNvbnN0IG1hdGNoIG9mIHRleHQubWF0Y2hBbGwoQ0hBTk5FTF9SRUZfUEFUVEVSTikpIHtcbiAgICBjb25zdCBwcmVmaXggPSBtYXRjaFsxXSA/PyAnJztcbiAgICBjb25zdCB2YWx1ZSA9IGAjJHttYXRjaFsyXX1gO1xuICAgIGNvbnN0IHN0YXJ0ID0gKG1hdGNoLmluZGV4ID8/IDApICsgcHJlZml4Lmxlbmd0aDtcbiAgICBjb25zdCBlbmQgPSBzdGFydCArIHZhbHVlLmxlbmd0aDtcblxuICAgIGlmICghc2hvdWxkU2tpcENhbmRpZGF0ZShzdGFydCwgZW5kLCBleGNsdWRlZFJhbmdlcywgaW5wdXQuY3Vyc29yT2Zmc2V0KSkge1xuICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgZW5kLCBraW5kOiAnY2hhbm5lbC1yZWYnLCBzdGFydCwgdmFsdWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNhbmRpZGF0ZXMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc3RhcnQgLSByaWdodC5zdGFydCk7XG59XG5cbmZ1bmN0aW9uIGFkZE1hdGNoZXMoXG4gIGNhbmRpZGF0ZXM6IENhbmRpZGF0ZU1hdGNoW10sXG4gIHRleHQ6IHN0cmluZyxcbiAgcGF0dGVybjogUmVnRXhwLFxuICBraW5kOiBDYW5kaWRhdGVLaW5kLFxuICBleGNsdWRlZFJhbmdlczogQXJyYXk8eyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9PixcbiAgY3Vyc29yT2Zmc2V0OiBudW1iZXJcbik6IHZvaWQge1xuICBmb3IgKGNvbnN0IG1hdGNoIG9mIHRleHQubWF0Y2hBbGwocGF0dGVybikpIHtcbiAgICBjb25zdCB2YWx1ZSA9IG1hdGNoWzBdO1xuICAgIGNvbnN0IHN0YXJ0ID0gbWF0Y2guaW5kZXggPz8gMDtcbiAgICBjb25zdCBlbmQgPSBzdGFydCArIHZhbHVlLmxlbmd0aDtcblxuICAgIGlmICghc2hvdWxkU2tpcENhbmRpZGF0ZShzdGFydCwgZW5kLCBleGNsdWRlZFJhbmdlcywgY3Vyc29yT2Zmc2V0KSkge1xuICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgZW5kLCBraW5kLCBzdGFydCwgdmFsdWUgfSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGdldEV4Y2x1ZGVkUmFuZ2VzKHRleHQ6IHN0cmluZyk6IEFycmF5PHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfT4ge1xuICBjb25zdCByYW5nZXMgPSBjb2xsZWN0UmFuZ2VzKHRleHQsIE1BUktET1dOX0xJTktfUEFUVEVSTik7XG5cbiAgZm9yIChjb25zdCByYW5nZSBvZiBjb2xsZWN0UmFuZ2VzKHRleHQsIFdJS0lMSU5LX1BBVFRFUk4pKSB7XG4gICAgcmFuZ2VzLnB1c2gocmFuZ2UpO1xuICB9XG5cbiAgY29uc3QgZnJvbnRtYXR0ZXJSYW5nZSA9IGdldEZyb250bWF0dGVyUmFuZ2UodGV4dCk7XG5cbiAgaWYgKGZyb250bWF0dGVyUmFuZ2UpIHtcbiAgICByYW5nZXMucHVzaChmcm9udG1hdHRlclJhbmdlKTtcbiAgfVxuXG4gIHJldHVybiByYW5nZXM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RSYW5nZXModGV4dDogc3RyaW5nLCBwYXR0ZXJuOiBSZWdFeHApOiBBcnJheTx7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0+IHtcbiAgY29uc3QgcmFuZ2VzOiBBcnJheTx7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0+ID0gW107XG5cbiAgZm9yIChjb25zdCBtYXRjaCBvZiB0ZXh0Lm1hdGNoQWxsKHBhdHRlcm4pKSB7XG4gICAgY29uc3Qgc3RhcnQgPSBtYXRjaC5pbmRleCA/PyAwO1xuICAgIHJhbmdlcy5wdXNoKHsgZW5kOiBzdGFydCArIG1hdGNoWzBdLmxlbmd0aCwgc3RhcnQgfSk7XG4gIH1cblxuICByZXR1cm4gcmFuZ2VzO1xufVxuXG5mdW5jdGlvbiBnZXRGcm9udG1hdHRlclJhbmdlKHRleHQ6IHN0cmluZyk6IHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfSB8IG51bGwge1xuICBpZiAoIXRleHQuc3RhcnRzV2l0aCgnLS0tXFxuJykpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGNsb3NpbmdJbmRleCA9IHRleHQuaW5kZXhPZignXFxuLS0tXFxuJywgNCk7XG5cbiAgaWYgKGNsb3NpbmdJbmRleCA9PT0gLTEpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7IGVuZDogY2xvc2luZ0luZGV4ICsgNSwgc3RhcnQ6IDAgfTtcbn1cblxuZnVuY3Rpb24gc2hvdWxkU2tpcENhbmRpZGF0ZShcbiAgc3RhcnQ6IG51bWJlcixcbiAgZW5kOiBudW1iZXIsXG4gIGV4Y2x1ZGVkUmFuZ2VzOiBBcnJheTx7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0+LFxuICBjdXJzb3JPZmZzZXQ6IG51bWJlclxuKTogYm9vbGVhbiB7XG4gIGlmIChjdXJzb3JPZmZzZXQgPj0gc3RhcnQgJiYgY3Vyc29yT2Zmc2V0IDw9IGVuZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGV4Y2x1ZGVkUmFuZ2VzLnNvbWUoKHJhbmdlKSA9PiBzdGFydCA8IHJhbmdlLmVuZCAmJiBlbmQgPiByYW5nZS5zdGFydCk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBMaW5rVGFyZ2V0UHJlZmVyZW5jZSwgUmVuZGVyVmFsdWVzIH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJTbWFydExpbmsodGVtcGxhdGU6IHN0cmluZywgdmFsdWVzOiBSZW5kZXJWYWx1ZXMpOiBzdHJpbmcge1xuICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFx7KFxcdyspXFx9L2csIChfbWF0Y2gsIHRva2VuOiBrZXlvZiBSZW5kZXJWYWx1ZXMpID0+IHZhbHVlc1t0b2tlbl0gPz8gJycpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUYXJnZXRVcmwoaW5wdXQ6IHtcbiAgY2hhbm5lbElkOiBzdHJpbmc7XG4gIHRhcmdldDogTGlua1RhcmdldFByZWZlcmVuY2U7XG4gIHRlYW1JZDogc3RyaW5nO1xufSk6IHN0cmluZyB7XG4gIGlmIChpbnB1dC50YXJnZXQgPT09ICdhcHAnKSB7XG4gICAgcmV0dXJuIGBzbGFjazovL2NoYW5uZWw/dGVhbT0ke2lucHV0LnRlYW1JZH0maWQ9JHtpbnB1dC5jaGFubmVsSWR9YDtcbiAgfVxuXG4gIHJldHVybiBgaHR0cHM6Ly9zbGFjay5jb20vYXBwX3JlZGlyZWN0P3RlYW09JHtpbnB1dC50ZWFtSWR9JmNoYW5uZWw9JHtpbnB1dC5jaGFubmVsSWR9YDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFJlbmRlclZhbHVlcywgVGV4dFJlcGxhY2VtZW50IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBkZXRlY3RDYW5kaWRhdGVzIH0gZnJvbSAnLi9kZXRlY3Rvcic7XG5pbXBvcnQgeyBidWlsZFRhcmdldFVybCwgcmVuZGVyU21hcnRMaW5rIH0gZnJvbSAnLi9yZW5kZXJlcic7XG5cbmludGVyZmFjZSBFbmdpbmVSZXNvbHZlciB7XG4gIHJlc29sdmVDaGFubmVsUmVmKHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHsgY2hhbm5lbElkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdGVhbUlkOiBzdHJpbmcgfSB8IG51bGw+O1xuICByZXNvbHZlRG1TZW50aW5lbCh2YWx1ZTogc3RyaW5nKTogUHJvbWlzZTx7IGRpc3BsYXlOYW1lOiBzdHJpbmc7IHRlYW1JZDogc3RyaW5nOyB1c2VySWQ6IHN0cmluZyB9IHwgbnVsbD47XG4gIHJlc29sdmVQZXJtYWxpbmsodmFsdWU6IHN0cmluZyk6IFByb21pc2U8UmVuZGVyVmFsdWVzPjtcbn1cblxuaW50ZXJmYWNlIEVuZ2luZVNldHRpbmdzIHtcbiAgZW5hYmxlQ2hhbm5lbHM6IGJvb2xlYW47XG4gIGVuYWJsZURtU2VudGluZWxzOiBib29sZWFuO1xuICBlbmFibGVQZXJtYWxpbmtzOiBib29sZWFuO1xuICBtZXNzYWdlVGVtcGxhdGU6IHN0cmluZztcbiAgdGFyZ2V0OiAnYXBwJyB8ICd3ZWInO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGxhblNsYWNrTGlua1JlcGxhY2VtZW50cyhcbiAgdGV4dDogc3RyaW5nLFxuICBpbnB1dDoge1xuICAgIGN1cnNvck9mZnNldDogbnVtYmVyO1xuICAgIHJlc29sdmVyOiBFbmdpbmVSZXNvbHZlcjtcbiAgICBzZXR0aW5nczogRW5naW5lU2V0dGluZ3M7XG4gIH1cbik6IFByb21pc2U8VGV4dFJlcGxhY2VtZW50W10+IHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IGRldGVjdENhbmRpZGF0ZXModGV4dCwgeyBjdXJzb3JPZmZzZXQ6IGlucHV0LmN1cnNvck9mZnNldCB9KTtcbiAgY29uc3QgcmVwbGFjZW1lbnRzOiBUZXh0UmVwbGFjZW1lbnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdtZXNzYWdlLXBlcm1hbGluaycgJiYgaW5wdXQuc2V0dGluZ3MuZW5hYmxlUGVybWFsaW5rcykge1xuICAgICAgY29uc3QgdmFsdWVzID0gYXdhaXQgaW5wdXQucmVzb2x2ZXIucmVzb2x2ZVBlcm1hbGluayhjYW5kaWRhdGUudmFsdWUpO1xuICAgICAgcmVwbGFjZW1lbnRzLnB1c2goe1xuICAgICAgICBlbmQ6IGNhbmRpZGF0ZS5lbmQsXG4gICAgICAgIHN0YXJ0OiBjYW5kaWRhdGUuc3RhcnQsXG4gICAgICAgIHRleHQ6IHJlbmRlclNtYXJ0TGluayhpbnB1dC5zZXR0aW5ncy5tZXNzYWdlVGVtcGxhdGUsIHtcbiAgICAgICAgICAuLi52YWx1ZXMsXG4gICAgICAgICAgdXJsOiB2YWx1ZXMudXJsID8/IGNhbmRpZGF0ZS52YWx1ZSxcbiAgICAgICAgfSksXG4gICAgICB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2NoYW5uZWwtcmVmJyAmJiBpbnB1dC5zZXR0aW5ncy5lbmFibGVDaGFubmVscykge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCBpbnB1dC5yZXNvbHZlci5yZXNvbHZlQ2hhbm5lbFJlZihjYW5kaWRhdGUudmFsdWUpO1xuXG4gICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgcmVwbGFjZW1lbnRzLnB1c2goe1xuICAgICAgICAgIGVuZDogY2FuZGlkYXRlLmVuZCxcbiAgICAgICAgICBzdGFydDogY2FuZGlkYXRlLnN0YXJ0LFxuICAgICAgICAgIHRleHQ6IGBbIyR7cmVzb2x2ZWQubmFtZX1dKCR7YnVpbGRUYXJnZXRVcmwoe1xuICAgICAgICAgICAgY2hhbm5lbElkOiByZXNvbHZlZC5jaGFubmVsSWQsXG4gICAgICAgICAgICB0YXJnZXQ6IGlucHV0LnNldHRpbmdzLnRhcmdldCxcbiAgICAgICAgICAgIHRlYW1JZDogcmVzb2x2ZWQudGVhbUlkLFxuICAgICAgICAgIH0pfSlgLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZG0tc2VudGluZWwnICYmIGlucHV0LnNldHRpbmdzLmVuYWJsZURtU2VudGluZWxzKSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IGlucHV0LnJlc29sdmVyLnJlc29sdmVEbVNlbnRpbmVsKGNhbmRpZGF0ZS52YWx1ZSk7XG5cbiAgICAgIGlmIChyZXNvbHZlZCkge1xuICAgICAgICByZXBsYWNlbWVudHMucHVzaCh7XG4gICAgICAgICAgZW5kOiBjYW5kaWRhdGUuZW5kLFxuICAgICAgICAgIHN0YXJ0OiBjYW5kaWRhdGUuc3RhcnQsXG4gICAgICAgICAgdGV4dDogYFtETSAke3Jlc29sdmVkLmRpc3BsYXlOYW1lfV0oJHtidWlsZFVzZXJUYXJnZXRVcmwocmVzb2x2ZWQudGVhbUlkLCByZXNvbHZlZC51c2VySWQpfSlgLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVwbGFjZW1lbnRzO1xufVxuXG5mdW5jdGlvbiBidWlsZFVzZXJUYXJnZXRVcmwodGVhbUlkOiBzdHJpbmcsIHVzZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBzbGFjazovL3VzZXI/dGVhbT0ke3RlYW1JZH0maWQ9JHt1c2VySWR9YDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFBhcnNlZFNsYWNrUGVybWFsaW5rIH0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IFNMQUNLX1BFUk1BTElOS19QQVRURVJOID0gL15cXC9hcmNoaXZlc1xcLyhbXi9dKylcXC9wKFxcZHsxNn0pJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNsYWNrUGVybWFsaW5rKHVybDogc3RyaW5nKTogUGFyc2VkU2xhY2tQZXJtYWxpbmsgfCBudWxsIHtcbiAgbGV0IHBhcnNlZFVybDogVVJMO1xuXG4gIHRyeSB7XG4gICAgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoID0gcGFyc2VkVXJsLnBhdGhuYW1lLm1hdGNoKFNMQUNLX1BFUk1BTElOS19QQVRURVJOKTtcblxuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBbLCBjaGFubmVsSWQsIHBhY2tlZFRpbWVzdGFtcF0gPSBtYXRjaDtcblxuICByZXR1cm4ge1xuICAgIGNoYW5uZWxJZCxcbiAgICB0czogYCR7cGFja2VkVGltZXN0YW1wLnNsaWNlKDAsIDEwKX0uJHtwYWNrZWRUaW1lc3RhbXAuc2xpY2UoMTApfWAsXG4gICAgdXJsLFxuICAgIHdvcmtzcGFjZTogcGFyc2VkVXJsLmhvc3RuYW1lLnNwbGl0KCcuJylbMF0sXG4gIH07XG59XG4iLCAiaW1wb3J0IHsgcGFyc2VTbGFja1Blcm1hbGluayB9IGZyb20gJy4vcGVybWFsaW5rJztcbmltcG9ydCB0eXBlIHsgU2xhY2tTZXJ2aWNlIH0gZnJvbSAnLi9zZXJ2aWNlJztcbmltcG9ydCB0eXBlIHsgUmVuZGVyVmFsdWVzLCBTbGFja0NoYW5uZWwsIFNsYWNrU2Vzc2lvbiwgU2xhY2tVc2VyIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBUdGxDYWNoZSB9IGZyb20gJy4vY2FjaGUnO1xuXG5pbnRlcmZhY2UgUmVzb2x2ZXJEZXBlbmRlbmNpZXMge1xuICBjaGFubmVsQ2FjaGU6IFR0bENhY2hlPFNsYWNrQ2hhbm5lbD47XG4gIGZhaWxlZExvb2t1cENhY2hlOiBUdGxDYWNoZTxib29sZWFuPjtcbiAgc2VydmljZTogU2xhY2tTZXJ2aWNlO1xuICBzZXNzaW9uOiBTbGFja1Nlc3Npb247XG4gIHVzZXJDYWNoZTogVHRsQ2FjaGU8U2xhY2tVc2VyPjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlc29sdmVyKGRlcHM6IFJlc29sdmVyRGVwZW5kZW5jaWVzKSB7XG4gIHJldHVybiB7XG4gICAgcmVzb2x2ZUNoYW5uZWxSZWY6IGFzeW5jICh2YWx1ZTogc3RyaW5nKSA9PiByZXNvbHZlQ2hhbm5lbFJlZihkZXBzLCB2YWx1ZSksXG4gICAgcmVzb2x2ZURtU2VudGluZWw6IGFzeW5jICh2YWx1ZTogc3RyaW5nKSA9PiByZXNvbHZlRG1TZW50aW5lbChkZXBzLCB2YWx1ZSksXG4gICAgcmVzb2x2ZVBlcm1hbGluazogYXN5bmMgKHVybDogc3RyaW5nKSA9PiByZXNvbHZlUGVybWFsaW5rKGRlcHMsIHVybCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQZXJtYWxpbmsoZGVwczogUmVzb2x2ZXJEZXBlbmRlbmNpZXMsIHVybDogc3RyaW5nKTogUHJvbWlzZTxSZW5kZXJWYWx1ZXM+IHtcbiAgY29uc3QgcGFyc2VkID0gcGFyc2VTbGFja1Blcm1hbGluayh1cmwpO1xuXG4gIGlmICghcGFyc2VkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbnN1cHBvcnRlZCBTbGFjayBwZXJtYWxpbmsnKTtcbiAgfVxuXG4gIGNvbnN0IGZhbGxiYWNrOiBSZW5kZXJWYWx1ZXMgPSB7XG4gICAgY2hhbm5lbF9pZDogcGFyc2VkLmNoYW5uZWxJZCxcbiAgICB0czogcGFyc2VkLnRzLFxuICAgIHVybDogcGFyc2VkLnVybCxcbiAgICB3b3Jrc3BhY2U6IHBhcnNlZC53b3Jrc3BhY2UsXG4gIH07XG5cbiAgaWYgKGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuZ2V0KHBhcnNlZC51cmwpKSB7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBtZXNzYWdlID0gYXdhaXQgZGVwcy5zZXJ2aWNlLmdldE1lc3NhZ2UocGFyc2VkLnVybCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uZmFsbGJhY2ssXG4gICAgICBhdXRob3I6IG1lc3NhZ2UuYXV0aG9yTmFtZSxcbiAgICAgIGF1dGhvcl9pZDogbWVzc2FnZS5hdXRob3JJZCxcbiAgICAgIGNoYW5uZWw6IG1lc3NhZ2UuY2hhbm5lbE5hbWUsXG4gICAgICB0ZXh0OiBtZXNzYWdlLnRleHQsXG4gICAgfTtcbiAgfSBjYXRjaCB7XG4gICAgZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5zZXQocGFyc2VkLnVybCwgdHJ1ZSk7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVDaGFubmVsUmVmKFxuICBkZXBzOiBSZXNvbHZlckRlcGVuZGVuY2llcyxcbiAgdmFsdWU6IHN0cmluZ1xuKTogUHJvbWlzZTx7IGNoYW5uZWxJZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHRlYW1JZDogc3RyaW5nIH0gfCBudWxsPiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWx1ZS5yZXBsYWNlKC9eIy8sICcnKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBjYWNoZWQgPSBkZXBzLmNoYW5uZWxDYWNoZS5nZXQobm9ybWFsaXplZCk7XG5cbiAgaWYgKGNhY2hlZCkge1xuICAgIHJldHVybiB7IGNoYW5uZWxJZDogY2FjaGVkLmlkLCBuYW1lOiBjYWNoZWQubmFtZSwgdGVhbUlkOiBkZXBzLnNlc3Npb24udGVhbUlkIH07XG4gIH1cblxuICBpZiAoZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5nZXQoYGNoYW5uZWw6JHtub3JtYWxpemVkfWApKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNoYW5uZWwgPSBhd2FpdCBkZXBzLnNlcnZpY2UuZ2V0Q2hhbm5lbEJ5TmFtZShub3JtYWxpemVkKTtcblxuICAgIGlmICghY2hhbm5lbCkge1xuICAgICAgZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5zZXQoYGNoYW5uZWw6JHtub3JtYWxpemVkfWAsIHRydWUpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZGVwcy5jaGFubmVsQ2FjaGUuc2V0KG5vcm1hbGl6ZWQsIGNoYW5uZWwpO1xuXG4gICAgcmV0dXJuIHsgY2hhbm5lbElkOiBjaGFubmVsLmlkLCBuYW1lOiBjaGFubmVsLm5hbWUsIHRlYW1JZDogZGVwcy5zZXNzaW9uLnRlYW1JZCB9O1xuICB9IGNhdGNoIHtcbiAgICBkZXBzLmZhaWxlZExvb2t1cENhY2hlLnNldChgY2hhbm5lbDoke25vcm1hbGl6ZWR9YCwgdHJ1ZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZURtU2VudGluZWwoXG4gIGRlcHM6IFJlc29sdmVyRGVwZW5kZW5jaWVzLFxuICB2YWx1ZTogc3RyaW5nXG4pOiBQcm9taXNlPHsgZGlzcGxheU5hbWU6IHN0cmluZzsgdGVhbUlkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nIH0gfCBudWxsPiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWx1ZS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBjYWNoZWQgPSBkZXBzLnVzZXJDYWNoZS5nZXQobm9ybWFsaXplZCk7XG5cbiAgaWYgKGNhY2hlZCkge1xuICAgIHJldHVybiB7IGRpc3BsYXlOYW1lOiBjYWNoZWQuZGlzcGxheU5hbWUsIHRlYW1JZDogZGVwcy5zZXNzaW9uLnRlYW1JZCwgdXNlcklkOiBjYWNoZWQuaWQgfTtcbiAgfVxuXG4gIGlmIChkZXBzLmZhaWxlZExvb2t1cENhY2hlLmdldChgdXNlcjoke25vcm1hbGl6ZWR9YCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgdXNlciA9IGF3YWl0IGRlcHMuc2VydmljZS5nZXRVc2VyQnlEbVNlbnRpbmVsKHZhbHVlKTtcblxuICAgIGlmICghdXNlcikge1xuICAgICAgZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5zZXQoYHVzZXI6JHtub3JtYWxpemVkfWAsIHRydWUpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZGVwcy51c2VyQ2FjaGUuc2V0KG5vcm1hbGl6ZWQsIHVzZXIpO1xuXG4gICAgcmV0dXJuIHsgZGlzcGxheU5hbWU6IHVzZXIuZGlzcGxheU5hbWUsIHRlYW1JZDogZGVwcy5zZXNzaW9uLnRlYW1JZCwgdXNlcklkOiB1c2VyLmlkIH07XG4gIH0gY2F0Y2gge1xuICAgIGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuc2V0KGB1c2VyOiR7bm9ybWFsaXplZH1gLCB0cnVlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgVGV4dFJlcGxhY2VtZW50IH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBzb3J0UmVwbGFjZW1lbnRzQm90dG9tVXA8VCBleHRlbmRzIHsgc3RhcnQ6IG51bWJlciB9PihpdGVtczogVFtdKTogVFtdIHtcbiAgcmV0dXJuIFsuLi5pdGVtc10uc29ydCgobGVmdCwgcmlnaHQpID0+IHJpZ2h0LnN0YXJ0IC0gbGVmdC5zdGFydCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVJlcGxhY2VtZW50cyh0ZXh0OiBzdHJpbmcsIHJlcGxhY2VtZW50czogVGV4dFJlcGxhY2VtZW50W10pOiBzdHJpbmcge1xuICBsZXQgbmV4dFRleHQgPSB0ZXh0O1xuXG4gIGZvciAoY29uc3QgcmVwbGFjZW1lbnQgb2Ygc29ydFJlcGxhY2VtZW50c0JvdHRvbVVwKHJlcGxhY2VtZW50cykpIHtcbiAgICBuZXh0VGV4dCA9XG4gICAgICBuZXh0VGV4dC5zbGljZSgwLCByZXBsYWNlbWVudC5zdGFydCkgKyByZXBsYWNlbWVudC50ZXh0ICsgbmV4dFRleHQuc2xpY2UocmVwbGFjZW1lbnQuZW5kKTtcbiAgfVxuXG4gIHJldHVybiBuZXh0VGV4dDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNsYWNrU2Vzc2lvbiB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNlc3Npb25DaXBoZXIge1xuICBkZWNyeXB0KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmc7XG4gIGVuY3J5cHQodmFsdWU6IHN0cmluZyk6IHN0cmluZztcbiAgaXNBdmFpbGFibGUoKTogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIEVsZWN0cm9uU2FmZVN0b3JhZ2Uge1xuICBkZWNyeXB0U3RyaW5nKHZhbHVlOiBCdWZmZXIpOiBzdHJpbmc7XG4gIGVuY3J5cHRTdHJpbmcodmFsdWU6IHN0cmluZyk6IEJ1ZmZlcjtcbiAgaXNFbmNyeXB0aW9uQXZhaWxhYmxlKCk6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFbGVjdHJvblNlc3Npb25DaXBoZXIoKTogU2Vzc2lvbkNpcGhlciB8IG51bGwge1xuICBjb25zdCBzYWZlU3RvcmFnZSA9IGdldEVsZWN0cm9uU2FmZVN0b3JhZ2UoKTtcblxuICBpZiAoIXNhZmVTdG9yYWdlKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRlY3J5cHQ6ICh2YWx1ZSkgPT4gc2FmZVN0b3JhZ2UuZGVjcnlwdFN0cmluZyhCdWZmZXIuZnJvbSh2YWx1ZSwgJ2Jhc2U2NCcpKSxcbiAgICBlbmNyeXB0OiAodmFsdWUpID0+IHNhZmVTdG9yYWdlLmVuY3J5cHRTdHJpbmcodmFsdWUpLnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICBpc0F2YWlsYWJsZTogKCkgPT4gc2FmZVN0b3JhZ2UuaXNFbmNyeXB0aW9uQXZhaWxhYmxlKCksXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVTZWN1cmVTZXNzaW9uKHZhbHVlOiBzdHJpbmcsIGNpcGhlcjogU2Vzc2lvbkNpcGhlcik6IFNsYWNrU2Vzc2lvbiB7XG4gIHJldHVybiBKU09OLnBhcnNlKGNpcGhlci5kZWNyeXB0KHZhbHVlKSkgYXMgU2xhY2tTZXNzaW9uO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZW5jb2RlU2VjdXJlU2Vzc2lvbihzZXNzaW9uOiBTbGFja1Nlc3Npb24sIGNpcGhlcjogU2Vzc2lvbkNpcGhlcik6IHN0cmluZyB7XG4gIGlmICghY2lwaGVyLmlzQXZhaWxhYmxlKCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlY3VyZSBzZXNzaW9uIHN0b3JhZ2UgaXMgdW5hdmFpbGFibGUnKTtcbiAgfVxuXG4gIHJldHVybiBjaXBoZXIuZW5jcnlwdChKU09OLnN0cmluZ2lmeShzZXNzaW9uKSk7XG59XG5cbmZ1bmN0aW9uIGdldEVsZWN0cm9uU2FmZVN0b3JhZ2UoKTogRWxlY3Ryb25TYWZlU3RvcmFnZSB8IG51bGwge1xuICBjb25zdCByZXF1aXJlRm4gPSAoZ2xvYmFsVGhpcyBhcyB7IHJlcXVpcmU/OiAoaWQ6IHN0cmluZykgPT4gdW5rbm93biB9KS5yZXF1aXJlO1xuXG4gIGlmICghcmVxdWlyZUZuKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBsZXQgZWxlY3Ryb246IHsgc2FmZVN0b3JhZ2U/OiBFbGVjdHJvblNhZmVTdG9yYWdlOyByZW1vdGU/OiB7IHNhZmVTdG9yYWdlPzogRWxlY3Ryb25TYWZlU3RvcmFnZSB9IH0gPSB7fTtcblxuICB0cnkge1xuICAgIGVsZWN0cm9uID0gcmVxdWlyZUZuKCdlbGVjdHJvbicpIGFzIHR5cGVvZiBlbGVjdHJvbjtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBpZiAoZWxlY3Ryb24ucmVtb3RlPy5zYWZlU3RvcmFnZSkge1xuICAgIHJldHVybiBlbGVjdHJvbi5yZW1vdGUuc2FmZVN0b3JhZ2U7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGVsZWN0cm9uUmVtb3RlID0gcmVxdWlyZUZuKCdAZWxlY3Ryb24vcmVtb3RlJykgYXMgeyBzYWZlU3RvcmFnZT86IEVsZWN0cm9uU2FmZVN0b3JhZ2UgfTtcbiAgICBpZiAoZWxlY3Ryb25SZW1vdGUuc2FmZVN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBlbGVjdHJvblJlbW90ZS5zYWZlU3RvcmFnZTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIEBlbGVjdHJvbi9yZW1vdGUgbm90IGF2YWlsYWJsZSBcdTIwMTQgZmFsbCB0aHJvdWdoLlxuICB9XG5cbiAgcmV0dXJuIGVsZWN0cm9uLnNhZmVTdG9yYWdlID8/IG51bGw7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTbGFja0NoYW5uZWwsIFNsYWNrTWVzc2FnZU1ldGFkYXRhLCBTbGFja1Nlc3Npb24sIFNsYWNrVXNlciB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNsYWNrU2VydmljZSB7XG4gIGdldENoYW5uZWxCeU5hbWUobmFtZTogc3RyaW5nKTogUHJvbWlzZTxTbGFja0NoYW5uZWwgfCBudWxsPjtcbiAgZ2V0TWVzc2FnZSh1cmw6IHN0cmluZyk6IFByb21pc2U8U2xhY2tNZXNzYWdlTWV0YWRhdGE+O1xuICBnZXRVc2VyQnlEbVNlbnRpbmVsKHNlbnRpbmVsOiBzdHJpbmcpOiBQcm9taXNlPFNsYWNrVXNlciB8IG51bGw+O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2xhY2tTZXJ2aWNlKFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoID0gZmV0Y2hcbik6IFNsYWNrU2VydmljZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0Q2hhbm5lbEJ5TmFtZTogYXN5bmMgKG5hbWU6IHN0cmluZykgPT4gZmluZENoYW5uZWxCeU5hbWUoc2Vzc2lvbiwgbmFtZSwgZmV0Y2hJbXBsKSxcbiAgICBnZXRNZXNzYWdlOiBhc3luYyAodXJsOiBzdHJpbmcpID0+IGdldE1lc3NhZ2VNZXRhZGF0YShzZXNzaW9uLCB1cmwsIGZldGNoSW1wbCksXG4gICAgZ2V0VXNlckJ5RG1TZW50aW5lbDogYXN5bmMgKHNlbnRpbmVsOiBzdHJpbmcpID0+IGZpbmRVc2VyQnlEbVNlbnRpbmVsKHNlc3Npb24sIHNlbnRpbmVsLCBmZXRjaEltcGwpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRNZXNzYWdlTWV0YWRhdGEoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgdXJsOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPFNsYWNrTWVzc2FnZU1ldGFkYXRhPiB7XG4gIGNvbnN0IHBlcm1hbGluayA9IG5ldyBVUkwodXJsKTtcbiAgY29uc3QgY2hhbm5lbElkID0gcGVybWFsaW5rLnBhdGhuYW1lLnNwbGl0KCcvJylbMl07XG4gIGNvbnN0IHBhY2tlZFRzID0gcGVybWFsaW5rLnBhdGhuYW1lLnNwbGl0KCcvJylbM10/LnNsaWNlKDEpO1xuXG4gIGlmICghY2hhbm5lbElkIHx8ICFwYWNrZWRUcykge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBTbGFjayBwZXJtYWxpbmsnKTtcbiAgfVxuXG4gIGNvbnN0IHRzID0gYCR7cGFja2VkVHMuc2xpY2UoMCwgMTApfS4ke3BhY2tlZFRzLnNsaWNlKDEwKX1gO1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgbWVzc2FnZXM/OiBBcnJheTx7IHRleHQ/OiBzdHJpbmc7IHVzZXI/OiBzdHJpbmcgfT47XG4gIH0+KHNlc3Npb24sIGZldGNoSW1wbCwgJ2NvbnZlcnNhdGlvbnMuaGlzdG9yeScsIHtcbiAgICBjaGFubmVsOiBjaGFubmVsSWQsXG4gICAgaW5jbHVzaXZlOiAndHJ1ZScsXG4gICAgbGF0ZXN0OiB0cyxcbiAgICBsaW1pdDogJzEnLFxuICAgIG9sZGVzdDogdHMsXG4gIH0pO1xuXG4gIGNvbnN0IG1lc3NhZ2UgPSByZXNwb25zZS5tZXNzYWdlcz8uWzBdO1xuICBjb25zdCBbY2hhbm5lbE5hbWUsIGF1dGhvck5hbWVdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIGdldENoYW5uZWxOYW1lKHNlc3Npb24sIGNoYW5uZWxJZCwgZmV0Y2hJbXBsKSxcbiAgICBtZXNzYWdlPy51c2VyID8gZ2V0VXNlckRpc3BsYXlOYW1lKHNlc3Npb24sIG1lc3NhZ2UudXNlciwgZmV0Y2hJbXBsKSA6IFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpLFxuICBdKTtcblxuICByZXR1cm4ge1xuICAgIGF1dGhvcklkOiBtZXNzYWdlPy51c2VyLFxuICAgIGF1dGhvck5hbWUsXG4gICAgY2hhbm5lbE5hbWUsXG4gICAgdGV4dDogbWVzc2FnZT8udGV4dCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Q2hhbm5lbE5hbWUoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgY2hhbm5lbElkOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgY2hhbm5lbD86IHsgbmFtZT86IHN0cmluZyB9O1xuICB9PihzZXNzaW9uLCBmZXRjaEltcGwsICdjb252ZXJzYXRpb25zLmluZm8nLCB7XG4gICAgY2hhbm5lbDogY2hhbm5lbElkLFxuICB9KTtcblxuICByZXR1cm4gcmVzcG9uc2UuY2hhbm5lbD8ubmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VXNlckRpc3BsYXlOYW1lKFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIHVzZXJJZDogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaFxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgIHVzZXI/OiB7IHByb2ZpbGU/OiB7IGRpc3BsYXlfbmFtZT86IHN0cmluZzsgcmVhbF9uYW1lPzogc3RyaW5nIH0gfTtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAndXNlcnMuaW5mbycsIHtcbiAgICB1c2VyOiB1c2VySWQsXG4gIH0pO1xuXG4gIHJldHVybiByZXNwb25zZS51c2VyPy5wcm9maWxlPy5kaXNwbGF5X25hbWUgfHwgcmVzcG9uc2UudXNlcj8ucHJvZmlsZT8ucmVhbF9uYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmaW5kQ2hhbm5lbEJ5TmFtZShcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uLFxuICBuYW1lOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPFNsYWNrQ2hhbm5lbCB8IG51bGw+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgIGNoYW5uZWxzPzogQXJyYXk8eyBpZD86IHN0cmluZzsgbmFtZT86IHN0cmluZyB9PjtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAnY29udmVyc2F0aW9ucy5saXN0Jywge1xuICAgIGV4Y2x1ZGVfYXJjaGl2ZWQ6ICd0cnVlJyxcbiAgICBsaW1pdDogJzEwMDAnLFxuICAgIHR5cGVzOiAncHVibGljX2NoYW5uZWwscHJpdmF0ZV9jaGFubmVsJyxcbiAgfSk7XG5cbiAgY29uc3QgbWF0Y2ggPSByZXNwb25zZS5jaGFubmVscz8uZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5uYW1lID09PSBuYW1lKTtcblxuICBpZiAoIW1hdGNoPy5pZCB8fCAhbWF0Y2gubmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpZDogbWF0Y2guaWQsXG4gICAgbmFtZTogbWF0Y2gubmFtZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZFVzZXJCeURtU2VudGluZWwoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgc2VudGluZWw6IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2hcbik6IFByb21pc2U8U2xhY2tVc2VyIHwgbnVsbD4ge1xuICBjb25zdCB2YWx1ZSA9IHNlbnRpbmVsLnJlcGxhY2UoL15kbTovLCAnJyk7XG5cbiAgaWYgKHZhbHVlLmluY2x1ZGVzKCdAJykgJiYgIXZhbHVlLnN0YXJ0c1dpdGgoJ0AnKSkge1xuICAgIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgICAgdXNlcj86IHsgaWQ/OiBzdHJpbmc7IHByb2ZpbGU/OiB7IGVtYWlsPzogc3RyaW5nOyBkaXNwbGF5X25hbWU/OiBzdHJpbmc7IHJlYWxfbmFtZT86IHN0cmluZyB9IH07XG4gICAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAndXNlcnMubG9va3VwQnlFbWFpbCcsIHsgZW1haWw6IHZhbHVlIH0pO1xuICAgIGNvbnN0IGVtYWlsVXNlciA9IGJ5RW1haWwudXNlcjtcblxuICAgIGlmICghZW1haWxVc2VyPy5pZCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRpc3BsYXlOYW1lOlxuICAgICAgICBlbWFpbFVzZXIucHJvZmlsZT8uZGlzcGxheV9uYW1lIHx8IGVtYWlsVXNlci5wcm9maWxlPy5yZWFsX25hbWUgfHwgZW1haWxVc2VyLnByb2ZpbGU/LmVtYWlsIHx8IGVtYWlsVXNlci5pZCxcbiAgICAgIGVtYWlsOiBlbWFpbFVzZXIucHJvZmlsZT8uZW1haWwsXG4gICAgICBpZDogZW1haWxVc2VyLmlkLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkTmFtZSA9IHZhbHVlLnJlcGxhY2UoL15ALywgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2FsbFNsYWNrQXBpPHtcbiAgICBtZW1iZXJzPzogQXJyYXk8e1xuICAgICAgaWQ/OiBzdHJpbmc7XG4gICAgICBuYW1lPzogc3RyaW5nO1xuICAgICAgcHJvZmlsZT86IHsgZGlzcGxheV9uYW1lPzogc3RyaW5nOyBlbWFpbD86IHN0cmluZzsgcmVhbF9uYW1lPzogc3RyaW5nIH07XG4gICAgfT47XG4gIH0+KHNlc3Npb24sIGZldGNoSW1wbCwgJ3VzZXJzLmxpc3QnLCB7fSk7XG5cbiAgY29uc3QgbWF0Y2ggPSByZXNwb25zZS5tZW1iZXJzPy5maW5kKChtZW1iZXIpID0+IHtcbiAgICBjb25zdCBkaXNwbGF5TmFtZSA9IG1lbWJlci5wcm9maWxlPy5kaXNwbGF5X25hbWU/LnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmVhbE5hbWUgPSBtZW1iZXIucHJvZmlsZT8ucmVhbF9uYW1lPy50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHVzZXJuYW1lID0gbWVtYmVyLm5hbWU/LnRvTG93ZXJDYXNlKCk7XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZE5hbWUgPT09IGRpc3BsYXlOYW1lIHx8IG5vcm1hbGl6ZWROYW1lID09PSByZWFsTmFtZSB8fCBub3JtYWxpemVkTmFtZSA9PT0gdXNlcm5hbWU7XG4gIH0pO1xuXG4gIGlmICghbWF0Y2g/LmlkKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRpc3BsYXlOYW1lOiBtYXRjaC5wcm9maWxlPy5kaXNwbGF5X25hbWUgfHwgbWF0Y2gucHJvZmlsZT8ucmVhbF9uYW1lIHx8IG1hdGNoLm5hbWUgfHwgbWF0Y2guaWQsXG4gICAgZW1haWw6IG1hdGNoLnByb2ZpbGU/LmVtYWlsLFxuICAgIGlkOiBtYXRjaC5pZCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FsbFNsYWNrQXBpPFQ+KFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoLFxuICBtZXRob2Q6IHN0cmluZyxcbiAgcXVlcnk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbik6IFByb21pc2U8VD4ge1xuICBpZiAoIXNlc3Npb24uYWNjZXNzVG9rZW4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NsYWNrIGFjY2VzcyB0b2tlbiBpcyBtaXNzaW5nJyk7XG4gIH1cblxuICBjb25zdCB1cmwgPSBuZXcgVVJMKGBodHRwczovL3NsYWNrLmNvbS9hcGkvJHttZXRob2R9YCk7XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocXVlcnkpKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoa2V5LCB2YWx1ZSk7XG4gIH1cblxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoSW1wbCh1cmwsIHtcbiAgICBoZWFkZXJzOiB7XG4gICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2Vzc2lvbi5hY2Nlc3NUb2tlbn1gLFxuICAgIH0sXG4gIH0pO1xuXG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFNsYWNrIEFQSSByZXF1ZXN0IGZhaWxlZDogJHtyZXNwb25zZS5zdGF0dXN9YCk7XG4gIH1cblxuICBjb25zdCBwYXlsb2FkID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgeyBlcnJvcj86IHN0cmluZzsgb2s/OiBib29sZWFuIH0gJiBUO1xuXG4gIGlmICghcGF5bG9hZC5vaykge1xuICAgIHRocm93IG5ldyBFcnJvcihwYXlsb2FkLmVycm9yID8/IGBTbGFjayBBUEkgcmVxdWVzdCBmYWlsZWQ6ICR7bWV0aG9kfWApO1xuICB9XG5cbiAgcmV0dXJuIHBheWxvYWQ7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTbGFja1Nlc3Npb24gfSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1ZhbGlkQWNjZXNzVG9rZW4oc2Vzc2lvbjogU2xhY2tTZXNzaW9uKTogYm9vbGVhbiB7XG4gIHJldHVybiBCb29sZWFuKHNlc3Npb24uYWNjZXNzVG9rZW4gJiYgKCFzZXNzaW9uLmV4cGlyZXNBdCB8fCBzZXNzaW9uLmV4cGlyZXNBdCA+IERhdGUubm93KCkpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3VsZFJlZnJlc2hTZXNzaW9uKHNlc3Npb246IFNsYWNrU2Vzc2lvbiwgcmVmcmVzaExlZXdheU1zID0gNjBfMDAwKTogYm9vbGVhbiB7XG4gIHJldHVybiBCb29sZWFuKFxuICAgIHNlc3Npb24uYWNjZXNzVG9rZW4gJiZcbiAgICAgIHNlc3Npb24ucmVmcmVzaFRva2VuICYmXG4gICAgICBzZXNzaW9uLmV4cGlyZXNBdCAmJlxuICAgICAgc2Vzc2lvbi5leHBpcmVzQXQgPD0gRGF0ZS5ub3coKSArIHJlZnJlc2hMZWV3YXlNc1xuICApO1xufVxuIiwgImV4cG9ydCBjbGFzcyBTaW5nbGVGbGlnaHQ8VD4ge1xuICBwcml2YXRlIGluRmxpZ2h0OiBQcm9taXNlPFQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgcnVuKGZhY3Rvcnk6ICgpID0+IFByb21pc2U8VD4pOiBQcm9taXNlPFQ+IHtcbiAgICBpZiAodGhpcy5pbkZsaWdodCkge1xuICAgICAgcmV0dXJuIHRoaXMuaW5GbGlnaHQ7XG4gICAgfVxuXG4gICAgdGhpcy5pbkZsaWdodCA9IGZhY3RvcnkoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5GbGlnaHQgPSBudWxsO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuaW5GbGlnaHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IExpbmtUYXJnZXRQcmVmZXJlbmNlLCBTbGFja1Nlc3Npb24gfSBmcm9tICcuL3NsYWNrL3R5cGVzJztcbmltcG9ydCB7XG4gIGRlY29kZVNlY3VyZVNlc3Npb24sXG4gIGVuY29kZVNlY3VyZVNlc3Npb24sXG4gIHR5cGUgU2Vzc2lvbkNpcGhlcixcbn0gZnJvbSAnLi9zbGFjay9zZWN1cmUtc2Vzc2lvbic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgY2hhbm5lbENhY2hlVHRsTXM6IG51bWJlcjtcbiAgY2xpZW50SWQ6IHN0cmluZztcbiAgZW5jcnlwdGVkU2Vzc2lvbjogc3RyaW5nO1xuICBlbmFibGVDaGFubmVsczogYm9vbGVhbjtcbiAgZW5hYmxlRG1TZW50aW5lbHM6IGJvb2xlYW47XG4gIGVuYWJsZVBlcm1hbGlua3M6IGJvb2xlYW47XG4gIGZhaWxlZExvb2t1cFR0bE1zOiBudW1iZXI7XG4gIGlkbGVEZWxheU1zOiBudW1iZXI7XG4gIG1lc3NhZ2VUZW1wbGF0ZTogc3RyaW5nO1xuICByZWZyZXNoTGVld2F5TXM6IG51bWJlcjtcbiAgc2NvcGVzOiBzdHJpbmc7XG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbjtcbiAgdGFyZ2V0OiBMaW5rVGFyZ2V0UHJlZmVyZW5jZTtcbiAgdGVhbUlkOiBzdHJpbmc7XG4gIHVzZXJDYWNoZVR0bE1zOiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBTbGFja0Jhc2VzU2V0dGluZ3MgPSB7XG4gIGNoYW5uZWxDYWNoZVR0bE1zOiA2MCAqIDYwICogMTAwMCxcbiAgY2xpZW50SWQ6ICcnLFxuICBlbmNyeXB0ZWRTZXNzaW9uOiAnJyxcbiAgZW5hYmxlQ2hhbm5lbHM6IHRydWUsXG4gIGVuYWJsZURtU2VudGluZWxzOiB0cnVlLFxuICBlbmFibGVQZXJtYWxpbmtzOiB0cnVlLFxuICBmYWlsZWRMb29rdXBUdGxNczogNSAqIDYwICogMTAwMCxcbiAgaWRsZURlbGF5TXM6IDUwMCxcbiAgbWVzc2FnZVRlbXBsYXRlOiAnW3tjaGFubmVsfSBcdTIwMjIge2F1dGhvcn06IHt0ZXh0fV0oe3VybH0pJyxcbiAgcmVmcmVzaExlZXdheU1zOiA2MCAqIDEwMDAsXG4gIHNjb3BlczogJ2NoYW5uZWxzOnJlYWQsZ3JvdXBzOnJlYWQsdXNlcnM6cmVhZCx1c2VyczpyZWFkLmVtYWlsLGNoYW5uZWxzOmhpc3RvcnksZ3JvdXBzOmhpc3RvcnknLFxuICBzZXNzaW9uOiB7XG4gICAgYWNjZXNzVG9rZW46ICcnLFxuICAgIGV4cGlyZXNBdDogMCxcbiAgICByZWZyZXNoVG9rZW46ICcnLFxuICAgIHRlYW1JZDogJycsXG4gICAgd29ya3NwYWNlOiAnJyxcbiAgfSxcbiAgdGFyZ2V0OiAnYXBwJyxcbiAgdGVhbUlkOiAnJyxcbiAgdXNlckNhY2hlVHRsTXM6IDYwICogNjAgKiAxMDAwLFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRTbGFja0NsaWVudElkKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eXFxkK1xcLlxcZCskLy50ZXN0KHZhbHVlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlU2V0dGluZ3MoXG4gIHBhcnRpYWw6IFBhcnRpYWw8U2xhY2tCYXNlc1NldHRpbmdzPiB8IHVuZGVmaW5lZFxuKTogU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgIC4uLnBhcnRpYWwsXG4gICAgc2Vzc2lvbjoge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUy5zZXNzaW9uLFxuICAgICAgLi4ucGFydGlhbD8uc2Vzc2lvbixcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGVyc2lzdGVkU2V0dGluZ3MoXG4gIHNldHRpbmdzOiBTbGFja0Jhc2VzU2V0dGluZ3MsXG4gIGNpcGhlcj86IFNlc3Npb25DaXBoZXIgfCBudWxsXG4pOiBTbGFja0Jhc2VzU2V0dGluZ3Mge1xuICBpZiAoIWhhc1Nlc3Npb25EYXRhKHNldHRpbmdzLnNlc3Npb24pKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnNldHRpbmdzLFxuICAgICAgZW5jcnlwdGVkU2Vzc2lvbjogJycsXG4gICAgICBzZXNzaW9uOiB7IC4uLkRFRkFVTFRfU0VUVElOR1Muc2Vzc2lvbiB9LFxuICAgIH07XG4gIH1cblxuICBpZiAoIWNpcGhlcj8uaXNBdmFpbGFibGUoKSkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5zZXR0aW5ncyxcbiAgICAgIGVuY3J5cHRlZFNlc3Npb246ICcnLFxuICAgICAgc2Vzc2lvbjogeyAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24gfSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5zZXR0aW5ncyxcbiAgICBlbmNyeXB0ZWRTZXNzaW9uOiBlbmNvZGVTZWN1cmVTZXNzaW9uKHNldHRpbmdzLnNlc3Npb24sIGNpcGhlciksXG4gICAgc2Vzc2lvbjogeyAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24gfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRTZXR0aW5nc1dpdGhTZXNzaW9uKFxuICBwYXJ0aWFsOiBQYXJ0aWFsPFNsYWNrQmFzZXNTZXR0aW5ncz4gfCB1bmRlZmluZWQsXG4gIGNpcGhlcj86IFNlc3Npb25DaXBoZXIgfCBudWxsXG4pOiBTbGFja0Jhc2VzU2V0dGluZ3Mge1xuICBjb25zdCBtZXJnZWQgPSBtZXJnZVNldHRpbmdzKHBhcnRpYWwpO1xuXG4gIGlmICghbWVyZ2VkLmVuY3J5cHRlZFNlc3Npb24gfHwgIWNpcGhlcj8uaXNBdmFpbGFibGUoKSkge1xuICAgIHJldHVybiBtZXJnZWQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIC4uLm1lcmdlZCxcbiAgICBzZXNzaW9uOiB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24sXG4gICAgICAuLi5kZWNvZGVTZWN1cmVTZXNzaW9uKG1lcmdlZC5lbmNyeXB0ZWRTZXNzaW9uLCBjaXBoZXIpLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGhhc1Nlc3Npb25EYXRhKHNlc3Npb246IFNsYWNrU2Vzc2lvbik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihcbiAgICBzZXNzaW9uLmFjY2Vzc1Rva2VuIHx8XG4gICAgICBzZXNzaW9uLnJlZnJlc2hUb2tlbiB8fFxuICAgICAgc2Vzc2lvbi50ZWFtSWQgfHxcbiAgICAgIHNlc3Npb24ud29ya3NwYWNlIHx8XG4gICAgICBzZXNzaW9uLmV4cGlyZXNBdFxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7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LGVBQWUsQ0FBQyxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3hFLGNBQU0sU0FBUyxPQUFPLFNBQVMsT0FBTyxFQUFFO0FBQ3hDLFlBQUksT0FBTyxNQUFNLE1BQU0sS0FBSyxTQUFTLEdBQUc7QUFDdEM7QUFBQSxRQUNGO0FBRUEsY0FBTSxLQUFLLE9BQU8sYUFBYSxFQUFFLGlCQUFpQixPQUFPLENBQUM7QUFBQSxNQUM1RCxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLG9CQUFvQixFQUM1QixRQUFRLG1EQUFtRCxFQUMzRDtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxTQUFTLGNBQWMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNqRSxjQUFNLEtBQUssT0FBTyxhQUFhLEVBQUUsZ0JBQWdCLE1BQU0sQ0FBQztBQUFBLE1BQzFELENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx3QkFBUSxXQUFXLEVBQ3BCLFFBQVEsd0JBQXdCLEVBQ2hDLFFBQVEsbURBQW1ELEVBQzNEO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLFNBQVMsaUJBQWlCLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDcEUsY0FBTSxLQUFLLE9BQU8sYUFBYSxFQUFFLG1CQUFtQixNQUFNLENBQUM7QUFBQSxNQUM3RCxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLDZCQUE2QixFQUNyQyxRQUFRLG9FQUFvRSxFQUM1RTtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxTQUFTLGdCQUFnQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ25FLGNBQU0sS0FBSyxPQUFPLGFBQWEsRUFBRSxrQkFBa0IsTUFBTSxDQUFDO0FBQUEsTUFDNUQsQ0FBQztBQUFBLElBQ0g7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSx1QkFBdUIsRUFDL0IsUUFBUSxvREFBb0QsRUFDNUQ7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsTUFBTSxFQUFFLFFBQVEsTUFBTTtBQUN6QyxhQUFLLE9BQU8scUJBQXFCO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQ0Y7QUFFQSxTQUFTLGdCQUFnQixPQUF3QjtBQUMvQyxTQUFPLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDOUQ7IiwKICAibmFtZXMiOiBbInJlc29sdmVkIl0KfQo=
