import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
  type App,
  type Editor,
} from 'obsidian';

import {
  buildSlackAuthorizeUrl,
  completeSlackAuth,
  createPkcePair,
  refreshSlackSession,
  type SlackApiFormRequest,
} from './slack/auth';
import { TtlCache } from './slack/cache';
import { detectCandidates } from './slack/detector';
import { planSlackLinkReplacements } from './slack/engine';
import { buildTargetUrl } from './slack/renderer';
import { createResolver } from './slack/resolver';
import { applyReplacements } from './slack/replacements';
import { createElectronSessionCipher } from './slack/secure-session';
import { createSlackService, type SlackService } from './slack/service';
import { hasValidAccessToken, shouldRefreshSession } from './slack/session';
import { SingleFlight } from './slack/single-flight';
import type { SlackChannel, SlackUser } from './slack/types';
import type { SlackBasesSettings } from './settings';
import {
  createPersistedSettings,
  DEFAULT_SETTINGS,
  loadSettingsWithSession,
  mergeSettings,
} from './settings';

const AUTH_CALLBACK_ACTION = 'slack-bases-auth';
const AUTH_RECONNECT_NOTICE_MS = 60_000;

export default class SlackBasesPlugin extends Plugin {
  private channelCache = new TtlCache<SlackChannel>(DEFAULT_SETTINGS.channelCacheTtlMs);
  private failedLookupCache = new TtlCache<boolean>(DEFAULT_SETTINGS.failedLookupTtlMs);
  private isApplyingChanges = false;
  private lastAuthNoticeAt = 0;
  private pendingAuthState: { codeVerifier: string; state: string } | null = null;
  private refreshTimer: number | null = null;
  private refreshSessionGate = new SingleFlight<boolean>();
  private service: SlackService = createSlackService(DEFAULT_SETTINGS.session);
  private sessionCipher = createElectronSessionCipher();
  private settings: SlackBasesSettings = DEFAULT_SETTINGS;
  private userCache = new TtlCache<SlackUser>(DEFAULT_SETTINGS.userCacheTtlMs);
  private resolver = createResolver({
    channelCache: this.channelCache,
    failedLookupCache: this.failedLookupCache,
    service: this.service,
    session: this.settings.session,
    userCache: this.userCache,
  });

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerObsidianProtocolHandler(AUTH_CALLBACK_ACTION, (params) => {
      void this.completeSlackConnect(params);
    });

    this.addRibbonIcon('link', 'Connect Slack', () => {
      void this.connectSlack();
    });
    this.addSettingTab(new SlackBasesSettingTab(this.app, this));
    this.registerCommands();
    this.registerEditorListener();
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async saveSettings(nextSettings?: Partial<SlackBasesSettings>): Promise<void> {
    const mergedSettings = mergeSettings(nextSettings ? { ...this.settings, ...nextSettings } : this.settings);

    this.settings = mergedSettings;
    await this.saveData(createPersistedSettings(mergedSettings, this.sessionCipher));
    this.rebuildRuntime();
  }

  getSettings(): SlackBasesSettings {
    return this.settings;
  }

  async connectSlack(): Promise<void> {
    if (!this.settings.clientId) {
      new Notice('Set your Slack client ID before connecting.');
      return;
    }

    if (!this.sessionCipher?.isAvailable()) {
      new Notice('Secure local storage is unavailable in this desktop environment.');
      return;
    }

    const pkcePair = await createPkcePair();
    const state = this.createStateToken();

    this.pendingAuthState = {
      codeVerifier: pkcePair.codeVerifier,
      state,
    };

    window.open(
      buildSlackAuthorizeUrl({
        clientId: this.settings.clientId,
        codeChallenge: pkcePair.codeChallenge,
        redirectUri: this.getRedirectUri(),
        scopes: this.settings.scopes,
        state,
      }),
      '_blank'
    );

    new Notice('Finish Slack sign-in in your browser, then return to Obsidian.');
  }

  async disconnectSlack(): Promise<void> {
    await this.saveSettings({
      encryptedSession: '',
      session: {
        ...DEFAULT_SETTINGS.session,
      },
    });
  }

