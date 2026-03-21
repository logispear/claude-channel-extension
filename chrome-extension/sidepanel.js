const DEFAULT_API_BASE = 'http://127.0.0.1:8788';
let API_BASE = DEFAULT_API_BASE;

const messagesEl = document.getElementById('messages');
const welcome = document.getElementById('welcome');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const previewStrip = document.getElementById('preview-strip');
const dropOverlay = document.getElementById('drop-overlay');
const clearBtn = document.getElementById('clear-btn');
const settingsBtn = document.getElementById('settings-btn');
const pickBtn = document.getElementById('pick-btn');

const STORAGE_KEY = 'claude-ext-chat-history';
let pendingImages = [];
let pendingElements = [];
let connected = false;

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Settings ---
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Load URL from storage, then start polling
chrome.storage.local.get('apiBase', (data) => {
  API_BASE = data.apiBase || DEFAULT_API_BASE;
  startPolling();
});

// React to settings changes live
chrome.storage.onChanged.addListener((changes) => {
  if (changes.apiBase) {
    API_BASE = changes.apiBase.newValue || DEFAULT_API_BASE;
    // Restart polling with new URL
    stopPolling();
    startPolling();
  }
});

// --- Persistence ---
function saveHistory() {
  try {
    const msgs = [];
    messagesEl.querySelectorAll('.msg-row').forEach(row => {
      const sender = row.classList.contains('user') ? 'user' : 'claude';
      const text = row.querySelector('.msg-text')?.textContent || '';
      const time = row.querySelector('.time')?.textContent || '';
      const images = Array.from(row.querySelectorAll('.bubble img')).map(img => img.src);
      msgs.push({ sender, text, time, images });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {}
}

function loadHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    const msgs = JSON.parse(data);
    if (!msgs.length) return;
    if (welcome) welcome.remove();
    msgs.forEach(m => addMsg(m.text, m.sender, m.images, m.time, true));
  } catch {}
}

// --- Messages ---
function addMsg(text, sender, images, time, restored) {
  if (welcome && welcome.parentNode) welcome.remove();

  const row = document.createElement('div');
  row.className = 'msg-row ' + sender + (restored ? ' restored' : '');

  const senderEl = document.createElement('div');
  senderEl.className = 'sender';
  senderEl.textContent = sender === 'user' ? 'You' : 'Claude';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (text) {
    const textEl = document.createElement('span');
    textEl.className = 'msg-text';
    textEl.textContent = text;
    bubble.appendChild(textEl);
  }

  if (images && images.length) {
    images.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      bubble.appendChild(img);
    });
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'time';
  timeEl.textContent = time || timeStr();

  row.appendChild(senderEl);
  row.appendChild(bubble);
  row.appendChild(timeEl);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (!restored) saveHistory();
}

// --- Clear ---
clearBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  messagesEl.innerHTML = '';
  const w = document.createElement('div');
  w.id = 'welcome';
  w.innerHTML = '<div class="welcome-icon">✦</div><h2>Channel</h2><p>Chat with Claude Code from any page</p>';
  messagesEl.appendChild(w);
});

loadHistory();

// --- Auto-resize textarea ---
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 100) + 'px';
});

// --- Image handling ---
function addImageFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingImages.push({ dataUrl: e.target.result, file });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  }
}

function renderPreviews() {
  previewStrip.innerHTML = '';
  if (pendingImages.length === 0 && pendingElements.length === 0) {
    previewStrip.classList.remove('active');
    return;
  }
  previewStrip.classList.add('active');

  // Render image previews
  pendingImages.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    const btn = document.createElement('button');
    btn.className = 'remove-btn';
    btn.textContent = 'x';
    btn.onclick = () => { pendingImages.splice(i, 1); renderPreviews(); };
    wrap.appendChild(img);
    wrap.appendChild(btn);
    previewStrip.appendChild(wrap);
  });

  // Render element previews
  pendingElements.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item element-chip';
    const label = document.createElement('span');
    label.className = 'element-label';
    label.textContent = item.label;
    label.title = item.selector;
    const btn = document.createElement('button');
    btn.className = 'remove-btn';
    btn.textContent = 'x';
    btn.onclick = () => { pendingElements.splice(i, 1); renderPreviews(); };
    wrap.appendChild(label);
    wrap.appendChild(btn);
    previewStrip.appendChild(wrap);
  });
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addImageFiles(fileInput.files);
  fileInput.value = '';
});

