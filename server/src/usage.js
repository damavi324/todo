// Account balances for the app's Usage page, straight from each provider.
// Anthropic has no balance API. With an Admin key (ANTHROPIC_ADMIN_KEY) it reports this month's real spend;
// without one the app shows the Claude tokens it counted itself.
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

async function anthropicUsage() {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) return { error: 'Add ANTHROPIC_ADMIN_KEY on the server to see real spend' };
  const now = new Date();
  const params = new URLSearchParams({
    starting_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    ending_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
    bucket_width: '1d',
    limit: '31',
  });
  let cents = 0;
  for (let page = '', i = 0; i < 5; i++) {
    const res = await fetch(`${config.anthropic.baseUrl}/v1/organizations/cost_report?${params}${page ? `&page=${encodeURIComponent(page)}` : ''}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'CallPilot/1.0' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    // Amounts are USD in cents, as decimal strings.
    for (const day of json.data || []) for (const r of day.results || []) cents += Number(r.amount) || 0;
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }
  return { spentThisMonth: cents / 100, currency: 'USD' };
}

const settle = (p) => p.then((v) => v, (err) => ({ error: err.message }));

export async function accountUsage() {
  const [twilio, deepgram, anthropic] = await Promise.all([settle(twilioUsage()), settle(deepgramUsage()), settle(anthropicUsage())]);
  return { twilio, deepgram, anthropic, models: { fast: config.anthropic.fastModel, smart: config.anthropic.smartModel, agent: config.deepgram.agentThinkModel } };
}
