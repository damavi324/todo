import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { config } from './config.js';
import { complete, parseJson } from './claude.js';

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
      hasPlan: !!h.plan, briefChars: (h.brief || '').length,
    }));
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

export function createSession({ mode, to, goal, brief, plan, owner, about }) {
  const s = {
    id: crypto.randomUUID(),
    mode, // 'copilot' | 'agent'
    to,
    ownerName: String(owner || '').trim().slice(0, 80) || config.ownerName,
    about: String(about || '').trim().slice(0, 8000),
    goal: (goal || '').trim(),
    brief: (brief || '').trim(),
    plan: plan || null,
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

// Safety net: a call Twilio never reported as finished is closed after the maximum call length,
// and finished calls are dropped from memory (they stay in history on disk).
setInterval(() => {
  const now = Date.now();
  const maxMs = (config.maxCallMinutes + 5) * 60 * 1000;
  for (const s of sessions.values()) {
    const age = now - Date.parse(s.startedAt);
    if (!s._finalized && age > maxMs) {
      slog(s, 'warn', `No final status from Twilio after ${Math.round(age / 60000)} minutes; closing the call record.`);
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
    .map((l) => `${l.speaker === 'you' ? (s.ownerName || config.ownerName) : l.speaker === 'agent' ? 'AI agent' : 'Other party'}: ${l.text}`)
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
export function finalize(s, reason = 'ended') {
  if (s._finalized) return;
  s._finalized = true;
  s.endedAt = new Date().toISOString();
  clearTimeout(s._suggest.timer);
  for (const fn of s._pendingAnswers.values()) fn('');
  s._pendingAnswers.clear();
  // flush partial lines that never got a final
  for (const [speaker, text] of Object.entries(s._partials)) if (text) addLine(s, speaker, text);
  setStatus(s, 'ended', reason);
  // give in-flight transcripts a moment to land, then summarize
  setTimeout(() => summarize(s), 1500);
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
      // Short calls don't need the bigger model: same quality notes, a fraction of the cost.
      model: s.transcript.length > 14 ? config.anthropic.smartModel : config.anthropic.fastModel,
      maxTokens: 700,
      timeoutMs: 30000,
      system:
        `You write post-call notes for ${s.ownerName || config.ownerName}'s personal assistant. Be factual; never invent details not in the transcript. ` +
        'Reply ONLY with JSON: {"outcome":"done|needs_you|failed|no_answer|voicemail","headline":"<under 12 words>","summary":"<2-4 sentences>","key_facts":["dates, times, prices, names, reference numbers"],"action_items":["<follow-ups for ' +
        (s.ownerName || config.ownerName) +
        '>"]}',
      prompt: `Call to ${s.to}. Goal: ${s.goal || '(not given)'}\nAbout them: ${(s.about || '(none)').slice(0, 2000)}\nThis call: ${(s.brief || '(none)').slice(0, 8000)}
Plan objective: ${s.plan?.objective || '(none)'}\nMode: ${s.mode}\n\nTranscript:\n${transcriptText(s, 400)}`,
    });
    s.summary = parseJson(text) || { outcome: 'done', headline: 'Call notes', summary: text, action_items: [] };
  } catch (err) {
    console.error(`[summary] failed: ${err.message}`);
    s.summary = { outcome: 'unknown', headline: 'Summary unavailable', summary: err.message, action_items: [] };
  }
  emit(s, 'summary', { summary: s.summary });
  saveToHistory(s);
}
