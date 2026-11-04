import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { config, assistantNameOf } from './config.js';
import { complete, parseJson } from './claude.js';
import { hangupCall } from './twilio.js';

// ---------- Live UI hub ----------
const uiClients = new Set();
export function addUiClient(ws) {
  uiClients.add(ws);
  ws.on('close', () => uiClients.delete(ws));
}
export function broadcast(event) {
  const data = JSON.stringify(event);
  for (const ws of uiClients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

// ---------- Session store ----------
const sessions = new Map();
const dataDir = process.env.CALLPILOT_DATA_DIR || path.join(config.root, 'data');
const historyFile = path.join(dataDir, 'calls.json');

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch {
    return [];
  }
}
function saveToHistory(s) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const list = loadHistory().filter((x) => x.id !== s.id);
    list.unshift(publicView(s));
    fs.writeFileSync(historyFile, JSON.stringify(list.slice(0, 100), null, 2));
  } catch (err) {
    console.error('[history] could not save:', err.message);
  }
}
export const history = () => loadHistory();

const RESULT_TEXT = { live: 'In progress', answered: 'Answered', voicemail: 'Voicemail', no_answer: 'No answer', busy: 'Busy', canceled: 'Canceled', failed: 'Failed' };

/**
 * How a call went, in one word the app can filter on: live, answered, voicemail, no_answer, busy, canceled or failed.
 * Works for saved calls from before this was recorded too.
 */
export function callResult(c) {
  if (!c.endedAt) return 'live';
  if (c.voicemail || c.summary?.outcome === 'voicemail') return 'voicemail';
  if (c.status === 'busy') return 'busy';
  if (c.status === 'no-answer') return 'no_answer';
  if (c.status === 'canceled') return 'canceled';
  if (c.status === 'failed' || c.error) return 'failed';
  if (c.answered || c.transcript?.some((l) => l.speaker === 'them')) return 'answered';
  return 'no_answer';
}

function recordResult(s, how = '') {
  const result = callResult(s);
  if (s.result === result) return;
  s.result = result;
  slog(s, ['answered', 'live'].includes(result) ? 'info' : 'warn', `Result: ${RESULT_TEXT[result]}${how}`);
  emit(s, 'result', { result });
}

/** Light list for the Recent calls panel (no transcripts or long details). */
export function historyList() {
  const live = [...sessions.values()].map(publicView);
  const ids = new Set(live.map((x) => x.id));
  return [...live, ...loadHistory().filter((h) => !ids.has(h.id))]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 50)
    .map((h) => ({
      id: h.id, mode: h.mode, to: h.to, goal: h.goal, status: h.status, startedAt: h.startedAt, endedAt: h.endedAt,
      error: h.error || null, outcome: h.summary?.outcome || null, headline: h.summary?.headline || null,
      result: h.endedAt ? h.result || callResult(h) : 'live',
      hasPlan: !!h.plan, briefChars: (h.brief || '').length, usage: h.usage || null,
    }));
}

/** How many calls started in the last `ms` milliseconds. Counts the full history, not the short list the app shows. */
export function callsSince(ms) {
  const since = Date.now() - ms;
  const seen = new Set();
  let n = 0;
  const count = (c) => {
    if (!c?.id || seen.has(c.id)) return;
    if (Date.parse(c.startedAt) > since) { seen.add(c.id); n += 1; }
  };
  for (const s of sessions.values()) count(s);
  for (const h of loadHistory()) count(h);
  return n;
}

/** Full record of one call (live or saved). */
export function callRecord(id) {
  const live = sessions.get(id);
  if (live) return publicView(live);
  return loadHistory().find((h) => h.id === id) || null;
}

const saveTimers = new Map();
export function persist(s) {
  clearTimeout(saveTimers.get(s.id));
  saveTimers.set(s.id, setTimeout(() => { saveTimers.delete(s.id); saveToHistory(s); }, 300));
}

