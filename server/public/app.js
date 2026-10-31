// CallPilot browser client: Twilio Voice SDK dialer + live view over a WebSocket.
const $ = (id) => document.getElementById(id);
const state = {
  owner: 'You',
  assistant: 'Assistant',
  device: null,
  deviceReady: false,
  call: null, // Twilio Call (browser leg)
  session: null, // current server session
  joinPending: false,
  timer: null,
  startedAt: null,
  questionId: null,
  pending: null,
  detail: null,
  detailId: null,
  ws: null,
};

// ---------- utilities ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, data: json });
  return json;
}

let toastTimer;
function toast(message, level = 'info') {
  const t = $('toast');
  t.textContent = message;
  t.dataset.level = level;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), level === 'error' ? 7000 : 3500);
}

function formatNumber(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || '';
}

function setDevice(stateName, text) {
  const el = $('deviceState');
  el.dataset.state = stateName;
  el.textContent = text;
}

// ---------- boot ----------
async function boot() {
  const health = await api('/api/health');
  state.owner = health.owner;
  state.assistant = health.assistant;
  if (health.needsPasscode && !health.authed) {
    $('login').hidden = false;
    $('passcode').focus();
    return;
  }
  renderSetup(health.problems);
  connectLive();
  loadHistory();
  await initDevice();
}

function renderSetup(problems) {
  const list = problems.filter((p) => !p.startsWith('APP_PASSCODE'));
  $('setup').hidden = list.length === 0;
  $('setupList').innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    li.textContent = p;
    $('setupList').append(li);
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { passcode: $('passcode').value });
    $('login').hidden = true;
    boot();
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').hidden = false;
  }
});

// ---------- Twilio Device ----------
async function initDevice() {
  updateCallButton();
  if (!window.Twilio?.Device) {
    setDevice('error', 'Phone library failed to load');
    return;
  }
  try {
    const { token } = await api('/api/token');
    const device = new Twilio.Device(token, {
      logLevel: 'error',
      codecPreferences: ['opus', 'pcmu'],
      closeProtection: 'A call is in progress. Leave anyway?',
    });
    device.on('registered', () => {
      state.deviceReady = true;
      setDevice('ready', 'Ready to call');
      updateCallButton();
    });
    device.on('unregistered', () => {
      state.deviceReady = false;
      setDevice('off', 'Phone line offline');
      updateCallButton();
    });
    device.on('error', (err) => {
      console.error(err);
      reportError(`Phone line error ${err.code || ''}: ${err.message || err}${err.explanation ? ` (${err.explanation})` : ''}`);
      setDevice('error', 'Phone line error');
      toast(`Phone: ${err.message || err}`, 'error');
    });
    device.on('tokenWillExpire', async () => {
      try {
        const { token: t } = await api('/api/token');
        device.updateToken(t);
      } catch {}
    });
    device.on('incoming', (call) => {
      // The only incoming call we expect is the agent handing a call to you.
      if (state.joinPending) {
        state.joinPending = false;
        call.accept();
        bindCall(call);
        showYouControls();
        toast('You are on the call');
      } else {
        // Another device asked to join; let this one stay quiet without ending the hand-off.
        call.ignore();
      }
    });
    await device.register();
    state.device = device;
  } catch (err) {
    setDevice('error', 'Phone line not set up');
    toast(err.message, 'error');
    reportError(`Phone line could not start: ${err.message}`);
  }
}

function bindCall(call) {
  state.call = call;
  call.on('accept', () => startTimer());
  call.on('disconnect', () => {
    state.call = null;
    if (state.session?.mode === 'copilot' || state.session?.joined) endedLocally();
  });
  call.on('cancel', () => endedLocally());
  call.on('reject', () => endedLocally());
  call.on('error', (err) => {
    toast(`Call: ${err.message}`, 'error');
    reportError(`Call error ${err.code || ''}: ${err.message}${err.explanation ? ` (${err.explanation})` : ''}`, { fatal: true });
  });
}

