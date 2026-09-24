// Small helpers shared by the client and therapist pages.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

// Renders one chat message. `mine` is the sender role of the current viewer.
function renderMessage(message, mine) {
  if (message.from === 'system') {
    const wrap = el('div', 'msg system');
    wrap.appendChild(el('div', 'bubble', message.text));
    return wrap;
  }
  const isMine = message.from === mine;
  const wrap = el('div', `msg ${isMine ? 'mine' : 'theirs'}`);
  wrap.appendChild(el('div', 'bubble', message.text));
  wrap.appendChild(el('div', 'meta', `${isMine ? 'You' : message.name} · ${formatTime(message.at)}`));
  return wrap;
}

function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

// Enter sends, Shift+Enter adds a newline; textarea grows with its content.
function wireComposer(textarea, onSend) {
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
  };
  textarea.addEventListener('input', resize);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });
  return () => { textarea.value = ''; resize(); };
}
