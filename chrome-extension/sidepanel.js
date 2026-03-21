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

const STORAGE_KEY = 'claude-ext-chat-history';
let pendingImages = [];
let connected = false;
let currentES = null;

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Settings ---
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Load URL from storage, then start SSE
chrome.storage.local.get('apiBase', (data) => {
  API_BASE = data.apiBase || DEFAULT_API_BASE;
  connectSSE();
});

// React to settings changes live
chrome.storage.onChanged.addListener((changes) => {
  if (changes.apiBase) {
    API_BASE = changes.apiBase.newValue || DEFAULT_API_BASE;
    // Reconnect with new URL
    if (currentES) {
      currentES.close();
      currentES = null;
    }
    connectSSE();
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
  if (pendingImages.length === 0) {
    previewStrip.classList.remove('active');
    return;
  }
  previewStrip.classList.add('active');
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
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addImageFiles(fileInput.files);
  fileInput.value = '';
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
  if (!text && images.length === 0) return;

  input.value = '';
  input.style.height = 'auto';
  pendingImages = [];
  renderPreviews();

  addMsg(text, 'user', images);

  let content = text;
  if (images.length) {
    content = (text ? text + '\n\n' : '') + images.map(d => '[image: ' + d.substring(0, 60) + '...]').join('\n');
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

// --- SSE connection with auto-reconnect ---
function setStatus(online) {
  connected = online;
}

function connectSSE() {
  if (currentES) {
    currentES.close();
  }

  const es = new EventSource(API_BASE + '/api/events');
  currentES = es;

  es.onopen = () => setStatus(true);

  es.onmessage = (e) => {
    removeTyping();
    const data = JSON.parse(e.data);
    addMsg(data.text, 'claude', [], null, false);
  };

  es.onerror = () => {
    setStatus(false);
    es.close();
    currentES = null;
    // Reconnect after 3 seconds
    setTimeout(connectSSE, 3000);
  };
}

input.focus();