// ---------- live updates ----------
function connectLive() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ui`);
  state.ws = ws;
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connectLive, 1500);
}

function handleEvent(ev) {
  if (ev.type === 'log') return addLog(ev.entry);
  if (ev.type === 'call_log') {
    if (state.detailId === ev.sessionId) appendCallLog(ev.line);
    if (ev.line.level !== 'info') scheduleHistoryRefresh();
    return;
  }
  if (ev.type === 'status' && !(state.session && ev.sessionId === state.session.id)) return scheduleHistoryRefresh();
  if (!state.session || ev.sessionId !== state.session.id) return;
  switch (ev.type) {
    case 'status':
      setStatus(ev.status, ev.detail);
      break;
    case 'line':
      addLine(ev.line);
      break;
    case 'partial':
      $(`partial-${ev.speaker}`) && ($(`partial-${ev.speaker}`).textContent = ev.text);
      break;
    case 'suggestion':
      showSuggestion(ev.suggestion);
      break;
    case 'question':
      showQuestion(ev.question);
      break;
    case 'question_closed':
      if (ev.questionId === state.questionId) hideQuestion();
      break;
    case 'agent_state':
      showAgentState(ev.state, ev.detail);
      break;
    case 'summary':
      showSummary(ev.summary);
      break;
    case 'notice':
      toast(ev.message, ev.level === 'error' ? 'error' : 'info');
      break;
  }
}

const STATUS_TEXT = {
  starting: 'Starting',
  dialing: 'Dialing',
  queued: 'Dialing',
  initiated: 'Dialing',
  ringing: 'Ringing',
  live: 'Live',
  ended: 'Call ended',
  busy: 'Line busy',
  'no-answer': 'No answer',
  failed: 'Call failed',
  canceled: 'Canceled',
};
function setStatus(status, detail) {
  const bar = document.querySelector('.live-bar');
  bar.dataset.status = status === 'live' ? 'live' : status === 'ended' ? 'ended' : 'starting';
  $('statusText').textContent = STATUS_TEXT[status] || status;
  if (status === 'live' && !state.startedAt) startTimer();
  if (status === 'ended' || ['busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    stopTimer();
    $('agentControls').hidden = true;
    $('youControls').hidden = true;
    hideQuestion();
    if (detail && status === 'failed') toast(detail, 'error');
  }
}

function speakerName(s) {
  return s === 'you' ? 'You' : s === 'agent' ? state.assistant : 'Them';
}
function addLine(line) {
  const box = $('transcript');
  box.querySelector('.empty')?.remove();
  const p = document.createElement('p');
  p.className = `line ${line.speaker}`;
  const tag = document.createElement('span');
  tag.className = 'who-tag';
  tag.textContent = speakerName(line.speaker);
  p.append(tag, document.createTextNode(line.text));
  box.append(p);
  box.scrollTop = box.scrollHeight;
}

function showSuggestion(sg) {
  $('suggestion').hidden = false;
  const ul = $('suggestionSay');
  ul.innerHTML = '';
  for (const s of sg.say || []) {
    const li = document.createElement('li');
    li.textContent = s;
    ul.append(li);
  }
  $('suggestionNote').textContent = sg.note || '';
}

function showQuestion(q) {
  state.questionId = q.id;
  $('questionText').textContent = q.question;
  $('question').hidden = false;
  $('answer').value = '';
  $('answer').focus();
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  toast(`${state.assistant} needs an answer`);
}
function hideQuestion() {
  state.questionId = null;
  $('question').hidden = true;
}
async function sendAnswer(answer) {
  if (!state.questionId || !answer.trim()) return;
  const qid = state.questionId;
  hideQuestion();
  try {
    await api(`/api/sessions/${state.session.id}/answer`, { questionId: qid, answer });
  } catch (err) {
    toast(err.message, 'error');
  }
}
$('question').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAnswer($('answer').value);
});
$('question').querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => sendAnswer(b.dataset.quick)));

const AGENT_TEXT = {
  talking: () => `${state.assistant} is talking`,
  thinking: () => `${state.assistant} is thinking`,
  waiting_for_you: () => `${state.assistant} asked them to hold a moment and needs your answer`,
  pressing_keys: (d) => `${state.assistant} pressed ${d}`,
  handing_off: () => `Connecting you now`,
  you_are_on: () => `You're on the call. ${state.assistant} is listening and suggesting.`,
};
function showAgentState(s, detail) {
  const el = $('agentState');
  el.hidden = false;
  el.textContent = (AGENT_TEXT[s] || (() => s))(detail);
}

