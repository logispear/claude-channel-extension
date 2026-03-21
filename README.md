# Claude Code Chrome Extension

Chat with Claude Code from any webpage using a Chrome side panel.

## How it works

A local MCP server (`webhook.ts`) bridges a Chrome extension to Claude Code:

1. The extension sends messages to a local HTTP server (`localhost:8788`)
2. The server forwards them to Claude Code via the MCP channel protocol
3. Claude's replies stream back to the extension over SSE

## Features

- **Side panel chat** — open on any page, stays out of your way
- **Image support** — paste or drag-and-drop screenshots into the chat
- **Real-time streaming** — responses arrive over Server-Sent Events
- **Configurable port** — change the server address in extension settings

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Chrome (or Chromium-based browser)
- [Claude Code](https://claude.ai/claude-code) CLI

### Install

```sh
bun install
```

### Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `chrome-extension/` folder

### Configure Claude Code

**Option A — Project-level** (already in `.mcp.json`, works when you run Claude from this directory):

```json
{
  "mcpServers": {
    "webhook": { "command": "bun", "args": ["./webhook.ts"] }
  }
}
```

**Option B — User-level** (works from any project). Copy `webhook.ts` to your home directory and add the server to `~/.claude.json` with the full absolute path:

```sh
cp webhook.ts ~/webhook.ts
```

```json
{
  "mcpServers": {
    "webhook": { "command": "bun", "args": ["/Users/you/webhook.ts"] }
  }
}
```

### Start the server

```sh
claude --dangerously-skip-permissions --dangerously-load-development-channels server:webhook
```

This starts Claude Code with the webhook MCP server loaded as a development channel.

### Use

1. Run the start command above
2. Click the extension icon in Chrome to open the side panel
3. Start chatting

## Project structure

```
webhook.ts            MCP server + HTTP server (Bun)
chrome-extension/
  manifest.json       Extension manifest (MV3)
  sidepanel.html/js   Chat UI
  sidepanel.css       Styles
  settings.html       Extension settings (port config)
  background.js       Service worker (opens side panel on icon click)
  icons/              Extension icons
```

## API

| Endpoint       | Method | Description                          |
| -------------- | ------ | ------------------------------------ |
| `/`            | GET    | Landing page                         |
| `/api/send`    | POST   | Send a message (JSON: `{text, images?}`) |
| `/api/events`  | GET    | SSE stream for Claude's replies      |