/** Log a line to the server log AND to this call's own log. */
export function slog(s, level, text) {
  const line = { at: new Date().toISOString(), level, text: String(text).slice(0, 2000) };
  s.log.push(line);
  if (s.log.length > 300) s.log.shift();
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`[call ${s.id.slice(0, 8)}] ${line.text}`);
  emit(s, 'call_log', { line });
  persist(s);
}

export function createSession({ mode, to, from, goal, brief, plan, owner, about, localNow, skills = [], planUsage, voice = '', assistant = '' }) {
  const s = {
    id: crypto.randomUUID(),
    mode, // 'copilot' | 'agent'
    to,
    from, // the caller ID the other phone sees
    ownerName: String(owner || '').trim().slice(0, 80) || config.ownerName,
    about: String(about || '').trim().slice(0, 8000),
    // The owner's own date and time, e.g. "Friday 2026-10-30 18:05 America/Chicago", so "next Tuesday"
    // in the call can be written down as a real date.
    localNow: String(localNow || '').trim().slice(0, 80),
    goal: (goal || '').trim(),
    brief: (brief || '').trim(),
    plan: plan || null,
    skills,
    assistantName: assistantNameOf(assistant), // what the assistant calls itself on this call
    voice, // the voice picked in the app for this call; empty = the server's default
    // What this call used: Claude tokens per model (call plan, live tips, notes) and how long it lasted.
    usage: { claude: cleanUsage(planUsage), seconds: 0 },
    status: 'starting',
    callSid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    transcript: [], // { speaker: 'you'|'them'|'agent', text, at }
    suggestions: [],
    questions: [],
    summary: null,
    error: null,
    log: [],
    // runtime only
    _partials: {},
    _suggest: { timer: null, inFlight: false, pending: false, lastLineCount: 0 },
    _finalized: false,
    _pendingAnswers: new Map(),
    _agent: null,
  };
  sessions.set(s.id, s);
  emit(s, 'session', { session: publicView(s) });
  slog(s, 'info', `Created ${mode === 'agent' ? 'AI agent' : 'you-talk'} call to ${to}`);
  return s;
}

export const getSession = (id) => sessions.get(id);

/** Token counts sent back by the app (from writing the call plan), checked to be plain numbers. */
function cleanUsage(u) {
  const out = {};
  if (!u || typeof u !== 'object') return out;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1e8) : 0);
  for (const [model, t] of Object.entries(u).slice(0, 5)) {
    if (/^[\w.-]{1,60}$/.test(model)) out[model] = { in: n(t?.in), out: n(t?.out), calls: n(t?.calls) };
  }
  return out;
}

// Safety net: a call Twilio never reported as finished is closed after the maximum call length,
// and finished calls are dropped from memory (they stay in history on disk).
setInterval(() => {
  const now = Date.now();
  const maxMs = (config.maxCallMinutes + 5) * 60 * 1000;
  for (const s of sessions.values()) {
    const age = now - Date.parse(s.startedAt);
    if (!s._finalized && age > maxMs) {
      slog(s, 'warn', `No final status from Twilio after ${Math.round(age / 60000)} minutes; hanging up.`);
      if (s.callSid) hangupCall(s.callSid).catch((err) => slog(s, 'error', `Could not hang up: ${err.message}`));
      finalize(s, 'timed out');
    } else if (s._finalized && s.endedAt && now - Date.parse(s.endedAt) > 10 * 60 * 1000) {
      sessions.delete(s.id);
    }
  }
}, 60 * 1000).unref();
export const findByCallSid = (sid) => [...sessions.values()].find((s) => s.callSid === sid);

export function publicView(s) {
  const { _partials, _suggest, _finalized, _pendingAnswers, _agent, ...rest } = s;
  return rest;
}

export function emit(s, type, data = {}) {
  if (type === 'notice') slog(s, data.level === 'error' ? 'error' : 'warn', data.message);
  broadcast({ type, sessionId: s.id, ...data });
}