function showSummary(sm) {
  $('summary').hidden = false;
  $('activeCall').hidden = true;
  const outcome = $('summaryOutcome');
  outcome.dataset.outcome = sm.outcome || '';
  outcome.textContent = { done: 'Done', needs_you: 'Needs you', failed: 'Not completed', no_answer: 'No answer', voicemail: 'Left voicemail', no_conversation: 'No conversation' }[sm.outcome] || 'Call notes';
  $('summaryHeadline').textContent = sm.headline || 'Call notes';
  $('summaryBody').textContent = sm.summary || '';
  renderList($('summaryFacts'), 'Key details', sm.key_facts);
  renderList($('summaryActions'), 'Follow-ups', sm.action_items);
  loadHistory();
}
function renderList(container, title, items) {
  container.innerHTML = '';
  if (!items?.length) return;
  const h = document.createElement('h4');
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it;
    ul.append(li);
  }
  container.append(h, ul);
}

const BAD = new Set(['failed', 'busy', 'no-answer', 'canceled']);
let histTimer;
function scheduleHistoryRefresh() {
  clearTimeout(histTimer);
  histTimer = setTimeout(loadHistory, 600);
}
async function loadHistory() {
  try {
    const { history } = await api('/api/sessions');
    const ol = $('historyList');
    ol.innerHTML = '';
    if (!history.length) {
      ol.innerHTML = '<li class="muted">No calls yet.</li>';
      return;
    }
    for (const h of history.slice(0, 20)) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      const b = document.createElement('b');
      b.textContent = h.headline || h.goal || (h.mode === 'agent' ? 'AI call' : 'Call');
      const failed = BAD.has(h.status) || h.error || ['failed', 'no_answer'].includes(h.outcome);
      const tag = el('span', failed ? 'Failed' : h.status === 'ended' ? '' : h.status === 'live' ? 'Live' : '', `tag ${failed ? 'bad' : 'good'}`);
      if (tag.textContent) b.append(tag);
      const span = el('span', `${formatNumber(h.to)}, ${new Date(h.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${h.mode === 'agent' ? ', by the AI' : ''}`, 'muted');
      li.append(b, span);
      const open = () => openDetail(h.id);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      ol.append(li);
    }
  } catch {}
}

