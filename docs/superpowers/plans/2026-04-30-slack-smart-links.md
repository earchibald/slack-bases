# Slack Smart Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-first Obsidian plugin that passively converts Slack message permalinks, channel refs, and explicit DM sentinels into smart Markdown links.

**Architecture:** Create a small TypeScript Obsidian plugin with pure Slack parsing/rendering modules, a resolver layer behind injectable services, and a main plugin class that wires settings, debounce-driven editor scanning, and commands. Keep passive behavior deterministic by separating candidate detection, Slack resolution, and editor mutation into focused units that can be tested independently.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, Vitest

---

## File structure

- Create: `package.json` — npm scripts, build config, dev dependencies
- Create: `tsconfig.json` — TypeScript configuration for plugin code and tests
- Create: `esbuild.config.mjs` — bundle `src/main.ts` into `main.js`
- Create: `manifest.json` — Obsidian plugin manifest
- Create: `versions.json` — supported Obsidian versions
- Create: `vitest.config.ts` — test runner config
- Create: `src/main.ts` — plugin entrypoint, command registration, editor event wiring
- Create: `src/settings.ts` — default settings, setting tab, persisted settings helpers
- Create: `src/slack/types.ts` — shared Slack and candidate types
- Create: `src/slack/permalink.ts` — Slack permalink parsing and normalization
- Create: `src/slack/detector.ts` — note scanning and candidate extraction
- Create: `src/slack/renderer.ts` — smart-link template rendering and target URL selection
- Create: `src/slack/replacements.ts` — replacement planning and bottom-up application helpers
- Create: `src/slack/cache.ts` — in-memory TTL caches for users, channels, and misses
- Create: `src/slack/session.ts` — session model and token-validity helpers
- Create: `src/slack/resolver.ts` — cache-aware resolution and metadata hydration
- Create: `src/slack/service.ts` — Slack service interface and HTTP-backed transport helpers
- Create: `tests/permalink.test.ts` — permalink parsing tests
- Create: `tests/detector.test.ts` — candidate scanning tests
- Create: `tests/renderer.test.ts` — template and target rendering tests
- Create: `tests/resolver.test.ts` — resolver/cache behavior tests
- Create: `tests/replacements.test.ts` — replacement ordering tests
- Modify: `README.md` — plugin overview, development commands, current v1 behavior

### Task 1: Scaffold the plugin project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `versions.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the failing build/test scaffolding check**

```ts
// tests/permalink.test.ts
import { describe, expect, it } from 'vitest';
import { parseSlackPermalink } from '../src/slack/permalink';

describe('parseSlackPermalink', () => {
  it('parses a standard Slack message permalink', () => {
    const parsed = parseSlackPermalink(
      'https://acme.slack.com/archives/C01234567/p1714490435123456'
    );

    expect(parsed?.workspace).toBe('acme');
    expect(parsed?.channelId).toBe('C01234567');
    expect(parsed?.ts).toBe('1714490435.123456');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/permalink.test.ts`
Expected: FAIL because `package.json`, the test runner, and `src/slack/permalink.ts` do not exist yet.

- [ ] **Step 3: Add the minimal project scaffolding**

```json
// package.json
{
  "name": "slack-bases",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "^1.8.10",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

```js
// esbuild.config.mjs
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'main.js',
  external: ['obsidian'],
  platform: 'node',
  sourcemap: 'inline'
});
```

```json
// manifest.json
{
  "id": "slack-bases",
  "name": "Slack Bases",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Turn Slack references into smart links.",
  "author": "Copilot",
  "isDesktopOnly": true
}
```

- [ ] **Step 4: Run the test to verify the project is wired up**

Run: `npm install && npm test -- --run tests/permalink.test.ts`
Expected: FAIL with a module-not-found error for `../src/slack/permalink`, confirming the toolchain works and the feature code is the remaining missing piece.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs manifest.json versions.json vitest.config.ts tests/permalink.test.ts
git commit -m "chore: scaffold slack plugin project"
```

### Task 2: Implement Slack permalink parsing and smart-link rendering

**Files:**
- Create: `src/slack/types.ts`
- Create: `src/slack/permalink.ts`
- Create: `src/slack/renderer.ts`
- Modify: `tests/permalink.test.ts`
- Create: `tests/renderer.test.ts`

