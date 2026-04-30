# slack-bases

Desktop-first Obsidian plugin for Slack smart links and Bases-style metadata.

## Current v1 behavior

- starts a desktop Slack OAuth PKCE flow from Obsidian and stores the session locally in encrypted form when secure storage is available
- refreshes expiring Slack user sessions before live lookups
- rewrites pasted Slack message permalinks into templated Markdown links
- resolves `#channel` references into Slack deep links
- resolves explicit `dm:` sentinels into Slack user links
- skips frontmatter, existing Markdown links, wikilinks, and cursor-adjacent candidates

## Development

```bash
npm install
npm test
npm run check
npm run build
```

## Plugin surfaces

- settings for Slack connect/disconnect, client ID, requested scopes, template, passive toggles, and idle/refresh timing
- commands to connect Slack, test the connection, convert selections, refresh caches, and open the current Slack ref
