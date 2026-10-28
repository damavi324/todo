// End-to-end simulation with mock Twilio, Deepgram (STT + Voice Agent) and Claude.
// Exercises: auth, token, TwiML, copilot transcription + suggestions + summary,
// agent call creation, agent audio relay, barge-in, ask_owner round-trip,
// press_digits tones, finish_call hangup, join-call TwiML.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = { app: 5591, stt: 5592, agent: 5593, claude: 5594, twilio: 5595 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pass = (m) => { results.push(m); console.log('  ✔', m); };

// ---------------- mocks ----------------
const twilioCalls = [];
let callCounter = 0;
const twilioServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const params = new URLSearchParams(body);
    twilioCalls.push({ url: req.url, params, auth: req.headers.authorization });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    const sid = req.url.endsWith('/Calls.json') ? `CA_AGENT_${++callCounter}` : 'CA_OTHER';
    res.end(JSON.stringify({ sid, status: 'queued' }));
  });
}).listen(PORTS.twilio);

const claudeRequests = [];
const claudeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body);
    claudeRequests.push({ json, headers: req.headers });
    const isSummary = /post-call/.test(json.system);
    const isPlan = /call planner/.test(json.system);
    const isAssistant = /voice front door/.test(json.system);
    const text = isAssistant
      ? '{"kind":"both","task":{"title":"Call the dentist","notes":"","dueDate":"2026-10-30","dueTime":"09:00","priority":"medium","listId":"personal"},"call":{"to":"(214) 555-0100","contact":"Bright Smiles Dental","goal":"Move the cleaning to a weekday morning","details":"Patient: Manoj Khanal","mode":"agent","when":"later"},"say":"Reminder Friday 9am to have Pilot call the dentist.","question":""}'
      : isPlan
      ? 'Here is the plan:\n{"objective":"Move the cleaning to a weekday morning next week","opening":"I\'m calling to reschedule a cleaning for Mk Khanal.","steps":["Explain the reason","Offer Tue-Thu 8-11am"],"facts_to_share":[{"label":"Patient","value":"Mk Khanal"},{"label":"Bad","value":""}],"can_agree_to":["Any Tue-Thu slot 8-11am"],"ask_owner_before":["Any fee"],"never_share":["Card number"],"likely_questions":[{"q":"Date of birth?","a":"Ask Mk"}],"if_phone_menu":"Press 2 for appointments","if_voicemail":"Hi, this is Pilot for Mk Khanal about rescheduling.","confirm_before_hanging_up":["date","time"],"missing_info":["Insurance provider"]}'
      : isSummary
      ? '{"outcome":"done","headline":"Cleaning moved to Tue 9am","summary":"The office moved the appointment.","key_facts":["Tue 9:00 am"],"action_items":["Add to calendar"]}'
      : '```json\n{"say":["Could you do Tuesday at 9am?"],"note":"They mentioned a $25 fee"}\n```';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  });
}).listen(PORTS.claude);

const sttConnections = [];
const sttServer = new WebSocketServer({ port: PORTS.stt });
sttServer.on('connection', (ws, req) => {
  const conn = { url: req.url, auth: req.headers.authorization, bytes: 0, said: false };
  sttConnections.push(conn);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    conn.bytes += data.length;
    if (!conn.said && conn.bytes >= 1600) {
      conn.said = true;
      const idx = sttConnections.indexOf(conn);
      const text = idx % 2 === 0 ? 'Hi, I need to move my cleaning' : 'Sure, we have Tuesday or Wednesday';
      ws.send(JSON.stringify({ type: 'Results', is_final: false, speech_final: false, channel: { alternatives: [{ transcript: text.split(' ').slice(0, 3).join(' ') }] } }));
      ws.send(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: text }] } }));
    }
  });
});

