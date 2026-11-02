// Account balances for the app's Usage page, straight from each provider.
// Anthropic has no balance API for a regular key, so the app shows Claude tokens it counted itself.
import { config } from './config.js';
import { twilioGet } from './twilio.js';

async function twilioUsage() {
  if (!config.twilio.accountSid) return { error: 'Twilio is not set up' };
  const [bal, month] = await Promise.all([
    twilioGet('/Balance.json'),
    twilioGet('/Usage/Records/ThisMonth.json?Category=totalprice').catch(() => null),
  ]);
  const spent = month?.usage_records?.[0];
  return {
    balance: Number(bal.balance),
    currency: bal.currency || 'USD',
    spentThisMonth: spent ? Number(spent.price) : null,
  };
}

async function deepgramUsage() {
  const key = config.deepgram.apiKey;
  if (!key) return { error: 'Deepgram is not set up' };
  const get = async (path) => {
    const res = await fetch(`https://api.deepgram.com/v1${path}`, { headers: { Authorization: `Token ${key}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.err_msg || json.message || `HTTP ${res.status}`);
    return json;
  };
  const { projects = [] } = await get('/projects');
  if (!projects.length) return { error: 'No Deepgram project found for this key' };
  const { balances = [] } = await get(`/projects/${projects[0].project_id}/balances`);
  return { balance: balances.reduce((sum, b) => sum + (Number(b.amount) || 0), 0), currency: balances[0]?.units || 'USD' };
}

const settle = (p) => p.then((v) => v, (err) => ({ error: err.message }));

export async function accountUsage() {
  const [twilio, deepgram] = await Promise.all([settle(twilioUsage()), settle(deepgramUsage())]);
  return { twilio, deepgram, models: { fast: config.anthropic.fastModel, smart: config.anthropic.smartModel, agent: config.deepgram.agentThinkModel } };
}
