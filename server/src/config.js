import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.CALLPILOT_ENV_FILE || path.join(root, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const e = process.env;
const clean = (v) => (v || '').trim();

export const config = {
  root,
  port: Number(e.PORT || 5050),
  // Render/Railway/Fly provide the public host name; on Google Cloud Run it's worked out at startup (server.js).
  publicHost: (clean(e.PUBLIC_HOST) || clean(e.RENDER_EXTERNAL_HOSTNAME) || clean(e.RAILWAY_PUBLIC_DOMAIN) || (clean(e.FLY_APP_NAME) ? `${clean(e.FLY_APP_NAME)}.fly.dev` : '')).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  passcode: clean(e.APP_PASSCODE),
  ownerName: clean(e.OWNER_NAME) || 'Mk',
  assistantName: clean(e.ASSISTANT_NAME) || 'Pilot',
  clientIdentity: (clean(e.CLIENT_IDENTITY) || 'owner').replace(/[^A-Za-z0-9_]/g, '') || 'owner',
  // Twilio webhook signature checking: 'enforce' (default when an auth token is set), 'log', or 'off'.
  twilioValidate: (clean(e.TWILIO_VALIDATE) || 'enforce').toLowerCase(),
  // Cost guards
  maxCallsPerDay: Number(e.MAX_CALLS_PER_DAY || 60),
  maxCallMinutes: Math.max(1, Math.min(240, Number(e.MAX_CALL_MINUTES || 30))),
  defaultCountryCode: clean(e.DEFAULT_COUNTRY_CODE) || '1',
  twilio: {
    accountSid: clean(e.TWILIO_ACCOUNT_SID),
    authToken: clean(e.TWILIO_AUTH_TOKEN),
    apiKeySid: clean(e.TWILIO_API_KEY_SID),
    apiKeySecret: clean(e.TWILIO_API_KEY_SECRET),
    twimlAppSid: clean(e.TWILIO_TWIML_APP_SID),
    phoneNumber: clean(e.TWILIO_PHONE_NUMBER),
    callerId: clean(e.TWILIO_CALLER_ID) || clean(e.TWILIO_PHONE_NUMBER),
    apiBase: clean(e.TWILIO_API_BASE) || 'https://api.twilio.com',
  },
  deepgram: {
    apiKey: clean(e.DEEPGRAM_API_KEY),
    listenUrl: clean(e.DEEPGRAM_LISTEN_URL) || 'wss://api.deepgram.com/v1/listen',
    agentUrl: clean(e.DEEPGRAM_AGENT_URL) || 'wss://agent.deepgram.com/v1/agent/converse',
    listenModel: clean(e.DEEPGRAM_LISTEN_MODEL) || 'nova-3',
    agentListenModel: clean(e.AGENT_LISTEN_MODEL) || 'flux-general-en',
    agentVoice: clean(e.AGENT_VOICE) || 'flux-cliff-en',
    // Voice engine: flux | aura | cartesia (Cartesia is managed by Deepgram, no extra account)
    agentTts: (clean(e.AGENT_TTS) || '').toLowerCase(),
    agentSpeed: clean(e.AGENT_SPEED),
    agentExpressivity: clean(e.AGENT_EXPRESSIVITY),
    cartesiaModel: clean(e.CARTESIA_MODEL) || 'sonic-2',
    cartesiaVoice: clean(e.CARTESIA_VOICE_ID) || 'a167e0f3-df7e-4d52-a9c3-f949145efdab',
    agentThinkModel: clean(e.AGENT_THINK_MODEL) || 'claude-haiku-4-5',
  },
  anthropic: {
    apiKey: clean(e.ANTHROPIC_API_KEY),
    baseUrl: (clean(e.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com').replace(/\/+$/, ''),
    fastModel: clean(e.CLAUDE_FAST_MODEL) || 'claude-haiku-5-5',
    smartModel: clean(e.CLAUDE_SMART_MODEL) || 'claude-sonnet-5-5',
  },
};

/** Returns a list of human-readable problems with the configuration. */
export function configProblems() {
  const p = [];
  const t = config.twilio;
  if (!config.publicHost) p.push('PUBLIC_HOST is not set (your ngrok or server domain).');
  if (!t.accountSid) p.push('TWILIO_ACCOUNT_SID is missing.');
  if (!t.apiKeySid || !t.apiKeySecret) p.push('TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET are missing (needed for in-app dialing).');
  if (!t.twimlAppSid) p.push('TWILIO_TWIML_APP_SID is missing (needed for in-app dialing).');
  if (!t.phoneNumber) p.push('TWILIO_PHONE_NUMBER is missing (caller ID).');
  if (t.accountSid && !t.authToken && !(t.apiKeySid && t.apiKeySecret)) p.push('Twilio REST credentials missing (auth token or API key).');
  if (!config.deepgram.apiKey) p.push('DEEPGRAM_API_KEY is missing (live transcription and agent voice).');
  if (!config.anthropic.apiKey) p.push('ANTHROPIC_API_KEY is missing (suggestions and summaries).');
  if (!config.passcode) p.push('APP_PASSCODE is not set: anyone with your URL could place calls. Set one before sharing the link.');
  return p;
}

export const publicUrl = (p) => `https://${config.publicHost}${p}`;
export const publicWss = (p) => `wss://${config.publicHost}${p}`;
