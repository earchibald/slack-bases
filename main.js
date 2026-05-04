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
  userCacheTtlMs: 60 * 60 * 1e3
};
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
        state
      }),
      "_blank"
    );
    new import_obsidian.Notice("Finish Slack sign-in in your browser, then return to Obsidian.");
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
      new import_obsidian.Notice(`Slack sign-in failed: ${getErrorMessage(error)}`);
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
      throw new Error(response.json?.error ?? `Slack API request failed: ${request.path}`);
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
    new import_obsidian.Setting(containerEl).setName("Client ID").setDesc("Slack app client ID for the desktop PKCE flow.").addText(
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3NsYWNrL2F1dGgudHMiLCAic3JjL3NsYWNrL2NhY2hlLnRzIiwgInNyYy9zbGFjay9kZXRlY3Rvci50cyIsICJzcmMvc2xhY2svcmVuZGVyZXIudHMiLCAic3JjL3NsYWNrL2VuZ2luZS50cyIsICJzcmMvc2xhY2svcGVybWFsaW5rLnRzIiwgInNyYy9zbGFjay9yZXNvbHZlci50cyIsICJzcmMvc2xhY2svcmVwbGFjZW1lbnRzLnRzIiwgInNyYy9zbGFjay9zZWN1cmUtc2Vzc2lvbi50cyIsICJzcmMvc2xhY2svc2VydmljZS50cyIsICJzcmMvc2xhY2svc2Vzc2lvbi50cyIsICJzcmMvc2xhY2svc2luZ2xlLWZsaWdodC50cyIsICJzcmMvc2V0dGluZ3MudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICByZXF1ZXN0VXJsLFxuICB0eXBlIEFwcCxcbiAgdHlwZSBFZGl0b3IsXG59IGZyb20gJ29ic2lkaWFuJztcblxuaW1wb3J0IHtcbiAgYnVpbGRTbGFja0F1dGhvcml6ZVVybCxcbiAgY29tcGxldGVTbGFja0F1dGgsXG4gIGNyZWF0ZVBrY2VQYWlyLFxuICByZWZyZXNoU2xhY2tTZXNzaW9uLFxuICB0eXBlIFNsYWNrQXBpRm9ybVJlcXVlc3QsXG59IGZyb20gJy4vc2xhY2svYXV0aCc7XG5pbXBvcnQgeyBUdGxDYWNoZSB9IGZyb20gJy4vc2xhY2svY2FjaGUnO1xuaW1wb3J0IHsgZGV0ZWN0Q2FuZGlkYXRlcyB9IGZyb20gJy4vc2xhY2svZGV0ZWN0b3InO1xuaW1wb3J0IHsgcGxhblNsYWNrTGlua1JlcGxhY2VtZW50cyB9IGZyb20gJy4vc2xhY2svZW5naW5lJztcbmltcG9ydCB7IGJ1aWxkVGFyZ2V0VXJsIH0gZnJvbSAnLi9zbGFjay9yZW5kZXJlcic7XG5pbXBvcnQgeyBjcmVhdGVSZXNvbHZlciB9IGZyb20gJy4vc2xhY2svcmVzb2x2ZXInO1xuaW1wb3J0IHsgYXBwbHlSZXBsYWNlbWVudHMgfSBmcm9tICcuL3NsYWNrL3JlcGxhY2VtZW50cyc7XG5pbXBvcnQgeyBjcmVhdGVFbGVjdHJvblNlc3Npb25DaXBoZXIgfSBmcm9tICcuL3NsYWNrL3NlY3VyZS1zZXNzaW9uJztcbmltcG9ydCB7IGNyZWF0ZVNsYWNrU2VydmljZSwgdHlwZSBTbGFja1NlcnZpY2UgfSBmcm9tICcuL3NsYWNrL3NlcnZpY2UnO1xuaW1wb3J0IHsgaGFzVmFsaWRBY2Nlc3NUb2tlbiwgc2hvdWxkUmVmcmVzaFNlc3Npb24gfSBmcm9tICcuL3NsYWNrL3Nlc3Npb24nO1xuaW1wb3J0IHsgU2luZ2xlRmxpZ2h0IH0gZnJvbSAnLi9zbGFjay9zaW5nbGUtZmxpZ2h0JztcbmltcG9ydCB0eXBlIHsgU2xhY2tDaGFubmVsLCBTbGFja1VzZXIgfSBmcm9tICcuL3NsYWNrL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgU2xhY2tCYXNlc1NldHRpbmdzIH0gZnJvbSAnLi9zZXR0aW5ncyc7XG5pbXBvcnQge1xuICBjcmVhdGVQZXJzaXN0ZWRTZXR0aW5ncyxcbiAgREVGQVVMVF9TRVRUSU5HUyxcbiAgbG9hZFNldHRpbmdzV2l0aFNlc3Npb24sXG4gIG1lcmdlU2V0dGluZ3MsXG59IGZyb20gJy4vc2V0dGluZ3MnO1xuXG5jb25zdCBBVVRIX0NBTExCQUNLX0FDVElPTiA9ICdzbGFjay1iYXNlcy1hdXRoJztcbmNvbnN0IEFVVEhfUkVDT05ORUNUX05PVElDRV9NUyA9IDYwXzAwMDtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2xhY2tCYXNlc1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHByaXZhdGUgY2hhbm5lbENhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrQ2hhbm5lbD4oREVGQVVMVF9TRVRUSU5HUy5jaGFubmVsQ2FjaGVUdGxNcyk7XG4gIHByaXZhdGUgZmFpbGVkTG9va3VwQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8Ym9vbGVhbj4oREVGQVVMVF9TRVRUSU5HUy5mYWlsZWRMb29rdXBUdGxNcyk7XG4gIHByaXZhdGUgaXNBcHBseWluZ0NoYW5nZXMgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsYXN0QXV0aE5vdGljZUF0ID0gMDtcbiAgcHJpdmF0ZSBwZW5kaW5nQXV0aFN0YXRlOiB7IGNvZGVWZXJpZmllcjogc3RyaW5nOyBzdGF0ZTogc3RyaW5nIH0gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWZyZXNoVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlZnJlc2hTZXNzaW9uR2F0ZSA9IG5ldyBTaW5nbGVGbGlnaHQ8Ym9vbGVhbj4oKTtcbiAgcHJpdmF0ZSBzZXJ2aWNlOiBTbGFja1NlcnZpY2UgPSBjcmVhdGVTbGFja1NlcnZpY2UoREVGQVVMVF9TRVRUSU5HUy5zZXNzaW9uKTtcbiAgcHJpdmF0ZSBzZXNzaW9uQ2lwaGVyID0gY3JlYXRlRWxlY3Ryb25TZXNzaW9uQ2lwaGVyKCk7XG4gIHByaXZhdGUgc2V0dGluZ3M6IFNsYWNrQmFzZXNTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHByaXZhdGUgdXNlckNhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrVXNlcj4oREVGQVVMVF9TRVRUSU5HUy51c2VyQ2FjaGVUdGxNcyk7XG4gIHByaXZhdGUgcmVzb2x2ZXIgPSBjcmVhdGVSZXNvbHZlcih7XG4gICAgY2hhbm5lbENhY2hlOiB0aGlzLmNoYW5uZWxDYWNoZSxcbiAgICBmYWlsZWRMb29rdXBDYWNoZTogdGhpcy5mYWlsZWRMb29rdXBDYWNoZSxcbiAgICBzZXJ2aWNlOiB0aGlzLnNlcnZpY2UsXG4gICAgc2Vzc2lvbjogdGhpcy5zZXR0aW5ncy5zZXNzaW9uLFxuICAgIHVzZXJDYWNoZTogdGhpcy51c2VyQ2FjaGUsXG4gIH0pO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgdGhpcy5yZWdpc3Rlck9ic2lkaWFuUHJvdG9jb2xIYW5kbGVyKEFVVEhfQ0FMTEJBQ0tfQUNUSU9OLCAocGFyYW1zKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuY29tcGxldGVTbGFja0Nvbm5lY3QocGFyYW1zKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkUmliYm9uSWNvbignbGluaycsICdDb25uZWN0IFNsYWNrJywgKCkgPT4ge1xuICAgICAgdm9pZCB0aGlzLmNvbm5lY3RTbGFjaygpO1xuICAgIH0pO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgU2xhY2tCYXNlc1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29tbWFuZHMoKTtcbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yTGlzdGVuZXIoKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlZnJlc2hUaW1lciAhPT0gbnVsbCkge1xuICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnJlZnJlc2hUaW1lcik7XG4gICAgICB0aGlzLnJlZnJlc2hUaW1lciA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKG5leHRTZXR0aW5ncz86IFBhcnRpYWw8U2xhY2tCYXNlc1NldHRpbmdzPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1lcmdlZFNldHRpbmdzID0gbWVyZ2VTZXR0aW5ncyhuZXh0U2V0dGluZ3MgPyB7IC4uLnRoaXMuc2V0dGluZ3MsIC4uLm5leHRTZXR0aW5ncyB9IDogdGhpcy5zZXR0aW5ncyk7XG5cbiAgICB0aGlzLnNldHRpbmdzID0gbWVyZ2VkU2V0dGluZ3M7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShjcmVhdGVQZXJzaXN0ZWRTZXR0aW5ncyhtZXJnZWRTZXR0aW5ncywgdGhpcy5zZXNzaW9uQ2lwaGVyKSk7XG4gICAgdGhpcy5yZWJ1aWxkUnVudGltZSgpO1xuICB9XG5cbiAgZ2V0U2V0dGluZ3MoKTogU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgICByZXR1cm4gdGhpcy5zZXR0aW5ncztcbiAgfVxuXG4gIGFzeW5jIGNvbm5lY3RTbGFjaygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MuY2xpZW50SWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1NldCB5b3VyIFNsYWNrIGNsaWVudCBJRCBiZWZvcmUgY29ubmVjdGluZy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2Vzc2lvbkNpcGhlcj8uaXNBdmFpbGFibGUoKSkge1xuICAgICAgbmV3IE5vdGljZSgnU2VjdXJlIGxvY2FsIHN0b3JhZ2UgaXMgdW5hdmFpbGFibGUgaW4gdGhpcyBkZXNrdG9wIGVudmlyb25tZW50LicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBrY2VQYWlyID0gYXdhaXQgY3JlYXRlUGtjZVBhaXIoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuY3JlYXRlU3RhdGVUb2tlbigpO1xuXG4gICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0ge1xuICAgICAgY29kZVZlcmlmaWVyOiBwa2NlUGFpci5jb2RlVmVyaWZpZXIsXG4gICAgICBzdGF0ZSxcbiAgICB9O1xuXG4gICAgd2luZG93Lm9wZW4oXG4gICAgICBidWlsZFNsYWNrQXV0aG9yaXplVXJsKHtcbiAgICAgICAgY2xpZW50SWQ6IHRoaXMuc2V0dGluZ3MuY2xpZW50SWQsXG4gICAgICAgIGNvZGVDaGFsbGVuZ2U6IHBrY2VQYWlyLmNvZGVDaGFsbGVuZ2UsXG4gICAgICAgIHJlZGlyZWN0VXJpOiB0aGlzLmdldFJlZGlyZWN0VXJpKCksXG4gICAgICAgIHNjb3BlczogdGhpcy5zZXR0aW5ncy5zY29wZXMsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSksXG4gICAgICAnX2JsYW5rJ1xuICAgICk7XG5cbiAgICBuZXcgTm90aWNlKCdGaW5pc2ggU2xhY2sgc2lnbi1pbiBpbiB5b3VyIGJyb3dzZXIsIHRoZW4gcmV0dXJuIHRvIE9ic2lkaWFuLicpO1xuICB9XG5cbiAgYXN5bmMgZGlzY29ubmVjdFNsYWNrKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKHtcbiAgICAgIGVuY3J5cHRlZFNlc3Npb246ICcnLFxuICAgICAgc2Vzc2lvbjoge1xuICAgICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmVzZXRDaGFubmVsQ2FjaGUoKTogdm9pZCB7XG4gICAgdGhpcy5jaGFubmVsQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8U2xhY2tDaGFubmVsPih0aGlzLnNldHRpbmdzLmNoYW5uZWxDYWNoZVR0bE1zKTtcbiAgICB0aGlzLnJlYnVpbGRSZXNvbHZlcigpO1xuICB9XG5cbiAgcmVzZXRVc2VyQ2FjaGUoKTogdm9pZCB7XG4gICAgdGhpcy51c2VyQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8U2xhY2tVc2VyPih0aGlzLnNldHRpbmdzLnVzZXJDYWNoZVR0bE1zKTtcbiAgICB0aGlzLnJlYnVpbGRSZXNvbHZlcigpO1xuICB9XG5cbiAgc2hvd0Nvbm5lY3Rpb25TdGF0dXMoKTogdm9pZCB7XG4gICAgaWYgKGhhc1ZhbGlkQWNjZXNzVG9rZW4odGhpcy5zZXR0aW5ncy5zZXNzaW9uKSAmJiB0aGlzLnNldHRpbmdzLnNlc3Npb24ud29ya3NwYWNlKSB7XG4gICAgICBuZXcgTm90aWNlKGBTbGFjayBzZXNzaW9uIGNvbmZpZ3VyZWQgZm9yICR7dGhpcy5zZXR0aW5ncy5zZXNzaW9uLndvcmtzcGFjZX1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKCdTbGFjayBpcyBub3QgY29ubmVjdGVkLicpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IGxvYWRTZXR0aW5nc1dpdGhTZXNzaW9uKGF3YWl0IHRoaXMubG9hZERhdGEoKSwgdGhpcy5zZXNzaW9uQ2lwaGVyKTtcbiAgICB0aGlzLnJlYnVpbGRSdW50aW1lKCk7XG4gIH1cblxuICBwcml2YXRlIHJlYnVpbGRSdW50aW1lKCk6IHZvaWQge1xuICAgIHRoaXMuY2hhbm5lbENhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrQ2hhbm5lbD4odGhpcy5zZXR0aW5ncy5jaGFubmVsQ2FjaGVUdGxNcyk7XG4gICAgdGhpcy51c2VyQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8U2xhY2tVc2VyPih0aGlzLnNldHRpbmdzLnVzZXJDYWNoZVR0bE1zKTtcbiAgICB0aGlzLmZhaWxlZExvb2t1cENhY2hlID0gbmV3IFR0bENhY2hlPGJvb2xlYW4+KHRoaXMuc2V0dGluZ3MuZmFpbGVkTG9va3VwVHRsTXMpO1xuICAgIHRoaXMuc2VydmljZSA9IGNyZWF0ZVNsYWNrU2VydmljZSh0aGlzLnNldHRpbmdzLnNlc3Npb24pO1xuICAgIHRoaXMucmVidWlsZFJlc29sdmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHJlYnVpbGRSZXNvbHZlcigpOiB2b2lkIHtcbiAgICB0aGlzLnJlc29sdmVyID0gY3JlYXRlUmVzb2x2ZXIoe1xuICAgICAgY2hhbm5lbENhY2hlOiB0aGlzLmNoYW5uZWxDYWNoZSxcbiAgICAgIGZhaWxlZExvb2t1cENhY2hlOiB0aGlzLmZhaWxlZExvb2t1cENhY2hlLFxuICAgICAgc2VydmljZTogdGhpcy5zZXJ2aWNlLFxuICAgICAgc2Vzc2lvbjogdGhpcy5zZXR0aW5ncy5zZXNzaW9uLFxuICAgICAgdXNlckNhY2hlOiB0aGlzLnVzZXJDYWNoZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVnaXN0ZXJDb21tYW5kcygpOiB2b2lkIHtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb25uZWN0LXNsYWNrJyxcbiAgICAgIG5hbWU6ICdDb25uZWN0IFNsYWNrJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5jb25uZWN0U2xhY2soKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdkaXNjb25uZWN0LXNsYWNrJyxcbiAgICAgIG5hbWU6ICdEaXNjb25uZWN0IFNsYWNrJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5kaXNjb25uZWN0U2xhY2soKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICd0ZXN0LXNsYWNrLWNvbm5lY3Rpb24nLFxuICAgICAgbmFtZTogJ1Rlc3QgU2xhY2sgY29ubmVjdGlvbicsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zaG93Q29ubmVjdGlvblN0YXR1cygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAnaW5zZXJ0LXNsYWNrLWxpbmsnLFxuICAgICAgbmFtZTogJ0luc2VydCBTbGFjayBsaW5rJyxcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5yZXBsYWNlU2VsZWN0aW9uV2l0aFNsYWNrTGlua3MoZWRpdG9yKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdpbnNlcnQtc2xhY2stbWVzc2FnZS1saW5rJyxcbiAgICAgIG5hbWU6ICdJbnNlcnQgU2xhY2sgbWVzc2FnZSBsaW5rJyxcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5yZXBsYWNlU2VsZWN0aW9uV2l0aFNsYWNrTGlua3MoZWRpdG9yLCB7XG4gICAgICAgICAgZW5hYmxlQ2hhbm5lbHM6IGZhbHNlLFxuICAgICAgICAgIGVuYWJsZURtU2VudGluZWxzOiBmYWxzZSxcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAncmVmcmVzaC1zbGFjay1wZW9wbGUtY2FjaGUnLFxuICAgICAgbmFtZTogJ1JlZnJlc2ggU2xhY2sgcGVvcGxlIGNhY2hlJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHRoaXMucmVzZXRVc2VyQ2FjaGUoKTtcbiAgICAgICAgbmV3IE5vdGljZSgnU2xhY2sgcGVvcGxlIGNhY2hlIGNsZWFyZWQuJyk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAncmVmcmVzaC1zbGFjay1jaGFubmVsLWNhY2hlJyxcbiAgICAgIG5hbWU6ICdSZWZyZXNoIFNsYWNrIGNoYW5uZWwgY2FjaGUnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgdGhpcy5yZXNldENoYW5uZWxDYWNoZSgpO1xuICAgICAgICBuZXcgTm90aWNlKCdTbGFjayBjaGFubmVsIGNhY2hlIGNsZWFyZWQuJyk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAnb3Blbi1jdXJyZW50LXNsYWNrLXJlZicsXG4gICAgICBuYW1lOiAnT3BlbiBjdXJyZW50IFNsYWNrIHJlZicsXG4gICAgICBlZGl0b3JDYWxsYmFjazogKGVkaXRvcikgPT4ge1xuICAgICAgICB2b2lkIHRoaXMub3BlbkN1cnJlbnRTbGFja1JlZihlZGl0b3IpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVnaXN0ZXJFZGl0b3JMaXN0ZW5lcigpOiB2b2lkIHtcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2VkaXRvci1jaGFuZ2UnLCAoZWRpdG9yKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmlzQXBwbHlpbmdDaGFuZ2VzKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMucmVmcmVzaFRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnJlZnJlc2hUaW1lcik7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlZnJlc2hUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICB2b2lkIHRoaXMucmVmcmVzaEVkaXRvcihlZGl0b3IpO1xuICAgICAgICB9LCB0aGlzLnNldHRpbmdzLmlkbGVEZWxheU1zKTtcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaEVkaXRvcihlZGl0b3I6IEVkaXRvcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGVkaXRvci5nZXRWYWx1ZSgpO1xuICAgIGNvbnN0IGN1cnNvck9mZnNldCA9IGVkaXRvci5wb3NUb09mZnNldChlZGl0b3IuZ2V0Q3Vyc29yKCkpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkZXRlY3RDYW5kaWRhdGVzKHNvdXJjZSwgeyBjdXJzb3JPZmZzZXQgfSk7XG5cbiAgICBpZiAoIWNhbmRpZGF0ZXMubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVWYWxpZFNlc3Npb24oKSkpIHtcbiAgICAgIHRoaXMubWF5YmVTaG93UmVjb25uZWN0Tm90aWNlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbGFjZW1lbnRzID0gYXdhaXQgcGxhblNsYWNrTGlua1JlcGxhY2VtZW50cyhzb3VyY2UsIHtcbiAgICAgIGN1cnNvck9mZnNldCxcbiAgICAgIHJlc29sdmVyOiB0aGlzLnJlc29sdmVyLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuc2V0dGluZ3MsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlcGxhY2VtZW50cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBuZXh0VmFsdWUgPSBhcHBseVJlcGxhY2VtZW50cyhzb3VyY2UsIHJlcGxhY2VtZW50cyk7XG5cbiAgICBpZiAobmV4dFZhbHVlID09PSBzb3VyY2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmlzQXBwbHlpbmdDaGFuZ2VzID0gdHJ1ZTtcblxuICAgIHRyeSB7XG4gICAgICBlZGl0b3Iuc2V0VmFsdWUobmV4dFZhbHVlKTtcbiAgICAgIGVkaXRvci5zZXRDdXJzb3IoZWRpdG9yLm9mZnNldFRvUG9zKGN1cnNvck9mZnNldCkpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmlzQXBwbHlpbmdDaGFuZ2VzID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXBsYWNlU2VsZWN0aW9uV2l0aFNsYWNrTGlua3MoXG4gICAgZWRpdG9yOiBFZGl0b3IsXG4gICAgb3ZlcnJpZGVzPzogUGFydGlhbDxQaWNrPFNsYWNrQmFzZXNTZXR0aW5ncywgJ2VuYWJsZUNoYW5uZWxzJyB8ICdlbmFibGVEbVNlbnRpbmVscycgfCAnZW5hYmxlUGVybWFsaW5rcyc+PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBlZGl0b3IuZ2V0U2VsZWN0aW9uKCk7XG5cbiAgICBpZiAoIXNlbGVjdGlvbikge1xuICAgICAgbmV3IE5vdGljZSgnU2VsZWN0IFNsYWNrIHRleHQgZmlyc3QuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVWYWxpZFNlc3Npb24odHJ1ZSkpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbGFjZW1lbnRzID0gYXdhaXQgcGxhblNsYWNrTGlua1JlcGxhY2VtZW50cyhzZWxlY3Rpb24sIHtcbiAgICAgIGN1cnNvck9mZnNldDogLTEsXG4gICAgICByZXNvbHZlcjogdGhpcy5yZXNvbHZlcixcbiAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgIC4uLnRoaXMuc2V0dGluZ3MsXG4gICAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlcGxhY2VtZW50cy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ05vIFNsYWNrIHJlZmVyZW5jZXMgZm91bmQgaW4gdGhlIGN1cnJlbnQgc2VsZWN0aW9uLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGVkaXRvci5yZXBsYWNlU2VsZWN0aW9uKGFwcGx5UmVwbGFjZW1lbnRzKHNlbGVjdGlvbiwgcmVwbGFjZW1lbnRzKSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG9wZW5DdXJyZW50U2xhY2tSZWYoZWRpdG9yOiBFZGl0b3IpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0ZXh0ID0gZWRpdG9yLmdldFZhbHVlKCk7XG4gICAgY29uc3QgY3Vyc29yT2Zmc2V0ID0gZWRpdG9yLnBvc1RvT2Zmc2V0KGVkaXRvci5nZXRDdXJzb3IoKSk7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gZGV0ZWN0Q2FuZGlkYXRlcyh0ZXh0LCB7IGN1cnNvck9mZnNldCB9KS5maW5kKFxuICAgICAgKGl0ZW0pID0+IGN1cnNvck9mZnNldCA+PSBpdGVtLnN0YXJ0ICYmIGN1cnNvck9mZnNldCA8PSBpdGVtLmVuZFxuICAgICk7XG5cbiAgICBpZiAoIWNhbmRpZGF0ZSkge1xuICAgICAgbmV3IE5vdGljZSgnTm8gU2xhY2sgcmVmZXJlbmNlIHVuZGVyIHRoZSBjdXJzb3IuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVWYWxpZFNlc3Npb24odHJ1ZSkpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnbWVzc2FnZS1wZXJtYWxpbmsnKSB7XG4gICAgICB3aW5kb3cub3BlbihjYW5kaWRhdGUudmFsdWUsICdfYmxhbmsnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdjaGFubmVsLXJlZicpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZXNvbHZlci5yZXNvbHZlQ2hhbm5lbFJlZihjYW5kaWRhdGUudmFsdWUpO1xuXG4gICAgICBpZiAoIXJlc29sdmVkKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1VuYWJsZSB0byByZXNvbHZlIHRoYXQgU2xhY2sgY2hhbm5lbC4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB3aW5kb3cub3BlbihcbiAgICAgICAgYnVpbGRUYXJnZXRVcmwoe1xuICAgICAgICAgIGNoYW5uZWxJZDogcmVzb2x2ZWQuY2hhbm5lbElkLFxuICAgICAgICAgIHRhcmdldDogdGhpcy5zZXR0aW5ncy50YXJnZXQsXG4gICAgICAgICAgdGVhbUlkOiByZXNvbHZlZC50ZWFtSWQsXG4gICAgICAgIH0pLFxuICAgICAgICAnX2JsYW5rJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHRoaXMucmVzb2x2ZXIucmVzb2x2ZURtU2VudGluZWwoY2FuZGlkYXRlLnZhbHVlKTtcblxuICAgIGlmICghcmVzb2x2ZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1VuYWJsZSB0byByZXNvbHZlIHRoYXQgU2xhY2sgRE0uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgd2luZG93Lm9wZW4oYHNsYWNrOi8vdXNlcj90ZWFtPSR7cmVzb2x2ZWQudGVhbUlkfSZpZD0ke3Jlc29sdmVkLnVzZXJJZH1gLCAnX2JsYW5rJyk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbXBsZXRlU2xhY2tDb25uZWN0KHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChwYXJhbXMuZXJyb3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFNsYWNrIHNpZ24taW4gZmFpbGVkOiAke3BhcmFtcy5lcnJvcn1gKTtcbiAgICAgIHRoaXMucGVuZGluZ0F1dGhTdGF0ZSA9IG51bGw7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFwYXJhbXMuY29kZSB8fCAhcGFyYW1zLnN0YXRlIHx8ICF0aGlzLnBlbmRpbmdBdXRoU3RhdGUpIHtcbiAgICAgIHRoaXMucGVuZGluZ0F1dGhTdGF0ZSA9IG51bGw7XG4gICAgICBuZXcgTm90aWNlKCdTbGFjayBzaWduLWluIGNhbGxiYWNrIHdhcyBpbmNvbXBsZXRlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChwYXJhbXMuc3RhdGUgIT09IHRoaXMucGVuZGluZ0F1dGhTdGF0ZS5zdGF0ZSkge1xuICAgICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0gbnVsbDtcbiAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIHNpZ24taW4gc3RhdGUgZGlkIG5vdCBtYXRjaCB0aGUgcGVuZGluZyByZXF1ZXN0LicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzZXNzaW9uID0gYXdhaXQgY29tcGxldGVTbGFja0F1dGgodGhpcy5yZXF1ZXN0U2xhY2tBcGlGb3JtLmJpbmQodGhpcyksIHtcbiAgICAgICAgY2xpZW50SWQ6IHRoaXMuc2V0dGluZ3MuY2xpZW50SWQsXG4gICAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgICBjb2RlVmVyaWZpZXI6IHRoaXMucGVuZGluZ0F1dGhTdGF0ZS5jb2RlVmVyaWZpZXIsXG4gICAgICAgIHJlZGlyZWN0VXJpOiB0aGlzLmdldFJlZGlyZWN0VXJpKCksXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoeyBzZXNzaW9uIH0pO1xuICAgICAgdGhpcy5wZW5kaW5nQXV0aFN0YXRlID0gbnVsbDtcbiAgICAgIG5ldyBOb3RpY2UoYENvbm5lY3RlZCBTbGFjayB3b3Jrc3BhY2UgJHtzZXNzaW9uLndvcmtzcGFjZSB8fCBzZXNzaW9uLnRlYW1JZH0uYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMucGVuZGluZ0F1dGhTdGF0ZSA9IG51bGw7XG4gICAgICBuZXcgTm90aWNlKGBTbGFjayBzaWduLWluIGZhaWxlZDogJHtnZXRFcnJvck1lc3NhZ2UoZXJyb3IpfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlVmFsaWRTZXNzaW9uKG5vdGlmeU9uTWlzc2luZyA9IGZhbHNlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCFoYXNWYWxpZEFjY2Vzc1Rva2VuKHRoaXMuc2V0dGluZ3Muc2Vzc2lvbikpIHtcbiAgICAgIGlmIChub3RpZnlPbk1pc3NpbmcpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnQ29ubmVjdCBTbGFjayB0byByZXNvbHZlIGxpdmUgU2xhY2sgbWV0YWRhdGEuJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYgKCFzaG91bGRSZWZyZXNoU2Vzc2lvbih0aGlzLnNldHRpbmdzLnNlc3Npb24sIHRoaXMuc2V0dGluZ3MucmVmcmVzaExlZXdheU1zKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLmNsaWVudElkIHx8ICF0aGlzLnNldHRpbmdzLnNlc3Npb24ucmVmcmVzaFRva2VuKSB7XG4gICAgICBpZiAobm90aWZ5T25NaXNzaW5nKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIHNlc3Npb24gZXhwaXJlZC4gUmVjb25uZWN0IFNsYWNrLicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlZnJlc2hTZXNzaW9uR2F0ZS5ydW4oYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFzaG91bGRSZWZyZXNoU2Vzc2lvbih0aGlzLnNldHRpbmdzLnNlc3Npb24sIHRoaXMuc2V0dGluZ3MucmVmcmVzaExlZXdheU1zKSkge1xuICAgICAgICByZXR1cm4gaGFzVmFsaWRBY2Nlc3NUb2tlbih0aGlzLnNldHRpbmdzLnNlc3Npb24pO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXNzaW9uID0gYXdhaXQgcmVmcmVzaFNsYWNrU2Vzc2lvbih0aGlzLnJlcXVlc3RTbGFja0FwaUZvcm0uYmluZCh0aGlzKSwge1xuICAgICAgICAgIGNsaWVudElkOiB0aGlzLnNldHRpbmdzLmNsaWVudElkLFxuICAgICAgICAgIHNlc3Npb246IHRoaXMuc2V0dGluZ3Muc2Vzc2lvbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoeyBzZXNzaW9uIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChub3RpZnlPbk1pc3NpbmcpIHtcbiAgICAgICAgICBuZXcgTm90aWNlKGBTbGFjayBzZXNzaW9uIHJlZnJlc2ggZmFpbGVkOiAke2dldEVycm9yTWVzc2FnZShlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRSZWRpcmVjdFVyaSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBgb2JzaWRpYW46Ly8ke0FVVEhfQ0FMTEJBQ0tfQUNUSU9OfWA7XG4gIH1cblxuICBwcml2YXRlIG1heWJlU2hvd1JlY29ubmVjdE5vdGljZSgpOiB2b2lkIHtcbiAgICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMubGFzdEF1dGhOb3RpY2VBdCA8IEFVVEhfUkVDT05ORUNUX05PVElDRV9NUykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubGFzdEF1dGhOb3RpY2VBdCA9IERhdGUubm93KCk7XG4gICAgbmV3IE5vdGljZSgnU2xhY2sgcmVmZXJlbmNlcyBkZXRlY3RlZC4gQ29ubmVjdCBTbGFjayB0byBlbmFibGUgbGl2ZSByZXNvbHV0aW9uLicpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTdGF0ZVRva2VuKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKGNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMTYpKSlcbiAgICAgIC50b1N0cmluZygnYmFzZTY0JylcbiAgICAgIC5yZXBsYWNlKC9cXCsvZywgJy0nKVxuICAgICAgLnJlcGxhY2UoL1xcLy9nLCAnXycpXG4gICAgICAucmVwbGFjZSgvPSskL2csICcnKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVxdWVzdFNsYWNrQXBpRm9ybShyZXF1ZXN0OiBTbGFja0FwaUZvcm1SZXF1ZXN0KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgYm9keTogcmVxdWVzdC5ib2R5LnRvU3RyaW5nKCksXG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZDsgY2hhcnNldD11dGYtOCcsXG4gICAgICBoZWFkZXJzOiByZXF1ZXN0LnRva2VuXG4gICAgICAgID8ge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3JlcXVlc3QudG9rZW59YCxcbiAgICAgICAgICB9XG4gICAgICAgIDoge30sXG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIHRocm93OiBmYWxzZSxcbiAgICAgIHVybDogYGh0dHBzOi8vc2xhY2suY29tL2FwaS8ke3JlcXVlc3QucGF0aH1gLFxuICAgIH0pO1xuXG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA+PSA0MDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2xhY2sgQVBJIHJlcXVlc3QgZmFpbGVkOiAke3Jlc3BvbnNlLnN0YXR1c31gKTtcbiAgICB9XG5cbiAgICBpZiAoIXJlc3BvbnNlLmpzb24/Lm9rKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzcG9uc2UuanNvbj8uZXJyb3IgPz8gYFNsYWNrIEFQSSByZXF1ZXN0IGZhaWxlZDogJHtyZXF1ZXN0LnBhdGh9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb247XG4gIH1cbn1cblxuY2xhc3MgU2xhY2tCYXNlc1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBTbGFja0Jhc2VzUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uZ2V0U2V0dGluZ3MoKTtcblxuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnaDInLCB7IHRleHQ6ICdTbGFjayBCYXNlcycgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTbGFjayBjb25uZWN0aW9uJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBoYXNWYWxpZEFjY2Vzc1Rva2VuKHNldHRpbmdzLnNlc3Npb24pXG4gICAgICAgICAgPyBgQ29ubmVjdGVkIHRvICR7c2V0dGluZ3Muc2Vzc2lvbi53b3Jrc3BhY2UgfHwgc2V0dGluZ3Muc2Vzc2lvbi50ZWFtSWR9LmBcbiAgICAgICAgICA6ICdOb3QgY29ubmVjdGVkLidcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0Nvbm5lY3QnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5jb25uZWN0U2xhY2soKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0Rpc2Nvbm5lY3QnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5kaXNjb25uZWN0U2xhY2soKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICBuZXcgTm90aWNlKCdTbGFjayBzZXNzaW9uIGNsZWFyZWQuJyk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQ2xpZW50IElEJylcbiAgICAgIC5zZXREZXNjKCdTbGFjayBhcHAgY2xpZW50IElEIGZvciB0aGUgZGVza3RvcCBQS0NFIGZsb3cuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKHNldHRpbmdzLmNsaWVudElkKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBjbGllbnRJZDogdmFsdWUudHJpbSgpIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1VzZXIgc2NvcGVzJylcbiAgICAgIC5zZXREZXNjKCdDb21tYS1zZXBhcmF0ZWQgU2xhY2sgdXNlciBzY29wZXMgcmVxdWVzdGVkIGR1cmluZyBDb25uZWN0IFNsYWNrLicpXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoc2V0dGluZ3Muc2NvcGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBzY29wZXM6IHZhbHVlLnRyaW0oKSB8fCBERUZBVUxUX1NFVFRJTkdTLnNjb3BlcyB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdNZXNzYWdlIHRlbXBsYXRlJylcbiAgICAgIC5zZXREZXNjKCdDb250cm9scyBob3cgcGFzdGVkIFNsYWNrIG1lc3NhZ2UgcGVybWFsaW5rcyByZW5kZXIuJylcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShzZXR0aW5ncy5tZXNzYWdlVGVtcGxhdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IG1lc3NhZ2VUZW1wbGF0ZTogdmFsdWUudHJpbSgpIHx8IERFRkFVTFRfU0VUVElOR1MubWVzc2FnZVRlbXBsYXRlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ByZWZlcnJlZCBsaW5rIHRhcmdldCcpXG4gICAgICAuc2V0RGVzYygnQ2hvb3NlIFNsYWNrIGFwcCBsaW5rcyBvciB0aGUgd2ViL2FwcF9yZWRpcmVjdCBmYWxsYmFjay4nKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKCdhcHAnLCAnU2xhY2sgYXBwJylcbiAgICAgICAgICAuYWRkT3B0aW9uKCd3ZWInLCAnV2ViIC8gYXBwX3JlZGlyZWN0JylcbiAgICAgICAgICAuc2V0VmFsdWUoc2V0dGluZ3MudGFyZ2V0KVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IHRhcmdldDogdmFsdWUgPT09ICd3ZWInID8gJ3dlYicgOiAnYXBwJyB9KTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0lkbGUgZGVsYXknKVxuICAgICAgLnNldERlc2MoJ0hvdyBsb25nIHRoZSBwbHVnaW4gd2FpdHMgYWZ0ZXIgdHlwaW5nIGJlZm9yZSBzY2FubmluZyB0aGUgbm90ZS4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHNldHRpbmdzLmlkbGVEZWxheU1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKE51bWJlci5pc05hTihwYXJzZWQpIHx8IHBhcnNlZCA8IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBpZGxlRGVsYXlNczogcGFyc2VkIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1JlZnJlc2ggbGVld2F5JylcbiAgICAgIC5zZXREZXNjKCdIb3cgZWFybHkgdGhlIHBsdWdpbiByZWZyZXNoZXMgYW4gZXhwaXJpbmcgU2xhY2sgc2Vzc2lvbi4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHNldHRpbmdzLnJlZnJlc2hMZWV3YXlNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmIChOdW1iZXIuaXNOYU4ocGFyc2VkKSB8fCBwYXJzZWQgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgcmVmcmVzaExlZXdheU1zOiBwYXJzZWQgfSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQXV0by1saW5rIGNoYW5uZWxzJylcbiAgICAgIC5zZXREZXNjKCdSZXNvbHZlICNjaGFubmVsIHJlZmVyZW5jZXMgYWZ0ZXIgdGhlIGlkbGUgZGVsYXkuJylcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHNldHRpbmdzLmVuYWJsZUNoYW5uZWxzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBlbmFibGVDaGFubmVsczogdmFsdWUgfSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQXV0by1saW5rIERNIHNlbnRpbmVscycpXG4gICAgICAuc2V0RGVzYygnUmVzb2x2ZSBleHBsaWNpdCBkbTpAbmFtZSBvciBkbTplbWFpbCByZWZlcmVuY2VzLicpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShzZXR0aW5ncy5lbmFibGVEbVNlbnRpbmVscykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgZW5hYmxlRG1TZW50aW5lbHM6IHZhbHVlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0F1dG8tbGluayBwYXN0ZWQgcGVybWFsaW5rcycpXG4gICAgICAuc2V0RGVzYygnQ29udmVydCBwYXN0ZWQgU2xhY2sgbWVzc2FnZSBwZXJtYWxpbmtzIGludG8gc21hcnQgTWFya2Rvd24gbGlua3MuJylcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHNldHRpbmdzLmVuYWJsZVBlcm1hbGlua3MpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IGVuYWJsZVBlcm1hbGlua3M6IHZhbHVlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1Rlc3QgU2xhY2sgY29ubmVjdGlvbicpXG4gICAgICAuc2V0RGVzYygnQ2hlY2sgd2hldGhlciBhIGxvY2FsIFNsYWNrIHNlc3Npb24gaXMgY29uZmlndXJlZC4nKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnVGVzdCcpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNob3dDb25uZWN0aW9uU3RhdHVzKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbmZ1bmN0aW9uIGdldEVycm9yTWVzc2FnZShlcnJvcjogdW5rbm93bik6IHN0cmluZyB7XG4gIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTbGFja1Nlc3Npb24gfSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGludGVyZmFjZSBTbGFja0FwaUZvcm1SZXF1ZXN0IHtcbiAgYm9keTogVVJMU2VhcmNoUGFyYW1zO1xuICBwYXRoOiBzdHJpbmc7XG4gIHRva2VuPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBTbGFja0FwaUZvcm1SZXF1ZXN0ZXIgPSAocmVxdWVzdDogU2xhY2tBcGlGb3JtUmVxdWVzdCkgPT4gUHJvbWlzZTxhbnk+O1xuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTbGFja0F1dGhvcml6ZVVybChpbnB1dDoge1xuICBjbGllbnRJZDogc3RyaW5nO1xuICBjb2RlQ2hhbGxlbmdlOiBzdHJpbmc7XG4gIHJlZGlyZWN0VXJpOiBzdHJpbmc7XG4gIHNjb3Blczogc3RyaW5nO1xuICBzdGF0ZTogc3RyaW5nO1xufSk6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoJ2h0dHBzOi8vc2xhY2suY29tL29hdXRoL3YyL2F1dGhvcml6ZScpO1xuXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdjbGllbnRfaWQnLCBpbnB1dC5jbGllbnRJZCk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdjb2RlX2NoYWxsZW5nZScsIGlucHV0LmNvZGVDaGFsbGVuZ2UpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnY29kZV9jaGFsbGVuZ2VfbWV0aG9kJywgJ1MyNTYnKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlZGlyZWN0X3VyaScsIGlucHV0LnJlZGlyZWN0VXJpKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3Jlc3BvbnNlX3R5cGUnLCAnY29kZScpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnc3RhdGUnLCBpbnB1dC5zdGF0ZSk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd1c2VyX3Njb3BlJywgaW5wdXQuc2NvcGVzKTtcblxuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wbGV0ZVNsYWNrQXV0aChcbiAgcmVxdWVzdGVyOiBTbGFja0FwaUZvcm1SZXF1ZXN0ZXIsXG4gIGlucHV0OiB7XG4gICAgY2xpZW50SWQ6IHN0cmluZztcbiAgICBjb2RlOiBzdHJpbmc7XG4gICAgY29kZVZlcmlmaWVyOiBzdHJpbmc7XG4gICAgbm93PzogbnVtYmVyO1xuICAgIHJlZGlyZWN0VXJpOiBzdHJpbmc7XG4gIH1cbik6IFByb21pc2U8U2xhY2tTZXNzaW9uPiB7XG4gIGNvbnN0IHRva2VuUmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0ZXIoe1xuICAgIGJvZHk6IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgY2xpZW50X2lkOiBpbnB1dC5jbGllbnRJZCxcbiAgICAgIGNvZGU6IGlucHV0LmNvZGUsXG4gICAgICBjb2RlX3ZlcmlmaWVyOiBpbnB1dC5jb2RlVmVyaWZpZXIsXG4gICAgICBncmFudF90eXBlOiAnYXV0aG9yaXphdGlvbl9jb2RlJyxcbiAgICAgIHJlZGlyZWN0X3VyaTogaW5wdXQucmVkaXJlY3RVcmksXG4gICAgfSksXG4gICAgcGF0aDogJ29hdXRoLnYyLmFjY2VzcycsXG4gIH0pO1xuICBjb25zdCBiYXNlU2Vzc2lvbiA9IG1hcFNsYWNrVG9rZW5SZXNwb25zZSh0b2tlblJlc3BvbnNlLCBpbnB1dC5ub3cpO1xuICBjb25zdCBpZGVudGl0eSA9IGF3YWl0IHJlcXVlc3Rlcih7XG4gICAgYm9keTogbmV3IFVSTFNlYXJjaFBhcmFtcygpLFxuICAgIHBhdGg6ICdhdXRoLnRlc3QnLFxuICAgIHRva2VuOiBiYXNlU2Vzc2lvbi5hY2Nlc3NUb2tlbixcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5iYXNlU2Vzc2lvbixcbiAgICB0ZWFtSWQ6IGlkZW50aXR5LnRlYW1faWQgPz8gYmFzZVNlc3Npb24udGVhbUlkLFxuICAgIHdvcmtzcGFjZTogcGFyc2VXb3Jrc3BhY2VTbHVnKGlkZW50aXR5LnVybCkgPz8gYmFzZVNlc3Npb24ud29ya3NwYWNlLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlUGtjZVBhaXIoXG4gIHJhbmRvbVNvdXJjZTogKCkgPT4gVWludDhBcnJheSA9ICgpID0+IGNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMzIpKVxuKTogUHJvbWlzZTx7IGNvZGVDaGFsbGVuZ2U6IHN0cmluZzsgY29kZVZlcmlmaWVyOiBzdHJpbmcgfT4ge1xuICBjb25zdCBjb2RlVmVyaWZpZXIgPSB0b0Jhc2U2NFVybChyYW5kb21Tb3VyY2UoKSk7XG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCdTSEEtMjU2JywgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGNvZGVWZXJpZmllcikpO1xuXG4gIHJldHVybiB7XG4gICAgY29kZUNoYWxsZW5nZTogdG9CYXNlNjRVcmwobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSksXG4gICAgY29kZVZlcmlmaWVyLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNsYWNrU2Vzc2lvbihcbiAgcmVxdWVzdGVyOiBTbGFja0FwaUZvcm1SZXF1ZXN0ZXIsXG4gIGlucHV0OiB7XG4gICAgY2xpZW50SWQ6IHN0cmluZztcbiAgICBub3c/OiBudW1iZXI7XG4gICAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uO1xuICB9XG4pOiBQcm9taXNlPFNsYWNrU2Vzc2lvbj4ge1xuICBpZiAoIWlucHV0LnNlc3Npb24ucmVmcmVzaFRva2VuKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdNaXNzaW5nIFNsYWNrIHJlZnJlc2ggdG9rZW4nKTtcbiAgfVxuXG4gIGNvbnN0IHRva2VuUmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0ZXIoe1xuICAgIGJvZHk6IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgY2xpZW50X2lkOiBpbnB1dC5jbGllbnRJZCxcbiAgICAgIGdyYW50X3R5cGU6ICdyZWZyZXNoX3Rva2VuJyxcbiAgICAgIHJlZnJlc2hfdG9rZW46IGlucHV0LnNlc3Npb24ucmVmcmVzaFRva2VuLFxuICAgIH0pLFxuICAgIHBhdGg6ICdvYXV0aC52Mi5hY2Nlc3MnLFxuICB9KTtcbiAgY29uc3QgcmVmcmVzaGVkID0gbWFwU2xhY2tUb2tlblJlc3BvbnNlKHRva2VuUmVzcG9uc2UsIGlucHV0Lm5vdyk7XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZWZyZXNoZWQsXG4gICAgdGVhbUlkOiByZWZyZXNoZWQudGVhbUlkIHx8IGlucHV0LnNlc3Npb24udGVhbUlkLFxuICAgIHdvcmtzcGFjZTogcmVmcmVzaGVkLndvcmtzcGFjZSB8fCBpbnB1dC5zZXNzaW9uLndvcmtzcGFjZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwU2xhY2tUb2tlblJlc3BvbnNlKHBheWxvYWQ6IGFueSwgbm93ID0gRGF0ZS5ub3coKSk6IFNsYWNrU2Vzc2lvbiB7XG4gIGNvbnN0IGF1dGhlZFVzZXIgPSBwYXlsb2FkLmF1dGhlZF91c2VyID8/IHt9O1xuXG4gIHJldHVybiB7XG4gICAgYWNjZXNzVG9rZW46IGF1dGhlZFVzZXIuYWNjZXNzX3Rva2VuID8/ICcnLFxuICAgIGV4cGlyZXNBdDogYXV0aGVkVXNlci5leHBpcmVzX2luID8gbm93ICsgYXV0aGVkVXNlci5leHBpcmVzX2luICogMTAwMCA6IDAsXG4gICAgcmVmcmVzaFRva2VuOiBhdXRoZWRVc2VyLnJlZnJlc2hfdG9rZW4gPz8gJycsXG4gICAgdGVhbUlkOiBwYXlsb2FkLnRlYW0/LmlkID8/ICcnLFxuICAgIHdvcmtzcGFjZTogcGFyc2VXb3Jrc3BhY2VTbHVnKHBheWxvYWQudXJsKSA/PyAnJyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VXb3Jrc3BhY2VTbHVnKHVybDogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghdXJsKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0cnkge1xuICAgIHJldHVybiBuZXcgVVJMKHVybCkuaG9zdG5hbWUuc3BsaXQoJy4nKVswXSA/PyBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b0Jhc2U2NFVybChpbnB1dDogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIHJldHVybiBCdWZmZXIuZnJvbShpbnB1dClcbiAgICAudG9TdHJpbmcoJ2Jhc2U2NCcpXG4gICAgLnJlcGxhY2UoL1xcKy9nLCAnLScpXG4gICAgLnJlcGxhY2UoL1xcLy9nLCAnXycpXG4gICAgLnJlcGxhY2UoLz0rJC9nLCAnJyk7XG59XG4iLCAiZXhwb3J0IGNsYXNzIFR0bENhY2hlPFQ+IHtcbiAgcHJpdmF0ZSByZWFkb25seSBlbnRyaWVzID0gbmV3IE1hcDxzdHJpbmcsIHsgZXhwaXJlc0F0OiBudW1iZXI7IHZhbHVlOiBUIH0+KCk7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB0dGxNczogbnVtYmVyKSB7fVxuXG4gIGdldChrZXk6IHN0cmluZyk6IFQgfCBudWxsIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cmllcy5nZXQoa2V5KTtcblxuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmIChlbnRyeS5leHBpcmVzQXQgPD0gRGF0ZS5ub3coKSkge1xuICAgICAgdGhpcy5lbnRyaWVzLmRlbGV0ZShrZXkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJ5LnZhbHVlO1xuICB9XG5cbiAgc2V0KGtleTogc3RyaW5nLCB2YWx1ZTogVCk6IHZvaWQge1xuICAgIHRoaXMuZW50cmllcy5zZXQoa2V5LCB7XG4gICAgICBleHBpcmVzQXQ6IERhdGUubm93KCkgKyB0aGlzLnR0bE1zLFxuICAgICAgdmFsdWUsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IENhbmRpZGF0ZUtpbmQsIENhbmRpZGF0ZU1hdGNoIH0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IERNX1NFTlRJTkVMX1BBVFRFUk4gPSAvXFxiZG06KFtAXFx3ListXSspL2c7XG5jb25zdCBDSEFOTkVMX1JFRl9QQVRURVJOID0gLyhefFtcXHMoXSkjKFthLXowLTkuXy1dKykvZ2k7XG5jb25zdCBNRVNTQUdFX0xJTktfUEFUVEVSTiA9IC9odHRwczpcXC9cXC9bYS16MC05LV0rXFwuc2xhY2tcXC5jb21cXC9hcmNoaXZlc1xcL1tBLVowLTldK1xcL3BcXGR7MTZ9L2dpO1xuY29uc3QgTUFSS0RPV05fTElOS19QQVRURVJOID0gL1xcW1teXFxdXSpdXFwoW14pXStcXCkvZztcbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvXFxbXFxbW15bXFxdXStdXS9nO1xuXG5leHBvcnQgZnVuY3Rpb24gZGV0ZWN0Q2FuZGlkYXRlcyhcbiAgdGV4dDogc3RyaW5nLFxuICBpbnB1dDoge1xuICAgIGN1cnNvck9mZnNldDogbnVtYmVyO1xuICB9XG4pOiBDYW5kaWRhdGVNYXRjaFtdIHtcbiAgY29uc3QgZXhjbHVkZWRSYW5nZXMgPSBnZXRFeGNsdWRlZFJhbmdlcyh0ZXh0KTtcbiAgY29uc3QgY2FuZGlkYXRlczogQ2FuZGlkYXRlTWF0Y2hbXSA9IFtdO1xuXG4gIGFkZE1hdGNoZXMoY2FuZGlkYXRlcywgdGV4dCwgTUVTU0FHRV9MSU5LX1BBVFRFUk4sICdtZXNzYWdlLXBlcm1hbGluaycsIGV4Y2x1ZGVkUmFuZ2VzLCBpbnB1dC5jdXJzb3JPZmZzZXQpO1xuICBhZGRNYXRjaGVzKGNhbmRpZGF0ZXMsIHRleHQsIERNX1NFTlRJTkVMX1BBVFRFUk4sICdkbS1zZW50aW5lbCcsIGV4Y2x1ZGVkUmFuZ2VzLCBpbnB1dC5jdXJzb3JPZmZzZXQpO1xuXG4gIGZvciAoY29uc3QgbWF0Y2ggb2YgdGV4dC5tYXRjaEFsbChDSEFOTkVMX1JFRl9QQVRURVJOKSkge1xuICAgIGNvbnN0IHByZWZpeCA9IG1hdGNoWzFdID8/ICcnO1xuICAgIGNvbnN0IHZhbHVlID0gYCMke21hdGNoWzJdfWA7XG4gICAgY29uc3Qgc3RhcnQgPSAobWF0Y2guaW5kZXggPz8gMCkgKyBwcmVmaXgubGVuZ3RoO1xuICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgdmFsdWUubGVuZ3RoO1xuXG4gICAgaWYgKCFzaG91bGRTa2lwQ2FuZGlkYXRlKHN0YXJ0LCBlbmQsIGV4Y2x1ZGVkUmFuZ2VzLCBpbnB1dC5jdXJzb3JPZmZzZXQpKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2goeyBlbmQsIGtpbmQ6ICdjaGFubmVsLXJlZicsIHN0YXJ0LCB2YWx1ZSB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gY2FuZGlkYXRlcy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zdGFydCAtIHJpZ2h0LnN0YXJ0KTtcbn1cblxuZnVuY3Rpb24gYWRkTWF0Y2hlcyhcbiAgY2FuZGlkYXRlczogQ2FuZGlkYXRlTWF0Y2hbXSxcbiAgdGV4dDogc3RyaW5nLFxuICBwYXR0ZXJuOiBSZWdFeHAsXG4gIGtpbmQ6IENhbmRpZGF0ZUtpbmQsXG4gIGV4Y2x1ZGVkUmFuZ2VzOiBBcnJheTx7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0+LFxuICBjdXJzb3JPZmZzZXQ6IG51bWJlclxuKTogdm9pZCB7XG4gIGZvciAoY29uc3QgbWF0Y2ggb2YgdGV4dC5tYXRjaEFsbChwYXR0ZXJuKSkge1xuICAgIGNvbnN0IHZhbHVlID0gbWF0Y2hbMF07XG4gICAgY29uc3Qgc3RhcnQgPSBtYXRjaC5pbmRleCA/PyAwO1xuICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgdmFsdWUubGVuZ3RoO1xuXG4gICAgaWYgKCFzaG91bGRTa2lwQ2FuZGlkYXRlKHN0YXJ0LCBlbmQsIGV4Y2x1ZGVkUmFuZ2VzLCBjdXJzb3JPZmZzZXQpKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2goeyBlbmQsIGtpbmQsIHN0YXJ0LCB2YWx1ZSB9KTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0RXhjbHVkZWRSYW5nZXModGV4dDogc3RyaW5nKTogQXJyYXk8eyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9PiB7XG4gIGNvbnN0IHJhbmdlcyA9IGNvbGxlY3RSYW5nZXModGV4dCwgTUFSS0RPV05fTElOS19QQVRURVJOKTtcblxuICBmb3IgKGNvbnN0IHJhbmdlIG9mIGNvbGxlY3RSYW5nZXModGV4dCwgV0lLSUxJTktfUEFUVEVSTikpIHtcbiAgICByYW5nZXMucHVzaChyYW5nZSk7XG4gIH1cblxuICBjb25zdCBmcm9udG1hdHRlclJhbmdlID0gZ2V0RnJvbnRtYXR0ZXJSYW5nZSh0ZXh0KTtcblxuICBpZiAoZnJvbnRtYXR0ZXJSYW5nZSkge1xuICAgIHJhbmdlcy5wdXNoKGZyb250bWF0dGVyUmFuZ2UpO1xuICB9XG5cbiAgcmV0dXJuIHJhbmdlcztcbn1cblxuZnVuY3Rpb24gY29sbGVjdFJhbmdlcyh0ZXh0OiBzdHJpbmcsIHBhdHRlcm46IFJlZ0V4cCk6IEFycmF5PHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfT4ge1xuICBjb25zdCByYW5nZXM6IEFycmF5PHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfT4gPSBbXTtcblxuICBmb3IgKGNvbnN0IG1hdGNoIG9mIHRleHQubWF0Y2hBbGwocGF0dGVybikpIHtcbiAgICBjb25zdCBzdGFydCA9IG1hdGNoLmluZGV4ID8/IDA7XG4gICAgcmFuZ2VzLnB1c2goeyBlbmQ6IHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoLCBzdGFydCB9KTtcbiAgfVxuXG4gIHJldHVybiByYW5nZXM7XG59XG5cbmZ1bmN0aW9uIGdldEZyb250bWF0dGVyUmFuZ2UodGV4dDogc3RyaW5nKTogeyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGlmICghdGV4dC5zdGFydHNXaXRoKCctLS1cXG4nKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgY2xvc2luZ0luZGV4ID0gdGV4dC5pbmRleE9mKCdcXG4tLS1cXG4nLCA0KTtcblxuICBpZiAoY2xvc2luZ0luZGV4ID09PSAtMSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHsgZW5kOiBjbG9zaW5nSW5kZXggKyA1LCBzdGFydDogMCB9O1xufVxuXG5mdW5jdGlvbiBzaG91bGRTa2lwQ2FuZGlkYXRlKFxuICBzdGFydDogbnVtYmVyLFxuICBlbmQ6IG51bWJlcixcbiAgZXhjbHVkZWRSYW5nZXM6IEFycmF5PHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfT4sXG4gIGN1cnNvck9mZnNldDogbnVtYmVyXG4pOiBib29sZWFuIHtcbiAgaWYgKGN1cnNvck9mZnNldCA+PSBzdGFydCAmJiBjdXJzb3JPZmZzZXQgPD0gZW5kKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZXhjbHVkZWRSYW5nZXMuc29tZSgocmFuZ2UpID0+IHN0YXJ0IDwgcmFuZ2UuZW5kICYmIGVuZCA+IHJhbmdlLnN0YXJ0KTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IExpbmtUYXJnZXRQcmVmZXJlbmNlLCBSZW5kZXJWYWx1ZXMgfSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclNtYXJ0TGluayh0ZW1wbGF0ZTogc3RyaW5nLCB2YWx1ZXM6IFJlbmRlclZhbHVlcyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXHsoXFx3KylcXH0vZywgKF9tYXRjaCwgdG9rZW46IGtleW9mIFJlbmRlclZhbHVlcykgPT4gdmFsdWVzW3Rva2VuXSA/PyAnJyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRhcmdldFVybChpbnB1dDoge1xuICBjaGFubmVsSWQ6IHN0cmluZztcbiAgdGFyZ2V0OiBMaW5rVGFyZ2V0UHJlZmVyZW5jZTtcbiAgdGVhbUlkOiBzdHJpbmc7XG59KTogc3RyaW5nIHtcbiAgaWYgKGlucHV0LnRhcmdldCA9PT0gJ2FwcCcpIHtcbiAgICByZXR1cm4gYHNsYWNrOi8vY2hhbm5lbD90ZWFtPSR7aW5wdXQudGVhbUlkfSZpZD0ke2lucHV0LmNoYW5uZWxJZH1gO1xuICB9XG5cbiAgcmV0dXJuIGBodHRwczovL3NsYWNrLmNvbS9hcHBfcmVkaXJlY3Q/dGVhbT0ke2lucHV0LnRlYW1JZH0mY2hhbm5lbD0ke2lucHV0LmNoYW5uZWxJZH1gO1xufVxuIiwgImltcG9ydCB0eXBlIHsgUmVuZGVyVmFsdWVzLCBUZXh0UmVwbGFjZW1lbnQgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGRldGVjdENhbmRpZGF0ZXMgfSBmcm9tICcuL2RldGVjdG9yJztcbmltcG9ydCB7IGJ1aWxkVGFyZ2V0VXJsLCByZW5kZXJTbWFydExpbmsgfSBmcm9tICcuL3JlbmRlcmVyJztcblxuaW50ZXJmYWNlIEVuZ2luZVJlc29sdmVyIHtcbiAgcmVzb2x2ZUNoYW5uZWxSZWYodmFsdWU6IHN0cmluZyk6IFByb21pc2U8eyBjaGFubmVsSWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyB0ZWFtSWQ6IHN0cmluZyB9IHwgbnVsbD47XG4gIHJlc29sdmVEbVNlbnRpbmVsKHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPHsgZGlzcGxheU5hbWU6IHN0cmluZzsgdGVhbUlkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nIH0gfCBudWxsPjtcbiAgcmVzb2x2ZVBlcm1hbGluayh2YWx1ZTogc3RyaW5nKTogUHJvbWlzZTxSZW5kZXJWYWx1ZXM+O1xufVxuXG5pbnRlcmZhY2UgRW5naW5lU2V0dGluZ3Mge1xuICBlbmFibGVDaGFubmVsczogYm9vbGVhbjtcbiAgZW5hYmxlRG1TZW50aW5lbHM6IGJvb2xlYW47XG4gIGVuYWJsZVBlcm1hbGlua3M6IGJvb2xlYW47XG4gIG1lc3NhZ2VUZW1wbGF0ZTogc3RyaW5nO1xuICB0YXJnZXQ6ICdhcHAnIHwgJ3dlYic7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwbGFuU2xhY2tMaW5rUmVwbGFjZW1lbnRzKFxuICB0ZXh0OiBzdHJpbmcsXG4gIGlucHV0OiB7XG4gICAgY3Vyc29yT2Zmc2V0OiBudW1iZXI7XG4gICAgcmVzb2x2ZXI6IEVuZ2luZVJlc29sdmVyO1xuICAgIHNldHRpbmdzOiBFbmdpbmVTZXR0aW5ncztcbiAgfVxuKTogUHJvbWlzZTxUZXh0UmVwbGFjZW1lbnRbXT4ge1xuICBjb25zdCBjYW5kaWRhdGVzID0gZGV0ZWN0Q2FuZGlkYXRlcyh0ZXh0LCB7IGN1cnNvck9mZnNldDogaW5wdXQuY3Vyc29yT2Zmc2V0IH0pO1xuICBjb25zdCByZXBsYWNlbWVudHM6IFRleHRSZXBsYWNlbWVudFtdID0gW107XG5cbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ21lc3NhZ2UtcGVybWFsaW5rJyAmJiBpbnB1dC5zZXR0aW5ncy5lbmFibGVQZXJtYWxpbmtzKSB7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBhd2FpdCBpbnB1dC5yZXNvbHZlci5yZXNvbHZlUGVybWFsaW5rKGNhbmRpZGF0ZS52YWx1ZSk7XG4gICAgICByZXBsYWNlbWVudHMucHVzaCh7XG4gICAgICAgIGVuZDogY2FuZGlkYXRlLmVuZCxcbiAgICAgICAgc3RhcnQ6IGNhbmRpZGF0ZS5zdGFydCxcbiAgICAgICAgdGV4dDogcmVuZGVyU21hcnRMaW5rKGlucHV0LnNldHRpbmdzLm1lc3NhZ2VUZW1wbGF0ZSwge1xuICAgICAgICAgIC4uLnZhbHVlcyxcbiAgICAgICAgICB1cmw6IHZhbHVlcy51cmwgPz8gY2FuZGlkYXRlLnZhbHVlLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnY2hhbm5lbC1yZWYnICYmIGlucHV0LnNldHRpbmdzLmVuYWJsZUNoYW5uZWxzKSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IGlucHV0LnJlc29sdmVyLnJlc29sdmVDaGFubmVsUmVmKGNhbmRpZGF0ZS52YWx1ZSk7XG5cbiAgICAgIGlmIChyZXNvbHZlZCkge1xuICAgICAgICByZXBsYWNlbWVudHMucHVzaCh7XG4gICAgICAgICAgZW5kOiBjYW5kaWRhdGUuZW5kLFxuICAgICAgICAgIHN0YXJ0OiBjYW5kaWRhdGUuc3RhcnQsXG4gICAgICAgICAgdGV4dDogYFsjJHtyZXNvbHZlZC5uYW1lfV0oJHtidWlsZFRhcmdldFVybCh7XG4gICAgICAgICAgICBjaGFubmVsSWQ6IHJlc29sdmVkLmNoYW5uZWxJZCxcbiAgICAgICAgICAgIHRhcmdldDogaW5wdXQuc2V0dGluZ3MudGFyZ2V0LFxuICAgICAgICAgICAgdGVhbUlkOiByZXNvbHZlZC50ZWFtSWQsXG4gICAgICAgICAgfSl9KWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdkbS1zZW50aW5lbCcgJiYgaW5wdXQuc2V0dGluZ3MuZW5hYmxlRG1TZW50aW5lbHMpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgaW5wdXQucmVzb2x2ZXIucmVzb2x2ZURtU2VudGluZWwoY2FuZGlkYXRlLnZhbHVlKTtcblxuICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgIHJlcGxhY2VtZW50cy5wdXNoKHtcbiAgICAgICAgICBlbmQ6IGNhbmRpZGF0ZS5lbmQsXG4gICAgICAgICAgc3RhcnQ6IGNhbmRpZGF0ZS5zdGFydCxcbiAgICAgICAgICB0ZXh0OiBgW0RNICR7cmVzb2x2ZWQuZGlzcGxheU5hbWV9XSgke2J1aWxkVXNlclRhcmdldFVybChyZXNvbHZlZC50ZWFtSWQsIHJlc29sdmVkLnVzZXJJZCl9KWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXBsYWNlbWVudHM7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkVXNlclRhcmdldFVybCh0ZWFtSWQ6IHN0cmluZywgdXNlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNsYWNrOi8vdXNlcj90ZWFtPSR7dGVhbUlkfSZpZD0ke3VzZXJJZH1gO1xufVxuIiwgImltcG9ydCB0eXBlIHsgUGFyc2VkU2xhY2tQZXJtYWxpbmsgfSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgU0xBQ0tfUEVSTUFMSU5LX1BBVFRFUk4gPSAvXlxcL2FyY2hpdmVzXFwvKFteL10rKVxcL3AoXFxkezE2fSkkLztcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2xhY2tQZXJtYWxpbmsodXJsOiBzdHJpbmcpOiBQYXJzZWRTbGFja1Blcm1hbGluayB8IG51bGwge1xuICBsZXQgcGFyc2VkVXJsOiBVUkw7XG5cbiAgdHJ5IHtcbiAgICBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgbWF0Y2ggPSBwYXJzZWRVcmwucGF0aG5hbWUubWF0Y2goU0xBQ0tfUEVSTUFMSU5LX1BBVFRFUk4pO1xuXG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IFssIGNoYW5uZWxJZCwgcGFja2VkVGltZXN0YW1wXSA9IG1hdGNoO1xuXG4gIHJldHVybiB7XG4gICAgY2hhbm5lbElkLFxuICAgIHRzOiBgJHtwYWNrZWRUaW1lc3RhbXAuc2xpY2UoMCwgMTApfS4ke3BhY2tlZFRpbWVzdGFtcC5zbGljZSgxMCl9YCxcbiAgICB1cmwsXG4gICAgd29ya3NwYWNlOiBwYXJzZWRVcmwuaG9zdG5hbWUuc3BsaXQoJy4nKVswXSxcbiAgfTtcbn1cbiIsICJpbXBvcnQgeyBwYXJzZVNsYWNrUGVybWFsaW5rIH0gZnJvbSAnLi9wZXJtYWxpbmsnO1xuaW1wb3J0IHR5cGUgeyBTbGFja1NlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2UnO1xuaW1wb3J0IHR5cGUgeyBSZW5kZXJWYWx1ZXMsIFNsYWNrQ2hhbm5lbCwgU2xhY2tTZXNzaW9uLCBTbGFja1VzZXIgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IFR0bENhY2hlIH0gZnJvbSAnLi9jYWNoZSc7XG5cbmludGVyZmFjZSBSZXNvbHZlckRlcGVuZGVuY2llcyB7XG4gIGNoYW5uZWxDYWNoZTogVHRsQ2FjaGU8U2xhY2tDaGFubmVsPjtcbiAgZmFpbGVkTG9va3VwQ2FjaGU6IFR0bENhY2hlPGJvb2xlYW4+O1xuICBzZXJ2aWNlOiBTbGFja1NlcnZpY2U7XG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbjtcbiAgdXNlckNhY2hlOiBUdGxDYWNoZTxTbGFja1VzZXI+O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVzb2x2ZXIoZGVwczogUmVzb2x2ZXJEZXBlbmRlbmNpZXMpIHtcbiAgcmV0dXJuIHtcbiAgICByZXNvbHZlQ2hhbm5lbFJlZjogYXN5bmMgKHZhbHVlOiBzdHJpbmcpID0+IHJlc29sdmVDaGFubmVsUmVmKGRlcHMsIHZhbHVlKSxcbiAgICByZXNvbHZlRG1TZW50aW5lbDogYXN5bmMgKHZhbHVlOiBzdHJpbmcpID0+IHJlc29sdmVEbVNlbnRpbmVsKGRlcHMsIHZhbHVlKSxcbiAgICByZXNvbHZlUGVybWFsaW5rOiBhc3luYyAodXJsOiBzdHJpbmcpID0+IHJlc29sdmVQZXJtYWxpbmsoZGVwcywgdXJsKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVBlcm1hbGluayhkZXBzOiBSZXNvbHZlckRlcGVuZGVuY2llcywgdXJsOiBzdHJpbmcpOiBQcm9taXNlPFJlbmRlclZhbHVlcz4ge1xuICBjb25zdCBwYXJzZWQgPSBwYXJzZVNsYWNrUGVybWFsaW5rKHVybCk7XG5cbiAgaWYgKCFwYXJzZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vuc3VwcG9ydGVkIFNsYWNrIHBlcm1hbGluaycpO1xuICB9XG5cbiAgY29uc3QgZmFsbGJhY2s6IFJlbmRlclZhbHVlcyA9IHtcbiAgICBjaGFubmVsX2lkOiBwYXJzZWQuY2hhbm5lbElkLFxuICAgIHRzOiBwYXJzZWQudHMsXG4gICAgdXJsOiBwYXJzZWQudXJsLFxuICAgIHdvcmtzcGFjZTogcGFyc2VkLndvcmtzcGFjZSxcbiAgfTtcblxuICBpZiAoZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5nZXQocGFyc2VkLnVybCkpIHtcbiAgICByZXR1cm4gZmFsbGJhY2s7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBhd2FpdCBkZXBzLnNlcnZpY2UuZ2V0TWVzc2FnZShwYXJzZWQudXJsKTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5mYWxsYmFjayxcbiAgICAgIGF1dGhvcjogbWVzc2FnZS5hdXRob3JOYW1lLFxuICAgICAgYXV0aG9yX2lkOiBtZXNzYWdlLmF1dGhvcklkLFxuICAgICAgY2hhbm5lbDogbWVzc2FnZS5jaGFubmVsTmFtZSxcbiAgICAgIHRleHQ6IG1lc3NhZ2UudGV4dCxcbiAgICB9O1xuICB9IGNhdGNoIHtcbiAgICBkZXBzLmZhaWxlZExvb2t1cENhY2hlLnNldChwYXJzZWQudXJsLCB0cnVlKTtcbiAgICByZXR1cm4gZmFsbGJhY2s7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5uZWxSZWYoXG4gIGRlcHM6IFJlc29sdmVyRGVwZW5kZW5jaWVzLFxuICB2YWx1ZTogc3RyaW5nXG4pOiBQcm9taXNlPHsgY2hhbm5lbElkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdGVhbUlkOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHZhbHVlLnJlcGxhY2UoL14jLywgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGNhY2hlZCA9IGRlcHMuY2hhbm5lbENhY2hlLmdldChub3JtYWxpemVkKTtcblxuICBpZiAoY2FjaGVkKSB7XG4gICAgcmV0dXJuIHsgY2hhbm5lbElkOiBjYWNoZWQuaWQsIG5hbWU6IGNhY2hlZC5uYW1lLCB0ZWFtSWQ6IGRlcHMuc2Vzc2lvbi50ZWFtSWQgfTtcbiAgfVxuXG4gIGlmIChkZXBzLmZhaWxlZExvb2t1cENhY2hlLmdldChgY2hhbm5lbDoke25vcm1hbGl6ZWR9YCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgY2hhbm5lbCA9IGF3YWl0IGRlcHMuc2VydmljZS5nZXRDaGFubmVsQnlOYW1lKG5vcm1hbGl6ZWQpO1xuXG4gICAgaWYgKCFjaGFubmVsKSB7XG4gICAgICBkZXBzLmZhaWxlZExvb2t1cENhY2hlLnNldChgY2hhbm5lbDoke25vcm1hbGl6ZWR9YCwgdHJ1ZSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBkZXBzLmNoYW5uZWxDYWNoZS5zZXQobm9ybWFsaXplZCwgY2hhbm5lbCk7XG5cbiAgICByZXR1cm4geyBjaGFubmVsSWQ6IGNoYW5uZWwuaWQsIG5hbWU6IGNoYW5uZWwubmFtZSwgdGVhbUlkOiBkZXBzLnNlc3Npb24udGVhbUlkIH07XG4gIH0gY2F0Y2gge1xuICAgIGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuc2V0KGBjaGFubmVsOiR7bm9ybWFsaXplZH1gLCB0cnVlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlRG1TZW50aW5lbChcbiAgZGVwczogUmVzb2x2ZXJEZXBlbmRlbmNpZXMsXG4gIHZhbHVlOiBzdHJpbmdcbik6IFByb21pc2U8eyBkaXNwbGF5TmFtZTogc3RyaW5nOyB0ZWFtSWQ6IHN0cmluZzsgdXNlcklkOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGNhY2hlZCA9IGRlcHMudXNlckNhY2hlLmdldChub3JtYWxpemVkKTtcblxuICBpZiAoY2FjaGVkKSB7XG4gICAgcmV0dXJuIHsgZGlzcGxheU5hbWU6IGNhY2hlZC5kaXNwbGF5TmFtZSwgdGVhbUlkOiBkZXBzLnNlc3Npb24udGVhbUlkLCB1c2VySWQ6IGNhY2hlZC5pZCB9O1xuICB9XG5cbiAgaWYgKGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuZ2V0KGB1c2VyOiR7bm9ybWFsaXplZH1gKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB1c2VyID0gYXdhaXQgZGVwcy5zZXJ2aWNlLmdldFVzZXJCeURtU2VudGluZWwodmFsdWUpO1xuXG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICBkZXBzLmZhaWxlZExvb2t1cENhY2hlLnNldChgdXNlcjoke25vcm1hbGl6ZWR9YCwgdHJ1ZSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBkZXBzLnVzZXJDYWNoZS5zZXQobm9ybWFsaXplZCwgdXNlcik7XG5cbiAgICByZXR1cm4geyBkaXNwbGF5TmFtZTogdXNlci5kaXNwbGF5TmFtZSwgdGVhbUlkOiBkZXBzLnNlc3Npb24udGVhbUlkLCB1c2VySWQ6IHVzZXIuaWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5zZXQoYHVzZXI6JHtub3JtYWxpemVkfWAsIHRydWUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBUZXh0UmVwbGFjZW1lbnQgfSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGZ1bmN0aW9uIHNvcnRSZXBsYWNlbWVudHNCb3R0b21VcDxUIGV4dGVuZHMgeyBzdGFydDogbnVtYmVyIH0+KGl0ZW1zOiBUW10pOiBUW10ge1xuICByZXR1cm4gWy4uLml0ZW1zXS5zb3J0KChsZWZ0LCByaWdodCkgPT4gcmlnaHQuc3RhcnQgLSBsZWZ0LnN0YXJ0KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UmVwbGFjZW1lbnRzKHRleHQ6IHN0cmluZywgcmVwbGFjZW1lbnRzOiBUZXh0UmVwbGFjZW1lbnRbXSk6IHN0cmluZyB7XG4gIGxldCBuZXh0VGV4dCA9IHRleHQ7XG5cbiAgZm9yIChjb25zdCByZXBsYWNlbWVudCBvZiBzb3J0UmVwbGFjZW1lbnRzQm90dG9tVXAocmVwbGFjZW1lbnRzKSkge1xuICAgIG5leHRUZXh0ID1cbiAgICAgIG5leHRUZXh0LnNsaWNlKDAsIHJlcGxhY2VtZW50LnN0YXJ0KSArIHJlcGxhY2VtZW50LnRleHQgKyBuZXh0VGV4dC5zbGljZShyZXBsYWNlbWVudC5lbmQpO1xuICB9XG5cbiAgcmV0dXJuIG5leHRUZXh0O1xufVxuIiwgImltcG9ydCB0eXBlIHsgU2xhY2tTZXNzaW9uIH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2Vzc2lvbkNpcGhlciB7XG4gIGRlY3J5cHQodmFsdWU6IHN0cmluZyk6IHN0cmluZztcbiAgZW5jcnlwdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nO1xuICBpc0F2YWlsYWJsZSgpOiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgRWxlY3Ryb25TYWZlU3RvcmFnZSB7XG4gIGRlY3J5cHRTdHJpbmcodmFsdWU6IEJ1ZmZlcik6IHN0cmluZztcbiAgZW5jcnlwdFN0cmluZyh2YWx1ZTogc3RyaW5nKTogQnVmZmVyO1xuICBpc0VuY3J5cHRpb25BdmFpbGFibGUoKTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVsZWN0cm9uU2Vzc2lvbkNpcGhlcigpOiBTZXNzaW9uQ2lwaGVyIHwgbnVsbCB7XG4gIGNvbnN0IHNhZmVTdG9yYWdlID0gZ2V0RWxlY3Ryb25TYWZlU3RvcmFnZSgpO1xuXG4gIGlmICghc2FmZVN0b3JhZ2UpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGVjcnlwdDogKHZhbHVlKSA9PiBzYWZlU3RvcmFnZS5kZWNyeXB0U3RyaW5nKEJ1ZmZlci5mcm9tKHZhbHVlLCAnYmFzZTY0JykpLFxuICAgIGVuY3J5cHQ6ICh2YWx1ZSkgPT4gc2FmZVN0b3JhZ2UuZW5jcnlwdFN0cmluZyh2YWx1ZSkudG9TdHJpbmcoJ2Jhc2U2NCcpLFxuICAgIGlzQXZhaWxhYmxlOiAoKSA9PiBzYWZlU3RvcmFnZS5pc0VuY3J5cHRpb25BdmFpbGFibGUoKSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlY29kZVNlY3VyZVNlc3Npb24odmFsdWU6IHN0cmluZywgY2lwaGVyOiBTZXNzaW9uQ2lwaGVyKTogU2xhY2tTZXNzaW9uIHtcbiAgcmV0dXJuIEpTT04ucGFyc2UoY2lwaGVyLmRlY3J5cHQodmFsdWUpKSBhcyBTbGFja1Nlc3Npb247XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbmNvZGVTZWN1cmVTZXNzaW9uKHNlc3Npb246IFNsYWNrU2Vzc2lvbiwgY2lwaGVyOiBTZXNzaW9uQ2lwaGVyKTogc3RyaW5nIHtcbiAgaWYgKCFjaXBoZXIuaXNBdmFpbGFibGUoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignU2VjdXJlIHNlc3Npb24gc3RvcmFnZSBpcyB1bmF2YWlsYWJsZScpO1xuICB9XG5cbiAgcmV0dXJuIGNpcGhlci5lbmNyeXB0KEpTT04uc3RyaW5naWZ5KHNlc3Npb24pKTtcbn1cblxuZnVuY3Rpb24gZ2V0RWxlY3Ryb25TYWZlU3RvcmFnZSgpOiBFbGVjdHJvblNhZmVTdG9yYWdlIHwgbnVsbCB7XG4gIGNvbnN0IHJlcXVpcmVGbiA9IChnbG9iYWxUaGlzIGFzIHsgcmVxdWlyZT86IChpZDogc3RyaW5nKSA9PiB1bmtub3duIH0pLnJlcXVpcmU7XG5cbiAgaWYgKCFyZXF1aXJlRm4pIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGxldCBlbGVjdHJvbjogeyBzYWZlU3RvcmFnZT86IEVsZWN0cm9uU2FmZVN0b3JhZ2U7IHJlbW90ZT86IHsgc2FmZVN0b3JhZ2U/OiBFbGVjdHJvblNhZmVTdG9yYWdlIH0gfSA9IHt9O1xuXG4gIHRyeSB7XG4gICAgZWxlY3Ryb24gPSByZXF1aXJlRm4oJ2VsZWN0cm9uJykgYXMgdHlwZW9mIGVsZWN0cm9uO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGlmIChlbGVjdHJvbi5yZW1vdGU/LnNhZmVTdG9yYWdlKSB7XG4gICAgcmV0dXJuIGVsZWN0cm9uLnJlbW90ZS5zYWZlU3RvcmFnZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgZWxlY3Ryb25SZW1vdGUgPSByZXF1aXJlRm4oJ0BlbGVjdHJvbi9yZW1vdGUnKSBhcyB7IHNhZmVTdG9yYWdlPzogRWxlY3Ryb25TYWZlU3RvcmFnZSB9O1xuICAgIGlmIChlbGVjdHJvblJlbW90ZS5zYWZlU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGVsZWN0cm9uUmVtb3RlLnNhZmVTdG9yYWdlO1xuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgLy8gQGVsZWN0cm9uL3JlbW90ZSBub3QgYXZhaWxhYmxlIFx1MjAxNCBmYWxsIHRocm91Z2guXG4gIH1cblxuICByZXR1cm4gZWxlY3Ryb24uc2FmZVN0b3JhZ2UgPz8gbnVsbDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNsYWNrQ2hhbm5lbCwgU2xhY2tNZXNzYWdlTWV0YWRhdGEsIFNsYWNrU2Vzc2lvbiwgU2xhY2tVc2VyIH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xhY2tTZXJ2aWNlIHtcbiAgZ2V0Q2hhbm5lbEJ5TmFtZShuYW1lOiBzdHJpbmcpOiBQcm9taXNlPFNsYWNrQ2hhbm5lbCB8IG51bGw+O1xuICBnZXRNZXNzYWdlKHVybDogc3RyaW5nKTogUHJvbWlzZTxTbGFja01lc3NhZ2VNZXRhZGF0YT47XG4gIGdldFVzZXJCeURtU2VudGluZWwoc2VudGluZWw6IHN0cmluZyk6IFByb21pc2U8U2xhY2tVc2VyIHwgbnVsbD47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTbGFja1NlcnZpY2UoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2ggPSBmZXRjaFxuKTogU2xhY2tTZXJ2aWNlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRDaGFubmVsQnlOYW1lOiBhc3luYyAobmFtZTogc3RyaW5nKSA9PiBmaW5kQ2hhbm5lbEJ5TmFtZShzZXNzaW9uLCBuYW1lLCBmZXRjaEltcGwpLFxuICAgIGdldE1lc3NhZ2U6IGFzeW5jICh1cmw6IHN0cmluZykgPT4gZ2V0TWVzc2FnZU1ldGFkYXRhKHNlc3Npb24sIHVybCwgZmV0Y2hJbXBsKSxcbiAgICBnZXRVc2VyQnlEbVNlbnRpbmVsOiBhc3luYyAoc2VudGluZWw6IHN0cmluZykgPT4gZmluZFVzZXJCeURtU2VudGluZWwoc2Vzc2lvbiwgc2VudGluZWwsIGZldGNoSW1wbCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldE1lc3NhZ2VNZXRhZGF0YShcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uLFxuICB1cmw6IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2hcbik6IFByb21pc2U8U2xhY2tNZXNzYWdlTWV0YWRhdGE+IHtcbiAgY29uc3QgcGVybWFsaW5rID0gbmV3IFVSTCh1cmwpO1xuICBjb25zdCBjaGFubmVsSWQgPSBwZXJtYWxpbmsucGF0aG5hbWUuc3BsaXQoJy8nKVsyXTtcbiAgY29uc3QgcGFja2VkVHMgPSBwZXJtYWxpbmsucGF0aG5hbWUuc3BsaXQoJy8nKVszXT8uc2xpY2UoMSk7XG5cbiAgaWYgKCFjaGFubmVsSWQgfHwgIXBhY2tlZFRzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIFNsYWNrIHBlcm1hbGluaycpO1xuICB9XG5cbiAgY29uc3QgdHMgPSBgJHtwYWNrZWRUcy5zbGljZSgwLCAxMCl9LiR7cGFja2VkVHMuc2xpY2UoMTApfWA7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2FsbFNsYWNrQXBpPHtcbiAgICBtZXNzYWdlcz86IEFycmF5PHsgdGV4dD86IHN0cmluZzsgdXNlcj86IHN0cmluZyB9PjtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAnY29udmVyc2F0aW9ucy5oaXN0b3J5Jywge1xuICAgIGNoYW5uZWw6IGNoYW5uZWxJZCxcbiAgICBpbmNsdXNpdmU6ICd0cnVlJyxcbiAgICBsYXRlc3Q6IHRzLFxuICAgIGxpbWl0OiAnMScsXG4gICAgb2xkZXN0OiB0cyxcbiAgfSk7XG5cbiAgY29uc3QgbWVzc2FnZSA9IHJlc3BvbnNlLm1lc3NhZ2VzPy5bMF07XG4gIGNvbnN0IFtjaGFubmVsTmFtZSwgYXV0aG9yTmFtZV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgZ2V0Q2hhbm5lbE5hbWUoc2Vzc2lvbiwgY2hhbm5lbElkLCBmZXRjaEltcGwpLFxuICAgIG1lc3NhZ2U/LnVzZXIgPyBnZXRVc2VyRGlzcGxheU5hbWUoc2Vzc2lvbiwgbWVzc2FnZS51c2VyLCBmZXRjaEltcGwpIDogUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCksXG4gIF0pO1xuXG4gIHJldHVybiB7XG4gICAgYXV0aG9ySWQ6IG1lc3NhZ2U/LnVzZXIsXG4gICAgYXV0aG9yTmFtZSxcbiAgICBjaGFubmVsTmFtZSxcbiAgICB0ZXh0OiBtZXNzYWdlPy50ZXh0LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRDaGFubmVsTmFtZShcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uLFxuICBjaGFubmVsSWQ6IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2hcbik6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2FsbFNsYWNrQXBpPHtcbiAgICBjaGFubmVsPzogeyBuYW1lPzogc3RyaW5nIH07XG4gIH0+KHNlc3Npb24sIGZldGNoSW1wbCwgJ2NvbnZlcnNhdGlvbnMuaW5mbycsIHtcbiAgICBjaGFubmVsOiBjaGFubmVsSWQsXG4gIH0pO1xuXG4gIHJldHVybiByZXNwb25zZS5jaGFubmVsPy5uYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRVc2VyRGlzcGxheU5hbWUoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgdXNlcklkOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgdXNlcj86IHsgcHJvZmlsZT86IHsgZGlzcGxheV9uYW1lPzogc3RyaW5nOyByZWFsX25hbWU/OiBzdHJpbmcgfSB9O1xuICB9PihzZXNzaW9uLCBmZXRjaEltcGwsICd1c2Vycy5pbmZvJywge1xuICAgIHVzZXI6IHVzZXJJZCxcbiAgfSk7XG5cbiAgcmV0dXJuIHJlc3BvbnNlLnVzZXI/LnByb2ZpbGU/LmRpc3BsYXlfbmFtZSB8fCByZXNwb25zZS51c2VyPy5wcm9maWxlPy5yZWFsX25hbWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRDaGFubmVsQnlOYW1lKFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIG5hbWU6IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2hcbik6IFByb21pc2U8U2xhY2tDaGFubmVsIHwgbnVsbD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgY2hhbm5lbHM/OiBBcnJheTx7IGlkPzogc3RyaW5nOyBuYW1lPzogc3RyaW5nIH0+O1xuICB9PihzZXNzaW9uLCBmZXRjaEltcGwsICdjb252ZXJzYXRpb25zLmxpc3QnLCB7XG4gICAgZXhjbHVkZV9hcmNoaXZlZDogJ3RydWUnLFxuICAgIGxpbWl0OiAnMTAwMCcsXG4gICAgdHlwZXM6ICdwdWJsaWNfY2hhbm5lbCxwcml2YXRlX2NoYW5uZWwnLFxuICB9KTtcblxuICBjb25zdCBtYXRjaCA9IHJlc3BvbnNlLmNoYW5uZWxzPy5maW5kKChjaGFubmVsKSA9PiBjaGFubmVsLm5hbWUgPT09IG5hbWUpO1xuXG4gIGlmICghbWF0Y2g/LmlkIHx8ICFtYXRjaC5uYW1lKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGlkOiBtYXRjaC5pZCxcbiAgICBuYW1lOiBtYXRjaC5uYW1lLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBmaW5kVXNlckJ5RG1TZW50aW5lbChcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uLFxuICBzZW50aW5lbDogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaFxuKTogUHJvbWlzZTxTbGFja1VzZXIgfCBudWxsPiB7XG4gIGNvbnN0IHZhbHVlID0gc2VudGluZWwucmVwbGFjZSgvXmRtOi8sICcnKTtcblxuICBpZiAodmFsdWUuaW5jbHVkZXMoJ0AnKSAmJiAhdmFsdWUuc3RhcnRzV2l0aCgnQCcpKSB7XG4gICAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgICB1c2VyPzogeyBpZD86IHN0cmluZzsgcHJvZmlsZT86IHsgZW1haWw/OiBzdHJpbmc7IGRpc3BsYXlfbmFtZT86IHN0cmluZzsgcmVhbF9uYW1lPzogc3RyaW5nIH0gfTtcbiAgICB9PihzZXNzaW9uLCBmZXRjaEltcGwsICd1c2Vycy5sb29rdXBCeUVtYWlsJywgeyBlbWFpbDogdmFsdWUgfSk7XG4gICAgY29uc3QgZW1haWxVc2VyID0gYnlFbWFpbC51c2VyO1xuXG4gICAgaWYgKCFlbWFpbFVzZXI/LmlkKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGlzcGxheU5hbWU6XG4gICAgICAgIGVtYWlsVXNlci5wcm9maWxlPy5kaXNwbGF5X25hbWUgfHwgZW1haWxVc2VyLnByb2ZpbGU/LnJlYWxfbmFtZSB8fCBlbWFpbFVzZXIucHJvZmlsZT8uZW1haWwgfHwgZW1haWxVc2VyLmlkLFxuICAgICAgZW1haWw6IGVtYWlsVXNlci5wcm9maWxlPy5lbWFpbCxcbiAgICAgIGlkOiBlbWFpbFVzZXIuaWQsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWROYW1lID0gdmFsdWUucmVwbGFjZSgvXkAvLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgIG1lbWJlcnM/OiBBcnJheTx7XG4gICAgICBpZD86IHN0cmluZztcbiAgICAgIG5hbWU/OiBzdHJpbmc7XG4gICAgICBwcm9maWxlPzogeyBkaXNwbGF5X25hbWU/OiBzdHJpbmc7IGVtYWlsPzogc3RyaW5nOyByZWFsX25hbWU/OiBzdHJpbmcgfTtcbiAgICB9PjtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAndXNlcnMubGlzdCcsIHt9KTtcblxuICBjb25zdCBtYXRjaCA9IHJlc3BvbnNlLm1lbWJlcnM/LmZpbmQoKG1lbWJlcikgPT4ge1xuICAgIGNvbnN0IGRpc3BsYXlOYW1lID0gbWVtYmVyLnByb2ZpbGU/LmRpc3BsYXlfbmFtZT8udG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCByZWFsTmFtZSA9IG1lbWJlci5wcm9maWxlPy5yZWFsX25hbWU/LnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgdXNlcm5hbWUgPSBtZW1iZXIubmFtZT8udG9Mb3dlckNhc2UoKTtcblxuICAgIHJldHVybiBub3JtYWxpemVkTmFtZSA9PT0gZGlzcGxheU5hbWUgfHwgbm9ybWFsaXplZE5hbWUgPT09IHJlYWxOYW1lIHx8IG5vcm1hbGl6ZWROYW1lID09PSB1c2VybmFtZTtcbiAgfSk7XG5cbiAgaWYgKCFtYXRjaD8uaWQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGlzcGxheU5hbWU6IG1hdGNoLnByb2ZpbGU/LmRpc3BsYXlfbmFtZSB8fCBtYXRjaC5wcm9maWxlPy5yZWFsX25hbWUgfHwgbWF0Y2gubmFtZSB8fCBtYXRjaC5pZCxcbiAgICBlbWFpbDogbWF0Y2gucHJvZmlsZT8uZW1haWwsXG4gICAgaWQ6IG1hdGNoLmlkLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYWxsU2xhY2tBcGk8VD4oXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2gsXG4gIG1ldGhvZDogc3RyaW5nLFxuICBxdWVyeTogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuKTogUHJvbWlzZTxUPiB7XG4gIGlmICghc2Vzc2lvbi5hY2Nlc3NUb2tlbikge1xuICAgIHRocm93IG5ldyBFcnJvcignU2xhY2sgYWNjZXNzIHRva2VuIGlzIG1pc3NpbmcnKTtcbiAgfVxuXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoYGh0dHBzOi8vc2xhY2suY29tL2FwaS8ke21ldGhvZH1gKTtcblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhxdWVyeSkpIHtcbiAgICB1cmwuc2VhcmNoUGFyYW1zLnNldChrZXksIHZhbHVlKTtcbiAgfVxuXG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hJbXBsKHVybCwge1xuICAgIGhlYWRlcnM6IHtcbiAgICAgIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZXNzaW9uLmFjY2Vzc1Rva2VufWAsXG4gICAgfSxcbiAgfSk7XG5cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHRocm93IG5ldyBFcnJvcihgU2xhY2sgQVBJIHJlcXVlc3QgZmFpbGVkOiAke3Jlc3BvbnNlLnN0YXR1c31gKTtcbiAgfVxuXG4gIGNvbnN0IHBheWxvYWQgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyB7IGVycm9yPzogc3RyaW5nOyBvaz86IGJvb2xlYW4gfSAmIFQ7XG5cbiAgaWYgKCFwYXlsb2FkLm9rKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHBheWxvYWQuZXJyb3IgPz8gYFNsYWNrIEFQSSByZXF1ZXN0IGZhaWxlZDogJHttZXRob2R9YCk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNsYWNrU2Vzc2lvbiB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgZnVuY3Rpb24gaGFzVmFsaWRBY2Nlc3NUb2tlbihzZXNzaW9uOiBTbGFja1Nlc3Npb24pOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oc2Vzc2lvbi5hY2Nlc3NUb2tlbiAmJiAoIXNlc3Npb24uZXhwaXJlc0F0IHx8IHNlc3Npb24uZXhwaXJlc0F0ID4gRGF0ZS5ub3coKSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkUmVmcmVzaFNlc3Npb24oc2Vzc2lvbjogU2xhY2tTZXNzaW9uLCByZWZyZXNoTGVld2F5TXMgPSA2MF8wMDApOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oXG4gICAgc2Vzc2lvbi5hY2Nlc3NUb2tlbiAmJlxuICAgICAgc2Vzc2lvbi5yZWZyZXNoVG9rZW4gJiZcbiAgICAgIHNlc3Npb24uZXhwaXJlc0F0ICYmXG4gICAgICBzZXNzaW9uLmV4cGlyZXNBdCA8PSBEYXRlLm5vdygpICsgcmVmcmVzaExlZXdheU1zXG4gICk7XG59XG4iLCAiZXhwb3J0IGNsYXNzIFNpbmdsZUZsaWdodDxUPiB7XG4gIHByaXZhdGUgaW5GbGlnaHQ6IFByb21pc2U8VD4gfCBudWxsID0gbnVsbDtcblxuICBydW4oZmFjdG9yeTogKCkgPT4gUHJvbWlzZTxUPik6IFByb21pc2U8VD4ge1xuICAgIGlmICh0aGlzLmluRmxpZ2h0KSB7XG4gICAgICByZXR1cm4gdGhpcy5pbkZsaWdodDtcbiAgICB9XG5cbiAgICB0aGlzLmluRmxpZ2h0ID0gZmFjdG9yeSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbkZsaWdodCA9IG51bGw7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5pbkZsaWdodDtcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgTGlua1RhcmdldFByZWZlcmVuY2UsIFNsYWNrU2Vzc2lvbiB9IGZyb20gJy4vc2xhY2svdHlwZXMnO1xuaW1wb3J0IHtcbiAgZGVjb2RlU2VjdXJlU2Vzc2lvbixcbiAgZW5jb2RlU2VjdXJlU2Vzc2lvbixcbiAgdHlwZSBTZXNzaW9uQ2lwaGVyLFxufSBmcm9tICcuL3NsYWNrL3NlY3VyZS1zZXNzaW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBTbGFja0Jhc2VzU2V0dGluZ3Mge1xuICBjaGFubmVsQ2FjaGVUdGxNczogbnVtYmVyO1xuICBjbGllbnRJZDogc3RyaW5nO1xuICBlbmNyeXB0ZWRTZXNzaW9uOiBzdHJpbmc7XG4gIGVuYWJsZUNoYW5uZWxzOiBib29sZWFuO1xuICBlbmFibGVEbVNlbnRpbmVsczogYm9vbGVhbjtcbiAgZW5hYmxlUGVybWFsaW5rczogYm9vbGVhbjtcbiAgZmFpbGVkTG9va3VwVHRsTXM6IG51bWJlcjtcbiAgaWRsZURlbGF5TXM6IG51bWJlcjtcbiAgbWVzc2FnZVRlbXBsYXRlOiBzdHJpbmc7XG4gIHJlZnJlc2hMZWV3YXlNczogbnVtYmVyO1xuICBzY29wZXM6IHN0cmluZztcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uO1xuICB0YXJnZXQ6IExpbmtUYXJnZXRQcmVmZXJlbmNlO1xuICB1c2VyQ2FjaGVUdGxNczogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogU2xhY2tCYXNlc1NldHRpbmdzID0ge1xuICBjaGFubmVsQ2FjaGVUdGxNczogNjAgKiA2MCAqIDEwMDAsXG4gIGNsaWVudElkOiAnJyxcbiAgZW5jcnlwdGVkU2Vzc2lvbjogJycsXG4gIGVuYWJsZUNoYW5uZWxzOiB0cnVlLFxuICBlbmFibGVEbVNlbnRpbmVsczogdHJ1ZSxcbiAgZW5hYmxlUGVybWFsaW5rczogdHJ1ZSxcbiAgZmFpbGVkTG9va3VwVHRsTXM6IDUgKiA2MCAqIDEwMDAsXG4gIGlkbGVEZWxheU1zOiA1MDAsXG4gIG1lc3NhZ2VUZW1wbGF0ZTogJ1t7Y2hhbm5lbH0gXHUyMDIyIHthdXRob3J9OiB7dGV4dH1dKHt1cmx9KScsXG4gIHJlZnJlc2hMZWV3YXlNczogNjAgKiAxMDAwLFxuICBzY29wZXM6ICdjaGFubmVsczpyZWFkLGdyb3VwczpyZWFkLHVzZXJzOnJlYWQsdXNlcnM6cmVhZC5lbWFpbCxjaGFubmVsczpoaXN0b3J5LGdyb3VwczpoaXN0b3J5JyxcbiAgc2Vzc2lvbjoge1xuICAgIGFjY2Vzc1Rva2VuOiAnJyxcbiAgICBleHBpcmVzQXQ6IDAsXG4gICAgcmVmcmVzaFRva2VuOiAnJyxcbiAgICB0ZWFtSWQ6ICcnLFxuICAgIHdvcmtzcGFjZTogJycsXG4gIH0sXG4gIHRhcmdldDogJ2FwcCcsXG4gIHVzZXJDYWNoZVR0bE1zOiA2MCAqIDYwICogMTAwMCxcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVNldHRpbmdzKFxuICBwYXJ0aWFsOiBQYXJ0aWFsPFNsYWNrQmFzZXNTZXR0aW5ncz4gfCB1bmRlZmluZWRcbik6IFNsYWNrQmFzZXNTZXR0aW5ncyB7XG4gIHJldHVybiB7XG4gICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAuLi5wYXJ0aWFsLFxuICAgIHNlc3Npb246IHtcbiAgICAgIC4uLkRFRkFVTFRfU0VUVElOR1Muc2Vzc2lvbixcbiAgICAgIC4uLnBhcnRpYWw/LnNlc3Npb24sXG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBlcnNpc3RlZFNldHRpbmdzKFxuICBzZXR0aW5nczogU2xhY2tCYXNlc1NldHRpbmdzLFxuICBjaXBoZXI/OiBTZXNzaW9uQ2lwaGVyIHwgbnVsbFxuKTogU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgaWYgKCFoYXNTZXNzaW9uRGF0YShzZXR0aW5ncy5zZXNzaW9uKSkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5zZXR0aW5ncyxcbiAgICAgIGVuY3J5cHRlZFNlc3Npb246ICcnLFxuICAgICAgc2Vzc2lvbjogeyAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24gfSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKCFjaXBoZXI/LmlzQXZhaWxhYmxlKCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uc2V0dGluZ3MsXG4gICAgICBlbmNyeXB0ZWRTZXNzaW9uOiAnJyxcbiAgICAgIHNlc3Npb246IHsgLi4uREVGQVVMVF9TRVRUSU5HUy5zZXNzaW9uIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgLi4uc2V0dGluZ3MsXG4gICAgZW5jcnlwdGVkU2Vzc2lvbjogZW5jb2RlU2VjdXJlU2Vzc2lvbihzZXR0aW5ncy5zZXNzaW9uLCBjaXBoZXIpLFxuICAgIHNlc3Npb246IHsgLi4uREVGQVVMVF9TRVRUSU5HUy5zZXNzaW9uIH0sXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2V0dGluZ3NXaXRoU2Vzc2lvbihcbiAgcGFydGlhbDogUGFydGlhbDxTbGFja0Jhc2VzU2V0dGluZ3M+IHwgdW5kZWZpbmVkLFxuICBjaXBoZXI/OiBTZXNzaW9uQ2lwaGVyIHwgbnVsbFxuKTogU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgY29uc3QgbWVyZ2VkID0gbWVyZ2VTZXR0aW5ncyhwYXJ0aWFsKTtcblxuICBpZiAoIW1lcmdlZC5lbmNyeXB0ZWRTZXNzaW9uIHx8ICFjaXBoZXI/LmlzQXZhaWxhYmxlKCkpIHtcbiAgICByZXR1cm4gbWVyZ2VkO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5tZXJnZWQsXG4gICAgc2Vzc2lvbjoge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUy5zZXNzaW9uLFxuICAgICAgLi4uZGVjb2RlU2VjdXJlU2Vzc2lvbihtZXJnZWQuZW5jcnlwdGVkU2Vzc2lvbiwgY2lwaGVyKSxcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBoYXNTZXNzaW9uRGF0YShzZXNzaW9uOiBTbGFja1Nlc3Npb24pOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oXG4gICAgc2Vzc2lvbi5hY2Nlc3NUb2tlbiB8fFxuICAgICAgc2Vzc2lvbi5yZWZyZXNoVG9rZW4gfHxcbiAgICAgIHNlc3Npb24udGVhbUlkIHx8XG4gICAgICBzZXNzaW9uLndvcmtzcGFjZSB8fFxuICAgICAgc2Vzc2lvbi5leHBpcmVzQXRcbiAgKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQVFPOzs7QUNFQSxTQUFTLHVCQUF1QixPQU01QjtBQUNULFFBQU0sTUFBTSxJQUFJLElBQUksc0NBQXNDO0FBRTFELE1BQUksYUFBYSxJQUFJLGFBQWEsTUFBTSxRQUFRO0FBQ2hELE1BQUksYUFBYSxJQUFJLGtCQUFrQixNQUFNLGFBQWE7QUFDMUQsTUFBSSxhQUFhLElBQUkseUJBQXlCLE1BQU07QUFDcEQsTUFBSSxhQUFhLElBQUksZ0JBQWdCLE1BQU0sV0FBVztBQUN0RCxNQUFJLGFBQWEsSUFBSSxpQkFBaUIsTUFBTTtBQUM1QyxNQUFJLGFBQWEsSUFBSSxTQUFTLE1BQU0sS0FBSztBQUN6QyxNQUFJLGFBQWEsSUFBSSxjQUFjLE1BQU0sTUFBTTtBQUUvQyxTQUFPLElBQUksU0FBUztBQUN0QjtBQUVBLGVBQXNCLGtCQUNwQixXQUNBLE9BT3VCO0FBQ3ZCLFFBQU0sZ0JBQWdCLE1BQU0sVUFBVTtBQUFBLElBQ3BDLE1BQU0sSUFBSSxnQkFBZ0I7QUFBQSxNQUN4QixXQUFXLE1BQU07QUFBQSxNQUNqQixNQUFNLE1BQU07QUFBQSxNQUNa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