const agentLog = { settings: null, auth: null, audioBytes: 0, responses: [], keepAlives: 0, injected: [] };
const agentServer = new WebSocketServer({ port: PORTS.agent });
agentServer.on('connection', (ws, req) => {
  agentLog.auth = req.headers.authorization;
  ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r1' }));
  let started = false;
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      agentLog.audioBytes += data.length;
      if (!started && agentLog.audioBytes >= 800) {
        started = true;
        ws.send(JSON.stringify({ type: 'ConversationText', role: 'user', content: 'Hello, Bright Smiles Dental.' }));
        ws.send(JSON.stringify({ type: 'AgentStartedSpeaking' }));
        ws.send(Buffer.alloc(320, 0x7f)); // agent audio
        ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'Hi, I am calling to move a cleaning.' }));
        ws.send(JSON.stringify({ type: 'UserStartedSpeaking' }));
        ws.send(JSON.stringify({ type: 'FunctionCallRequest', functions: [{ id: 'fc_1', name: 'ask_owner', arguments: '{"question":"Is Tuesday 9am OK?"}', client_side: true }] }));
      }
      return;
    }
    const msg = JSON.parse(data.toString());
    if (msg.type === 'Settings') {
      agentLog.settings = msg;
      ws.send(JSON.stringify({ type: 'SettingsApplied' }));
    } else if (msg.type === 'KeepAlive') agentLog.keepAlives++;
    else if (msg.type === 'InjectAgentMessage') agentLog.injected.push(msg.message);
    else if (msg.type === 'FunctionCallResponse') {
      agentLog.responses.push(msg);
      if (msg.name === 'ask_owner') {
        ws.send(JSON.stringify({ type: 'FunctionCallRequest', functions: [{ id: 'fc_2', name: 'press_digits', arguments: '{"digits":"2"}', client_side: true }] }));
      } else if (msg.name === 'press_digits') {
        ws.send(JSON.stringify({ type: 'FunctionCallRequest', functions: [{ id: 'fc_3', name: 'finish_call', arguments: '{"outcome":"done","note":"booked"}', client_side: true }] }));
      }
    }
  });
});

// ---------------- app ----------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'callpilot-'));
const envFile = path.join(tmp, 'test.env');
fs.writeFileSync(envFile, '');
const env = {
  ...process.env,
  CALLPILOT_ENV_FILE: envFile,
  CALLPILOT_DATA_DIR: path.join(tmp, 'data'),
  PORT: String(PORTS.app),
  PUBLIC_HOST: `localhost:${PORTS.app}`,
  APP_PASSCODE: 'letmein',
  OWNER_NAME: 'Mk',
  ASSISTANT_NAME: 'Pilot',
  CLIENT_IDENTITY: 'owner',
  TWILIO_ACCOUNT_SID: 'AC_TEST',
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_API_KEY_SID: 'SK_TEST',
  TWILIO_API_KEY_SECRET: 'secret',
  TWILIO_TWIML_APP_SID: 'AP_TEST',
  TWILIO_PHONE_NUMBER: '+19405550100',
  TWILIO_API_BASE: `http://localhost:${PORTS.twilio}`,
  DEEPGRAM_API_KEY: 'dg_test',
  DEEPGRAM_LISTEN_URL: `ws://localhost:${PORTS.stt}/v1/listen`,
  DEEPGRAM_AGENT_URL: `ws://localhost:${PORTS.agent}/v1/agent/converse`,
  ANTHROPIC_API_KEY: 'sk-ant-test',
  ANTHROPIC_BASE_URL: `http://localhost:${PORTS.claude}`,
};
const app = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let appOut = '';
app.stdout.on('data', (d) => (appOut += d));
app.stderr.on('data', (d) => (appOut += d));

