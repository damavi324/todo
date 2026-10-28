import http from 'node:http';
import { recentLogs, onLog, record } from './logger.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config, configProblems, publicUrl, publicWss } from './config.js';
import { voiceAccessToken, createCall, hangupCall, toE164, twiml, streamParams, xml } from './twilio.js';
import {
  broadcast,
  addUiClient, createSession, getSession, findByCallSid, publicView, setStatus, emit, finalize,
  answerQuestion, runSuggestion, history, historyList, callRecord, slog,
} from './sessions.js';
import { handleListenStream, handleAgentStream, joinAgentCall } from './streams.js';
import { generatePlan, normalizePlan } from './planner.js';
import { interpret } from './assistant.js';
import { ensureTwimlApp, validTwilioSignature } from './twilio.js';
import { openLiveTranscriber } from './deepgram.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const publicDir = path.join(config.root, 'public');

// ---------- auth (simple passcode cookie) ----------
const authValue = config.passcode
  ? crypto.createHmac('sha256', config.passcode).update('callpilot').digest('hex')
  : null;
const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// Browser: cookie. Phone app: "Authorization: Bearer <token>" or ?token= on WebSockets.
function isAuthed(req) {
  if (!authValue) return true;
  const cookie = req.headers.cookie || '';
  if (cookie.split(/;\s*/).some((c) => safeEq(c, `cp_auth=${authValue}`))) return true;
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  if (bearer && safeEq(bearer.trim(), authValue)) return true;
  const qs = new URL(req.url, 'http://localhost').searchParams.get('token');
  return !!qs && safeEq(qs, authValue);
}

// Slow down passcode guessing: 8 tries per 10 minutes per address.
const loginTries = new Map();
function tooManyTries(req) {
  const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (loginTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  loginTries.set(ip, recent);
  return recent.length > 8;
}

// ---------- helpers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
};
const CSP = "default-src 'self'; script-src 'self' blob: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' wss: https: blob:; media-src 'self' blob: https:; img-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'";

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(data);
}

// Only Twilio may call the /twilio/* webhooks.
function twilioRequestOk(req, params) {
  const mode = config.twilioValidate;
  if (mode === 'off' || !config.twilio.authToken) return true;
  const url = `https://${config.publicHost}${req.url}`;
  const ok = validTwilioSignature(url, params, req.headers['x-twilio-signature']);
  if (!ok) console.warn(`[security] ${mode === 'log' ? 'unsigned' : 'blocked unsigned'} request to ${req.url.split('?')[0]}`);
  return ok || mode === 'log';
}

/** Calls started in the last 24h (live + saved), for the daily cost guard. */
function callsInLastDay() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return historyList().filter((h) => Date.parse(h.startedAt) > since).length;
}
const sendXml = (res, inner) => send(res, 200, twiml(inner), 'text/xml');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2e6) { reject(new Error('Body too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = req.headers['content-type'] || '';
      if (!raw) return resolve({});
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
      } else resolve(Object.fromEntries(new URLSearchParams(raw)));
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/vendor/twilio.min.js') {
    const local = path.join(config.root, 'node_modules/@twilio/voice-sdk/dist/twilio.min.js');
    if (fs.existsSync(local)) {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(local).pipe(res);
    }
    res.writeHead(302, { Location: 'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2/dist/twilio.min.js' });
    return res.end();
  }
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS, ...(file.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {}) });
  fs.createReadStream(file).pipe(res);
}

// ---------- TwiML for an in-app (browser) call ----------
function outgoingTwiml(params) {
  const to = toE164(params.To);
  const session = getSession(params.sessionId);
  if (!to) return `<Say>Sorry, that number is not valid.</Say>`;
  if (session) {
    session.callSid = params.CallSid || session.callSid;
    setStatus(session, 'ringing');
  }
  const stream = session
    ? `<Start><Stream url="${xml(publicWss('/streams/listen'))}" track="both_tracks">${streamParams({ sessionId: session.id, inboundSpeaker: 'you' })}</Stream></Start>`
    : '';
  const action = session ? ` action="${xml(publicUrl(`/twilio/dial-done?sessionId=${session.id}`))}"` : '';
  const numberCb = session
    ? ` statusCallbackEvent="answered completed" statusCallback="${xml(publicUrl(`/twilio/status?sessionId=${session.id}`))}" statusCallbackMethod="POST"`
    : '';
  return `${stream}<Dial callerId="${xml(config.twilio.callerId)}" answerOnBridge="true" timeLimit="${config.maxCallMinutes * 60}"${action}><Number${numberCb}>${xml(to)}</Number></Dial>`;
}