- [ ] **Step 1: Write failing parser and renderer tests**

```ts
// tests/renderer.test.ts
import { describe, expect, it } from 'vitest';
import { buildTargetUrl, renderSmartLink } from '../src/slack/renderer';

describe('renderSmartLink', () => {
  it('renders a hydrated template', () => {
    expect(
      renderSmartLink('[{channel} • {author}: {text}]({url})', {
        url: 'https://acme.slack.com/archives/C01/p1714490435123456',
        channel: 'ops',
        author: 'Avery',
        text: 'deploy failed'
      })
    ).toBe('[ops • Avery: deploy failed](https://acme.slack.com/archives/C01/p1714490435123456)');
  });
});

describe('buildTargetUrl', () => {
  it('returns a Slack deep link when preferred', () => {
    expect(buildTargetUrl({ target: 'app', teamId: 'T01', channelId: 'C01' })).toBe(
      'slack://channel?team=T01&id=C01'
    );
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run tests/permalink.test.ts tests/renderer.test.ts`
Expected: FAIL because `src/slack/permalink.ts` and `src/slack/renderer.ts` are missing.

- [ ] **Step 3: Implement the parser and renderer**

```ts
// src/slack/permalink.ts
export function parseSlackPermalink(url: string) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/archives\/([^/]+)\/p(\d{16})$/);
  if (!match) return null;
  const [, channelId, packedTs] = match;
  const ts = `${packedTs.slice(0, 10)}.${packedTs.slice(10)}`;
  return { url, workspace: parsed.hostname.split('.')[0], channelId, ts };
}
```

```ts
// src/slack/renderer.ts
export function renderSmartLink(template: string, values: Record<string, string | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? '');
}

export function buildTargetUrl(input: {
  target: 'app' | 'web';
  teamId: string;
  channelId: string;
}) {
  return input.target === 'app'
    ? `slack://channel?team=${input.teamId}&id=${input.channelId}`
    : `https://slack.com/app_redirect?team=${input.teamId}&channel=${input.channelId}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run tests/permalink.test.ts tests/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/slack/types.ts src/slack/permalink.ts src/slack/renderer.ts tests/permalink.test.ts tests/renderer.test.ts
git commit -m "feat: add permalink parsing and rendering"
```

### Task 3: Implement candidate detection and replacement ordering

**Files:**
- Create: `src/slack/detector.ts`
- Create: `src/slack/replacements.ts`
- Create: `tests/detector.test.ts`
- Create: `tests/replacements.test.ts`

- [ ] **Step 1: Write the failing detector tests**

```ts
// tests/detector.test.ts
import { describe, expect, it } from 'vitest';
import { detectCandidates } from '../src/slack/detector';

describe('detectCandidates', () => {
  it('finds permalinks, channels, and dm sentinels while skipping existing markdown links', () => {
    const text = [
      'Paste https://acme.slack.com/archives/C01/p1714490435123456 here',
      'Talk in #ops next',
      'Ping dm:@avery',
      '[skip](https://acme.slack.com/archives/C02/p1714490435123456)'
    ].join('\n');

    const found = detectCandidates(text, { cursorOffset: -1 });
    expect(found.map((candidate) => candidate.kind)).toEqual(['message-permalink', 'channel-ref', 'dm-sentinel']);
  });
});
```

- [ ] **Step 2: Run the detector tests to verify they fail**

Run: `npm test -- --run tests/detector.test.ts tests/replacements.test.ts`
Expected: FAIL because detector and replacement helpers do not exist yet.

- [ ] **Step 3: Implement candidate scanning and bottom-up replacement helpers**

```ts
// src/slack/replacements.ts
export function sortReplacementsBottomUp<T extends { start: number }>(items: T[]) {
  return [...items].sort((left, right) => right.start - left.start);
}
```

