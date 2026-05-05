# slack-bases

Desktop-first Obsidian plugin for Slack smart links and Bases-style metadata.

## Setup (Slack side)

Before connecting the plugin, you need to create a Slack app and configure it for OAuth.

### 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Give it a name (e.g., "Slack Bases") and select your workspace
4. Click **Create App**

### 2. Configure OAuth redirect URL

1. In the app settings, go to **OAuth & Permissions**
2. Under **Redirect URLs**, click **Add New Redirect URL**
3. Enter `obsidian://slack-bases-auth`
4. Click **Add** then **Save URLs**

### 3. Get your Client ID

1. Go to **Basic Information**
2. Under **App Credentials**, find **Client ID** (format: `<numbers>.<numbers>`, e.g. `1234567890.1234567890`)
3. Copy it — you'll paste this into the plugin settings

### 4. Get your Team ID (optional)

If you want to pre-select a workspace in the OAuth flow:

1. Open Slack in your browser
2. Your Team ID is the `T`-prefixed string in the URL: `https://app.slack.com/client/T01234567/...`
3. Enter it in the plugin's **Team ID** setting

### 5. Connect in Obsidian

1. In the plugin settings, paste the **Client ID** you copied in step 3
2. (Optional) enter the **Team ID**
3. Click **Connect** — your browser will open Slack's authorization page
4. Authorize the app, then return to Obsidian

## Current v1 behavior

- starts a desktop Slack OAuth PKCE flow from Obsidian and stores the session locally in encrypted form when secure storage is available
- refreshes expiring Slack user sessions before live lookups
- rewrites pasted Slack message permalinks into templated Markdown links
- resolves `#channel` references into Slack deep links
- resolves explicit `dm:` sentinels into Slack user links
- validates client ID format before opening the browser to catch typos early
- skips frontmatter, existing Markdown links, wikilinks, and cursor-adjacent candidates

## Development

```bash
npm install
npm test
npm run check
npm run build
```

## Plugin surfaces

- settings for Slack connect/disconnect, client ID, Team ID, requested scopes, template, passive toggles, and idle/refresh timing
- commands to connect Slack, test the connection, convert selections, refresh caches, and open the current Slack ref