const ENDED = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  // The phone app runs on its own origin (https://localhost inside the app), so allow cross-origin
  // API calls. They carry a bearer token, never cookies, so this does not open up the browser login.
  if (p.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }

  // --- Twilio webhooks (called by Twilio, not the browser) ---
  if (p.startsWith('/twilio/')) {
    const body = await readBody(req);
    if (!twilioRequestOk(req, body)) return send(res, 403, { error: 'Forbidden' });
    req.twilioBody = body;
  }
  if (p === '/twilio/outgoing') {
    const params = { ...Object.fromEntries(url.searchParams), ...req.twilioBody };
    log(`[twilio] browser call -> ${params.To || '(no number)'} (call ${params.CallSid || '?'}, session ${params.sessionId || 'none'})`);
    if (!toE164(params.To)) console.warn(`[twilio] number "${params.To}" is not dialable`);
    return sendXml(res, outgoingTwiml(params));
  }
  if (p === '/twilio/dial-done') {
    const params = req.twilioBody;
    const s = getSession(url.searchParams.get('sessionId'));
    if (s) {
      const bad = params.DialCallStatus && params.DialCallStatus !== 'completed';
      slog(s, bad ? 'warn' : 'info', `Twilio dial finished: ${params.DialCallStatus}${params.ErrorCode ? ` error ${params.ErrorCode}` : ''}${params.ErrorMessage ? ` ${params.ErrorMessage}` : ''}${params.DialSipResponseCode ? ` SIP ${params.DialSipResponseCode}` : ''}${bad ? '  (see https://www.twilio.com/docs/api/errors' + (params.ErrorCode ? '/' + params.ErrorCode : '') + ')' : ''}`);
      if (bad) s.error = `${params.DialCallStatus}${params.ErrorCode ? ` (Twilio error ${params.ErrorCode})` : ''}`;
      if (bad) setStatus(s, params.DialCallStatus);
      finalize(s, params.DialCallStatus || 'completed');
    }
    return sendXml(res, '<Hangup/>');
  }
  if (p === '/twilio/status') {
    const params = req.twilioBody;
    const s = getSession(url.searchParams.get('sessionId')) || findByCallSid(params.CallSid);
    if (s && params.CallStatus) {
      const bad = ['busy', 'no-answer', 'failed', 'canceled'].includes(params.CallStatus);
      if (bad && params.ErrorCode) s.error = `${params.CallStatus} (Twilio error ${params.ErrorCode})`;
      slog(s, bad ? 'warn' : 'info', `Twilio call ${params.CallSid}: ${params.CallStatus}${params.ErrorCode ? ` error ${params.ErrorCode}` : ''}${params.ErrorMessage ? ` ${params.ErrorMessage}` : ''}${params.SipResponseCode ? ` SIP ${params.SipResponseCode}` : ''}${params.CallDuration ? ` (${params.CallDuration}s)` : ''}`);
      if (ENDED.has(params.CallStatus)) {
        if (params.CallStatus !== 'completed') setStatus(s, params.CallStatus);
        finalize(s, params.CallStatus);
      } else if (params.CallStatus === 'in-progress' || params.CallStatus === 'answered') {
        setStatus(s, 'live');
      } else {
        setStatus(s, params.CallStatus);
      }
    }
    return send(res, 204, '', 'text/plain');
  }

  // --- app API ---
  if (p === '/api/health') {
    return send(res, 200, {
      ok: true,
      authed: isAuthed(req),
      needsPasscode: !!config.passcode,
      problems: configProblems(),
      owner: config.ownerName,
      assistant: config.assistantName,
      callerId: config.twilio.callerId,
      api: 2,
    });
  }
  if (p === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    if (config.passcode && tooManyTries(req)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
    if (!config.passcode || safeEq(body.passcode, config.passcode)) {
      res.setHeader('Set-Cookie', `cp_auth=${authValue || ''}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`);
      return send(res, 200, { ok: true, token: authValue || '', owner: config.ownerName, assistant: config.assistantName });
    }
    console.warn('[auth] wrong passcode attempt');
    return send(res, 401, { error: 'Wrong passcode' });
  }
  if (p.startsWith('/api/') && !isAuthed(req)) return send(res, 401, { error: 'Login required' });

  if (p === '/api/logs' && method === 'GET') return send(res, 200, { logs: recentLogs() });
  if (p === '/api/client-log' && method === 'POST') {
    const body = await readBody(req);
    const level = ['info', 'warn', 'error'].includes(body.level) ? body.level : 'info';
    record(level, `[browser] ${String(body.message || '').slice(0, 2000)}`);
    return send(res, 204, '', 'text/plain');
  }

  if (p === '/api/token') {
    const t = config.twilio;
    if (!t.apiKeySid || !t.apiKeySecret || !t.twimlAppSid) return send(res, 400, { error: 'Twilio API key and TwiML App are not configured' });
    return send(res, 200, { token: voiceAccessToken(config.clientIdentity), identity: config.clientIdentity });
  }

  if (p === '/api/sessions' && method === 'GET') return send(res, 200, { history: historyList() });

  const one = p.match(/^\/api\/sessions\/([0-9a-f-]+)$/);
  if (one && method === 'GET') {
    const rec = callRecord(one[1]);
    return rec ? send(res, 200, { call: rec }) : send(res, 404, { error: 'Call not found' });
  }

  if (p === '/api/assistant' && method === 'POST') {
    const body = await readBody(req);
    try {
      log(`[assistant] heard: ${String(body.text || '').slice(0, 160)}`);
      const result = await interpret(body);
      log(`[assistant] understood as ${result.kind}${result.task ? ` | task: ${result.task.title}` : ''}${result.call ? ` | call: ${result.call.contact || result.call.to || '?'} (${result.call.when})` : ''}`);
      return send(res, 200, { result });
    } catch (err) {
      console.error('[assistant] failed:', err.message);
      return send(res, 502, { error: `Could not understand that: ${err.message}` });
    }
  }

  if (p === '/api/plan' && method === 'POST') {
    const body = await readBody(req);
    const to = toE164(body.to);
    if (!to) return send(res, 400, { error: 'Enter a valid phone number' });
    if (!String(body.goal || '').trim()) return send(res, 400, { error: 'Tell the agent what the call is for' });
    try {
      log(`[plan] writing call plan (${String(body.brief || '').length} chars of details)`);
      const plan = await generatePlan({ to, goal: body.goal, brief: body.brief });
      log(`[plan] ready: ${plan.objective}`);
      return send(res, 200, { plan });
    } catch (err) {
      console.error('[plan] failed:', err.message);
      return send(res, 502, { error: `Could not write the call plan: ${err.message}` });
    }
  }

  if (p === '/api/sessions' && method === 'POST') {
    const body = await readBody(req);
    const to = toE164(body.to);
    if (!to) return send(res, 400, { error: 'Enter a valid phone number' });
    const mode = body.mode === 'agent' ? 'agent' : 'copilot';
    if (callsInLastDay() >= config.maxCallsPerDay) {
      console.warn(`[guard] daily call limit reached (${config.maxCallsPerDay})`);
      return send(res, 429, { error: `Daily call limit reached (${config.maxCallsPerDay} in 24 hours). Raise MAX_CALLS_PER_DAY on the server if you need more.` });
    }
    body.goal = String(body.goal || '').slice(0, 2000);
    body.brief = String(body.brief || '').slice(0, 40000);
    if (mode === 'agent' && !body.goal?.trim()) return send(res, 400, { error: 'Tell the agent what the call is for' });
    const s = createSession({ mode, to, goal: body.goal, brief: body.brief, plan: mode === 'agent' ? normalizePlan(body.plan) : null });
    if (mode === 'agent') {
      try {
        const call = await createCall({
          To: to,
          From: config.twilio.callerId,
          Twiml: twiml(`<Connect><Stream url="${xml(publicWss('/streams/agent'))}">${streamParams({ sessionId: s.id })}</Stream></Connect>`),
          StatusCallback: publicUrl(`/twilio/status?sessionId=${s.id}`),
          StatusCallbackMethod: 'POST',
          StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          TimeLimit: config.maxCallMinutes * 60,
        });
        s.callSid = call.sid;
        setStatus(s, 'dialing');
      } catch (err) {
        slog(s, 'error', `Could not place the AI call: ${err.message}`);
        setStatus(s, 'failed', err.message);
        finalize(s, 'failed');
        return send(res, 502, { error: err.message, session: publicView(s) });
      }
    }
    return send(res, 200, { session: publicView(s) });
  }

  const m = p.match(/^\/api\/sessions\/([0-9a-f-]+)\/(join|hangup|answer|suggest|client-error)$/);
  if (m && method === 'POST') {
    const s = getSession(m[1]);
    if (!s) return send(res, 404, { error: 'Call not found' });
    const body = await readBody(req);
    try {
      if (m[2] === 'join') {
        log(`[call] joining you into ${s.callSid}`);
        await joinAgentCall(s);
        return send(res, 200, { ok: true });
      }
      if (m[2] === 'hangup') {
        if (s.callSid) await hangupCall(s.callSid).catch((e) => log('[hangup]', e.message));
        finalize(s, 'hung up');
        return send(res, 200, { ok: true });
      }
      if (m[2] === 'answer') {
        const ok = answerQuestion(s, body.questionId, body.answer);
        return send(res, ok ? 200 : 410, ok ? { ok: true } : { error: 'That question already timed out' });
      }
      if (m[2] === 'client-error') {
        const msg = String(body.message || 'Unknown browser error').slice(0, 1000);
        slog(s, 'error', `Browser: ${msg}`);
        if (body.fatal && !s._finalized) {
          setStatus(s, 'failed', msg);
          finalize(s, 'failed');
        }
        return send(res, 200, { ok: true });
      }
      if (m[2] === 'suggest') {
        runSuggestion(s);
        return send(res, 200, { ok: true });
      }
    } catch (err) {
      console.error(`[call] ${m[2]} failed: ${err.message}`);
      emit(s, 'notice', { level: 'error', message: err.message });
      return send(res, 502, { error: err.message });
    }
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (method === 'GET') return serveStatic(req, res, p);
  return send(res, 405, { error: 'Method not allowed' });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    log('[error]', err.stack || err.message);
    if (!res.headersSent) send(res, 500, { error: err.message });
  });
});

