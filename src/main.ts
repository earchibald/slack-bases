import { Notice, Plugin, PluginSettingTab, Setting, type App, type Editor } from 'obsidian';

import { TtlCache } from './slack/cache';
import { detectCandidates } from './slack/detector';
import { planSlackLinkReplacements } from './slack/engine';
import { buildTargetUrl } from './slack/renderer';
import { createResolver } from './slack/resolver';
import { applyReplacements } from './slack/replacements';
import { createSlackService, type SlackService } from './slack/service';
import type { SlackBasesSettings } from './settings';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import type { SlackChannel, SlackUser } from './slack/types';

export default class SlackBasesPlugin extends Plugin {
  private channelCache = new TtlCache<SlackChannel>(DEFAULT_SETTINGS.channelCacheTtlMs);
  private failedLookupCache = new TtlCache<boolean>(DEFAULT_SETTINGS.failedLookupTtlMs);
  private isApplyingChanges = false;
  private refreshTimer: number | null = null;
  private service: SlackService = createSlackService(DEFAULT_SETTINGS.session);
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
    this.settings = mergeSettings(nextSettings ? { ...this.settings, ...nextSettings } : this.settings);
    await this.saveData(this.settings);
    this.rebuildRuntime();
  }

  getSettings(): SlackBasesSettings {
    return this.settings;
  }

  async disconnectSlack(): Promise<void> {
    await this.saveSettings({
      session: {
        accessToken: '',
        expiresAt: 0,
        refreshToken: '',
        teamId: '',
        workspace: '',
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
    if (this.settings.session.accessToken && this.settings.session.workspace) {
      new Notice(`Slack session configured for ${this.settings.session.workspace}`);
      return;
    }

    new Notice('Slack is not connected.');
  }

  private async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
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
      .setName('Workspace slug')
      .setDesc('Used for permalink fallback rendering and session metadata.')
      .addText((text) =>
        text.setValue(settings.session.workspace).onChange(async (value) => {
          await this.plugin.saveSettings({
            session: {
              ...this.plugin.getSettings().session,
              workspace: value.trim(),
            },
          });
        })
      );

    new Setting(containerEl)
      .setName('Team ID')
      .setDesc('Used for Slack deep links.')
      .addText((text) =>
        text.setValue(settings.session.teamId).onChange(async (value) => {
          await this.plugin.saveSettings({
            session: {
              ...this.plugin.getSettings().session,
              teamId: value.trim(),
            },
          });
        })
      );

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Slack app client ID for a desktop PKCE flow.')
      .addText((text) =>
        text.setValue(settings.clientId).onChange(async (value) => {
          await this.plugin.saveSettings({ clientId: value.trim() });
        })
      );

    new Setting(containerEl)
      .setName('Access token')
      .setDesc('Stored locally for Slack metadata hydration.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setValue(settings.session.accessToken ?? '').onChange(async (value) => {
          await this.plugin.saveSettings({
            session: {
              ...this.plugin.getSettings().session,
              accessToken: value.trim(),
            },
          });
        });
      });

    new Setting(containerEl)
      .setName('Refresh token')
      .setDesc('Optional refresh token for long-lived sessions.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setValue(settings.session.refreshToken ?? '').onChange(async (value) => {
          await this.plugin.saveSettings({
            session: {
              ...this.plugin.getSettings().session,
              refreshToken: value.trim(),
            },
          });
        });
      });

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
      )
      .addButton((button) =>
        button.setButtonText('Disconnect').onClick(async () => {
          await this.plugin.disconnectSlack();
          this.display();
          new Notice('Slack session cleared.');
        })
      );
  }
}
