# Slack analogue research

## Problem

Design an Obsidian plugin analogous to jira-bases for Slack references, with special attention to:

- OAuth/user auth feasibility
- debounced "magic links"
- control surfaces and product shape
- message-link workflow

## Proposed approach

Use a **desktop-only Slack OAuth v2 + PKCE** flow with **user tokens**, not bot tokens.

Why:

- Slack supports PKCE for public clients, including desktop-style redirects.
- Desktop redirects cannot request bot scopes.
- User tokens match the visibility model we want: channels and private conversations the installing user can actually see.

Store in secure local storage:

- workspace URL
- team ID
- user access token
- refresh token
- expiry metadata

## Recommended v1 scope

### Passive / debounced

1. Channel refs
2. DM sentinels
3. Pasted Slack permalinks

### Explicit / command-driven

1. Message search / lookup
2. Group DM resolution
3. Cache refresh

## Linking model

### Channels

- Detect deterministic channel-shaped refs, e.g. `#release-notes`
- Resolve from cached `conversations.list` / `conversations.info`
- Insert either:
  - `https://slack.com/app_redirect?channel=...&team=...`
  - `slack://channel?team=...&id=...`

### DMs

- Do not auto-link bare `@name` in ordinary prose
- Prefer explicit sentinels such as:
  - `dm:@alice`
  - `dm:alice@example.com`
- Resolve from cached `users.list`, optionally `users.lookupByEmail`
- Insert `slack://user?team=...&id=...`

### Messages

Do **not** treat arbitrary prose as a passive message-search surface.

Best workflow:

1. User copies a Slack message permalink.
2. User pastes it into Obsidian.
3. Plugin auto-converts it after debounce, or rewrites it on demand via command.
4. Plugin parses workspace / channel / ts / thread info from the URL.
5. Plugin optionally hydrates metadata from Slack.
6. Plugin renders a configurable Markdown link template.

This is the strongest Slack equivalent to the jira-bases insert-link flow.

## Message-link workflow (must-have)

For **Slack messages specifically**, the plugin should support:

1. **Copy link in Slack**
2. **Paste link in the note**
3. Plugin detects Slack permalink shape
4. Plugin parses:
   - workspace
   - channel ID
   - message ts
   - optional thread ts / cid
5. Plugin optionally hydrates:
   - channel name
   - author display name
   - message text excerpt
   - date/time
6. Plugin renders a **template-able smart link**

Example templates:

- `[{channel} • {author}: {text}]({url})`
- `[Slack: {author} in #{channel}]({url})`
- `[{date} {channel} — {text}]({url})`

Recommended tokens:

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

## Why message search should stay explicit

Slack does provide message search, but it is a worse fit for passive linking:

- `search.messages` is documented by Slack as a legacy method
- results are user-token-scoped
- results are influenced by the user’s Slack search environment
- message discovery is inherently less deterministic than JIRA key lookup
- newer Slack limits on message-history APIs make background probing a poor default

Therefore:

- **pasted permalinks** are the right passive message trigger
- **message search criteria** should be command-driven or sentinel-driven

Suggested explicit syntax if needed later:

- `slackmsg:"deploy failed" in:#ops from:@alice after:7d`

## Control surfaces

### Settings

- Connect Slack / Disconnect Slack
- Preferred link target:
  - Slack app (`slack://`)
  - Web/app_redirect
- Enable auto-lookup
- Idle delay
- Toggle auto behaviors:
  - channels
  - DMs
  - pasted Slack permalinks
  - optional message sentinel parsing
- Cache TTLs:
  - users
  - channels
  - failed lookups

### Commands

- Test Slack connection
- Insert Slack link
- Insert Slack message link
- Refresh Slack people cache
- Refresh Slack channel cache
- Open current Slack ref

### Editor logic

Mirror the jira-bases auto-lookup pattern:

1. editor change event
2. single debounce timer
3. scan active note body
4. skip frontmatter
5. skip existing markdown links / wikilinks
6. skip cursor-adjacent candidate
7. resolve unknown refs
8. re-read editor state before apply
9. replace bottom-up

## Product recommendation

The strongest v1 product shape is:

**Debounced magic Slack links for channels, DM sentinels, and pasted Slack message permalinks; explicit lookup for message search.**