const wssUi = new WebSocketServer({ noServer: true });
const wssListen = new WebSocketServer({ noServer: true });
const wssAgent = new WebSocketServer({ noServer: true });
const wssDictate = new WebSocketServer({ noServer: true });

// Dictation: browser sends 16-bit PCM from the mic; we relay to Deepgram and send text back.
wssDictate.on('connection', (ws, req) => {
  const rate = Number(new URL(req.url, 'http://localhost').searchParams.get('rate'));
  const sampleRate = Number.isInteger(rate) && rate >= 8000 && rate <= 48000 ? rate : 16000;
  const sendUi = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const stt = openLiveTranscriber({
    label: 'dictation',
    encoding: 'linear16',
    sampleRate,
    onEvent: (ev) => {
      if (ev.type === 'interim' || ev.type === 'final') sendUi({ type: ev.type, text: ev.text });
    },
    onError: (err) => sendUi({ type: 'error', message: err.message }),
  });
  const maxTimer = setTimeout(() => ws.close(), 10 * 60 * 1000);
  ws.on('message', (data, isBinary) => {
    if (isBinary) stt.send(Buffer.from(data));
  });
  ws.on('close', () => {
    clearTimeout(maxTimer);
    stt.close();
  });
});
wssListen.on('connection', handleListenStream);
wssAgent.on('connection', handleAgentStream);
onLog((entry) => broadcast({ type: 'log', entry }));
wssUi.on('connection', (ws) => {
  addUiClient(ws);
  ws.send(JSON.stringify({ type: 'hello' }));
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const target =
    pathname === '/ui' ? (isAuthed(req) ? wssUi : null)
      : pathname === '/streams/listen' ? wssListen
        : pathname === '/streams/agent' ? wssAgent
          : pathname === '/dictate' ? (isAuthed(req) ? wssDictate : null)
          : null;
  if (!target) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

server.listen(config.port, () => {
  log(`CallPilot running on http://localhost:${config.port}`);
  if (config.publicHost) log(`Public URL: https://${config.publicHost}`);
  const problems = configProblems();
  if (problems.length) {
    log('Setup items to fix:');
    problems.forEach((x) => log('  -', x));
  }
  // Point the Twilio TwiML App at this server so in-app dialing works without manual setup.
  if (config.publicHost && config.twilio.twimlAppSid && process.env.SKIP_TWIML_AUTOCONFIG !== '1') {
    ensureTwimlApp()
      .then((r) => log(`[twilio] TwiML App voice URL ${r.changed ? 'set to' : 'already'} ${r.url}`))
      .catch((err) => console.warn(`[twilio] could not configure the TwiML App: ${err.message}`));
  }
});