```ts
// src/slack/detector.ts
const DM_SENTINEL = /\bdm:([@\w.\-+]+)\b/g;
const CHANNEL_REF = /(^|\s)#([a-z0-9._-]+)/gi;
const MESSAGE_LINK = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}/gi;

export function detectCandidates(text: string, input: { cursorOffset: number }) {
  const spans = text.split(/\[[^\]]+\]\([^)]+\)/g);
  const found = [];
  for (const span of spans) {
    for (const match of span.matchAll(MESSAGE_LINK)) {
      found.push({ kind: 'message-permalink', value: match[0] });
    }
    for (const match of span.matchAll(DM_SENTINEL)) {
      found.push({ kind: 'dm-sentinel', value: match[0] });
    }
    for (const match of span.matchAll(CHANNEL_REF)) {
      found.push({ kind: 'channel-ref', value: `#${match[2]}` });
    }
  }
  return found;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run tests/detector.test.ts tests/replacements.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/slack/detector.ts src/slack/replacements.ts tests/detector.test.ts tests/replacements.test.ts
git commit -m "feat: add candidate detection pipeline"
```

### Task 4: Implement resolver, cache, and session helpers

**Files:**
- Create: `src/slack/cache.ts`
- Create: `src/slack/session.ts`
- Create: `src/slack/service.ts`
- Create: `src/slack/resolver.ts`
- Create: `tests/resolver.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

```ts
// tests/resolver.test.ts
import { describe, expect, it } from 'vitest';
import { createResolver } from '../src/slack/resolver';

describe('createResolver', () => {
  it('uses hydrated Slack metadata when available', async () => {
    const resolver = createResolver({
      session: { teamId: 'T01', workspace: 'acme' },
      service: {
        getMessage: async () => ({
          channelName: 'ops',
          authorName: 'Avery',
          text: 'deploy failed'
        })
      }
    });

    const result = await resolver.resolvePermalink(
      'https://acme.slack.com/archives/C01/p1714490435123456'
    );

    expect(result.text).toBe('deploy failed');
    expect(result.channel).toBe('ops');
  });
});
```

- [ ] **Step 2: Run the resolver tests to verify they fail**

Run: `npm test -- --run tests/resolver.test.ts`
Expected: FAIL because the resolver and cache modules do not exist yet.

- [ ] **Step 3: Implement cache-aware resolution**

```ts
// src/slack/cache.ts
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
```

```ts
// src/slack/resolver.ts
export function createResolver(deps: {
  session: { teamId: string; workspace: string };
  service: { getMessage(url: string): Promise<{ channelName: string; authorName: string; text: string }> };
}) {
  return {
    async resolvePermalink(url: string) {
      const hydrated = await deps.service.getMessage(url);
      return {
        url,
        workspace: deps.session.workspace,
        channel: hydrated.channelName,
        author: hydrated.authorName,
        text: hydrated.text
      };
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run tests/resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/slack/cache.ts src/slack/session.ts src/slack/service.ts src/slack/resolver.ts tests/resolver.test.ts
git commit -m "feat: add slack resolution services"
```

### Task 5: Wire the Obsidian plugin, settings, commands, and docs

**Files:**
- Create: `src/settings.ts`
- Modify: `src/main.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing integration-oriented tests**

```ts
// tests/replacements.test.ts
import { describe, expect, it } from 'vitest';
import { applyReplacements } from '../src/slack/replacements';

describe('applyReplacements', () => {
  it('applies edits from the bottom of the document upward', () => {
    const result = applyReplacements('alpha beta gamma', [
      { start: 6, end: 10, text: 'BETA' },
      { start: 0, end: 5, text: 'ALPHA' }
    ]);

    expect(result).toBe('ALPHA BETA gamma');
  });
});
```

- [ ] **Step 2: Run the full suite to verify it fails somewhere meaningful**

Run: `npm test`
Expected: FAIL until `src/main.ts`, `src/settings.ts`, and the replacement helpers are wired together.

- [ ] **Step 3: Implement plugin wiring and docs**

```ts
// src/main.ts
export default class SlackBasesPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerCommands();
    this.registerEditorListener();
  }
}
```

```ts
// src/settings.ts
export const DEFAULT_SETTINGS = {
  target: 'app',
  idleDelayMs: 500,
  enableChannels: true,
  enableDmSentinels: true,
  enablePermalinks: true
};
```

- [ ] **Step 4: Run the complete verification set**

Run: `npm test && npm run check && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/settings.ts README.md
git commit -m "feat: ship slack smart links plugin skeleton"
```