  resetChannelCache(): void {
    this.channelCache = new TtlCache<SlackChannel>(this.settings.channelCacheTtlMs);
    this.rebuildResolver();
  }

  resetUserCache(): void {
    this.userCache = new TtlCache<SlackUser>(this.settings.userCacheTtlMs);
    this.rebuildResolver();
  }

  showConnectionStatus(): void {
    if (hasValidAccessToken(this.settings.session) && this.settings.session.workspace) {
      new Notice(`Slack session configured for ${this.settings.session.workspace}`);
      return;
    }

    new Notice('Slack is not connected.');
  }

  private async loadSettings(): Promise<void> {
    this.settings = loadSettingsWithSession(await this.loadData(), this.sessionCipher);
    this.rebuildRuntime();
  }

  private rebuildRuntime(): void {
    this.channelCache = new TtlCache<SlackChannel>(this.settings.channelCacheTtlMs);
    this.userCache = new TtlCache<SlackUser>(this.settings.userCacheTtlMs);
    this.failedLookupCache = new TtlCache<boolean>(this.settings.failedLookupTtlMs);
    this.service = createSlackService(this.settings.session);
    this.rebuildResolver();
  }

  private rebuildResolver(): void {
    this.resolver = createResolver({
      channelCache: this.channelCache,
      failedLookupCache: this.failedLookupCache,
      service: this.service,
      session: this.settings.session,
      userCache: this.userCache,
    });
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'connect-slack',
      name: 'Connect Slack',
      callback: () => {
        void this.connectSlack();
      },
    });

    this.addCommand({
      id: 'disconnect-slack',
      name: 'Disconnect Slack',
      callback: () => {
        void this.disconnectSlack();
      },
    });

    this.addCommand({
      id: 'test-slack-connection',
      name: 'Test Slack connection',
      callback: () => this.showConnectionStatus(),
    });

    this.addCommand({
      id: 'insert-slack-link',
      name: 'Insert Slack link',
      editorCallback: (editor) => {
        void this.replaceSelectionWithSlackLinks(editor);
      },
    });

    this.addCommand({
      id: 'insert-slack-message-link',
      name: 'Insert Slack message link',
      editorCallback: (editor) => {
        void this.replaceSelectionWithSlackLinks(editor, {
          enableChannels: false,
          enableDmSentinels: false,
        });
      },
    });

    this.addCommand({
      id: 'refresh-slack-people-cache',
      name: 'Refresh Slack people cache',
      callback: () => {
        this.resetUserCache();
        new Notice('Slack people cache cleared.');
      },
    });

    this.addCommand({
      id: 'refresh-slack-channel-cache',
      name: 'Refresh Slack channel cache',
      callback: () => {
        this.resetChannelCache();
        new Notice('Slack channel cache cleared.');
      },
    });

    this.addCommand({
      id: 'open-current-slack-ref',
      name: 'Open current Slack ref',
      editorCallback: (editor) => {
        void this.openCurrentSlackRef(editor);
      },
    });
  }

  private registerEditorListener(): void {
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor) => {
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

  private async refreshEditor(editor: Editor): Promise<void> {
    const source = editor.getValue();
    const cursorOffset = editor.posToOffset(editor.getCursor());
    const candidates = detectCandidates(source, { cursorOffset });

    if (!candidates.length) {
      return;
    }

    if (!(await this.ensureValidSession())) {
      this.maybeShowReconnectNotice();
      return;
    }

    const replacements = await planSlackLinkReplacements(source, {
      cursorOffset,
      resolver: this.resolver,
      settings: this.settings,
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

  private async replaceSelectionWithSlackLinks(
    editor: Editor,
    overrides?: Partial<Pick<SlackBasesSettings, 'enableChannels' | 'enableDmSentinels' | 'enablePermalinks'>>
  ): Promise<void> {
    const selection = editor.getSelection();

    if (!selection) {
      new Notice('Select Slack text first.');
      return;
    }

    if (!(await this.ensureValidSession(true))) {
      return;
    }

    const replacements = await planSlackLinkReplacements(selection, {
      cursorOffset: -1,
      resolver: this.resolver,
      settings: {
        ...this.settings,
        ...overrides,
      },
    });

    if (!replacements.length) {
      new Notice('No Slack references found in the current selection.');
      return;
    }

    editor.replaceSelection(applyReplacements(selection, replacements));
  }

  private async openCurrentSlackRef(editor: Editor): Promise<void> {
    const text = editor.getValue();
    const cursorOffset = editor.posToOffset(editor.getCursor());
    const candidate = detectCandidates(text, { cursorOffset }).find(
      (item) => cursorOffset >= item.start && cursorOffset <= item.end
    );

    if (!candidate) {
      new Notice('No Slack reference under the cursor.');
      return;
    }

    if (!(await this.ensureValidSession(true))) {
      return;
    }

    if (candidate.kind === 'message-permalink') {
      window.open(candidate.value, '_blank');
      return;
    }

    if (candidate.kind === 'channel-ref') {
      const resolved = await this.resolver.resolveChannelRef(candidate.value);

      if (!resolved) {
        new Notice('Unable to resolve that Slack channel.');
        return;
      }

      window.open(
        buildTargetUrl({
          channelId: resolved.channelId,
          target: this.settings.target,
          teamId: resolved.teamId,
        }),
        '_blank'
      );
      return;
    }

    const resolved = await this.resolver.resolveDmSentinel(candidate.value);

    if (!resolved) {
      new Notice('Unable to resolve that Slack DM.');
      return;
    }

    window.open(`slack://user?team=${resolved.teamId}&id=${resolved.userId}`, '_blank');
  }

  private async completeSlackConnect(params: Record<string, string>): Promise<void> {
    if (params.error) {
      new Notice(`Slack sign-in failed: ${params.error}`);
      this.pendingAuthState = null;
      return;
    }

    if (!params.code || !params.state || !this.pendingAuthState) {
      this.pendingAuthState = null;
      new Notice('Slack sign-in callback was incomplete.');
      return;
    }

    if (params.state !== this.pendingAuthState.state) {
      this.pendingAuthState = null;
      new Notice('Slack sign-in state did not match the pending request.');
      return;
    }

    try {
      const session = await completeSlackAuth(this.requestSlackApiForm.bind(this), {
        clientId: this.settings.clientId,
        code: params.code,
        codeVerifier: this.pendingAuthState.codeVerifier,
        redirectUri: this.getRedirectUri(),
      });

      await this.saveSettings({ session });
      this.pendingAuthState = null;
      new Notice(`Connected Slack workspace ${session.workspace || session.teamId}.`);
    } catch (error) {
      this.pendingAuthState = null;
      new Notice(`Slack sign-in failed: ${getErrorMessage(error)}`);
    }
  }

  private async ensureValidSession(notifyOnMissing = false): Promise<boolean> {
    if (!hasValidAccessToken(this.settings.session)) {
      if (notifyOnMissing) {
        new Notice('Connect Slack to resolve live Slack metadata.');
      }
      return false;
    }

    if (!shouldRefreshSession(this.settings.session, this.settings.refreshLeewayMs)) {
      return true;
    }

    if (!this.settings.clientId || !this.settings.session.refreshToken) {
      if (notifyOnMissing) {
        new Notice('Slack session expired. Reconnect Slack.');
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
          session: this.settings.session,
        });

        await this.saveSettings({ session });
        return true;
      } catch (error) {
        if (notifyOnMissing) {
          new Notice(`Slack session refresh failed: ${getErrorMessage(error)}`);
        }
        return false;
      }
    });
  }

  private getRedirectUri(): string {
    return `obsidian://${AUTH_CALLBACK_ACTION}`;
  }

  private maybeShowReconnectNotice(): void {
    if (Date.now() - this.lastAuthNoticeAt < AUTH_RECONNECT_NOTICE_MS) {
      return;
    }

    this.lastAuthNoticeAt = Date.now();
    new Notice('Slack references detected. Connect Slack to enable live resolution.');
  }

  private createStateToken(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private async requestSlackApiForm(request: SlackApiFormRequest): Promise<any> {
    const response = await requestUrl({
      body: request.body.toString(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      headers: request.token
        ? {
            Authorization: `Bearer ${request.token}`,
          }
        : {},
      method: 'POST',
      throw: false,
      url: `https://slack.com/api/${request.path}`,
    });

    if (response.status >= 400) {
      throw new Error(`Slack API request failed: ${response.status}`);
    }

    if (!response.json?.ok) {
      throw new Error(response.json?.error ?? `Slack API request failed: ${request.path}`);
    }

    return response.json;
  }
}

class SlackBasesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SlackBasesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.getSettings();

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Slack Bases' });

    new Setting(containerEl)
      .setName('Slack connection')
      .setDesc(
        hasValidAccessToken(settings.session)
          ? `Connected to ${settings.session.workspace || settings.session.teamId}.`
          : 'Not connected.'
      )
      .addButton((button) =>
        button.setButtonText('Connect').onClick(async () => {
          await this.plugin.connectSlack();
        })
      )
      .addButton((button) =>
        button.setButtonText('Disconnect').onClick(async () => {
          await this.plugin.disconnectSlack();
          this.display();
          new Notice('Slack session cleared.');
        })
      );

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Slack app client ID for the desktop PKCE flow.')
      .addText((text) =>
        text.setValue(settings.clientId).onChange(async (value) => {
          await this.plugin.saveSettings({ clientId: value.trim() });
        })
      );

    new Setting(containerEl)
      .setName('User scopes')
      .setDesc('Comma-separated Slack user scopes requested during Connect Slack.')
      .addTextArea((text) =>
        text.setValue(settings.scopes).onChange(async (value) => {
          await this.plugin.saveSettings({ scopes: value.trim() || DEFAULT_SETTINGS.scopes });
        })
      );

    new Setting(containerEl)
      .setName('Message template')
      .setDesc('Controls how pasted Slack message permalinks render.')
      .addTextArea((text) =>
        text.setValue(settings.messageTemplate).onChange(async (value) => {
          await this.plugin.saveSettings({ messageTemplate: value.trim() || DEFAULT_SETTINGS.messageTemplate });
        })
      );

    new Setting(containerEl)
      .setName('Preferred link target')
      .setDesc('Choose Slack app links or the web/app_redirect fallback.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('app', 'Slack app')
          .addOption('web', 'Web / app_redirect')
          .setValue(settings.target)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ target: value === 'web' ? 'web' : 'app' });
          })
      );

    new Setting(containerEl)
      .setName('Idle delay')
      .setDesc('How long the plugin waits after typing before scanning the note.')
      .addText((text) =>
        text.setValue(String(settings.idleDelayMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isNaN(parsed) || parsed < 0) {
            return;
          }

          await this.plugin.saveSettings({ idleDelayMs: parsed });
        })
      );

    new Setting(containerEl)
      .setName('Refresh leeway')
      .setDesc('How early the plugin refreshes an expiring Slack session.')
      .addText((text) =>
        text.setValue(String(settings.refreshLeewayMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isNaN(parsed) || parsed < 0) {
            return;
          }

          await this.plugin.saveSettings({ refreshLeewayMs: parsed });
        })
      );

    new Setting(containerEl)
      .setName('Auto-link channels')
      .setDesc('Resolve #channel references after the idle delay.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enableChannels).onChange(async (value) => {
          await this.plugin.saveSettings({ enableChannels: value });
        })
      );

    new Setting(containerEl)
      .setName('Auto-link DM sentinels')
      .setDesc('Resolve explicit dm:@name or dm:email references.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enableDmSentinels).onChange(async (value) => {
          await this.plugin.saveSettings({ enableDmSentinels: value });
        })
      );

    new Setting(containerEl)
      .setName('Auto-link pasted permalinks')
      .setDesc('Convert pasted Slack message permalinks into smart Markdown links.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enablePermalinks).onChange(async (value) => {
          await this.plugin.saveSettings({ enablePermalinks: value });
        })
      );

    new Setting(containerEl)
      .setName('Test Slack connection')
      .setDesc('Check whether a local Slack session is configured.')
      .addButton((button) =>
        button.setButtonText('Test').onClick(() => {
          this.plugin.showConnectionStatus();
        })
      );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
