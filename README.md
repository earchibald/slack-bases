# slack-bases

Desktop-first Obsidian plugin for Slack smart links and Bases-style metadata.

## Current v1 behavior

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

- settings for workspace/session fields, template, passive toggles, and idle delay
- commands to test the Slack connection, convert selections, refresh caches, and open the current Slack ref
