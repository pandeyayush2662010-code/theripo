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

// Renders one chat message. `mine` is the sender role of the current viewer;
// `mediaUrl(id)` builds the link for photos, voice notes and videos.
function renderMessage(message, mine, mediaUrl) {
  if (message.from === 'system') {
    const wrap = el('div', 'msg system');
    wrap.appendChild(el('div', 'bubble', message.text));
    return wrap;
  }
  const isMine = message.from === mine;
  const wrap = el('div', `msg ${isMine ? 'mine' : 'theirs'}`);
  wrap.appendChild(message.media ? renderMedia(message.media, mediaUrl(message.media.id)) : el('div', 'bubble', message.text));
  wrap.appendChild(el('div', 'meta', `${isMine ? 'You' : message.name} · ${formatTime(message.at)}`));
  return wrap;
}

function renderMedia(item, src) {
  const bubble = el('div', `bubble media media-${item.kind}`);
  if (item.kind === 'image') {
    const link = el('a');
    link.href = src;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = el('img');
    img.src = src;
    img.alt = item.name || 'Shared photo';
    img.addEventListener('load', () => {
      const box = bubble.closest('.messages');
      if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 400) scrollToBottom(box);
    });
    link.appendChild(img);
    bubble.appendChild(link);
  } else {
    const player = el(item.kind === 'video' ? 'video' : 'audio');
    player.controls = true;
    player.preload = 'metadata';
    player.playsInline = true;
    player.src = src;
    bubble.appendChild(player);
  }
  return bubble;
}

async function uploadMedia(path, file, token) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || ''),
      Authorization: `Bearer ${token}`,
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not send that file.');
  return data;
}

const ICONS = {
  clip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>',
  mic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
};

function iconButton(svg, label) {
  const btn = el('button', 'icon-btn');
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svg;
  return btn;
}

function describeFile(file) {
  const kind = file.type.split('/')[0];
  return kind === 'image' ? 'photo' : kind === 'audio' ? 'voice note' : kind === 'video' ? 'video' : 'file';
}

// Adds attach (photos, screenshots, videos), voice-note recording and
// paste-a-screenshot to a chat composer. `upload(file)` sends one file.
function enhanceComposer(form, textarea, upload) {
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*,audio/*';
  fileInput.hidden = true;
  const attachBtn = iconButton(ICONS.clip, 'Send a photo, screenshot or video');
  const micBtn = iconButton(ICONS.mic, 'Record a voice note');
  const tools = el('div', 'composer-tools');
  tools.append(attachBtn, micBtn, fileInput);
  form.prepend(tools);

  const timer = el('span', 'rec-time', '0:00');
  const cancelBtn = el('button', 'btn btn-ghost btn-sm', 'Cancel');
  const sendBtn = el('button', 'btn btn-sm', 'Send voice note');
  cancelBtn.type = sendBtn.type = 'button';
  const recorderBar = el('div', 'recorder');
  recorderBar.append(el('span', 'rec-dot'), timer, el('span', 'rec-label', 'Recording…'), cancelBtn, sendBtn);
  form.appendChild(recorderBar);

  let busy = false;
  async function send(file) {
    if (busy) return;
    busy = true;
    const placeholder = textarea.placeholder;
    textarea.placeholder = `Sending ${describeFile(file)}…`;
    textarea.disabled = attachBtn.disabled = micBtn.disabled = true;
    try {
      await upload(file);
    } catch (err) {
      alert(err.message);
    } finally {
      busy = false;
      textarea.placeholder = placeholder;
      textarea.disabled = attachBtn.disabled = micBtn.disabled = false;
    }
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) send(file);
  });
  textarea.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      send(file);
    }
  });

  let recorder = null;
  let chunks = [];
  let cancelled = false;
  let tick = null;

  micBtn.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return alert('Voice notes are not supported in this browser.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return alert('Microphone access is blocked. Allow it in your browser settings to record a voice note.');
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    cancelled = false;
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tick);
      form.classList.remove('recording');
      if (cancelled || !chunks.length) return;
      const type = (recorder.mimeType || 'audio/webm').split(';')[0];
      send(new File(chunks, `voice-note.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type }));
    });

    recorder.start();
    const startedAt = Date.now();
    timer.textContent = '0:00';
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 300) recorder.stop(); // 5 minute limit
    }, 250);
    form.classList.add('recording');
  });

  cancelBtn.addEventListener('click', () => { cancelled = true; recorder?.stop(); });
  sendBtn.addEventListener('click', () => recorder?.stop());
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