export function setStatus(s, status, detail) {
  if (s.status === status && !detail) return;
  s.status = status;
  if (['failed', 'busy', 'no-answer', 'canceled'].includes(status) && detail) s.error = detail;
  slog(s, ['failed', 'busy', 'no-answer', 'canceled'].includes(status) ? 'warn' : 'info', `Status: ${status}${detail ? ` (${detail})` : ''}`);
  emit(s, 'status', { status, detail: detail || null });
}

export function addLine(s, speaker, text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const line = { speaker, text: clean, at: new Date().toISOString() };
  s.transcript.push(line);
  emit(s, 'line', { line });
  if (speaker === 'them' && (s.mode === 'copilot' || s.joined)) scheduleSuggestion(s);
}

/**
 * Records that a machine answered, not a person: a note in the transcript, and (on an AI call) a heads-up
 * to the agent so it leaves its short message instead of trying to hold a conversation.
 */
export function markVoicemail(s, note = 'Went to voicemail. No one picked up.') {
  if (s.voicemail) return;
  s.voicemail = true;
  addLine(s, 'system', note);
  s._agent?.note(
    'IMPORTANT: this call was answered by voicemail or an answering machine, not a person. Nobody is listening live. ' +
    'Do not ask questions or wait for answers. After the greeting ends (or the beep), leave your one short voicemail message, ' +
    'then call finish_call with outcome "voicemail".'
  );
}

export function setPartial(s, speaker, text) {
  s._partials[speaker] = text;
  emit(s, 'partial', { speaker, text });
}

// ---------- Utterance assembly from streaming STT ----------
/** Returns a handler for Deepgram events for one speaker. */
export function utteranceAssembler(s, speaker) {
  let committed = '';
  const flush = () => {
    if (committed.trim()) addLine(s, speaker, committed);
    committed = '';
    setPartial(s, speaker, '');
  };
  return (ev) => {
    if (ev.type === 'interim') {
      setPartial(s, speaker, `${committed} ${ev.text}`.trim());
    } else if (ev.type === 'final') {
      if (ev.text) committed = `${committed} ${ev.text}`.trim();
      if (ev.speechFinal) flush();
      else setPartial(s, speaker, committed);
    } else if (ev.type === 'utterance_end') {
      flush();
    }
  };
}

const transcriptText = (s, maxLines = 40) =>
  s.transcript
    .slice(-maxLines)
    .map((l) => `${l.speaker === 'you' ? (s.ownerName || config.ownerName) : l.speaker === 'agent' ? 'AI agent' : l.speaker === 'system' ? '[Call note]' : 'Other party'}: ${l.text}`)
    .join('\n');

// ---------- Live suggestions (copilot) ----------
export function scheduleSuggestion(s, delayMs = 450) {
  const st = s._suggest;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => runSuggestion(s), delayMs);
}

export async function runSuggestion(s) {
  const st = s._suggest;
  if (st.inFlight) {
    st.pending = true;
    return;
  }
  if (!config.anthropic.apiKey || s.transcript.length === 0) return;
  st.inFlight = true;
  const started = Date.now();
  try {
    const text = await complete({
      usage: s.usage.claude,
      model: config.anthropic.fastModel,
      maxTokens: 300,
      timeoutMs: 12000,
      system:
        `You are a real-time call copilot for ${s.ownerName || config.ownerName}, who is on a live phone call right now. ` +
        `Help ${s.ownerName || config.ownerName} reach the goal. Be extremely brief: they glance at your card mid-conversation. ` +
        'Reply ONLY with JSON: {"say":["<what to say next, under 20 words>", "<optional alternative>"],"note":"<key fact, warning, or empty>"}. ' +
        'Suggestions must be things the user can say out loud verbatim. Flag anything that commits money, signs up, cancels, or shares sensitive data.',
      prompt:
        `Goal: ${s.goal || '(not given)'}\nAbout ${s.ownerName || config.ownerName} (every call): ${(s.about || '(none)').slice(0, 2000)}\nThis call: ${(s.brief || '(none)').slice(0, 6000)}\n\nTranscript so far:\n${transcriptText(s)}\n\nWhat should ${s.ownerName || config.ownerName} say next?`,
    });
    const json = parseJson(text) || { say: [text.slice(0, 160)], note: '' };
    const suggestion = {
      say: (Array.isArray(json.say) ? json.say : [json.say]).filter(Boolean).slice(0, 2),
      note: json.note || '',
      at: new Date().toISOString(),
      ms: Date.now() - started,
    };
    if (suggestion.say.length || suggestion.note) {
      s.suggestions.push(suggestion);
      emit(s, 'suggestion', { suggestion });
    }
  } catch (err) {
    emit(s, 'notice', { level: 'warn', message: `Suggestion failed: ${err.message}` });
  } finally {
    st.inFlight = false;
    if (st.pending) {
      st.pending = false;
      scheduleSuggestion(s, 50);
    }
  }
}