// --- Element picker ---
let currentPickerTabUrl = null;

pickBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    // Store the tab URL for when element is picked
    currentPickerTabUrl = tab.url;

    // Inject content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
    } catch (e) {
      // Script may already be injected, continue
    }

    // Activate picker in the content script
    chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_PICKER' });
  } catch (err) {
    console.error('Failed to activate picker:', err);
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ELEMENT_PICKED') {
    // Add the page URL to the element data
    const elementData = {
      ...msg.data,
      pageUrl: currentPickerTabUrl || sender.tab?.url || 'unknown'
    };
    pendingElements.push(elementData);
    renderPreviews();
  }
  return true;
});

// --- Drag and drop ---
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');
  if (e.dataTransfer.files.length) addImageFiles(e.dataTransfer.files);
});

// --- Paste image ---
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      addImageFiles([item.getAsFile()]);
    }
  }
});

// --- Typing indicator ---
function showTyping() {
  removeTyping();
  const row = document.createElement('div');
  row.className = 'typing-row';
  row.id = 'typing-indicator';
  const senderEl = document.createElement('div');
  senderEl.className = 'sender';
  senderEl.textContent = 'Claude';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  row.appendChild(senderEl);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// --- Send ---
async function send() {
  const text = input.value.trim();
  const images = pendingImages.map(p => p.dataUrl);
  const elements = pendingElements.map(e => ({ html: e.html, selector: e.selector, pageUrl: e.pageUrl }));
  if (!text && images.length === 0 && elements.length === 0) return;

  input.value = '';
  input.style.height = 'auto';
  pendingImages = [];
  pendingElements = [];
  renderPreviews();

  // Display text with element references
  let displayText = text;
  if (elements.length > 0) {
    const elementRefs = elements.map(() => '#element').join(' ');
    displayText = displayText ? displayText + ' ' + elementRefs : elementRefs;
  }
  addMsg(displayText, 'user', images);

  // Build content with elements stringified directly
  let content = text;
  if (elements.length > 0) {
    const elementParts = elements.map((el, i) =>
      `[Element ${i + 1}]\nPage: ${el.pageUrl}\nSelector: ${el.selector}\nHTML:\n${el.html}`
    );
    content = (content ? content + '\n\n' : '') + 'Selected elements:\n\n' + elementParts.join('\n\n');
  }
  if (images.length) {
    content = (content ? content + '\n\n' : '') + images.map(d => '[image: ' + d.substring(0, 60) + '...]').join('\n');
  }

  showTyping();

  try {
    await fetch(API_BASE + '/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, images }),
    });
  } catch (err) {
    removeTyping();
    addMsg('Failed to send — is Claude Code running? Check Settings for the correct URL.', 'claude', []);
  }
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// --- Polling for responses ---
const POLL_INTERVAL = 1000; // Poll every 1 second
let pollTimer = null;

function setStatus(online) {
  connected = online;
  const header = document.querySelector('header h1');
  if (header) {
    header.style.opacity = online ? '1' : '0.5';
  }
}

async function pollResponses() {
  try {
    const res = await fetch(API_BASE + '/api/poll');
    if (res.ok) {
      setStatus(true);
      const responses = await res.json();
      for (const r of responses) {
        removeTyping();
        addMsg(r.text, 'claude', [], null, false);
      }
    } else {
      setStatus(false);
    }
  } catch (err) {
    setStatus(false);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollResponses(); // Initial poll
  pollTimer = setInterval(pollResponses, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Pause polling when tab is hidden to save resources
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    startPolling();
  } else {
    stopPolling();
  }
});

input.focus();
