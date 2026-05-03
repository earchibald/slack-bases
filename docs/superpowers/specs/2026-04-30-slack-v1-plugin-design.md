# Slack V1 Plugin Design

## Problem

Design the first version of an Obsidian plugin that turns Slack references into reliable smart links for a single user connecting their own Slack workspace to their own vault.

The plugin should prioritize deterministic passive behavior over fuzzy discovery. V1 should support:

- pasted Slack message permalinks
- channel references
- explicit DM sentinels

V1 can assume a desktop-only environment with local secure token storage.

## Goals

- Convert pasted Slack message permalinks into smart Markdown links after a short debounce.
- Resolve `#channel` references when the channel can be identified confidently.
- Resolve explicit DM sentinels such as `dm:@alice` without auto-linking ordinary `@name` prose.
- Enrich links with Slack metadata when that data is available.
- Keep passive behavior predictable and non-destructive.

## Non-goals

- Passive free-text message search
- Broad cross-platform support in v1
- Team-wide shared configuration or shared auth state
- Bot-token-based automation

## Chosen approach

V1 will use a permalink-first smart-link engine.

Passive behavior is limited to deterministic triggers:

1. pasted Slack message permalinks
2. `#channel` references
3. explicit DM sentinels

This is preferred over a search-centric design because it is more reliable, easier to understand, and better aligned with Slack API constraints. It is preferred over a minimal converter because it preserves the product value of enriched, templateable references instead of acting as a simple URL rewriter.

## Architecture

The plugin should be organized around a narrow link-resolution pipeline with four focused units:

### 1. Auth/session manager

Responsible for Slack OAuth v2 with PKCE in a desktop flow, token refresh, and secure local storage of:

- workspace URL
- team ID
- user access token
- refresh token
- expiry metadata

This unit owns connection state and exposes a small interface for obtaining a valid user session.

### 2. Reference detector

Responsible for watching editor changes after a debounce and extracting only supported candidates from the active note body. It should:

- skip frontmatter
- skip existing Markdown links and wikilinks
- skip cursor-adjacent candidates
- classify candidates as message permalinks, channel refs, or DM sentinels

This unit should not call Slack or apply edits directly.

### 3. Resolver/hydrator

Responsible for turning a candidate into a canonical Slack target. It should:

- consult cache first
- call Slack only when required
- resolve message permalinks into workspace, channel, message timestamp, and optional thread metadata
- resolve channel refs from cached or fetched channel metadata
- resolve DM sentinels from cached user metadata, with optional email lookup

When available, it should also hydrate:

- channel name
- author display name
- message excerpt
- date and time

### 4. Renderer/applicator

Responsible for formatting the final Markdown link from a template and applying replacements safely. It should:

- render from canonical resolved data
- re-read editor state before applying edits
- apply replacements bottom-up to preserve offsets
- preserve the original text when a candidate cannot be resolved safely

## Data flow

The default passive flow is:

1. the user edits a note
2. a single debounce timer fires
3. the plugin scans the active note body
4. candidates are normalized into message permalinks, channel refs, or DM sentinels
5. the resolver checks cache first, then Slack if needed
6. the renderer creates the final smart link text
7. replacements are applied after a final editor-state check

This keeps passive behavior narrow and deterministic. Anything fuzzy or ambiguous remains command-driven instead of running automatically in the background.

## Link behavior

### Message permalinks

When a Slack message permalink is pasted, the plugin should automatically rewrite it after a short idle delay into a smart Markdown link. It should parse:

- workspace
- channel ID
- message timestamp
- optional thread metadata

If metadata hydration succeeds, the link text should use enriched values. If hydration fails, the plugin should still produce a valid link using URL-derived data when possible.

Recommended template tokens:

- `{url}`
- `{workspace}`
- `{channel}`
- `{channel_id}`
- `{author}`
- `{author_id}`
- `{text}`
- `{date}`
- `{time}`
- `{ts}`
- `{thread_ts}`
- `{is_thread}`

Example templates:

- `[{channel} • {author}: {text}]({url})`
- `[Slack: {author} in #{channel}]({url})`
- `[{date} {channel} — {text}]({url})`

### Channel references

The plugin should detect deterministic channel-shaped references such as `#release-notes`, resolve them from cached or fetched channel metadata, and insert either a Slack deep link or web target depending on user preference.

### DM sentinels

The plugin should only auto-link DMs from explicit sentinels such as:

- `dm:@alice`
- `dm:alice@example.com`

It should not auto-link bare `@name` mentions in ordinary prose.

## Control surfaces

### Settings

- connect Slack
- disconnect Slack
- preferred link target: `slack://` or web/app redirect
- idle delay
- toggle passive behaviors for channels, DM sentinels, and pasted permalinks
- cache TTLs for users, channels, and failed lookups
- configurable smart-link template

### Commands

- test Slack connection
- insert Slack link
- insert Slack message link
- refresh Slack people cache
- refresh Slack channel cache
- open current Slack ref

Commands should be the home for any behavior that is too ambiguous for passive auto-linking.

## Failure handling

- If auth is missing or expired, passive detection should stop before network resolution and surface a clear reconnect action.
- If a lookup is ambiguous or not found, the plugin should leave the original text unchanged.
- Failed lookups should be cached briefly to avoid repeated API thrashing.
- Resolver failures should not silently mutate text into a misleading link.

## Testing strategy

The implementation should emphasize tests around the boundaries that can regress silently:

- unit tests for candidate parsing and normalization
- unit tests for Slack permalink parsing
- unit tests for template rendering
- unit tests for replacement ordering
- integration tests for the debounce/scan/resolve/apply flow with mocked Slack responses
- auth tests for token refresh and expired-session recovery

## Rationale

This design gives the plugin a strong v1 identity: debounced smart links for channels, DM sentinels, and pasted Slack message permalinks, with explicit commands reserved for anything less deterministic. It maximizes reliability and user trust while leaving room for richer command-driven lookup features later.