const base = `http://localhost:${PORTS.app}`;
let cookie = '';
async function req(p, { method = 'GET', body, form, noSign } = {}) {
  const headers = { cookie };
  let payload;
  if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  if (p.startsWith('/twilio/') && !noSign) {
    const data = Object.keys(form || {}).sort().reduce((a, k) => a + k + form[k], `https://localhost:${PORTS.app}${p}`);
    headers['X-Twilio-Signature'] = crypto.createHmac('sha1', 'tok').update(data).digest('base64');
  }
  const res = await fetch(base + p, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

function uiSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORTS.app}/ui`, { headers: { cookie } });
    const events = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, events }));
    ws.on('error', reject);
  });
}
async function waitFor(fn, label, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for: ${label}\n--- app log ---\n${appOut}`);
}
const silence = (n = 160) => Buffer.alloc(n, 0xff).toString('base64');

try {
  console.log('\nCallPilot simulation\n');
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/health'); break; } catch { await sleep(50); } }

  // ---- auth ----
  let r = await req('/api/token');
  assert.equal(r.status, 401);
  r = await req('/api/login', { method: 'POST', body: { passcode: 'nope' } });
  assert.equal(r.status, 401);
  r = await req('/api/login', { method: 'POST', body: { passcode: 'letmein' } });
  assert.equal(r.status, 200);
  pass('Passcode login protects the API');

  r = await req('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /CallPilot/);
  r = await req('/app.js');
  assert.equal(r.status, 200);
  r = await req('/../src/config.js');
  assert.notEqual(r.status, 200);
  pass('Serves the web app and blocks path traversal');

  // ---- token ----
  r = await req('/api/token');
  assert.equal(r.status, 200);
  const [h, p] = r.json.token.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString()));
  assert.equal(h.cty, 'twilio-fpa;v=1');
  assert.equal(p.iss, 'SK_TEST');
  assert.equal(p.sub, 'AC_TEST');
  assert.equal(p.grants.identity, 'owner');
  assert.equal(p.grants.voice.outgoing.application_sid, 'AP_TEST');
  assert.equal(p.grants.voice.incoming.allow, true);
  pass('Issues a Twilio Voice access token with outgoing + incoming grants');

  const ui = await uiSocket();

  // ---- copilot call ----
  r = await req('/api/sessions', { method: 'POST', body: { mode: 'copilot', to: '(214) 555-0123', goal: 'Move cleaning', brief: 'Free Tue-Thu mornings' } });
  assert.equal(r.status, 200);
  const cop = r.json.session;
  assert.equal(cop.to, '+12145550123');
  pass('Normalizes the dialed number to E.164');

  r = await req('/twilio/outgoing', { method: 'POST', form: { To: cop.to, sessionId: cop.id, CallSid: 'CA_BROWSER_1', From: 'client:owner' } });
  assert.match(r.text, /<Start><Stream url="wss:\/\/localhost:5591\/streams\/listen" track="both_tracks">/);
  assert.match(r.text, /<Parameter name="sessionId" value="[0-9a-f-]+"\/>/);
  assert.match(r.text, /<Dial callerId="\+19405550100" answerOnBridge="true" timeLimit="1800" action="https:\/\/localhost:5591\/twilio\/dial-done\?sessionId=/);
  assert.match(r.text, /<Number statusCallbackEvent="answered completed"[^>]*>\+12145550123<\/Number>/);
  pass('TwiML for in-app dialing: stream both sides, then dial with caller ID');

  r = await req('/twilio/outgoing', { method: 'POST', form: { To: cop.to, sessionId: cop.id }, noSign: true });
  assert.equal(r.status, 403);
  r = await req(`/twilio/status?sessionId=${cop.id}`, { method: 'POST', form: { CallSid: 'CA_X', CallStatus: 'completed' }, noSign: true });
  assert.equal(r.status, 403);
  pass('Twilio webhooks without a valid Twilio signature are blocked');

  r = await req('/twilio/outgoing', { method: 'POST', form: { To: 'abc', sessionId: cop.id } });
  assert.match(r.text, /<Say>Sorry, that number is not valid.<\/Say>/);
  pass('Rejects an invalid number in TwiML');

  await req(`/twilio/status?sessionId=${cop.id}`, { method: 'POST', form: { CallSid: 'CA_CHILD', CallStatus: 'in-progress' } });
  await waitFor(() => ui.events.find((e) => e.sessionId === cop.id && e.type === 'status' && e.status === 'live'), 'copilot live status');
  pass('Marks the call live when the other side answers');

  const listen = new WebSocket(`ws://localhost:${PORTS.app}/streams/listen`);
  await new Promise((res) => listen.on('open', res));
  listen.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
  listen.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ1', callSid: 'CA_BROWSER_1', tracks: ['inbound', 'outbound'], customParameters: { sessionId: cop.id, inboundSpeaker: 'you' } } }));
  for (let i = 0; i < 15; i++) {
    listen.send(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: silence() } }));
    listen.send(JSON.stringify({ event: 'media', media: { track: 'outbound', payload: silence() } }));
  }
  await waitFor(() => sttConnections.length >= 2 && sttConnections.every((c) => c.bytes > 0), 'audio reaches both transcribers');
  assert.ok(sttConnections[0].url.includes('encoding=mulaw') && sttConnections[0].url.includes('sample_rate=8000'));
  assert.equal(sttConnections[0].auth, 'Token dg_test');
  pass('Streams each side of the call to its own Deepgram transcriber (mulaw 8 kHz)');

  await waitFor(() => ui.events.find((e) => e.type === 'partial' && e.sessionId === cop.id && e.text), 'interim partial');
  const youLine = await waitFor(() => ui.events.find((e) => e.type === 'line' && e.line.speaker === 'you'), 'you line');
  const themLine = await waitFor(() => ui.events.find((e) => e.type === 'line' && e.line.speaker === 'them'), 'them line');
  assert.match(youLine.line.text, /move my cleaning/);
  assert.match(themLine.line.text, /Tuesday or Wednesday/);
  pass('Live transcript: interim words, then finished lines labelled You and Them');

  const sug = await waitFor(() => ui.events.find((e) => e.type === 'suggestion' && e.sessionId === cop.id), 'suggestion');
  assert.deepEqual(sug.suggestion.say, ['Could you do Tuesday at 9am?']);
  assert.equal(sug.suggestion.note, 'They mentioned a $25 fee');
  const cReq = claudeRequests.find((c) => /copilot/.test(c.json.system));
  assert.equal(cReq.json.model, 'claude-haiku-5-5');
  assert.equal(cReq.headers['x-api-key'], 'sk-ant-test');
  assert.equal(cReq.headers['anthropic-version'], '2023-06-01');
  assert.match(cReq.json.messages[0].content, /Tuesday or Wednesday/);
  pass('Claude suggestion card after the other side speaks (fenced JSON parsed)');

  listen.send(JSON.stringify({ event: 'stop', stop: { callSid: 'CA_BROWSER_1' } }));
  listen.close();
  await req(`/twilio/dial-done?sessionId=${cop.id}`, { method: 'POST', form: { DialCallStatus: 'completed' } });
  const sum = await waitFor(() => ui.events.find((e) => e.type === 'summary' && e.sessionId === cop.id), 'summary', 6000);
  assert.equal(sum.summary.headline, 'Cleaning moved to Tue 9am');
  assert.ok(claudeRequests.some((c) => /post-call/.test(c.json.system) && c.json.model === 'claude-haiku-5-5'), 'short call summarized with the fast model');
  r = await req('/api/sessions');
  assert.ok(r.json.history.some((h) => h.id === cop.id && h.headline === 'Cleaning moved to Tue 9am'));
  pass('Post-call summary with Claude, saved to call history');

  // ---- dictation ----
  const dws = new WebSocket(`ws://localhost:${PORTS.app}/dictate?rate=16000`, { headers: { cookie } });
  const dmsgs = [];
  dws.on('message', (d) => dmsgs.push(JSON.parse(d.toString())));
  await new Promise((res) => dws.on('open', res));
  dws.send(Buffer.alloc(4000));
  const dfinal = await waitFor(() => dmsgs.find((m) => m.type === 'final'), 'dictation final');
  assert.ok(dfinal.text.length > 0);
  assert.ok(dmsgs.some((m) => m.type === 'interim'));
  const dconn = sttConnections.at(-1);
  assert.ok(dconn.url.includes('encoding=linear16') && dconn.url.includes('sample_rate=16000'));
  dws.close();
  const dbad = new WebSocket(`ws://localhost:${PORTS.app}/dictate?rate=16000`);
  assert.ok(await new Promise((res) => { dbad.on('error', () => res(true)); dbad.on('open', () => res(false)); }));
  pass('Dictation: mic audio (16-bit PCM) streams to Deepgram, text comes back live; passcode required');

  // ---- call plan ----
  const longDetails = 'I am Mk Khanal. '.repeat(1500);
  r = await req('/api/plan', { method: 'POST', body: { to: '2145550199', goal: '', brief: 'x' } });
  assert.equal(r.status, 400);
  r = await req('/api/plan', { method: 'POST', body: { to: '2145550199', goal: 'Reschedule cleaning', brief: longDetails } });
  assert.equal(r.status, 200);
  const plan = r.json.plan;
  assert.equal(plan.objective, 'Move the cleaning to a weekday morning next week');
  assert.equal(plan.facts_to_share.length, 1, 'empty facts dropped');
  assert.deepEqual(plan.missing_info, ['Insurance provider']);
  const planReq = claudeRequests.find((c) => /call planner/.test(c.json.system));
  assert.equal(planReq.json.model, 'claude-sonnet-5-5');
  assert.ok(planReq.json.messages[0].content.length > 20000, 'long details reach the planner');
  pass('Call plan: Claude turns goal + long details (24k chars) into a structured plan');

  // ---- agent call ----
  r = await req('/api/sessions', { method: 'POST', body: { mode: 'agent', to: '+12145550199' } });
  assert.equal(r.status, 400);
  r = await req('/api/sessions', { method: 'POST', body: { mode: 'agent', to: '+12145550199', goal: 'Reschedule cleaning to Tue morning', brief: 'Patient: Mk Khanal' } });
  assert.equal(r.status, 200);
  const ag = r.json.session;
  const create = twilioCalls.find((c) => c.url.endsWith('/Calls.json'));
  assert.ok(create, 'Twilio create call');
  assert.equal(create.url, '/2010-04-01/Accounts/AC_TEST/Calls.json');
  assert.equal(create.params.get('To'), '+12145550199');
  assert.equal(create.params.get('From'), '+19405550100');
  assert.match(create.params.get('Twiml'), /<Connect><Stream url="wss:\/\/localhost:5591\/streams\/agent">/);
  assert.deepEqual(create.params.getAll('StatusCallbackEvent'), ['initiated', 'ringing', 'answered', 'completed']);
  assert.equal(create.auth, 'Basic ' + Buffer.from('AC_TEST:tok').toString('base64'));
  pass('Agent mode places the call via Twilio REST with a bidirectional stream');

  const tw = new WebSocket(`ws://localhost:${PORTS.app}/streams/agent`);
  const toTwilio = [];
  tw.on('message', (d) => toTwilio.push(JSON.parse(d.toString())));
  await new Promise((res) => tw.on('open', res));
  tw.send(JSON.stringify({ event: 'connected' }));
  tw.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ_AGENT', callSid: 'CA_AGENT_1', customParameters: { sessionId: ag.id } } }));
  for (let i = 0; i < 8; i++) tw.send(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: silence() } }));

  await waitFor(() => agentLog.settings, 'agent settings');
  const st = agentLog.settings;
  assert.equal(agentLog.auth, 'Token dg_test');
  assert.deepEqual(st.audio.input, { encoding: 'mulaw', sample_rate: 8000 });
  assert.deepEqual(st.audio.output, { encoding: 'mulaw', sample_rate: 8000, container: 'none' });
  assert.deepEqual(st.agent.listen.provider, { type: 'deepgram', model: 'flux-general-en', version: 'v2' });
  assert.deepEqual(st.agent.speak.provider, { type: 'deepgram', version: 'v2', model: 'flux-alexis-en', speed: 1.05, expressivity: 1 });
  assert.match(st.agent.think.prompt, /usually one sentence, at most two/);
  assert.deepEqual(st.agent.think.provider, { type: 'anthropic', model: 'claude-haiku-4-5' });
  assert.deepEqual(st.agent.think.functions.map((f) => f.name), ['ask_owner', 'press_digits', 'finish_call']);
  assert.match(st.agent.greeting, /^Hi, this is Pilot, an AI assistant calling on behalf of Mk\. This call is being transcribed\.$/);
  assert.match(st.agent.think.prompt, /Reschedule cleaning to Tue morning/);
  pass('Voice agent configured: Flux listen/speak, Claude brain, tools, fixed AI disclosure greeting');

  await waitFor(() => agentLog.audioBytes >= 800, 'caller audio to agent');
  pass('Caller audio is relayed to the agent after SettingsApplied');

  await waitFor(() => toTwilio.find((m) => m.event === 'media'), 'agent audio to twilio');
  const media = toTwilio.find((m) => m.event === 'media');
  assert.equal(media.streamSid, 'MZ_AGENT');
  assert.equal(Buffer.from(media.media.payload, 'base64').length, 320);
  await waitFor(() => toTwilio.find((m) => m.event === 'clear'), 'barge-in clear');
  pass('Agent voice is played into the call; barge-in clears queued audio');

  await waitFor(() => ui.events.find((e) => e.type === 'line' && e.sessionId === ag.id && e.line.speaker === 'them'), 'them line (agent)');
  await waitFor(() => ui.events.find((e) => e.type === 'line' && e.sessionId === ag.id && e.line.speaker === 'agent'), 'agent line');
  pass('Agent conversation is transcribed live in the app');

  const q = await waitFor(() => ui.events.find((e) => e.type === 'question' && e.sessionId === ag.id), 'question to owner');
  assert.equal(q.question.question, 'Is Tuesday 9am OK?');
  r = await req(`/api/sessions/${ag.id}/answer`, { method: 'POST', body: { questionId: q.question.id, answer: 'Yes, book it' } });
  assert.equal(r.status, 200);
  const askResp = await waitFor(() => agentLog.responses.find((x) => x.name === 'ask_owner'), 'ask_owner response');
  assert.equal(askResp.id, 'fc_1');
  assert.equal(askResp.content, 'Mk says: Yes, book it');
  r = await req(`/api/sessions/${ag.id}/answer`, { method: 'POST', body: { questionId: q.question.id, answer: 'again' } });
  assert.equal(r.status, 410);
  pass('Agent asks you mid-call; your typed answer goes back to it (once)');

  const pressResp = await waitFor(() => agentLog.responses.find((x) => x.name === 'press_digits'), 'press_digits response');
  assert.equal(pressResp.id, 'fc_2');
  const toneFrames = toTwilio.filter((m) => m.event === 'media').length;
  assert.ok(toneFrames > 10, 'DTMF frames sent');
  pass(`Agent presses keypad tones on phone menus (${toneFrames} audio frames sent)`);

  const finResp = await waitFor(() => agentLog.responses.find((x) => x.name === 'finish_call'), 'finish_call response');
  assert.equal(finResp.id, 'fc_3');
  const mark = await waitFor(() => toTwilio.find((m) => m.event === 'mark'), 'mark');
  assert.equal(mark.mark.name, 'hangup');
  tw.send(JSON.stringify({ event: 'mark', streamSid: 'MZ_AGENT', mark: { name: 'hangup' } }));
  const hang = await waitFor(() => twilioCalls.find((c) => c.url.endsWith('/Calls/CA_AGENT_1.json') && c.params.get('Status') === 'completed'), 'hangup');
  assert.ok(hang);
  pass('Agent says goodbye, waits for playback to finish, then hangs up');

  await req(`/twilio/status?sessionId=${ag.id}`, { method: 'POST', form: { CallSid: 'CA_AGENT_1', CallStatus: 'completed' } });
  await waitFor(() => ui.events.find((e) => e.type === 'summary' && e.sessionId === ag.id), 'agent summary', 6000);
  pass('Agent call ends with a summary');
  tw.close();

  // ---- join flow ----
  r = await req('/api/sessions', { method: 'POST', body: { mode: 'agent', to: '+12145550177', goal: 'Reschedule cleaning', brief: longDetails, plan } });
  const ag2 = r.json.session;
  const tw2 = new WebSocket(`ws://localhost:${PORTS.app}/streams/agent`);
  await new Promise((res) => tw2.on('open', res));
  tw2.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ_2', callSid: 'CA_AGENT_2', customParameters: { sessionId: ag2.id } } }));
  await waitFor(() => agentLog.settings?.agent?.greeting?.includes('reschedule a cleaning'), 'plan settings');
  const st2 = agentLog.settings.agent;
  assert.equal(st2.greeting, "Hi, this is Pilot, an AI assistant calling on behalf of Mk. This call is being transcribed. I'm calling to reschedule a cleaning for Mk Khanal.");
  assert.match(st2.think.prompt, /CALL PLAN \(a guide, not a script/);
  assert.match(st2.think.prompt, /Check with Mk \(ask_owner\) before:\n- Any fee/);
  assert.match(st2.think.prompt, /If you hit a phone menu: Press 2 for appointments/);
  assert.ok(st2.think.prompt.length < 16000, `prompt stays compact (${st2.think.prompt.length} chars)`);
  pass('Agent uses the plan: opening line after the AI disclosure, plan as guidance, long details capped');
  r = await req(`/api/sessions/${ag2.id}/join`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  const upd = twilioCalls.find((c) => c.url.endsWith('/Calls/CA_AGENT_2.json'));
  assert.match(upd.params.get('Twiml'), /<Parameter name="inboundSpeaker" value="them"\/>/);
  assert.match(upd.params.get('Twiml'), /<Dial><Client>owner<\/Client><\/Dial>/);
  assert.ok(agentLog.injected.some((m) => /connecting Mk/.test(m)));
  pass('Join call: agent tells them it is connecting you, then bridges the call to your app');
  tw2.close();

  // ---- call records, per-call logs, logs panel ----
  r = await req(`/api/sessions/${ag2.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.call.goal, 'Reschedule cleaning');
  assert.equal(r.json.call.brief, longDetails.trim());
  assert.equal(r.json.call.plan.objective, plan.objective);
  assert.ok(r.json.call.log.some((l) => /Created AI agent call/.test(l.text)));
  pass('Each call keeps its number, goal, full details and plan, ready to redial');

  r = await req('/api/sessions', { method: 'POST', body: { mode: 'copilot', to: '2145550111', goal: 'Test failure', brief: 'Some details' } });
  const fail = r.json.session;
  r = await req(`/api/sessions/${fail.id}/client-error`, { method: 'POST', body: { message: 'Call error 31005: Connection error', fatal: true } });
  assert.equal(r.status, 200);
  await sleep(2200);
  r = await req(`/api/sessions/${fail.id}`);
  assert.equal(r.json.call.status !== 'live', true);
  assert.match(r.json.call.error, /31005/);
  assert.ok(r.json.call.log.some((l) => l.level === 'error' && /Browser: Call error 31005/.test(l.text)));
  r = await req('/api/sessions');
  const failedEntry = r.json.history.find((h) => h.id === fail.id);
  assert.ok(failedEntry && failedEntry.error && failedEntry.goal === 'Test failure');
  assert.equal(failedEntry.brief, undefined, 'list stays light');
  pass('Failed calls are saved with the error and their own log (browser errors included)');

  await req(`/twilio/dial-done?sessionId=${cop.id}`, { method: 'POST', form: { DialCallStatus: 'failed', ErrorCode: '13227' } });
  r = await req('/api/logs');
  const texts = r.json.logs.map((l) => l.text).join('\n');
  assert.match(texts, /Created you-talk call/);
  assert.match(texts, /Twilio dial finished: failed error 13227/);
  assert.match(texts, /\[agent\] tool: ask_owner/);
  assert.ok(!texts.includes('sk-ant-test') && !texts.includes('dg_test'), 'secrets redacted');
  assert.ok(ui.events.some((e) => e.type === 'log'));
  assert.ok(ui.events.some((e) => e.type === 'call_log' && e.sessionId === fail.id));
  const logFile = fs.readFileSync(path.join(tmp, 'data', 'server.log'), 'utf8');
  assert.match(logFile, /Twilio dial finished: failed error 13227/);
  pass('Logs panel: every backend event streams live, is saved to data/server.log, secrets redacted');

  // ---- phone app access: token, CORS, assistant, TwiML auto-config ----
  const loginRes = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' }, body: JSON.stringify({ passcode: 'letmein' }) });
  const { token } = await loginRes.json();
  assert.ok(token && token.length > 20);
  const pre = await fetch(base + '/api/sessions', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  let br = await fetch(base + '/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(br.status, 200);
  br = await fetch(base + '/api/sessions', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(br.status, 401);
  const tws = new WebSocket(`ws://localhost:${PORTS.app}/ui?token=${token}`);
  assert.ok(await new Promise((res) => { tws.on('open', () => res(true)); tws.on('error', () => res(false)); }));
  tws.close();
  pass('Phone app login: bearer token for the API and ?token= for live sockets; CORS preflight OK');

  br = await fetch(base + '/api/assistant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'remind me friday at 9 to have pilot call the dentist at 214 555 0100 to move my cleaning', now: '2026-10-27T20:00', weekday: 'Tuesday', timezone: 'America/Chicago', lists: [{ id: 'inbox', name: 'Inbox' }, { id: 'personal', name: 'Personal' }] }),
  });
  const { result } = await br.json();
  assert.equal(result.kind, 'both');
  assert.deepEqual(result.task, { title: 'Call the dentist', notes: '', dueDate: '2026-10-30', dueTime: '09:00', priority: 'medium', listId: 'personal' });
  assert.equal(result.call.to, '+12145550100');
  assert.equal(result.call.when, 'later');
  const aReq = claudeRequests.find((c) => /voice front door/.test(c.json.system));
  assert.equal(aReq.json.model, 'claude-haiku-5-5');
  assert.match(aReq.json.messages[0].content, /Tuesday/);
  pass('Voice assistant: one sentence becomes a task with date/time/list plus a call for Pilot');

  const appUpdate = twilioCalls.find((c) => c.url === '/2010-04-01/Accounts/AC_TEST/Applications/AP_TEST.json' && c.params.get('VoiceUrl'));
  assert.equal(appUpdate?.params.get('VoiceUrl'), 'https://localhost:5591/twilio/outgoing');
  pass('On startup the server points the Twilio TwiML App at itself');

  // ---- security of websockets ----
  const bad = new WebSocket(`ws://localhost:${PORTS.app}/ui`);
  const denied = await new Promise((res) => { bad.on('error', () => res(true)); bad.on('open', () => res(false)); });
  assert.ok(denied);
  pass('Live view socket refuses connections without the passcode cookie');

  console.log(`\nAll ${results.length} checks passed.\n`);
  ui.ws.close();
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exitCode = 1;
} finally {
  app.kill();
  [twilioServer, claudeServer].forEach((s) => s.close());
  sttServer.close();
  agentServer.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
