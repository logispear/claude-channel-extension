#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// Store pending responses for polling
const pendingResponses: { chat_id: string; text: string; timestamp: number }[] = []

// Clean old responses after 5 minutes
setInterval(() => {
  const now = Date.now()
  while (pendingResponses.length > 0 && now - pendingResponses[0].timestamp > 300000) {
    pendingResponses.shift()
  }
}, 60000)

// Create the MCP server and declare it as a channel
const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: [
      'Messages arrive as <channel source="webhook" chat_id="...">.',
      'Each message comes from a user chatting via a web UI.',
      'Reply with the mcp__webhook__respond tool, passing the chat_id from the tag and your response as text.',
      'Always reply to every message.',
    ].join(' '),
  },
)

// Tool: respond
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'respond',
      description: 'Send a reply back to the user in the web chat',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat_id from the inbound channel tag',
          },
          text: {
            type: 'string',
            description: 'The message to send back',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'respond') {
    const { chat_id, text } = req.params.arguments as {
      chat_id: string
      text: string
    }
    // Store response for polling
    pendingResponses.push({ chat_id, text, timestamp: Date.now() })
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

await mcp.connect(new StdioServerTransport())

// Message counter for chat IDs
let nextId = 1

// HTML for the chat web UI
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claude Code Extension</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #fafafa;
    --text: #1a1a2e;
    --text-secondary: rgba(26, 26, 46, 0.55);
    --accent: #c47a55;
    --accent-light: rgba(196, 122, 85, 0.08);
    --border: rgba(0, 0, 0, 0.06);
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
  }

  .container {
    max-width: 560px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  .logo {
    width: 80px; height: 80px;
    border-radius: 22px;
    background: linear-gradient(135deg, var(--accent), #d4956e);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 24px rgba(196, 122, 85, 0.2);
  }

  .logo svg { width: 40px; height: 40px; }

  h1 {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .subtitle {
    font-size: 16px;
    color: var(--text-secondary);
    line-height: 1.6;
    max-width: 440px;
  }

  .features {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    margin-top: 8px;
  }

  .feature {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 14px;
    text-align: left;
  }

  .feature-icon {
    width: 40px; height: 40px;
    border-radius: 10px;
    background: var(--accent-light);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-size: 18px;
  }

  .feature-text h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 2px;
  }

  .feature-text p {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .steps {
    margin-top: 16px;
    width: 100%;
    text-align: left;
  }

  .steps h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    text-align: center;
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0;
  }

  .step-num {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .step-text {
    font-size: 14px;
    color: var(--text);
    line-height: 1.5;
    padding-top: 3px;
  }

  .step-text code {
    background: var(--accent-light);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--accent);
    font-weight: 500;
  }

  .footer {
    margin-top: 32px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .footer a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
</style>
</head>
<body>

<div class="container">
  <div class="logo">
    <svg viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="14" r="6" fill="#fff"/>
      <circle cx="50" cy="86" r="6" fill="#fff"/>
      <circle cx="14" cy="50" r="6" fill="#fff"/>
      <circle cx="86" cy="50" r="6" fill="#fff"/>
      <circle cx="24.6" cy="24.6" r="6" fill="#fff"/>
      <circle cx="75.4" cy="75.4" r="6" fill="#fff"/>
      <circle cx="75.4" cy="24.6" r="6" fill="#fff"/>
      <circle cx="24.6" cy="75.4" r="6" fill="#fff"/>
      <line x1="50" y1="14" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="50" y1="86" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="14" y1="50" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="86" y1="50" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="24.6" y1="24.6" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="75.4" y1="75.4" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="75.4" y1="24.6" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <line x1="24.6" y1="75.4" x2="50" y2="50" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
    </svg>
  </div>

  <h1>Claude Code Extension</h1>
  <p class="subtitle">Chat with Claude Code directly from your browser using the Chrome extension side panel.</p>

  <div class="features">
    <div class="feature">
      <div class="feature-icon">💬</div>
      <div class="feature-text">
        <h3>Chat from any page</h3>
        <p>Open the side panel on any website and talk to Claude Code</p>
      </div>
    </div>
    <div class="feature">
      <div class="feature-icon">🖼</div>
      <div class="feature-text">
        <h3>Image support</h3>
        <p>Attach screenshots or drag and drop images into the chat</p>
      </div>
    </div>
    <div class="feature">
      <div class="feature-icon">⚡</div>
      <div class="feature-text">
        <h3>Real-time responses</h3>
        <p>Get instant replies powered by Claude Code running locally</p>
      </div>
    </div>
  </div>

  <div class="steps">
    <h2>Getting started</h2>
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">Load the <code>chrome-extension</code> folder as an unpacked extension in Chrome</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">Make sure this server is running at <code>localhost:8788</code></div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">Click the extension icon and open the side panel to start chatting</div>
    </div>
  </div>

  <div class="footer">Built with <a href="https://claude.ai" target="_blank">Claude Code</a></div>
</div>

</body>
</html>`

Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    const origin = req.headers.get('origin') || ''
    const cors: Record<string, string> = {}
    // Allow Chrome extension and localhost origins
    if (origin.startsWith('chrome-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      cors['Access-Control-Allow-Origin'] = origin
      cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
      cors['Access-Control-Allow-Headers'] = 'Content-Type'
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Serve the chat UI
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    // Polling endpoint for Claude's replies
    if (url.pathname === '/api/poll' && req.method === 'GET') {
      // Return all pending responses and clear them
      const responses = [...pendingResponses]
      pendingResponses.length = 0
      return new Response(JSON.stringify(responses), {
        headers: {
          'Content-Type': 'application/json',
          ...cors,
        },
      })
    }

    // Send a message from the web UI to Claude
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const { text, images } = (await req.json()) as { text: string; images?: string[] }
      const chat_id = String(nextId++)

      let content = text || ''
      if (images && images.length > 0) {
        // Save images to temp files and include paths in the message
        const paths: string[] = []
        for (const dataUrl of images) {
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
          if (match) {
            const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
            const filePath = `/tmp/claude-chat-img-${nextId}-${paths.length}.${ext}`
            const buffer = Buffer.from(match[2], 'base64')
            await Bun.write(filePath, buffer)
            paths.push(filePath)
          }
        }
        if (paths.length > 0) {
          content = (content ? content + '\n\n' : '') + 'Attached images:\n' + paths.join('\n')
        }
      }

      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content,
          meta: { chat_id, path: url.pathname, method: req.method },
        },
      })
      return new Response('ok', { headers: cors })
    }

    // Legacy: raw POST to root still works as a plain webhook
    if (req.method === 'POST') {
      const body = await req.text()
      const chat_id = String(nextId++)
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: body,
          meta: { chat_id, path: url.pathname, method: req.method },
        },
      })
      return new Response('ok', { headers: cors })
    }

    return new Response('not found', { status: 404, headers: cors })
  },
})
