// Pre-flight check: verifies every credential against the real services.
// Usage: npm run check            (report only)
//        npm run check -- --fix   (also points the TwiML App's Voice URL at PUBLIC_HOST)
import { config, configProblems, publicUrl } from './config.js';

const fix = process.argv.includes('--fix');
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); failures++; };
const warn = (m) => console.log(`  ! ${m}`);
let failures = 0;

const t = config.twilio;
const twAuth = 'Basic ' + Buffer.from(t.authToken ? `${t.accountSid}:${t.authToken}` : `${t.apiKeySid}:${t.apiKeySecret}`).toString('base64');
const twBase = `${t.apiBase}/2010-04-01/Accounts/${t.accountSid}`;
async function tw(path, init = {}) {
  const res = await fetch(`${twBase}${path}`, { ...init, headers: { Authorization: twAuth, ...(init.headers || {}) } });
  return { res, json: await res.json().catch(() => ({})) };
}

console.log('\nCallPilot pre-flight check\n');

console.log('Config');
const problems = configProblems();
if (!problems.length) ok('All settings present');
problems.forEach((p) => (p.startsWith('APP_PASSCODE') ? warn(p) : bad(p)));

console.log('\nTwilio');
try {
  const { res, json } = await tw('.json');
  if (!res.ok) bad(`Credentials rejected: ${json.message || res.status}`);
  else {
    ok(`Account "${json.friendly_name}" (${json.status}, type ${json.type})`);
    if (json.type === 'Trial') warn('Trial account: calls play a trial message and can only reach Verified Caller IDs. Upgrade (add $20) before the demo.');
  }
  if (t.phoneNumber) {
    const r = await tw(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(t.phoneNumber)}`);
    if (r.json.incoming_phone_numbers?.length) ok(`Phone number ${t.phoneNumber} belongs to this account`);
    else bad(`${t.phoneNumber} is not a number on this account`);
  }
  if (t.callerId && t.callerId !== t.phoneNumber) {
    const r = await tw(`/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(t.callerId)}`);
    if (r.json.outgoing_caller_ids?.length) ok(`Caller ID ${t.callerId} is verified`);
    else bad(`TWILIO_CALLER_ID ${t.callerId} is not a Verified Caller ID; Twilio will reject calls`);
  }
  if (t.twimlAppSid) {
    const want = publicUrl('/twilio/outgoing');
    const r = await tw(`/Applications/${t.twimlAppSid}.json`);
    if (!r.res.ok) bad(`TwiML App ${t.twimlAppSid} not found`);
    else if (r.json.voice_url === want && (r.json.voice_method || 'POST') === 'POST') ok(`TwiML App Voice URL -> ${want}`);
    else if (fix && config.publicHost) {
      const u = await tw(`/Applications/${t.twimlAppSid}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ VoiceUrl: want, VoiceMethod: 'POST' }),
      });
      u.res.ok ? ok(`Updated TwiML App Voice URL -> ${want}`) : bad(`Could not update TwiML App: ${u.json.message}`);
    } else bad(`TwiML App Voice URL is "${r.json.voice_url || '(empty)'}", expected ${want}. Run: npm run check -- --fix`);
  }
} catch (err) {
  bad(`Could not reach Twilio: ${err.message}`);
}

console.log('\nDeepgram');
try {
  const res = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${config.deepgram.apiKey}` } });
  res.ok ? ok('API key accepted') : bad(`API key rejected (HTTP ${res.status})`);
  const models = await fetch('https://agent.deepgram.com/v1/agent/settings/think/models').then((r) => r.json()).catch(() => null);
  const ids = (models?.models || []).map((m) => m.id);
  if (!ids.length) warn('Could not list agent LLM models; skipping model check');
  else if (ids.includes(config.deepgram.agentThinkModel)) ok(`Agent think model ${config.deepgram.agentThinkModel} is supported`);
  else bad(`AGENT_THINK_MODEL ${config.deepgram.agentThinkModel} is not on Deepgram's list. Anthropic options: ${ids.filter((i) => i.startsWith('claude')).join(', ')}`);
} catch (err) {
  bad(`Could not reach Deepgram: ${err.message}`);
}

console.log('\nAnthropic');
for (const model of [config.anthropic.fastModel, config.anthropic.smartModel]) {
  try {
    const res = await fetch(`${config.anthropic.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }),
    });
    const json = await res.json().catch(() => ({}));
    res.ok ? ok(`${model} responds`) : bad(`${model}: ${json?.error?.message || res.status}`);
  } catch (err) {
    bad(`Could not reach Anthropic: ${err.message}`);
  }
}

console.log('\nPublic URL');
if (config.publicHost) {
  try {
    const res = await fetch(publicUrl('/api/health'), { headers: { 'ngrok-skip-browser-warning': '1' } });
    const json = await res.json().catch(() => null);
    json?.ok ? ok(`https://${config.publicHost} reaches this server`) : bad(`https://${config.publicHost} answered, but not with CallPilot (is the server running?)`);
  } catch (err) {
    bad(`https://${config.publicHost} is not reachable: ${err.message}. Start the server and ngrok first.`);
  }
}

console.log(failures ? `\n${failures} problem(s) to fix.\n` : '\nAll checks passed. You are ready to call.\n');
process.exit(failures ? 1 : 0);
