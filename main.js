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

// src/settings.ts
var DEFAULT_SETTINGS = {
  channelCacheTtlMs: 60 * 60 * 1e3,
  clientId: "",
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

// src/main.ts
var SlackBasesPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.channelCache = new TtlCache(DEFAULT_SETTINGS.channelCacheTtlMs);
    this.failedLookupCache = new TtlCache(DEFAULT_SETTINGS.failedLookupTtlMs);
    this.isApplyingChanges = false;
    this.refreshTimer = null;
    this.service = createSlackService(DEFAULT_SETTINGS.session);
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
    this.settings = mergeSettings(nextSettings ? { ...this.settings, ...nextSettings } : this.settings);
    await this.saveData(this.settings);
    this.rebuildRuntime();
  }
  getSettings() {
    return this.settings;
  }
  async disconnectSlack() {
    await this.saveSettings({
      session: {
        accessToken: "",
        expiresAt: 0,
        refreshToken: "",
        teamId: "",
        workspace: ""
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
    if (this.settings.session.accessToken && this.settings.session.workspace) {
      new import_obsidian.Notice(`Slack session configured for ${this.settings.session.workspace}`);
      return;
    }
    new import_obsidian.Notice("Slack is not connected.");
  }
  async loadSettings() {
    this.settings = mergeSettings(await this.loadData());
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
    new import_obsidian.Setting(containerEl).setName("Workspace slug").setDesc("Used for permalink fallback rendering and session metadata.").addText(
      (text) => text.setValue(settings.session.workspace).onChange(async (value) => {
        await this.plugin.saveSettings({
          session: {
            ...this.plugin.getSettings().session,
            workspace: value.trim()
          }
        });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Team ID").setDesc("Used for Slack deep links.").addText(
      (text) => text.setValue(settings.session.teamId).onChange(async (value) => {
        await this.plugin.saveSettings({
          session: {
            ...this.plugin.getSettings().session,
            teamId: value.trim()
          }
        });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Client ID").setDesc("Slack app client ID for a desktop PKCE flow.").addText(
      (text) => text.setValue(settings.clientId).onChange(async (value) => {
        await this.plugin.saveSettings({ clientId: value.trim() });
      })
    );
    new import_obsidian.Setting(containerEl).setName("Access token").setDesc("Stored locally for Slack metadata hydration.").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(settings.session.accessToken ?? "").onChange(async (value) => {
        await this.plugin.saveSettings({
          session: {
            ...this.plugin.getSettings().session,
            accessToken: value.trim()
          }
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Refresh token").setDesc("Optional refresh token for long-lived sessions.").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(settings.session.refreshToken ?? "").onChange(async (value) => {
        await this.plugin.saveSettings({
          session: {
            ...this.plugin.getSettings().session,
            refreshToken: value.trim()
          }
        });
      });
    });
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
    ).addButton(
      (button) => button.setButtonText("Disconnect").onClick(async () => {
        await this.plugin.disconnectSlack();
        this.display();
        new import_obsidian.Notice("Slack session cleared.");
      })
    );
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3NsYWNrL2NhY2hlLnRzIiwgInNyYy9zbGFjay9kZXRlY3Rvci50cyIsICJzcmMvc2xhY2svcmVuZGVyZXIudHMiLCAic3JjL3NsYWNrL2VuZ2luZS50cyIsICJzcmMvc2xhY2svcGVybWFsaW5rLnRzIiwgInNyYy9zbGFjay9yZXNvbHZlci50cyIsICJzcmMvc2xhY2svcmVwbGFjZW1lbnRzLnRzIiwgInNyYy9zbGFjay9zZXJ2aWNlLnRzIiwgInNyYy9zZXR0aW5ncy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgTm90aWNlLCBQbHVnaW4sIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcsIHR5cGUgQXBwLCB0eXBlIEVkaXRvciB9IGZyb20gJ29ic2lkaWFuJztcblxuaW1wb3J0IHsgVHRsQ2FjaGUgfSBmcm9tICcuL3NsYWNrL2NhY2hlJztcbmltcG9ydCB7IGRldGVjdENhbmRpZGF0ZXMgfSBmcm9tICcuL3NsYWNrL2RldGVjdG9yJztcbmltcG9ydCB7IHBsYW5TbGFja0xpbmtSZXBsYWNlbWVudHMgfSBmcm9tICcuL3NsYWNrL2VuZ2luZSc7XG5pbXBvcnQgeyBidWlsZFRhcmdldFVybCB9IGZyb20gJy4vc2xhY2svcmVuZGVyZXInO1xuaW1wb3J0IHsgY3JlYXRlUmVzb2x2ZXIgfSBmcm9tICcuL3NsYWNrL3Jlc29sdmVyJztcbmltcG9ydCB7IGFwcGx5UmVwbGFjZW1lbnRzIH0gZnJvbSAnLi9zbGFjay9yZXBsYWNlbWVudHMnO1xuaW1wb3J0IHsgY3JlYXRlU2xhY2tTZXJ2aWNlLCB0eXBlIFNsYWNrU2VydmljZSB9IGZyb20gJy4vc2xhY2svc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IFNsYWNrQmFzZXNTZXR0aW5ncyB9IGZyb20gJy4vc2V0dGluZ3MnO1xuaW1wb3J0IHsgREVGQVVMVF9TRVRUSU5HUywgbWVyZ2VTZXR0aW5ncyB9IGZyb20gJy4vc2V0dGluZ3MnO1xuaW1wb3J0IHR5cGUgeyBTbGFja0NoYW5uZWwsIFNsYWNrVXNlciB9IGZyb20gJy4vc2xhY2svdHlwZXMnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTbGFja0Jhc2VzUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgcHJpdmF0ZSBjaGFubmVsQ2FjaGUgPSBuZXcgVHRsQ2FjaGU8U2xhY2tDaGFubmVsPihERUZBVUxUX1NFVFRJTkdTLmNoYW5uZWxDYWNoZVR0bE1zKTtcbiAgcHJpdmF0ZSBmYWlsZWRMb29rdXBDYWNoZSA9IG5ldyBUdGxDYWNoZTxib29sZWFuPihERUZBVUxUX1NFVFRJTkdTLmZhaWxlZExvb2t1cFR0bE1zKTtcbiAgcHJpdmF0ZSBpc0FwcGx5aW5nQ2hhbmdlcyA9IGZhbHNlO1xuICBwcml2YXRlIHJlZnJlc2hUaW1lcjogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc2VydmljZTogU2xhY2tTZXJ2aWNlID0gY3JlYXRlU2xhY2tTZXJ2aWNlKERFRkFVTFRfU0VUVElOR1Muc2Vzc2lvbik7XG4gIHByaXZhdGUgc2V0dGluZ3M6IFNsYWNrQmFzZXNTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHByaXZhdGUgdXNlckNhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrVXNlcj4oREVGQVVMVF9TRVRUSU5HUy51c2VyQ2FjaGVUdGxNcyk7XG4gIHByaXZhdGUgcmVzb2x2ZXIgPSBjcmVhdGVSZXNvbHZlcih7XG4gICAgY2hhbm5lbENhY2hlOiB0aGlzLmNoYW5uZWxDYWNoZSxcbiAgICBmYWlsZWRMb29rdXBDYWNoZTogdGhpcy5mYWlsZWRMb29rdXBDYWNoZSxcbiAgICBzZXJ2aWNlOiB0aGlzLnNlcnZpY2UsXG4gICAgc2Vzc2lvbjogdGhpcy5zZXR0aW5ncy5zZXNzaW9uLFxuICAgIHVzZXJDYWNoZTogdGhpcy51c2VyQ2FjaGUsXG4gIH0pO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBTbGFja0Jhc2VzU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHRoaXMucmVnaXN0ZXJDb21tYW5kcygpO1xuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JMaXN0ZW5lcigpO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVmcmVzaFRpbWVyICE9PSBudWxsKSB7XG4gICAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRoaXMucmVmcmVzaFRpbWVyKTtcbiAgICAgIHRoaXMucmVmcmVzaFRpbWVyID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MobmV4dFNldHRpbmdzPzogUGFydGlhbDxTbGFja0Jhc2VzU2V0dGluZ3M+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IG1lcmdlU2V0dGluZ3MobmV4dFNldHRpbmdzID8geyAuLi50aGlzLnNldHRpbmdzLCAuLi5uZXh0U2V0dGluZ3MgfSA6IHRoaXMuc2V0dGluZ3MpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gICAgdGhpcy5yZWJ1aWxkUnVudGltZSgpO1xuICB9XG5cbiAgZ2V0U2V0dGluZ3MoKTogU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgICByZXR1cm4gdGhpcy5zZXR0aW5ncztcbiAgfVxuXG4gIGFzeW5jIGRpc2Nvbm5lY3RTbGFjaygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncyh7XG4gICAgICBzZXNzaW9uOiB7XG4gICAgICAgIGFjY2Vzc1Rva2VuOiAnJyxcbiAgICAgICAgZXhwaXJlc0F0OiAwLFxuICAgICAgICByZWZyZXNoVG9rZW46ICcnLFxuICAgICAgICB0ZWFtSWQ6ICcnLFxuICAgICAgICB3b3Jrc3BhY2U6ICcnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlc2V0Q2hhbm5lbENhY2hlKCk6IHZvaWQge1xuICAgIHRoaXMuY2hhbm5lbENhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrQ2hhbm5lbD4odGhpcy5zZXR0aW5ncy5jaGFubmVsQ2FjaGVUdGxNcyk7XG4gICAgdGhpcy5yZWJ1aWxkUmVzb2x2ZXIoKTtcbiAgfVxuXG4gIHJlc2V0VXNlckNhY2hlKCk6IHZvaWQge1xuICAgIHRoaXMudXNlckNhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrVXNlcj4odGhpcy5zZXR0aW5ncy51c2VyQ2FjaGVUdGxNcyk7XG4gICAgdGhpcy5yZWJ1aWxkUmVzb2x2ZXIoKTtcbiAgfVxuXG4gIHNob3dDb25uZWN0aW9uU3RhdHVzKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLnNlc3Npb24uYWNjZXNzVG9rZW4gJiYgdGhpcy5zZXR0aW5ncy5zZXNzaW9uLndvcmtzcGFjZSkge1xuICAgICAgbmV3IE5vdGljZShgU2xhY2sgc2Vzc2lvbiBjb25maWd1cmVkIGZvciAke3RoaXMuc2V0dGluZ3Muc2Vzc2lvbi53b3Jrc3BhY2V9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZSgnU2xhY2sgaXMgbm90IGNvbm5lY3RlZC4nKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBtZXJnZVNldHRpbmdzKGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gICAgdGhpcy5yZWJ1aWxkUnVudGltZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWJ1aWxkUnVudGltZSgpOiB2b2lkIHtcbiAgICB0aGlzLmNoYW5uZWxDYWNoZSA9IG5ldyBUdGxDYWNoZTxTbGFja0NoYW5uZWw+KHRoaXMuc2V0dGluZ3MuY2hhbm5lbENhY2hlVHRsTXMpO1xuICAgIHRoaXMudXNlckNhY2hlID0gbmV3IFR0bENhY2hlPFNsYWNrVXNlcj4odGhpcy5zZXR0aW5ncy51c2VyQ2FjaGVUdGxNcyk7XG4gICAgdGhpcy5mYWlsZWRMb29rdXBDYWNoZSA9IG5ldyBUdGxDYWNoZTxib29sZWFuPih0aGlzLnNldHRpbmdzLmZhaWxlZExvb2t1cFR0bE1zKTtcbiAgICB0aGlzLnNlcnZpY2UgPSBjcmVhdGVTbGFja1NlcnZpY2UodGhpcy5zZXR0aW5ncy5zZXNzaW9uKTtcbiAgICB0aGlzLnJlYnVpbGRSZXNvbHZlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWJ1aWxkUmVzb2x2ZXIoKTogdm9pZCB7XG4gICAgdGhpcy5yZXNvbHZlciA9IGNyZWF0ZVJlc29sdmVyKHtcbiAgICAgIGNoYW5uZWxDYWNoZTogdGhpcy5jaGFubmVsQ2FjaGUsXG4gICAgICBmYWlsZWRMb29rdXBDYWNoZTogdGhpcy5mYWlsZWRMb29rdXBDYWNoZSxcbiAgICAgIHNlcnZpY2U6IHRoaXMuc2VydmljZSxcbiAgICAgIHNlc3Npb246IHRoaXMuc2V0dGluZ3Muc2Vzc2lvbixcbiAgICAgIHVzZXJDYWNoZTogdGhpcy51c2VyQ2FjaGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlZ2lzdGVyQ29tbWFuZHMoKTogdm9pZCB7XG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAndGVzdC1zbGFjay1jb25uZWN0aW9uJyxcbiAgICAgIG5hbWU6ICdUZXN0IFNsYWNrIGNvbm5lY3Rpb24nLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc2hvd0Nvbm5lY3Rpb25TdGF0dXMoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ2luc2VydC1zbGFjay1saW5rJyxcbiAgICAgIG5hbWU6ICdJbnNlcnQgU2xhY2sgbGluaycsXG4gICAgICBlZGl0b3JDYWxsYmFjazogKGVkaXRvcikgPT4ge1xuICAgICAgICB2b2lkIHRoaXMucmVwbGFjZVNlbGVjdGlvbldpdGhTbGFja0xpbmtzKGVkaXRvcik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAnaW5zZXJ0LXNsYWNrLW1lc3NhZ2UtbGluaycsXG4gICAgICBuYW1lOiAnSW5zZXJ0IFNsYWNrIG1lc3NhZ2UgbGluaycsXG4gICAgICBlZGl0b3JDYWxsYmFjazogKGVkaXRvcikgPT4ge1xuICAgICAgICB2b2lkIHRoaXMucmVwbGFjZVNlbGVjdGlvbldpdGhTbGFja0xpbmtzKGVkaXRvciwge1xuICAgICAgICAgIGVuYWJsZUNoYW5uZWxzOiBmYWxzZSxcbiAgICAgICAgICBlbmFibGVEbVNlbnRpbmVsczogZmFsc2UsXG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3JlZnJlc2gtc2xhY2stcGVvcGxlLWNhY2hlJyxcbiAgICAgIG5hbWU6ICdSZWZyZXNoIFNsYWNrIHBlb3BsZSBjYWNoZScsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICB0aGlzLnJlc2V0VXNlckNhY2hlKCk7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIHBlb3BsZSBjYWNoZSBjbGVhcmVkLicpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3JlZnJlc2gtc2xhY2stY2hhbm5lbC1jYWNoZScsXG4gICAgICBuYW1lOiAnUmVmcmVzaCBTbGFjayBjaGFubmVsIGNhY2hlJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHRoaXMucmVzZXRDaGFubmVsQ2FjaGUoKTtcbiAgICAgICAgbmV3IE5vdGljZSgnU2xhY2sgY2hhbm5lbCBjYWNoZSBjbGVhcmVkLicpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ29wZW4tY3VycmVudC1zbGFjay1yZWYnLFxuICAgICAgbmFtZTogJ09wZW4gY3VycmVudCBTbGFjayByZWYnLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3IpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLm9wZW5DdXJyZW50U2xhY2tSZWYoZWRpdG9yKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlZ2lzdGVyRWRpdG9yTGlzdGVuZXIoKTogdm9pZCB7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKCdlZGl0b3ItY2hhbmdlJywgKGVkaXRvcikgPT4ge1xuICAgICAgICBpZiAodGhpcy5pc0FwcGx5aW5nQ2hhbmdlcykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnJlZnJlc2hUaW1lciAhPT0gbnVsbCkge1xuICAgICAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5yZWZyZXNoVGltZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWZyZXNoVGltZXIgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJlZnJlc2hFZGl0b3IoZWRpdG9yKTtcbiAgICAgICAgfSwgdGhpcy5zZXR0aW5ncy5pZGxlRGVsYXlNcyk7XG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hFZGl0b3IoZWRpdG9yOiBFZGl0b3IpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcbiAgICBjb25zdCBjdXJzb3JPZmZzZXQgPSBlZGl0b3IucG9zVG9PZmZzZXQoZWRpdG9yLmdldEN1cnNvcigpKTtcbiAgICBjb25zdCByZXBsYWNlbWVudHMgPSBhd2FpdCBwbGFuU2xhY2tMaW5rUmVwbGFjZW1lbnRzKHNvdXJjZSwge1xuICAgICAgY3Vyc29yT2Zmc2V0LFxuICAgICAgcmVzb2x2ZXI6IHRoaXMucmVzb2x2ZXIsXG4gICAgICBzZXR0aW5nczogdGhpcy5zZXR0aW5ncyxcbiAgICB9KTtcblxuICAgIGlmICghcmVwbGFjZW1lbnRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5leHRWYWx1ZSA9IGFwcGx5UmVwbGFjZW1lbnRzKHNvdXJjZSwgcmVwbGFjZW1lbnRzKTtcblxuICAgIGlmIChuZXh0VmFsdWUgPT09IHNvdXJjZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaXNBcHBseWluZ0NoYW5nZXMgPSB0cnVlO1xuXG4gICAgdHJ5IHtcbiAgICAgIGVkaXRvci5zZXRWYWx1ZShuZXh0VmFsdWUpO1xuICAgICAgZWRpdG9yLnNldEN1cnNvcihlZGl0b3Iub2Zmc2V0VG9Qb3MoY3Vyc29yT2Zmc2V0KSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuaXNBcHBseWluZ0NoYW5nZXMgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlcGxhY2VTZWxlY3Rpb25XaXRoU2xhY2tMaW5rcyhcbiAgICBlZGl0b3I6IEVkaXRvcixcbiAgICBvdmVycmlkZXM/OiBQYXJ0aWFsPFBpY2s8U2xhY2tCYXNlc1NldHRpbmdzLCAnZW5hYmxlQ2hhbm5lbHMnIHwgJ2VuYWJsZURtU2VudGluZWxzJyB8ICdlbmFibGVQZXJtYWxpbmtzJz4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5nZXRTZWxlY3Rpb24oKTtcblxuICAgIGlmICghc2VsZWN0aW9uKSB7XG4gICAgICBuZXcgTm90aWNlKCdTZWxlY3QgU2xhY2sgdGV4dCBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXBsYWNlbWVudHMgPSBhd2FpdCBwbGFuU2xhY2tMaW5rUmVwbGFjZW1lbnRzKHNlbGVjdGlvbiwge1xuICAgICAgY3Vyc29yT2Zmc2V0OiAtMSxcbiAgICAgIHJlc29sdmVyOiB0aGlzLnJlc29sdmVyLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgLi4udGhpcy5zZXR0aW5ncyxcbiAgICAgICAgLi4ub3ZlcnJpZGVzLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmICghcmVwbGFjZW1lbnRzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZSgnTm8gU2xhY2sgcmVmZXJlbmNlcyBmb3VuZCBpbiB0aGUgY3VycmVudCBzZWxlY3Rpb24uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24oYXBwbHlSZXBsYWNlbWVudHMoc2VsZWN0aW9uLCByZXBsYWNlbWVudHMpKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgb3BlbkN1cnJlbnRTbGFja1JlZihlZGl0b3I6IEVkaXRvcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRleHQgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcbiAgICBjb25zdCBjdXJzb3JPZmZzZXQgPSBlZGl0b3IucG9zVG9PZmZzZXQoZWRpdG9yLmdldEN1cnNvcigpKTtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBkZXRlY3RDYW5kaWRhdGVzKHRleHQsIHsgY3Vyc29yT2Zmc2V0IH0pLmZpbmQoXG4gICAgICAoaXRlbSkgPT4gY3Vyc29yT2Zmc2V0ID49IGl0ZW0uc3RhcnQgJiYgY3Vyc29yT2Zmc2V0IDw9IGl0ZW0uZW5kXG4gICAgKTtcblxuICAgIGlmICghY2FuZGlkYXRlKSB7XG4gICAgICBuZXcgTm90aWNlKCdObyBTbGFjayByZWZlcmVuY2UgdW5kZXIgdGhlIGN1cnNvci4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdtZXNzYWdlLXBlcm1hbGluaycpIHtcbiAgICAgIHdpbmRvdy5vcGVuKGNhbmRpZGF0ZS52YWx1ZSwgJ19ibGFuaycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2NoYW5uZWwtcmVmJykge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCB0aGlzLnJlc29sdmVyLnJlc29sdmVDaGFubmVsUmVmKGNhbmRpZGF0ZS52YWx1ZSk7XG5cbiAgICAgIGlmICghcmVzb2x2ZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVW5hYmxlIHRvIHJlc29sdmUgdGhhdCBTbGFjayBjaGFubmVsLicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHdpbmRvdy5vcGVuKFxuICAgICAgICBidWlsZFRhcmdldFVybCh7XG4gICAgICAgICAgY2hhbm5lbElkOiByZXNvbHZlZC5jaGFubmVsSWQsXG4gICAgICAgICAgdGFyZ2V0OiB0aGlzLnNldHRpbmdzLnRhcmdldCxcbiAgICAgICAgICB0ZWFtSWQ6IHJlc29sdmVkLnRlYW1JZCxcbiAgICAgICAgfSksXG4gICAgICAgICdfYmxhbmsnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5yZXNvbHZlci5yZXNvbHZlRG1TZW50aW5lbChjYW5kaWRhdGUudmFsdWUpO1xuXG4gICAgaWYgKCFyZXNvbHZlZCkge1xuICAgICAgbmV3IE5vdGljZSgnVW5hYmxlIHRvIHJlc29sdmUgdGhhdCBTbGFjayBETS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB3aW5kb3cub3Blbihgc2xhY2s6Ly91c2VyP3RlYW09JHtyZXNvbHZlZC50ZWFtSWR9JmlkPSR7cmVzb2x2ZWQudXNlcklkfWAsICdfYmxhbmsnKTtcbiAgfVxufVxuXG5jbGFzcyBTbGFja0Jhc2VzU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IFNsYWNrQmFzZXNQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5nZXRTZXR0aW5ncygpO1xuXG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdoMicsIHsgdGV4dDogJ1NsYWNrIEJhc2VzJyB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1dvcmtzcGFjZSBzbHVnJylcbiAgICAgIC5zZXREZXNjKCdVc2VkIGZvciBwZXJtYWxpbmsgZmFsbGJhY2sgcmVuZGVyaW5nIGFuZCBzZXNzaW9uIG1ldGFkYXRhLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShzZXR0aW5ncy5zZXNzaW9uLndvcmtzcGFjZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHtcbiAgICAgICAgICAgIHNlc3Npb246IHtcbiAgICAgICAgICAgICAgLi4udGhpcy5wbHVnaW4uZ2V0U2V0dGluZ3MoKS5zZXNzaW9uLFxuICAgICAgICAgICAgICB3b3Jrc3BhY2U6IHZhbHVlLnRyaW0oKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnVGVhbSBJRCcpXG4gICAgICAuc2V0RGVzYygnVXNlZCBmb3IgU2xhY2sgZGVlcCBsaW5rcy4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoc2V0dGluZ3Muc2Vzc2lvbi50ZWFtSWQpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7XG4gICAgICAgICAgICBzZXNzaW9uOiB7XG4gICAgICAgICAgICAgIC4uLnRoaXMucGx1Z2luLmdldFNldHRpbmdzKCkuc2Vzc2lvbixcbiAgICAgICAgICAgICAgdGVhbUlkOiB2YWx1ZS50cmltKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0NsaWVudCBJRCcpXG4gICAgICAuc2V0RGVzYygnU2xhY2sgYXBwIGNsaWVudCBJRCBmb3IgYSBkZXNrdG9wIFBLQ0UgZmxvdy4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoc2V0dGluZ3MuY2xpZW50SWQpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IGNsaWVudElkOiB2YWx1ZS50cmltKCkgfSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQWNjZXNzIHRva2VuJylcbiAgICAgIC5zZXREZXNjKCdTdG9yZWQgbG9jYWxseSBmb3IgU2xhY2sgbWV0YWRhdGEgaHlkcmF0aW9uLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LmlucHV0RWwudHlwZSA9ICdwYXNzd29yZCc7XG4gICAgICAgIHRleHQuc2V0VmFsdWUoc2V0dGluZ3Muc2Vzc2lvbi5hY2Nlc3NUb2tlbiA/PyAnJykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHtcbiAgICAgICAgICAgIHNlc3Npb246IHtcbiAgICAgICAgICAgICAgLi4udGhpcy5wbHVnaW4uZ2V0U2V0dGluZ3MoKS5zZXNzaW9uLFxuICAgICAgICAgICAgICBhY2Nlc3NUb2tlbjogdmFsdWUudHJpbSgpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1JlZnJlc2ggdG9rZW4nKVxuICAgICAgLnNldERlc2MoJ09wdGlvbmFsIHJlZnJlc2ggdG9rZW4gZm9yIGxvbmctbGl2ZWQgc2Vzc2lvbnMuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuaW5wdXRFbC50eXBlID0gJ3Bhc3N3b3JkJztcbiAgICAgICAgdGV4dC5zZXRWYWx1ZShzZXR0aW5ncy5zZXNzaW9uLnJlZnJlc2hUb2tlbiA/PyAnJykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHtcbiAgICAgICAgICAgIHNlc3Npb246IHtcbiAgICAgICAgICAgICAgLi4udGhpcy5wbHVnaW4uZ2V0U2V0dGluZ3MoKS5zZXNzaW9uLFxuICAgICAgICAgICAgICByZWZyZXNoVG9rZW46IHZhbHVlLnRyaW0oKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdNZXNzYWdlIHRlbXBsYXRlJylcbiAgICAgIC5zZXREZXNjKCdDb250cm9scyBob3cgcGFzdGVkIFNsYWNrIG1lc3NhZ2UgcGVybWFsaW5rcyByZW5kZXIuJylcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShzZXR0aW5ncy5tZXNzYWdlVGVtcGxhdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IG1lc3NhZ2VUZW1wbGF0ZTogdmFsdWUudHJpbSgpIHx8IERFRkFVTFRfU0VUVElOR1MubWVzc2FnZVRlbXBsYXRlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ByZWZlcnJlZCBsaW5rIHRhcmdldCcpXG4gICAgICAuc2V0RGVzYygnQ2hvb3NlIFNsYWNrIGFwcCBsaW5rcyBvciB0aGUgd2ViL2FwcF9yZWRpcmVjdCBmYWxsYmFjay4nKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKCdhcHAnLCAnU2xhY2sgYXBwJylcbiAgICAgICAgICAuYWRkT3B0aW9uKCd3ZWInLCAnV2ViIC8gYXBwX3JlZGlyZWN0JylcbiAgICAgICAgICAuc2V0VmFsdWUoc2V0dGluZ3MudGFyZ2V0KVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IHRhcmdldDogdmFsdWUgPT09ICd3ZWInID8gJ3dlYicgOiAnYXBwJyB9KTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0lkbGUgZGVsYXknKVxuICAgICAgLnNldERlc2MoJ0hvdyBsb25nIHRoZSBwbHVnaW4gd2FpdHMgYWZ0ZXIgdHlwaW5nIGJlZm9yZSBzY2FubmluZyB0aGUgbm90ZS4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHNldHRpbmdzLmlkbGVEZWxheU1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKE51bWJlci5pc05hTihwYXJzZWQpIHx8IHBhcnNlZCA8IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBpZGxlRGVsYXlNczogcGFyc2VkIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0F1dG8tbGluayBjaGFubmVscycpXG4gICAgICAuc2V0RGVzYygnUmVzb2x2ZSAjY2hhbm5lbCByZWZlcmVuY2VzIGFmdGVyIHRoZSBpZGxlIGRlbGF5LicpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShzZXR0aW5ncy5lbmFibGVDaGFubmVscykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHsgZW5hYmxlQ2hhbm5lbHM6IHZhbHVlIH0pO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0F1dG8tbGluayBETSBzZW50aW5lbHMnKVxuICAgICAgLnNldERlc2MoJ1Jlc29sdmUgZXhwbGljaXQgZG06QG5hbWUgb3IgZG06ZW1haWwgcmVmZXJlbmNlcy4nKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUoc2V0dGluZ3MuZW5hYmxlRG1TZW50aW5lbHMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh7IGVuYWJsZURtU2VudGluZWxzOiB2YWx1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdBdXRvLWxpbmsgcGFzdGVkIHBlcm1hbGlua3MnKVxuICAgICAgLnNldERlc2MoJ0NvbnZlcnQgcGFzdGVkIFNsYWNrIG1lc3NhZ2UgcGVybWFsaW5rcyBpbnRvIHNtYXJ0IE1hcmtkb3duIGxpbmtzLicpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShzZXR0aW5ncy5lbmFibGVQZXJtYWxpbmtzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoeyBlbmFibGVQZXJtYWxpbmtzOiB2YWx1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdUZXN0IFNsYWNrIGNvbm5lY3Rpb24nKVxuICAgICAgLnNldERlc2MoJ0NoZWNrIHdoZXRoZXIgYSBsb2NhbCBTbGFjayBzZXNzaW9uIGlzIGNvbmZpZ3VyZWQuJylcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1Rlc3QnKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zaG93Q29ubmVjdGlvblN0YXR1cygpO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnRGlzY29ubmVjdCcpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmRpc2Nvbm5lY3RTbGFjaygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoJ1NsYWNrIHNlc3Npb24gY2xlYXJlZC4nKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cbiIsICJleHBvcnQgY2xhc3MgVHRsQ2FjaGU8VD4ge1xuICBwcml2YXRlIHJlYWRvbmx5IGVudHJpZXMgPSBuZXcgTWFwPHN0cmluZywgeyBleHBpcmVzQXQ6IG51bWJlcjsgdmFsdWU6IFQgfT4oKTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHR0bE1zOiBudW1iZXIpIHt9XG5cbiAgZ2V0KGtleTogc3RyaW5nKTogVCB8IG51bGwge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChrZXkpO1xuXG4gICAgaWYgKCFlbnRyeSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKGVudHJ5LmV4cGlyZXNBdCA8PSBEYXRlLm5vdygpKSB7XG4gICAgICB0aGlzLmVudHJpZXMuZGVsZXRlKGtleSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cnkudmFsdWU7XG4gIH1cblxuICBzZXQoa2V5OiBzdHJpbmcsIHZhbHVlOiBUKTogdm9pZCB7XG4gICAgdGhpcy5lbnRyaWVzLnNldChrZXksIHtcbiAgICAgIGV4cGlyZXNBdDogRGF0ZS5ub3coKSArIHRoaXMudHRsTXMsXG4gICAgICB2YWx1ZSxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ2FuZGlkYXRlS2luZCwgQ2FuZGlkYXRlTWF0Y2ggfSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgRE1fU0VOVElORUxfUEFUVEVSTiA9IC9cXGJkbTooW0BcXHcuKy1dKykvZztcbmNvbnN0IENIQU5ORUxfUkVGX1BBVFRFUk4gPSAvKF58W1xccyhdKSMoW2EtejAtOS5fLV0rKS9naTtcbmNvbnN0IE1FU1NBR0VfTElOS19QQVRURVJOID0gL2h0dHBzOlxcL1xcL1thLXowLTktXStcXC5zbGFja1xcLmNvbVxcL2FyY2hpdmVzXFwvW0EtWjAtOV0rXFwvcFxcZHsxNn0vZ2k7XG5jb25zdCBNQVJLRE9XTl9MSU5LX1BBVFRFUk4gPSAvXFxbW15cXF1dKl1cXChbXildK1xcKS9nO1xuY29uc3QgV0lLSUxJTktfUEFUVEVSTiA9IC9cXFtcXFtbXltcXF1dK11dL2c7XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3RDYW5kaWRhdGVzKFxuICB0ZXh0OiBzdHJpbmcsXG4gIGlucHV0OiB7XG4gICAgY3Vyc29yT2Zmc2V0OiBudW1iZXI7XG4gIH1cbik6IENhbmRpZGF0ZU1hdGNoW10ge1xuICBjb25zdCBleGNsdWRlZFJhbmdlcyA9IGdldEV4Y2x1ZGVkUmFuZ2VzKHRleHQpO1xuICBjb25zdCBjYW5kaWRhdGVzOiBDYW5kaWRhdGVNYXRjaFtdID0gW107XG5cbiAgYWRkTWF0Y2hlcyhjYW5kaWRhdGVzLCB0ZXh0LCBNRVNTQUdFX0xJTktfUEFUVEVSTiwgJ21lc3NhZ2UtcGVybWFsaW5rJywgZXhjbHVkZWRSYW5nZXMsIGlucHV0LmN1cnNvck9mZnNldCk7XG4gIGFkZE1hdGNoZXMoY2FuZGlkYXRlcywgdGV4dCwgRE1fU0VOVElORUxfUEFUVEVSTiwgJ2RtLXNlbnRpbmVsJywgZXhjbHVkZWRSYW5nZXMsIGlucHV0LmN1cnNvck9mZnNldCk7XG5cbiAgZm9yIChjb25zdCBtYXRjaCBvZiB0ZXh0Lm1hdGNoQWxsKENIQU5ORUxfUkVGX1BBVFRFUk4pKSB7XG4gICAgY29uc3QgcHJlZml4ID0gbWF0Y2hbMV0gPz8gJyc7XG4gICAgY29uc3QgdmFsdWUgPSBgIyR7bWF0Y2hbMl19YDtcbiAgICBjb25zdCBzdGFydCA9IChtYXRjaC5pbmRleCA/PyAwKSArIHByZWZpeC5sZW5ndGg7XG4gICAgY29uc3QgZW5kID0gc3RhcnQgKyB2YWx1ZS5sZW5ndGg7XG5cbiAgICBpZiAoIXNob3VsZFNraXBDYW5kaWRhdGUoc3RhcnQsIGVuZCwgZXhjbHVkZWRSYW5nZXMsIGlucHV0LmN1cnNvck9mZnNldCkpIHtcbiAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IGVuZCwga2luZDogJ2NoYW5uZWwtcmVmJywgc3RhcnQsIHZhbHVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjYW5kaWRhdGVzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LnN0YXJ0IC0gcmlnaHQuc3RhcnQpO1xufVxuXG5mdW5jdGlvbiBhZGRNYXRjaGVzKFxuICBjYW5kaWRhdGVzOiBDYW5kaWRhdGVNYXRjaFtdLFxuICB0ZXh0OiBzdHJpbmcsXG4gIHBhdHRlcm46IFJlZ0V4cCxcbiAga2luZDogQ2FuZGlkYXRlS2luZCxcbiAgZXhjbHVkZWRSYW5nZXM6IEFycmF5PHsgZW5kOiBudW1iZXI7IHN0YXJ0OiBudW1iZXIgfT4sXG4gIGN1cnNvck9mZnNldDogbnVtYmVyXG4pOiB2b2lkIHtcbiAgZm9yIChjb25zdCBtYXRjaCBvZiB0ZXh0Lm1hdGNoQWxsKHBhdHRlcm4pKSB7XG4gICAgY29uc3QgdmFsdWUgPSBtYXRjaFswXTtcbiAgICBjb25zdCBzdGFydCA9IG1hdGNoLmluZGV4ID8/IDA7XG4gICAgY29uc3QgZW5kID0gc3RhcnQgKyB2YWx1ZS5sZW5ndGg7XG5cbiAgICBpZiAoIXNob3VsZFNraXBDYW5kaWRhdGUoc3RhcnQsIGVuZCwgZXhjbHVkZWRSYW5nZXMsIGN1cnNvck9mZnNldCkpIHtcbiAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IGVuZCwga2luZCwgc3RhcnQsIHZhbHVlIH0pO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRFeGNsdWRlZFJhbmdlcyh0ZXh0OiBzdHJpbmcpOiBBcnJheTx7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0+IHtcbiAgY29uc3QgcmFuZ2VzID0gY29sbGVjdFJhbmdlcyh0ZXh0LCBNQVJLRE9XTl9MSU5LX1BBVFRFUk4pO1xuXG4gIGZvciAoY29uc3QgcmFuZ2Ugb2YgY29sbGVjdFJhbmdlcyh0ZXh0LCBXSUtJTElOS19QQVRURVJOKSkge1xuICAgIHJhbmdlcy5wdXNoKHJhbmdlKTtcbiAgfVxuXG4gIGNvbnN0IGZyb250bWF0dGVyUmFuZ2UgPSBnZXRGcm9udG1hdHRlclJhbmdlKHRleHQpO1xuXG4gIGlmIChmcm9udG1hdHRlclJhbmdlKSB7XG4gICAgcmFuZ2VzLnB1c2goZnJvbnRtYXR0ZXJSYW5nZSk7XG4gIH1cblxuICByZXR1cm4gcmFuZ2VzO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0UmFuZ2VzKHRleHQ6IHN0cmluZywgcGF0dGVybjogUmVnRXhwKTogQXJyYXk8eyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9PiB7XG4gIGNvbnN0IHJhbmdlczogQXJyYXk8eyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9PiA9IFtdO1xuXG4gIGZvciAoY29uc3QgbWF0Y2ggb2YgdGV4dC5tYXRjaEFsbChwYXR0ZXJuKSkge1xuICAgIGNvbnN0IHN0YXJ0ID0gbWF0Y2guaW5kZXggPz8gMDtcbiAgICByYW5nZXMucHVzaCh7IGVuZDogc3RhcnQgKyBtYXRjaFswXS5sZW5ndGgsIHN0YXJ0IH0pO1xuICB9XG5cbiAgcmV0dXJuIHJhbmdlcztcbn1cblxuZnVuY3Rpb24gZ2V0RnJvbnRtYXR0ZXJSYW5nZSh0ZXh0OiBzdHJpbmcpOiB7IGVuZDogbnVtYmVyOyBzdGFydDogbnVtYmVyIH0gfCBudWxsIHtcbiAgaWYgKCF0ZXh0LnN0YXJ0c1dpdGgoJy0tLVxcbicpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBjbG9zaW5nSW5kZXggPSB0ZXh0LmluZGV4T2YoJ1xcbi0tLVxcbicsIDQpO1xuXG4gIGlmIChjbG9zaW5nSW5kZXggPT09IC0xKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4geyBlbmQ6IGNsb3NpbmdJbmRleCArIDUsIHN0YXJ0OiAwIH07XG59XG5cbmZ1bmN0aW9uIHNob3VsZFNraXBDYW5kaWRhdGUoXG4gIHN0YXJ0OiBudW1iZXIsXG4gIGVuZDogbnVtYmVyLFxuICBleGNsdWRlZFJhbmdlczogQXJyYXk8eyBlbmQ6IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9PixcbiAgY3Vyc29yT2Zmc2V0OiBudW1iZXJcbik6IGJvb2xlYW4ge1xuICBpZiAoY3Vyc29yT2Zmc2V0ID49IHN0YXJ0ICYmIGN1cnNvck9mZnNldCA8PSBlbmQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBleGNsdWRlZFJhbmdlcy5zb21lKChyYW5nZSkgPT4gc3RhcnQgPCByYW5nZS5lbmQgJiYgZW5kID4gcmFuZ2Uuc3RhcnQpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgTGlua1RhcmdldFByZWZlcmVuY2UsIFJlbmRlclZhbHVlcyB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyU21hcnRMaW5rKHRlbXBsYXRlOiBzdHJpbmcsIHZhbHVlczogUmVuZGVyVmFsdWVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRlbXBsYXRlLnJlcGxhY2UoL1xceyhcXHcrKVxcfS9nLCAoX21hdGNoLCB0b2tlbjoga2V5b2YgUmVuZGVyVmFsdWVzKSA9PiB2YWx1ZXNbdG9rZW5dID8/ICcnKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0VXJsKGlucHV0OiB7XG4gIGNoYW5uZWxJZDogc3RyaW5nO1xuICB0YXJnZXQ6IExpbmtUYXJnZXRQcmVmZXJlbmNlO1xuICB0ZWFtSWQ6IHN0cmluZztcbn0pOiBzdHJpbmcge1xuICBpZiAoaW5wdXQudGFyZ2V0ID09PSAnYXBwJykge1xuICAgIHJldHVybiBgc2xhY2s6Ly9jaGFubmVsP3RlYW09JHtpbnB1dC50ZWFtSWR9JmlkPSR7aW5wdXQuY2hhbm5lbElkfWA7XG4gIH1cblxuICByZXR1cm4gYGh0dHBzOi8vc2xhY2suY29tL2FwcF9yZWRpcmVjdD90ZWFtPSR7aW5wdXQudGVhbUlkfSZjaGFubmVsPSR7aW5wdXQuY2hhbm5lbElkfWA7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBSZW5kZXJWYWx1ZXMsIFRleHRSZXBsYWNlbWVudCB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgZGV0ZWN0Q2FuZGlkYXRlcyB9IGZyb20gJy4vZGV0ZWN0b3InO1xuaW1wb3J0IHsgYnVpbGRUYXJnZXRVcmwsIHJlbmRlclNtYXJ0TGluayB9IGZyb20gJy4vcmVuZGVyZXInO1xuXG5pbnRlcmZhY2UgRW5naW5lUmVzb2x2ZXIge1xuICByZXNvbHZlQ2hhbm5lbFJlZih2YWx1ZTogc3RyaW5nKTogUHJvbWlzZTx7IGNoYW5uZWxJZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHRlYW1JZDogc3RyaW5nIH0gfCBudWxsPjtcbiAgcmVzb2x2ZURtU2VudGluZWwodmFsdWU6IHN0cmluZyk6IFByb21pc2U8eyBkaXNwbGF5TmFtZTogc3RyaW5nOyB0ZWFtSWQ6IHN0cmluZzsgdXNlcklkOiBzdHJpbmcgfSB8IG51bGw+O1xuICByZXNvbHZlUGVybWFsaW5rKHZhbHVlOiBzdHJpbmcpOiBQcm9taXNlPFJlbmRlclZhbHVlcz47XG59XG5cbmludGVyZmFjZSBFbmdpbmVTZXR0aW5ncyB7XG4gIGVuYWJsZUNoYW5uZWxzOiBib29sZWFuO1xuICBlbmFibGVEbVNlbnRpbmVsczogYm9vbGVhbjtcbiAgZW5hYmxlUGVybWFsaW5rczogYm9vbGVhbjtcbiAgbWVzc2FnZVRlbXBsYXRlOiBzdHJpbmc7XG4gIHRhcmdldDogJ2FwcCcgfCAnd2ViJztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBsYW5TbGFja0xpbmtSZXBsYWNlbWVudHMoXG4gIHRleHQ6IHN0cmluZyxcbiAgaW5wdXQ6IHtcbiAgICBjdXJzb3JPZmZzZXQ6IG51bWJlcjtcbiAgICByZXNvbHZlcjogRW5naW5lUmVzb2x2ZXI7XG4gICAgc2V0dGluZ3M6IEVuZ2luZVNldHRpbmdzO1xuICB9XG4pOiBQcm9taXNlPFRleHRSZXBsYWNlbWVudFtdPiB7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBkZXRlY3RDYW5kaWRhdGVzKHRleHQsIHsgY3Vyc29yT2Zmc2V0OiBpbnB1dC5jdXJzb3JPZmZzZXQgfSk7XG4gIGNvbnN0IHJlcGxhY2VtZW50czogVGV4dFJlcGxhY2VtZW50W10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnbWVzc2FnZS1wZXJtYWxpbmsnICYmIGlucHV0LnNldHRpbmdzLmVuYWJsZVBlcm1hbGlua3MpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IGF3YWl0IGlucHV0LnJlc29sdmVyLnJlc29sdmVQZXJtYWxpbmsoY2FuZGlkYXRlLnZhbHVlKTtcbiAgICAgIHJlcGxhY2VtZW50cy5wdXNoKHtcbiAgICAgICAgZW5kOiBjYW5kaWRhdGUuZW5kLFxuICAgICAgICBzdGFydDogY2FuZGlkYXRlLnN0YXJ0LFxuICAgICAgICB0ZXh0OiByZW5kZXJTbWFydExpbmsoaW5wdXQuc2V0dGluZ3MubWVzc2FnZVRlbXBsYXRlLCB7XG4gICAgICAgICAgLi4udmFsdWVzLFxuICAgICAgICAgIHVybDogdmFsdWVzLnVybCA/PyBjYW5kaWRhdGUudmFsdWUsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdjaGFubmVsLXJlZicgJiYgaW5wdXQuc2V0dGluZ3MuZW5hYmxlQ2hhbm5lbHMpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgaW5wdXQucmVzb2x2ZXIucmVzb2x2ZUNoYW5uZWxSZWYoY2FuZGlkYXRlLnZhbHVlKTtcblxuICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgIHJlcGxhY2VtZW50cy5wdXNoKHtcbiAgICAgICAgICBlbmQ6IGNhbmRpZGF0ZS5lbmQsXG4gICAgICAgICAgc3RhcnQ6IGNhbmRpZGF0ZS5zdGFydCxcbiAgICAgICAgICB0ZXh0OiBgWyMke3Jlc29sdmVkLm5hbWV9XSgke2J1aWxkVGFyZ2V0VXJsKHtcbiAgICAgICAgICAgIGNoYW5uZWxJZDogcmVzb2x2ZWQuY2hhbm5lbElkLFxuICAgICAgICAgICAgdGFyZ2V0OiBpbnB1dC5zZXR0aW5ncy50YXJnZXQsXG4gICAgICAgICAgICB0ZWFtSWQ6IHJlc29sdmVkLnRlYW1JZCxcbiAgICAgICAgICB9KX0pYCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2RtLXNlbnRpbmVsJyAmJiBpbnB1dC5zZXR0aW5ncy5lbmFibGVEbVNlbnRpbmVscykge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCBpbnB1dC5yZXNvbHZlci5yZXNvbHZlRG1TZW50aW5lbChjYW5kaWRhdGUudmFsdWUpO1xuXG4gICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgcmVwbGFjZW1lbnRzLnB1c2goe1xuICAgICAgICAgIGVuZDogY2FuZGlkYXRlLmVuZCxcbiAgICAgICAgICBzdGFydDogY2FuZGlkYXRlLnN0YXJ0LFxuICAgICAgICAgIHRleHQ6IGBbRE0gJHtyZXNvbHZlZC5kaXNwbGF5TmFtZX1dKCR7YnVpbGRVc2VyVGFyZ2V0VXJsKHJlc29sdmVkLnRlYW1JZCwgcmVzb2x2ZWQudXNlcklkKX0pYCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcGxhY2VtZW50cztcbn1cblxuZnVuY3Rpb24gYnVpbGRVc2VyVGFyZ2V0VXJsKHRlYW1JZDogc3RyaW5nLCB1c2VySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2xhY2s6Ly91c2VyP3RlYW09JHt0ZWFtSWR9JmlkPSR7dXNlcklkfWA7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBQYXJzZWRTbGFja1Blcm1hbGluayB9IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBTTEFDS19QRVJNQUxJTktfUEFUVEVSTiA9IC9eXFwvYXJjaGl2ZXNcXC8oW14vXSspXFwvcChcXGR7MTZ9KSQvO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTbGFja1Blcm1hbGluayh1cmw6IHN0cmluZyk6IFBhcnNlZFNsYWNrUGVybWFsaW5rIHwgbnVsbCB7XG4gIGxldCBwYXJzZWRVcmw6IFVSTDtcblxuICB0cnkge1xuICAgIHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBtYXRjaCA9IHBhcnNlZFVybC5wYXRobmFtZS5tYXRjaChTTEFDS19QRVJNQUxJTktfUEFUVEVSTik7XG5cbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgWywgY2hhbm5lbElkLCBwYWNrZWRUaW1lc3RhbXBdID0gbWF0Y2g7XG5cbiAgcmV0dXJuIHtcbiAgICBjaGFubmVsSWQsXG4gICAgdHM6IGAke3BhY2tlZFRpbWVzdGFtcC5zbGljZSgwLCAxMCl9LiR7cGFja2VkVGltZXN0YW1wLnNsaWNlKDEwKX1gLFxuICAgIHVybCxcbiAgICB3b3Jrc3BhY2U6IHBhcnNlZFVybC5ob3N0bmFtZS5zcGxpdCgnLicpWzBdLFxuICB9O1xufVxuIiwgImltcG9ydCB7IHBhcnNlU2xhY2tQZXJtYWxpbmsgfSBmcm9tICcuL3Blcm1hbGluayc7XG5pbXBvcnQgdHlwZSB7IFNsYWNrU2VydmljZSB9IGZyb20gJy4vc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IFJlbmRlclZhbHVlcywgU2xhY2tDaGFubmVsLCBTbGFja1Nlc3Npb24sIFNsYWNrVXNlciB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgVHRsQ2FjaGUgfSBmcm9tICcuL2NhY2hlJztcblxuaW50ZXJmYWNlIFJlc29sdmVyRGVwZW5kZW5jaWVzIHtcbiAgY2hhbm5lbENhY2hlOiBUdGxDYWNoZTxTbGFja0NoYW5uZWw+O1xuICBmYWlsZWRMb29rdXBDYWNoZTogVHRsQ2FjaGU8Ym9vbGVhbj47XG4gIHNlcnZpY2U6IFNsYWNrU2VydmljZTtcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uO1xuICB1c2VyQ2FjaGU6IFR0bENhY2hlPFNsYWNrVXNlcj47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZXNvbHZlcihkZXBzOiBSZXNvbHZlckRlcGVuZGVuY2llcykge1xuICByZXR1cm4ge1xuICAgIHJlc29sdmVDaGFubmVsUmVmOiBhc3luYyAodmFsdWU6IHN0cmluZykgPT4gcmVzb2x2ZUNoYW5uZWxSZWYoZGVwcywgdmFsdWUpLFxuICAgIHJlc29sdmVEbVNlbnRpbmVsOiBhc3luYyAodmFsdWU6IHN0cmluZykgPT4gcmVzb2x2ZURtU2VudGluZWwoZGVwcywgdmFsdWUpLFxuICAgIHJlc29sdmVQZXJtYWxpbms6IGFzeW5jICh1cmw6IHN0cmluZykgPT4gcmVzb2x2ZVBlcm1hbGluayhkZXBzLCB1cmwpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUGVybWFsaW5rKGRlcHM6IFJlc29sdmVyRGVwZW5kZW5jaWVzLCB1cmw6IHN0cmluZyk6IFByb21pc2U8UmVuZGVyVmFsdWVzPiB7XG4gIGNvbnN0IHBhcnNlZCA9IHBhcnNlU2xhY2tQZXJtYWxpbmsodXJsKTtcblxuICBpZiAoIXBhcnNlZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5zdXBwb3J0ZWQgU2xhY2sgcGVybWFsaW5rJyk7XG4gIH1cblxuICBjb25zdCBmYWxsYmFjazogUmVuZGVyVmFsdWVzID0ge1xuICAgIGNoYW5uZWxfaWQ6IHBhcnNlZC5jaGFubmVsSWQsXG4gICAgdHM6IHBhcnNlZC50cyxcbiAgICB1cmw6IHBhcnNlZC51cmwsXG4gICAgd29ya3NwYWNlOiBwYXJzZWQud29ya3NwYWNlLFxuICB9O1xuXG4gIGlmIChkZXBzLmZhaWxlZExvb2t1cENhY2hlLmdldChwYXJzZWQudXJsKSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGF3YWl0IGRlcHMuc2VydmljZS5nZXRNZXNzYWdlKHBhcnNlZC51cmwpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmZhbGxiYWNrLFxuICAgICAgYXV0aG9yOiBtZXNzYWdlLmF1dGhvck5hbWUsXG4gICAgICBhdXRob3JfaWQ6IG1lc3NhZ2UuYXV0aG9ySWQsXG4gICAgICBjaGFubmVsOiBtZXNzYWdlLmNoYW5uZWxOYW1lLFxuICAgICAgdGV4dDogbWVzc2FnZS50ZXh0LFxuICAgIH07XG4gIH0gY2F0Y2gge1xuICAgIGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuc2V0KHBhcnNlZC51cmwsIHRydWUpO1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlQ2hhbm5lbFJlZihcbiAgZGVwczogUmVzb2x2ZXJEZXBlbmRlbmNpZXMsXG4gIHZhbHVlOiBzdHJpbmdcbik6IFByb21pc2U8eyBjaGFubmVsSWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyB0ZWFtSWQ6IHN0cmluZyB9IHwgbnVsbD4ge1xuICBjb25zdCBub3JtYWxpemVkID0gdmFsdWUucmVwbGFjZSgvXiMvLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgY2FjaGVkID0gZGVwcy5jaGFubmVsQ2FjaGUuZ2V0KG5vcm1hbGl6ZWQpO1xuXG4gIGlmIChjYWNoZWQpIHtcbiAgICByZXR1cm4geyBjaGFubmVsSWQ6IGNhY2hlZC5pZCwgbmFtZTogY2FjaGVkLm5hbWUsIHRlYW1JZDogZGVwcy5zZXNzaW9uLnRlYW1JZCB9O1xuICB9XG5cbiAgaWYgKGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuZ2V0KGBjaGFubmVsOiR7bm9ybWFsaXplZH1gKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBjaGFubmVsID0gYXdhaXQgZGVwcy5zZXJ2aWNlLmdldENoYW5uZWxCeU5hbWUobm9ybWFsaXplZCk7XG5cbiAgICBpZiAoIWNoYW5uZWwpIHtcbiAgICAgIGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuc2V0KGBjaGFubmVsOiR7bm9ybWFsaXplZH1gLCB0cnVlKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGRlcHMuY2hhbm5lbENhY2hlLnNldChub3JtYWxpemVkLCBjaGFubmVsKTtcblxuICAgIHJldHVybiB7IGNoYW5uZWxJZDogY2hhbm5lbC5pZCwgbmFtZTogY2hhbm5lbC5uYW1lLCB0ZWFtSWQ6IGRlcHMuc2Vzc2lvbi50ZWFtSWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5zZXQoYGNoYW5uZWw6JHtub3JtYWxpemVkfWAsIHRydWUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVEbVNlbnRpbmVsKFxuICBkZXBzOiBSZXNvbHZlckRlcGVuZGVuY2llcyxcbiAgdmFsdWU6IHN0cmluZ1xuKTogUHJvbWlzZTx7IGRpc3BsYXlOYW1lOiBzdHJpbmc7IHRlYW1JZDogc3RyaW5nOyB1c2VySWQ6IHN0cmluZyB9IHwgbnVsbD4ge1xuICBjb25zdCBub3JtYWxpemVkID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgY2FjaGVkID0gZGVwcy51c2VyQ2FjaGUuZ2V0KG5vcm1hbGl6ZWQpO1xuXG4gIGlmIChjYWNoZWQpIHtcbiAgICByZXR1cm4geyBkaXNwbGF5TmFtZTogY2FjaGVkLmRpc3BsYXlOYW1lLCB0ZWFtSWQ6IGRlcHMuc2Vzc2lvbi50ZWFtSWQsIHVzZXJJZDogY2FjaGVkLmlkIH07XG4gIH1cblxuICBpZiAoZGVwcy5mYWlsZWRMb29rdXBDYWNoZS5nZXQoYHVzZXI6JHtub3JtYWxpemVkfWApKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBkZXBzLnNlcnZpY2UuZ2V0VXNlckJ5RG1TZW50aW5lbCh2YWx1ZSk7XG5cbiAgICBpZiAoIXVzZXIpIHtcbiAgICAgIGRlcHMuZmFpbGVkTG9va3VwQ2FjaGUuc2V0KGB1c2VyOiR7bm9ybWFsaXplZH1gLCB0cnVlKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGRlcHMudXNlckNhY2hlLnNldChub3JtYWxpemVkLCB1c2VyKTtcblxuICAgIHJldHVybiB7IGRpc3BsYXlOYW1lOiB1c2VyLmRpc3BsYXlOYW1lLCB0ZWFtSWQ6IGRlcHMuc2Vzc2lvbi50ZWFtSWQsIHVzZXJJZDogdXNlci5pZCB9O1xuICB9IGNhdGNoIHtcbiAgICBkZXBzLmZhaWxlZExvb2t1cENhY2hlLnNldChgdXNlcjoke25vcm1hbGl6ZWR9YCwgdHJ1ZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IFRleHRSZXBsYWNlbWVudCB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgZnVuY3Rpb24gc29ydFJlcGxhY2VtZW50c0JvdHRvbVVwPFQgZXh0ZW5kcyB7IHN0YXJ0OiBudW1iZXIgfT4oaXRlbXM6IFRbXSk6IFRbXSB7XG4gIHJldHVybiBbLi4uaXRlbXNdLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5zdGFydCAtIGxlZnQuc3RhcnQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlSZXBsYWNlbWVudHModGV4dDogc3RyaW5nLCByZXBsYWNlbWVudHM6IFRleHRSZXBsYWNlbWVudFtdKTogc3RyaW5nIHtcbiAgbGV0IG5leHRUZXh0ID0gdGV4dDtcblxuICBmb3IgKGNvbnN0IHJlcGxhY2VtZW50IG9mIHNvcnRSZXBsYWNlbWVudHNCb3R0b21VcChyZXBsYWNlbWVudHMpKSB7XG4gICAgbmV4dFRleHQgPVxuICAgICAgbmV4dFRleHQuc2xpY2UoMCwgcmVwbGFjZW1lbnQuc3RhcnQpICsgcmVwbGFjZW1lbnQudGV4dCArIG5leHRUZXh0LnNsaWNlKHJlcGxhY2VtZW50LmVuZCk7XG4gIH1cblxuICByZXR1cm4gbmV4dFRleHQ7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTbGFja0NoYW5uZWwsIFNsYWNrTWVzc2FnZU1ldGFkYXRhLCBTbGFja1Nlc3Npb24sIFNsYWNrVXNlciB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNsYWNrU2VydmljZSB7XG4gIGdldENoYW5uZWxCeU5hbWUobmFtZTogc3RyaW5nKTogUHJvbWlzZTxTbGFja0NoYW5uZWwgfCBudWxsPjtcbiAgZ2V0TWVzc2FnZSh1cmw6IHN0cmluZyk6IFByb21pc2U8U2xhY2tNZXNzYWdlTWV0YWRhdGE+O1xuICBnZXRVc2VyQnlEbVNlbnRpbmVsKHNlbnRpbmVsOiBzdHJpbmcpOiBQcm9taXNlPFNsYWNrVXNlciB8IG51bGw+O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2xhY2tTZXJ2aWNlKFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoID0gZmV0Y2hcbik6IFNsYWNrU2VydmljZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0Q2hhbm5lbEJ5TmFtZTogYXN5bmMgKG5hbWU6IHN0cmluZykgPT4gZmluZENoYW5uZWxCeU5hbWUoc2Vzc2lvbiwgbmFtZSwgZmV0Y2hJbXBsKSxcbiAgICBnZXRNZXNzYWdlOiBhc3luYyAodXJsOiBzdHJpbmcpID0+IGdldE1lc3NhZ2VNZXRhZGF0YShzZXNzaW9uLCB1cmwsIGZldGNoSW1wbCksXG4gICAgZ2V0VXNlckJ5RG1TZW50aW5lbDogYXN5bmMgKHNlbnRpbmVsOiBzdHJpbmcpID0+IGZpbmRVc2VyQnlEbVNlbnRpbmVsKHNlc3Npb24sIHNlbnRpbmVsLCBmZXRjaEltcGwpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRNZXNzYWdlTWV0YWRhdGEoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgdXJsOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPFNsYWNrTWVzc2FnZU1ldGFkYXRhPiB7XG4gIGNvbnN0IHBlcm1hbGluayA9IG5ldyBVUkwodXJsKTtcbiAgY29uc3QgY2hhbm5lbElkID0gcGVybWFsaW5rLnBhdGhuYW1lLnNwbGl0KCcvJylbMl07XG4gIGNvbnN0IHBhY2tlZFRzID0gcGVybWFsaW5rLnBhdGhuYW1lLnNwbGl0KCcvJylbM10/LnNsaWNlKDEpO1xuXG4gIGlmICghY2hhbm5lbElkIHx8ICFwYWNrZWRUcykge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBTbGFjayBwZXJtYWxpbmsnKTtcbiAgfVxuXG4gIGNvbnN0IHRzID0gYCR7cGFja2VkVHMuc2xpY2UoMCwgMTApfS4ke3BhY2tlZFRzLnNsaWNlKDEwKX1gO1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgbWVzc2FnZXM/OiBBcnJheTx7IHRleHQ/OiBzdHJpbmc7IHVzZXI/OiBzdHJpbmcgfT47XG4gIH0+KHNlc3Npb24sIGZldGNoSW1wbCwgJ2NvbnZlcnNhdGlvbnMuaGlzdG9yeScsIHtcbiAgICBjaGFubmVsOiBjaGFubmVsSWQsXG4gICAgaW5jbHVzaXZlOiAndHJ1ZScsXG4gICAgbGF0ZXN0OiB0cyxcbiAgICBsaW1pdDogJzEnLFxuICAgIG9sZGVzdDogdHMsXG4gIH0pO1xuXG4gIGNvbnN0IG1lc3NhZ2UgPSByZXNwb25zZS5tZXNzYWdlcz8uWzBdO1xuICBjb25zdCBbY2hhbm5lbE5hbWUsIGF1dGhvck5hbWVdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIGdldENoYW5uZWxOYW1lKHNlc3Npb24sIGNoYW5uZWxJZCwgZmV0Y2hJbXBsKSxcbiAgICBtZXNzYWdlPy51c2VyID8gZ2V0VXNlckRpc3BsYXlOYW1lKHNlc3Npb24sIG1lc3NhZ2UudXNlciwgZmV0Y2hJbXBsKSA6IFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpLFxuICBdKTtcblxuICByZXR1cm4ge1xuICAgIGF1dGhvcklkOiBtZXNzYWdlPy51c2VyLFxuICAgIGF1dGhvck5hbWUsXG4gICAgY2hhbm5lbE5hbWUsXG4gICAgdGV4dDogbWVzc2FnZT8udGV4dCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Q2hhbm5lbE5hbWUoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgY2hhbm5lbElkOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNhbGxTbGFja0FwaTx7XG4gICAgY2hhbm5lbD86IHsgbmFtZT86IHN0cmluZyB9O1xuICB9PihzZXNzaW9uLCBmZXRjaEltcGwsICdjb252ZXJzYXRpb25zLmluZm8nLCB7XG4gICAgY2hhbm5lbDogY2hhbm5lbElkLFxuICB9KTtcblxuICByZXR1cm4gcmVzcG9uc2UuY2hhbm5lbD8ubmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VXNlckRpc3BsYXlOYW1lKFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIHVzZXJJZDogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaFxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgIHVzZXI/OiB7IHByb2ZpbGU/OiB7IGRpc3BsYXlfbmFtZT86IHN0cmluZzsgcmVhbF9uYW1lPzogc3RyaW5nIH0gfTtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAndXNlcnMuaW5mbycsIHtcbiAgICB1c2VyOiB1c2VySWQsXG4gIH0pO1xuXG4gIHJldHVybiByZXNwb25zZS51c2VyPy5wcm9maWxlPy5kaXNwbGF5X25hbWUgfHwgcmVzcG9uc2UudXNlcj8ucHJvZmlsZT8ucmVhbF9uYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmaW5kQ2hhbm5lbEJ5TmFtZShcbiAgc2Vzc2lvbjogU2xhY2tTZXNzaW9uLFxuICBuYW1lOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoXG4pOiBQcm9taXNlPFNsYWNrQ2hhbm5lbCB8IG51bGw+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgIGNoYW5uZWxzPzogQXJyYXk8eyBpZD86IHN0cmluZzsgbmFtZT86IHN0cmluZyB9PjtcbiAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAnY29udmVyc2F0aW9ucy5saXN0Jywge1xuICAgIGV4Y2x1ZGVfYXJjaGl2ZWQ6ICd0cnVlJyxcbiAgICBsaW1pdDogJzEwMDAnLFxuICAgIHR5cGVzOiAncHVibGljX2NoYW5uZWwscHJpdmF0ZV9jaGFubmVsJyxcbiAgfSk7XG5cbiAgY29uc3QgbWF0Y2ggPSByZXNwb25zZS5jaGFubmVscz8uZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5uYW1lID09PSBuYW1lKTtcblxuICBpZiAoIW1hdGNoPy5pZCB8fCAhbWF0Y2gubmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpZDogbWF0Y2guaWQsXG4gICAgbmFtZTogbWF0Y2gubmFtZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZFVzZXJCeURtU2VudGluZWwoXG4gIHNlc3Npb246IFNsYWNrU2Vzc2lvbixcbiAgc2VudGluZWw6IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2hcbik6IFByb21pc2U8U2xhY2tVc2VyIHwgbnVsbD4ge1xuICBjb25zdCB2YWx1ZSA9IHNlbnRpbmVsLnJlcGxhY2UoL15kbTovLCAnJyk7XG5cbiAgaWYgKHZhbHVlLmluY2x1ZGVzKCdAJykgJiYgIXZhbHVlLnN0YXJ0c1dpdGgoJ0AnKSkge1xuICAgIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBjYWxsU2xhY2tBcGk8e1xuICAgICAgdXNlcj86IHsgaWQ/OiBzdHJpbmc7IHByb2ZpbGU/OiB7IGVtYWlsPzogc3RyaW5nOyBkaXNwbGF5X25hbWU/OiBzdHJpbmc7IHJlYWxfbmFtZT86IHN0cmluZyB9IH07XG4gICAgfT4oc2Vzc2lvbiwgZmV0Y2hJbXBsLCAndXNlcnMubG9va3VwQnlFbWFpbCcsIHsgZW1haWw6IHZhbHVlIH0pO1xuICAgIGNvbnN0IGVtYWlsVXNlciA9IGJ5RW1haWwudXNlcjtcblxuICAgIGlmICghZW1haWxVc2VyPy5pZCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRpc3BsYXlOYW1lOlxuICAgICAgICBlbWFpbFVzZXIucHJvZmlsZT8uZGlzcGxheV9uYW1lIHx8IGVtYWlsVXNlci5wcm9maWxlPy5yZWFsX25hbWUgfHwgZW1haWxVc2VyLnByb2ZpbGU/LmVtYWlsIHx8IGVtYWlsVXNlci5pZCxcbiAgICAgIGVtYWlsOiBlbWFpbFVzZXIucHJvZmlsZT8uZW1haWwsXG4gICAgICBpZDogZW1haWxVc2VyLmlkLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkTmFtZSA9IHZhbHVlLnJlcGxhY2UoL15ALywgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2FsbFNsYWNrQXBpPHtcbiAgICBtZW1iZXJzPzogQXJyYXk8e1xuICAgICAgaWQ/OiBzdHJpbmc7XG4gICAgICBuYW1lPzogc3RyaW5nO1xuICAgICAgcHJvZmlsZT86IHsgZGlzcGxheV9uYW1lPzogc3RyaW5nOyBlbWFpbD86IHN0cmluZzsgcmVhbF9uYW1lPzogc3RyaW5nIH07XG4gICAgfT47XG4gIH0+KHNlc3Npb24sIGZldGNoSW1wbCwgJ3VzZXJzLmxpc3QnLCB7fSk7XG5cbiAgY29uc3QgbWF0Y2ggPSByZXNwb25zZS5tZW1iZXJzPy5maW5kKChtZW1iZXIpID0+IHtcbiAgICBjb25zdCBkaXNwbGF5TmFtZSA9IG1lbWJlci5wcm9maWxlPy5kaXNwbGF5X25hbWU/LnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmVhbE5hbWUgPSBtZW1iZXIucHJvZmlsZT8ucmVhbF9uYW1lPy50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IHVzZXJuYW1lID0gbWVtYmVyLm5hbWU/LnRvTG93ZXJDYXNlKCk7XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZE5hbWUgPT09IGRpc3BsYXlOYW1lIHx8IG5vcm1hbGl6ZWROYW1lID09PSByZWFsTmFtZSB8fCBub3JtYWxpemVkTmFtZSA9PT0gdXNlcm5hbWU7XG4gIH0pO1xuXG4gIGlmICghbWF0Y2g/LmlkKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRpc3BsYXlOYW1lOiBtYXRjaC5wcm9maWxlPy5kaXNwbGF5X25hbWUgfHwgbWF0Y2gucHJvZmlsZT8ucmVhbF9uYW1lIHx8IG1hdGNoLm5hbWUgfHwgbWF0Y2guaWQsXG4gICAgZW1haWw6IG1hdGNoLnByb2ZpbGU/LmVtYWlsLFxuICAgIGlkOiBtYXRjaC5pZCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FsbFNsYWNrQXBpPFQ+KFxuICBzZXNzaW9uOiBTbGFja1Nlc3Npb24sXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoLFxuICBtZXRob2Q6IHN0cmluZyxcbiAgcXVlcnk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbik6IFByb21pc2U8VD4ge1xuICBpZiAoIXNlc3Npb24uYWNjZXNzVG9rZW4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NsYWNrIGFjY2VzcyB0b2tlbiBpcyBtaXNzaW5nJyk7XG4gIH1cblxuICBjb25zdCB1cmwgPSBuZXcgVVJMKGBodHRwczovL3NsYWNrLmNvbS9hcGkvJHttZXRob2R9YCk7XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocXVlcnkpKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoa2V5LCB2YWx1ZSk7XG4gIH1cblxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoSW1wbCh1cmwsIHtcbiAgICBoZWFkZXJzOiB7XG4gICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2Vzc2lvbi5hY2Nlc3NUb2tlbn1gLFxuICAgIH0sXG4gIH0pO1xuXG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFNsYWNrIEFQSSByZXF1ZXN0IGZhaWxlZDogJHtyZXNwb25zZS5zdGF0dXN9YCk7XG4gIH1cblxuICBjb25zdCBwYXlsb2FkID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgeyBlcnJvcj86IHN0cmluZzsgb2s/OiBib29sZWFuIH0gJiBUO1xuXG4gIGlmICghcGF5bG9hZC5vaykge1xuICAgIHRocm93IG5ldyBFcnJvcihwYXlsb2FkLmVycm9yID8/IGBTbGFjayBBUEkgcmVxdWVzdCBmYWlsZWQ6ICR7bWV0aG9kfWApO1xuICB9XG5cbiAgcmV0dXJuIHBheWxvYWQ7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBMaW5rVGFyZ2V0UHJlZmVyZW5jZSwgU2xhY2tTZXNzaW9uIH0gZnJvbSAnLi9zbGFjay90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xhY2tCYXNlc1NldHRpbmdzIHtcbiAgY2hhbm5lbENhY2hlVHRsTXM6IG51bWJlcjtcbiAgY2xpZW50SWQ6IHN0cmluZztcbiAgZW5hYmxlQ2hhbm5lbHM6IGJvb2xlYW47XG4gIGVuYWJsZURtU2VudGluZWxzOiBib29sZWFuO1xuICBlbmFibGVQZXJtYWxpbmtzOiBib29sZWFuO1xuICBmYWlsZWRMb29rdXBUdGxNczogbnVtYmVyO1xuICBpZGxlRGVsYXlNczogbnVtYmVyO1xuICBtZXNzYWdlVGVtcGxhdGU6IHN0cmluZztcbiAgcmVmcmVzaExlZXdheU1zOiBudW1iZXI7XG4gIHNjb3Blczogc3RyaW5nO1xuICBzZXNzaW9uOiBTbGFja1Nlc3Npb247XG4gIHRhcmdldDogTGlua1RhcmdldFByZWZlcmVuY2U7XG4gIHVzZXJDYWNoZVR0bE1zOiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBTbGFja0Jhc2VzU2V0dGluZ3MgPSB7XG4gIGNoYW5uZWxDYWNoZVR0bE1zOiA2MCAqIDYwICogMTAwMCxcbiAgY2xpZW50SWQ6ICcnLFxuICBlbmFibGVDaGFubmVsczogdHJ1ZSxcbiAgZW5hYmxlRG1TZW50aW5lbHM6IHRydWUsXG4gIGVuYWJsZVBlcm1hbGlua3M6IHRydWUsXG4gIGZhaWxlZExvb2t1cFR0bE1zOiA1ICogNjAgKiAxMDAwLFxuICBpZGxlRGVsYXlNczogNTAwLFxuICBtZXNzYWdlVGVtcGxhdGU6ICdbe2NoYW5uZWx9IFx1MjAyMiB7YXV0aG9yfToge3RleHR9XSh7dXJsfSknLFxuICByZWZyZXNoTGVld2F5TXM6IDYwICogMTAwMCxcbiAgc2NvcGVzOiAnY2hhbm5lbHM6cmVhZCxncm91cHM6cmVhZCx1c2VyczpyZWFkLHVzZXJzOnJlYWQuZW1haWwsY2hhbm5lbHM6aGlzdG9yeSxncm91cHM6aGlzdG9yeScsXG4gIHNlc3Npb246IHtcbiAgICBhY2Nlc3NUb2tlbjogJycsXG4gICAgZXhwaXJlc0F0OiAwLFxuICAgIHJlZnJlc2hUb2tlbjogJycsXG4gICAgdGVhbUlkOiAnJyxcbiAgICB3b3Jrc3BhY2U6ICcnLFxuICB9LFxuICB0YXJnZXQ6ICdhcHAnLFxuICB1c2VyQ2FjaGVUdGxNczogNjAgKiA2MCAqIDEwMDAsXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VTZXR0aW5ncyhcbiAgcGFydGlhbDogUGFydGlhbDxTbGFja0Jhc2VzU2V0dGluZ3M+IHwgdW5kZWZpbmVkXG4pOiBTbGFja0Jhc2VzU2V0dGluZ3Mge1xuICByZXR1cm4ge1xuICAgIC4uLkRFRkFVTFRfU0VUVElOR1MsXG4gICAgLi4ucGFydGlhbCxcbiAgICBzZXNzaW9uOiB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLnNlc3Npb24sXG4gICAgICAuLi5wYXJ0aWFsPy5zZXNzaW9uLFxuICAgIH0sXG4gIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFBaUY7OztBQ0ExRSxJQUFNLFdBQU4sTUFBa0I7QUFBQSxFQUd2QixZQUE2QixPQUFlO0FBQWY7QUFGN0IsU0FBaUIsVUFBVSxvQkFBSSxJQUE2QztBQUFBLEVBRS9CO0FBQUEsRUFFN0MsSUFBSSxLQUF1QjtBQUN6QixVQUFNLFFBQVEsS0FBSyxRQUFRLElBQUksR0FBRztBQUVsQyxRQUFJLENBQUMsT0FBTztBQUNWLGFBQU87QUFBQSxJQUNUO0FBRUEsUUFBSSxNQUFNLGFBQWEsS0FBSyxJQUFJLEdBQUc7QUFDakMsV0FBSyxRQUFRLE9BQU8sR0FBRztBQUN2QixhQUFPO0FBQUEsSUFDVDtBQUVBLFdBQU8sTUFBTTtBQUFBLEVBQ2Y7QUFBQSxFQUVBLElBQUksS0FBYSxPQUFnQjtBQUMvQixTQUFLLFFBQVEsSUFBSSxLQUFLO0FBQUEsTUFDcEIsV0FBVyxLQUFLLElBQUksSUFBSSxL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