// ---------- one past call: details, its own log, redial ----------
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/\s?[AP]M$/i, '');
}
function appendCallLog(line) {
  const li = document.createElement('li');
  li.dataset.level = line.level;
  li.append(el('time', fmtTime(line.at)), el('span', line.text));
  $('detailLog').append(li);
  $('detailLog').scrollTop = $('detailLog').scrollHeight;
}
function hideAllViews() {
  ['newCall', 'planView', 'activeCall', 'summary', 'callDetail'].forEach((id) => ($(id).hidden = true));
}
async function openDetail(id) {
  let call;
  try {
    ({ call } = await api(`/api/sessions/${id}`));
  } catch (err) {
    return toast(err.message, 'error');
  }
  state.detail = call;
  state.detailId = id;
  if (!state.session || state.session.id !== id || ['ended', ...BAD].includes(state.session.status)) {
    hideAllViews();
  } else return; // live call is already on screen
  $('callDetail').hidden = false;
  $('detailMeta').textContent = `${formatNumber(call.to)} · ${call.mode === 'agent' ? 'AI made the call' : 'You talked'} · ${new Date(call.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  $('detailTitle').textContent = call.summary?.headline || call.goal || 'Call';
  const err = call.error || (BAD.has(call.status) ? `Call ${call.status}` : '');
  $('detailError').hidden = !err;
  $('detailError').textContent = err ? `Problem: ${err}` : '';
  const body = $('detailBody');
  body.innerHTML = '';
  if (call.goal) body.append(planSection('Goal', el('p', call.goal, 'small')));
  if (call.brief) body.append(planSection(`Details the AI used (${call.brief.length.toLocaleString()} characters)`, el('p', call.brief, 'detail-brief')));
  if (call.summary?.summary) body.append(planSection('Summary', el('p', call.summary.summary, 'small')));
  if (call.transcript?.length) {
    const ol = el('ol', null, 'call-log');
    call.transcript.slice(-40).forEach((l) => {
      const li = document.createElement('li');
      li.append(el('time', speakerName(l.speaker)), el('span', l.text));
      ol.append(li);
    });
    body.append(planSection('Transcript', ol));
  }
  $('detailRedial').textContent = call.mode === 'agent' && call.plan ? 'Redial with same plan' : 'Redial with same info';
  $('detailLog').innerHTML = '';
  (call.log || []).forEach(appendCallLog);
  if (!call.log?.length) $('detailLog').append(el('li', 'No log lines were recorded for this call.', 'muted'));
  $('leftPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function fillForm(call) {
  document.querySelector(`input[name=mode][value=${call.mode}]`).checked = true;
  document.querySelector(`input[name=mode][value=${call.mode}]`).dispatchEvent(new Event('change'));
  $('to').value = formatNumber(call.to);
  $('goal').value = call.goal || '';
  $('brief').value = call.brief || '';
  $('brief').dispatchEvent(new Event('input'));
}
$('detailBack').addEventListener('click', () => {
  state.detailId = null;
  resetToForm();
});
$('detailEdit').addEventListener('click', () => {
  fillForm(state.detail);
  state.detailId = null;
  hideAllViews();
  $('newCall').hidden = false;
  $('goal').focus();
});
$('detailRedial').addEventListener('click', async () => {
  const c = state.detail;
  if (!c) return;
  fillForm(c);
  state.detailId = null;
  const body = { mode: c.mode, to: c.to, goal: c.goal, brief: c.brief };
  if (c.mode === 'agent') {
    if (c.plan) {
      // Reuse the plan from last time: straight to review, one tap to call.
      state.pending = { ...body, plan: c.plan };
      hideAllViews();
      showPlan(c.plan, c.to);
    } else {
      hideAllViews();
      $('newCall').hidden = false;
      $('newCall').requestSubmit();
    }
    return;
  }
  hideAllViews();
  $('newCall').hidden = false;
  $('newCall').requestSubmit();
});

// ---------- logs drawer ----------
const logsState = { open: false, unseen: 0 };
function addLog(entry) {
  const li = document.createElement('li');
  li.dataset.level = entry.level;
  li.append(el('time', fmtTime(entry.at)), el('span', entry.text));
  const list = $('logsList');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(li);
  while (list.children.length > 1000) list.firstChild.remove();
  if (atBottom) list.scrollTop = list.scrollHeight;
  if (!logsState.open && entry.level !== 'info') {
    logsState.unseen++;
    $('logsBadge').textContent = String(logsState.unseen);
    $('logsBadge').hidden = false;
  }
}
async function openLogs() {
  logsState.open = true;
  logsState.unseen = 0;
  $('logsBadge').hidden = true;
  $('logs').hidden = false;
  $('logsBtn').setAttribute('aria-expanded', 'true');
  try {
    const { logs } = await api('/api/logs');
    $('logsList').innerHTML = '';
    logs.forEach(addLog);
    $('logsList').scrollTop = $('logsList').scrollHeight;
  } catch (err) {
    toast(err.message, 'error');
  }
}
function closeLogs() {
  logsState.open = false;
  $('logs').hidden = true;
  $('logsBtn').setAttribute('aria-expanded', 'false');
}
$('logsBtn').addEventListener('click', () => (logsState.open ? closeLogs() : openLogs()));
$('logsClose').addEventListener('click', closeLogs);
$('logsErrorsOnly').addEventListener('change', (e) => $('logs').classList.toggle('errors-only', e.target.checked));
$('logsCopy').addEventListener('click', async () => {
  const text = [...$('logsList').children].map((li) => `${li.dataset.level.toUpperCase()} ${li.textContent}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Logs copied');
  } catch {
    toast('Could not copy; select the text instead', 'error');
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && logsState.open) closeLogs(); });

// Send browser-side problems (phone line, mic, failed requests) to the server log.
function reportError(message, { sessionId, fatal } = {}) {
  const sid = sessionId || state.session?.id;
  const path = sid ? `/api/sessions/${sid}/client-error` : '/api/client-log';
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ level: 'error', message, fatal: !!fatal }) }).catch(() => {});
}

