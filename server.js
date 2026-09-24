// Theripo — anonymous therapy chat (school project demo)
// Zero dependencies: run with `node server.js` and open http://localhost:3000
// All data lives in memory and is wiped when the server restarts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const THERAPIST_CODE = process.env.THERAPIST_CODE || 'care2026';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- In-memory store ----------
const sessions = new Map();       // sessionId -> session
const clientTokens = new Map();   // token -> sessionId
const therapists = new Map();     // token -> { id, name }
const clientStreams = new Map();  // sessionId -> Set<res>
const therapistStreams = new Set(); // { res, therapist }

const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const clean = (value, max) => String(value ?? '').trim().slice(0, max);

function addMessage(session, from, name, text) {
  const message = { id: newId(6), from, name, text, at: Date.now() };
  session.messages.push(message);
  session.updatedAt = message.at;
  return message;
}

function queuePosition(session) {
  if (session.status !== 'waiting') return 0;
  let pos = 1;
  for (const s of sessions.values()) {
    if (s.status === 'waiting' && s.createdAt < session.createdAt) pos++;
  }
  return pos;
}

function fullView(session) {
  return {
    id: session.id,
    clientName: session.clientName,
    topic: session.topic,
    details: session.details,
    status: session.status,
    therapistId: session.therapistId,
    therapistName: session.therapistName,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queuePosition: queuePosition(session),
    messages: session.messages,
  };
}

function summaryView(session) {
  const { messages, ...rest } = fullView(session);
  const last = messages[messages.length - 1];
  return { ...rest, lastMessage: last ? { from: last.from, text: last.text, at: last.at } : null };
}

// Therapists see the whole waiting room plus their own conversations.
function sessionsFor(therapist) {
  return [...sessions.values()]
    .filter((s) => s.status === 'waiting' || s.therapistId === therapist.id)
    .map(summaryView);
}

function canSee(therapist, session) {
  return session.status === 'waiting' || session.therapistId === therapist.id;
}

// ---------- Server-sent events ----------
function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => clearInterval(ping));
}