// ---------- Owner questions (agent asks you mid-call) ----------
export function askOwner(s, question, timeoutMs = 45000) {
  const qid = crypto.randomUUID();
  const q = { id: qid, question, askedAt: new Date().toISOString(), answer: null };
  s.questions.push(q);
  emit(s, 'question', { question: q });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s._pendingAnswers.delete(qid);
      q.answer = null;
      q.expired = true;
      emit(s, 'question_closed', { questionId: qid, answered: false });
      resolve(null);
    }, timeoutMs);
    s._pendingAnswers.set(qid, (answer) => {
      clearTimeout(timer);
      q.answer = answer;
      emit(s, 'question_closed', { questionId: qid, answered: true, answer });
      resolve(answer);
    });
  });
}

export function answerQuestion(s, qid, answer) {
  const fn = s._pendingAnswers.get(qid);
  if (!fn) return false;
  s._pendingAnswers.delete(qid);
  fn(String(answer || '').trim());
  return true;
}

// ---------- End of call ----------
const BAD_STATUS = new Set(['failed', 'busy', 'no-answer', 'canceled']);
export function finalize(s, reason = 'ended') {
  if (s._finalized) return;
  s._finalized = true;
  s.endedAt = new Date().toISOString();
  clearTimeout(s._suggest.timer);
  for (const fn of s._pendingAnswers.values()) fn('');
  s._pendingAnswers.clear();
  // flush partial lines that never got a final
  for (const [speaker, text] of Object.entries(s._partials)) if (text) addLine(s, speaker, text);
  // A call that never connected keeps its reason (busy, no-answer...) so the app can say what happened.
  if (BAD_STATUS.has(s.status)) {
    if (!s.error) s.error = s.status;
    slog(s, 'info', `Call closed (${reason})`);
  } else {
    setStatus(s, 'ended', reason);
  }
  recordResult(s);
  // give in-flight transcripts a moment to land, then summarize
  setTimeout(() => summarize(s), 1500);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Keeps the notes to one shape. action_items may come back as plain strings or as {title, date}. */
export function normalizeSummary(n) {
  if (!n || typeof n !== 'object') return null;
  const text = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const dated = (x) => ({ title: text(x?.title ?? x), date: DATE.test(x?.date) ? x.date : '', time: TIME.test(x?.time) ? x.time : '' });
  const callback = text(n.callback_after, 20);
  return {
    outcome: text(n.outcome, 30) || 'done',
    headline: text(n.headline, 140),
    summary: text(n.summary, 2000),
    key_facts: Array.isArray(n.key_facts) ? n.key_facts.map((f) => text(f)).filter(Boolean).slice(0, 12) : [],
    appointments: Array.isArray(n.appointments) ? n.appointments.map(dated).filter((a) => a.title && a.date).slice(0, 5) : [],
    action_items: Array.isArray(n.action_items) ? n.action_items.map(dated).filter((a) => a.title).slice(0, 10) : [],
    callback_after: /^(1h|tomorrow|\d{4}-\d{2}-\d{2})$/.test(callback) ? callback : '',
    callback_time: TIME.test(n.callback_time) ? n.callback_time : '',
  };
}

async function summarize(s) {
  if (!s.transcript.length) {
    s.summary = { outcome: 'no_conversation', headline: s.goal ? s.goal.slice(0, 90) : 'No conversation was captured', summary: '', action_items: [] };
    emit(s, 'summary', { summary: s.summary });
    saveToHistory(s);
    return;
  }
  try {
    const text = await complete({
      usage: s.usage.claude,
      // Short calls don't need the bigger model: same quality notes, a fraction of the cost.
      model: s.transcript.length > 14 ? config.anthropic.smartModel : config.anthropic.fastModel,
      maxTokens: 700,
      timeoutMs: 30000,
      system:
        `You write post-call notes for ${s.ownerName || config.ownerName}'s personal assistant. Be factual; never invent details not in the transcript. ` +
        'appointments lists only things actually booked or agreed on the call that happen at a set day (and time, if one was agreed): use YYYY-MM-DD and 24-hour HH:mm, worked out from the owner\'s current date, and "" for an unknown time. ' +
        'action_items are follow-ups the owner still has to do; give each a due date only if one was said, and a 24-hour HH:mm time when an hour was said, else "". ' +
        'callback_after is set only when the call should be tried again later (no answer, busy, closed, asked to call back): "1h", "tomorrow" or a YYYY-MM-DD date; otherwise "". ' +
        'callback_time is the 24-hour HH:mm they asked to be called back, and "" when they did not name an hour. ' +
        'Reply ONLY with JSON: {"outcome":"done|needs_you|failed|no_answer|voicemail","headline":"<under 12 words>","summary":"<2-4 sentences>","key_facts":["dates, times, prices, names, reference numbers"],' +
        '"appointments":[{"title":"<e.g. Dentist cleaning at Bright Smiles>","date":"YYYY-MM-DD","time":"HH:mm or empty"}],' +
        '"action_items":[{"title":"<follow-up for ' + (s.ownerName || config.ownerName) + '>","date":"YYYY-MM-DD or empty","time":"HH:mm or empty"}],' +
        '"callback_after":"","callback_time":""}',
      prompt: `Owner's current date and time: ${s.localNow || new Date().toISOString()}\nCall to ${s.to}. Goal: ${s.goal || '(not given)'}\nAbout them: ${(s.about || '(none)').slice(0, 2000)}\nThis call: ${(s.brief || '(none)').slice(0, 8000)}
Plan objective: ${s.plan?.objective || '(none)'}\nMode: ${s.mode}
${s.agentOutcome ? `The AI agent reported the call as: ${s.agentOutcome.outcome}${s.agentOutcome.note ? ` (${s.agentOutcome.note})` : ''}\n` : ''}${s.voicemail ? 'This call reached VOICEMAIL: no person answered. outcome must be "voicemail". Say plainly that it went to voicemail and what message was left; never describe it as a conversation, and nothing was agreed or booked.\n' : ''}
Transcript:\n${transcriptText(s, 400)}`,
    });
    s.summary = normalizeSummary(parseJson(text)) || { outcome: 'done', headline: 'Call notes', summary: text, action_items: [] };
    if (s.voicemail) Object.assign(s.summary, { outcome: 'voicemail', appointments: [] });
    // Twilio can miss a machine; if the transcript shows a voicemail greeting, say so in the transcript too.
    else if (s.summary.outcome === 'voicemail') {
      markVoicemail(s);
      recordResult(s, ' (from the transcript)');
    }
  } catch (err) {
    console.error(`[summary] failed: ${err.message}`);
    s.summary = { outcome: 'unknown', headline: 'Summary unavailable', summary: err.message, action_items: [] };
  }
  emit(s, 'summary', { summary: s.summary });
  saveToHistory(s);
}