// ---------- timer ----------
function startTimer() {
  if (state.timer) return;
  state.startedAt = Date.now();
  state.timer = setInterval(() => {
    const s = Math.floor((Date.now() - state.startedAt) / 1000);
    $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}
function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

// ---------- start a call ----------
document.querySelectorAll('input[name=mode]').forEach((r) =>
  r.addEventListener('change', () => {
    const agent = r.value === 'agent' && r.checked;
    $('goalLabel').innerHTML = agent ? "What's the call for?" : "What's the call for? <em>optional</em>";
    $('goal').required = agent;
    $('callBtn').textContent = agent ? `Have ${state.assistant} call` : 'Call';
    updateCallButton();
  }),
);

function currentMode() {
  return document.querySelector('input[name=mode]:checked').value;
}
// "I'll talk" needs the browser phone line; "AI makes the call" only needs the server.
function updateCallButton() {
  $('callBtn').disabled = currentMode() === 'copilot' && !state.deviceReady;
  $('callBtn').title = $('callBtn').disabled ? 'Waiting for the phone line in this browser' : '';
}

$('newCall').addEventListener('submit', async (e) => {
  e.preventDefault();
  stopDictation();
  $('formError').hidden = true;
  const mode = currentMode();
  const body = { mode, to: $('to').value, goal: $('goal').value, brief: $('brief').value };
  const btn = $('callBtn');
  btn.disabled = true;
  try {
    if (mode === 'agent') {
      // Step 1: Claude reads the goal + details and writes the call plan for review.
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Writing the call plan…';
      const { plan } = await api('/api/plan', body);
      state.pending = { ...body, plan };
      showPlan(plan, body.to);
      return;
    }
    await startCall(body);
  } catch (err) {
    $('formError').textContent = err.message;
    $('formError').hidden = false;
    reportError(`Call form: ${err.message}`);
  } finally {
    btn.removeAttribute('aria-busy');
    btn.textContent = currentMode() === 'agent' ? `Have ${state.assistant} call` : 'Call';
    updateCallButton();
  }
});

async function startCall(body) {
  try {
    const { session } = await api('/api/sessions', body);
    state.session = session;
    showActive(session);
    scheduleHistoryRefresh();
    if (body.mode === 'copilot') {
      if (!state.device) throw new Error('Phone line is not ready');
      const call = await state.device.connect({ params: { To: session.to, sessionId: session.id } });
      bindCall(call);
      setStatus('ringing');
    }
  } catch (err) {
    if (state.session) {
      reportError(`Could not start the call: ${err.message}`, { sessionId: state.session.id, fatal: true });
      resetToForm();
    }
    throw err;
  }
}

// ---------- call plan review ----------
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function planSection(title, node) {
  const sec = el('section', null, 'plan-sec');
  sec.append(el('h4', title), node);
  return sec;
}
function listNode(items, ordered) {
  const l = el(ordered ? 'ol' : 'ul');
  items.forEach((t) => l.append(el('li', t)));
  return l;
}
function showPlan(plan, to) {
  $('newCall').hidden = true;
  $('callDetail').hidden = true;
  $('planView').hidden = false;
  $('planNumber').textContent = to;
  $('planObjective').textContent = plan.objective || 'Call plan';
  $('planOpening').textContent = `“Hi, this is ${state.assistant}, an AI assistant calling on behalf of ${state.owner}. ${plan.opening || ''}”`;
  const body = $('planBody');
  body.innerHTML = '';
  if (plan.steps?.length) body.append(planSection('How the call should go', listNode(plan.steps, true)));
  if (plan.facts_to_share?.length) {
    const dl = el('dl');
    plan.facts_to_share.forEach((f) => dl.append(el('dt', f.label), el('dd', f.value)));
    body.append(planSection('Can share', dl));
  }
  if (plan.can_agree_to?.length) body.append(planSection('Can agree to on its own', listNode(plan.can_agree_to)));
  if (plan.ask_owner_before?.length) body.append(planSection('Will ask you first', listNode(plan.ask_owner_before)));
  if (plan.never_share?.length) body.append(planSection('Will never share', listNode(plan.never_share)));
  if (plan.likely_questions?.length) {
    const dl = el('dl');
    plan.likely_questions.forEach((x) => dl.append(el('dt', x.q), el('dd', x.a || 'Will ask you')));
    body.append(planSection('If they ask', dl));
  }
  const extras = [];
  if (plan.if_phone_menu) extras.push(`Phone menu: ${plan.if_phone_menu}`);
  if (plan.if_voicemail) extras.push(`Voicemail: “${plan.if_voicemail}”`);
  if (plan.confirm_before_hanging_up?.length) extras.push(`Confirms before hanging up: ${plan.confirm_before_hanging_up.join(', ')}`);
  if (extras.length) body.append(planSection('Also', listNode(extras)));
  const miss = $('planMissing');
  miss.innerHTML = '';
  miss.hidden = !plan.missing_info?.length;
  if (plan.missing_info?.length) {
    miss.append(el('strong', 'Your details don’t cover these. Pilot will ask you if they come up, or add them now:'), listNode(plan.missing_info));
  }
  $('leftPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
$('planEdit').addEventListener('click', () => {
  $('planView').hidden = true;
  $('callDetail').hidden = true;
  $('newCall').hidden = false;
});
$('planCall').addEventListener('click', async () => {
  if (!state.pending) return;
  const btn = $('planCall');
  btn.disabled = true;
  try {
    await startCall(state.pending);
    $('planView').hidden = true;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- voice dictation (mic -> Deepgram via server) ----------
const dict = { active: null };
const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i){const c=i[0]&&i[0][0];if(c){const o=new Int16Array(c.length);for(let k=0;k<c.length;k++){const v=Math.max(-1,Math.min(1,c[k]));o[k]=v<0?v*32768:v*32767}this.b.push(o);this.n+=o.length;if(this.n>=2048){const a=new Int16Array(this.n);let p=0;for(const x of this.b){a.set(x,p);p+=x.length}this.port.postMessage(a.buffer,[a.buffer]);this.b=[];this.n=0}}return true}}registerProcessor('pcm16',P);`;

async function startDictation(btn) {
  if (dict.active) await stopDictation();
  const field = $(btn.dataset.target);
  if (!navigator.mediaDevices?.getUserMedia) return toast('This browser cannot use the microphone', 'error');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch {
    return toast('Allow microphone access to dictate', 'error');
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/dictate?rate=${ctx.sampleRate}`);
  ws.binaryType = 'arraybuffer';
  const base = field.value.replace(/\s+$/, '');
  const a = { btn, field, stream, ctx, ws, base, committed: '', node: null, src: null };
  dict.active = a;
  btn.setAttribute('aria-pressed', 'true');
  btn.querySelector('span').textContent = 'Stop';
  field.classList.add('listening');

  const render = (interim = '') => {
    const spoken = [a.committed, interim].filter(Boolean).join(' ');
    field.value = [a.base, spoken].filter(Boolean).join(a.base && spoken ? ' ' : '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.scrollTop = field.scrollHeight;
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'interim') render(m.text);
    else if (m.type === 'final') {
      if (m.text) a.committed = [a.committed, m.text].filter(Boolean).join(' ');
      render();
    } else if (m.type === 'error') {
      toast(m.message, 'error');
      stopDictation();
    }
  };
  ws.onclose = () => { if (dict.active === a) stopDictation(); };

  a.src = ctx.createMediaStreamSource(stream);
  const send = (buf) => { if (ws.readyState === 1) ws.send(buf); };
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    a.node = new AudioWorkletNode(ctx, 'pcm16');
    a.node.port.onmessage = (e) => send(e.data);
    a.src.connect(a.node);
  } catch {
    // Older browsers: ScriptProcessor fallback.
    a.node = ctx.createScriptProcessor(4096, 1, 1);
    a.node.onaudioprocess = (e) => {
      const c = e.inputBuffer.getChannelData(0);
      const o = new Int16Array(c.length);
      for (let k = 0; k < c.length; k++) { const v = Math.max(-1, Math.min(1, c[k])); o[k] = v < 0 ? v * 32768 : v * 32767; }
      send(o.buffer);
    };
    a.src.connect(a.node);
    a.node.connect(ctx.destination);
  }
}

async function stopDictation() {
  const a = dict.active;
  if (!a) return;
  dict.active = null;
  a.btn.setAttribute('aria-pressed', 'false');
  a.btn.querySelector('span').textContent = 'Speak';
  a.field.classList.remove('listening');
  try { a.src?.disconnect(); a.node?.disconnect(); } catch {}
  a.stream.getTracks().forEach((t) => t.stop());
  a.ctx.close().catch(() => {});
  // Give Deepgram a moment to return the last words before closing.
  setTimeout(() => { try { a.ws.close(); } catch {} }, 1200);
}

document.querySelectorAll('.mic').forEach((btn) =>
  btn.addEventListener('click', () => (dict.active?.btn === btn ? stopDictation() : startDictation(btn))),
);
// Typing while dictating stops the mic so the two don't fight.
['goal', 'brief'].forEach((id) =>
  $(id).addEventListener('keydown', () => { if (dict.active?.field.id === id) stopDictation(); }),
);
// Character count for long details.
$('brief').addEventListener('input', () => {
  const n = $('brief').value.length;
  $('briefCount').textContent = n > 200 ? `${n.toLocaleString()} characters` : '';
});

function showActive(session) {
  $('callDetail').hidden = true;
  state.detailId = null;
  $('newCall').hidden = true;
  $('summary').hidden = true;
  $('activeCall').hidden = false;
  $('activeNumber').textContent = formatNumber(session.to);
  $('activeGoal').textContent = session.goal || '';
  $('agentState').hidden = true;
  $('youControls').hidden = session.mode !== 'copilot';
  $('agentControls').hidden = session.mode !== 'agent';
  $('keypad').hidden = true;
  $('suggestion').hidden = true;
  $('transcript').innerHTML = '<p class="empty">The conversation shows up here as it happens.</p>';
  $('partial-them').textContent = '';
  $('partial-you').textContent = '';
  $('timer').textContent = '0:00';
  state.startedAt = null;
  setStatus(session.status || 'starting');
}

function showYouControls() {
  $('agentControls').hidden = true;
  $('youControls').hidden = false;
  state.session.joined = true;
}

function endedLocally() {
  stopTimer();
  $('youControls').hidden = true;
  $('agentControls').hidden = true;
}

function resetToForm() {
  state.session = null;
  state.call = null;
  stopTimer();
  $('activeCall').hidden = true;
  $('summary').hidden = true;
  $('planView').hidden = true;
  $('callDetail').hidden = true;
  $('newCall').hidden = false;
}

// ---------- in-call controls ----------
$('hangupBtn').addEventListener('click', async () => {
  if (state.call) state.call.disconnect();
  else if (state.session) await api(`/api/sessions/${state.session.id}/hangup`, {}).catch(() => {});
});
$('agentHangupBtn').addEventListener('click', async () => {
  if (!state.session) return;
  await api(`/api/sessions/${state.session.id}/hangup`, {}).catch((err) => toast(err.message, 'error'));
});
$('joinBtn').addEventListener('click', async () => {
  if (!state.session || !state.device) return toast('Phone line is not ready', 'error');
  state.joinPending = true;
  $('joinBtn').disabled = true;
  try {
    await api(`/api/sessions/${state.session.id}/join`, {});
  } catch (err) {
    state.joinPending = false;
    toast(err.message, 'error');
  } finally {
    $('joinBtn').disabled = false;
  }
});
$('muteBtn').addEventListener('click', () => {
  if (!state.call) return;
  const muted = !state.call.isMuted();
  state.call.mute(muted);
  $('muteBtn').setAttribute('aria-pressed', String(muted));
  $('muteBtn').textContent = muted ? 'Unmute' : 'Mute';
});
$('keypadBtn').addEventListener('click', () => {
  const open = $('keypad').hidden;
  $('keypad').hidden = !open;
  $('keypadBtn').setAttribute('aria-expanded', String(open));
});
$('keypad').addEventListener('click', (e) => {
  const d = e.target.closest('button')?.textContent;
  if (d && state.call) state.call.sendDigits(d);
});
$('newCallBtn').addEventListener('click', resetToForm);

boot().catch((err) => toast(err.message, 'error'));