function emit(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastSessions() {
  // Queue positions shift for everyone, so refresh every waiting client too.
  for (const s of sessions.values()) {
    for (const res of clientStreams.get(s.id) || []) {
      const { messages, ...view } = fullView(s);
      emit(res, 'session', view);
    }
  }
  for (const { res, therapist } of therapistStreams) {
    emit(res, 'sessions', sessionsFor(therapist));
  }
}

function broadcastMessage(session, message) {
  for (const res of clientStreams.get(session.id) || []) emit(res, 'message', message);
  for (const { res, therapist } of therapistStreams) {
    if (session.therapistId === therapist.id) emit(res, 'message', { sessionId: session.id, message });
  }
}

// ---------- Helpers ----------
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

function tokenFrom(req, url) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return url.searchParams.get('token') || '';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const PAGES = { '/': 'index.html', '/client': 'client.html', '/therapist': 'therapist.html' };

function serveStatic(res, pathname) {
  const file = PAGES[pathname] || pathname.slice(1);
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Client routes ----------
async function handleClient(req, res, url, route) {
  if (route === 'start' && req.method === 'POST') {
    const body = await readBody(req);
    const clientName = clean(body.name, 40);
    const topic = clean(body.topic, 40) || 'General';
    const details = clean(body.details, 2000);
    if (!clientName) return sendJson(res, 400, { error: 'Please choose a name we can call you.' });
    if (!details) return sendJson(res, 400, { error: 'Please share a little about what is on your mind.' });

    const now = Date.now();
    const session = {
      id: newId(), clientName, topic, details,
      status: 'waiting', therapistId: null, therapistName: null,
      createdAt: now, updatedAt: now, messages: [],
    };
    addMessage(session, 'system', null, `${clientName} joined the waiting room.`);
    sessions.set(session.id, session);
    const token = newId(18);
    clientTokens.set(token, session.id);
    broadcastSessions();
    return sendJson(res, 201, { token, session: fullView(session) });
  }

  const session = sessions.get(clientTokens.get(tokenFrom(req, url)));
  if (!session) return sendJson(res, 401, { error: 'Session not found. Please start a new conversation.' });

  if (route === 'session' && req.method === 'GET') {
    return sendJson(res, 200, { session: fullView(session) });
  }

  if (route === 'stream' && req.method === 'GET') {
    openStream(req, res);
    if (!clientStreams.has(session.id)) clientStreams.set(session.id, new Set());
    clientStreams.get(session.id).add(res);
    req.on('close', () => clientStreams.get(session.id)?.delete(res));
    return;
  }

  if (route === 'message' && req.method === 'POST') {
    if (session.status !== 'active') return sendJson(res, 409, { error: 'This conversation is not active.' });
    const text = clean((await readBody(req)).text, 2000);
    if (!text) return sendJson(res, 400, { error: 'Message is empty.' });
    const message = addMessage(session, 'client', session.clientName, text);
    broadcastMessage(session, message);
    broadcastSessions();
    return sendJson(res, 201, { message });
  }

  if (route === 'end' && req.method === 'POST') {
    if (session.status !== 'ended') {
      session.status = 'ended';
      const message = addMessage(session, 'system', null, `${session.clientName} ended the conversation.`);
      broadcastMessage(session, message);
      broadcastSessions();
    }
    return sendJson(res, 200, { session: fullView(session) });
  }

  sendJson(res, 404, { error: 'Not found' });
}

// ---------- Therapist routes ----------
async function handleTherapist(req, res, url, parts) {
  const [route, sessionId, action] = parts;

  if (route === 'login' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 40);
    if (!name) return sendJson(res, 400, { error: 'Please enter a display name.' });
    if (clean(body.code, 100) !== THERAPIST_CODE) return sendJson(res, 401, { error: 'That access code is not valid.' });
    const therapist = { id: newId(), name };
    const token = newId(18);
    therapists.set(token, therapist);
    return sendJson(res, 200, { token, therapist });
  }

  const token = tokenFrom(req, url);
  const therapist = therapists.get(token);
  if (!therapist) return sendJson(res, 401, { error: 'Please sign in again.' });

  if (route === 'logout' && req.method === 'POST') {
    therapists.delete(token);
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'me' && req.method === 'GET') {
    return sendJson(res, 200, { therapist });
  }

  if (route === 'stream' && req.method === 'GET') {
    openStream(req, res);
    const entry = { res, therapist };
    therapistStreams.add(entry);
    emit(res, 'sessions', sessionsFor(therapist));
    req.on('close', () => therapistStreams.delete(entry));
    return;
  }

  if (route !== 'sessions') return sendJson(res, 404, { error: 'Not found' });

  if (!sessionId && req.method === 'GET') {
    return sendJson(res, 200, { sessions: sessionsFor(therapist) });
  }

  const session = sessions.get(sessionId);
  if (!session || !canSee(therapist, session)) return sendJson(res, 404, { error: 'Conversation not found.' });

  if (!action && req.method === 'GET') {
    return sendJson(res, 200, { session: fullView(session) });
  }

  if (action === 'accept' && req.method === 'POST') {
    if (session.status !== 'waiting') return sendJson(res, 409, { error: 'Another therapist already accepted this conversation.' });
    session.status = 'active';
    session.therapistId = therapist.id;
    session.therapistName = therapist.name;
    const message = addMessage(session, 'system', null, `${therapist.name} joined the conversation.`);
    broadcastMessage(session, message);
    broadcastSessions();
    return sendJson(res, 200, { session: fullView(session) });
  }

  if (session.therapistId !== therapist.id) return sendJson(res, 403, { error: 'Accept this conversation first.' });

  if (action === 'message' && req.method === 'POST') {
    if (session.status !== 'active') return sendJson(res, 409, { error: 'This conversation is not active.' });
    const text = clean((await readBody(req)).text, 2000);
    if (!text) return sendJson(res, 400, { error: 'Message is empty.' });
    const message = addMessage(session, 'therapist', therapist.name, text);
    broadcastMessage(session, message);
    broadcastSessions();
    return sendJson(res, 201, { message });
  }

  if (action === 'end' && req.method === 'POST') {
    if (session.status !== 'ended') {
      session.status = 'ended';
      const message = addMessage(session, 'system', null, `${therapist.name} ended the conversation.`);
      broadcastMessage(session, message);
      broadcastSessions();
    }
    return sendJson(res, 200, { session: fullView(session) });
  }

  sendJson(res, 404, { error: 'Not found' });
}

// ---------- Server ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'api') {
    const handler = parts[1] === 'client' ? handleClient(req, res, url, parts[2])
      : parts[1] === 'therapist' ? handleTherapist(req, res, url, parts.slice(2))
      : Promise.resolve(sendJson(res, 404, { error: 'Not found' }));
    handler.catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
    });
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Theripo running at http://localhost:${PORT}`);
  console.log(`  Client page:    http://localhost:${PORT}/client`);
  console.log(`  Therapist page: http://localhost:${PORT}/therapist  (access code: ${THERAPIST_CODE})`);
});
