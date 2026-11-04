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
  // On Google Cloud Run the public host name is worked out at startup (server.js); set PUBLIC_HOST for a custom domain.
  publicHost: clean(e.PUBLIC_HOST).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  passcode: clean(e.APP_PASSCODE),
  // Only used when the app sends no name (the name in the app's Settings always wins).
  ownerName: clean(e.OWNER_NAME) || 'my client',
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
    // Flux turn-taking: end-of-turn confidence (0.5-1), early "probably done" signal (0.3-0.9, or off), max wait in ms.
    agentEotThreshold: clean(e.AGENT_EOT_THRESHOLD),
    agentEagerEot: clean(e.AGENT_EAGER_EOT),
    agentEotTimeoutMs: clean(e.AGENT_EOT_TIMEOUT_MS),
    agentVoice: clean(e.AGENT_VOICE) || 'flux-miles-en',
    // Voice engine: flux | aura | cartesia (Cartesia is managed by Deepgram, no extra account)
    agentTts: (clean(e.AGENT_TTS) || '').toLowerCase(),
    agentSpeed: clean(e.AGENT_SPEED),
    agentExpressivity: clean(e.AGENT_EXPRESSIVITY),
    cartesiaModel: clean(e.CARTESIA_MODEL) || 'sonic-2',
    cartesiaVoice: clean(e.CARTESIA_VOICE_ID) || 'a167e0f3-df7e-4d52-a9c3-f949145efdab',
    // The agent's mind on a live call. Sonnet 5.5 reasons best at a speed that suits a phone call; it runs on your
    // Anthropic key. The app can pick the faster model instead (Settings → Calling), which Deepgram runs itself.
    agentThinkModel: clean(e.AGENT_THINK_MODEL) || 'claude-sonnet-5-5',
    agentFastThinkModel: clean(e.AGENT_FAST_THINK_MODEL) || 'claude-haiku-4-5',
    // Who runs the agent's Claude: 'deepgram' (managed, in Deepgram's per-minute rate) or 'anthropic' (your key,
    // billed by Anthropic). Empty = Deepgram for models it manages, your key for any other model.
    agentThinkEndpoint: (clean(e.AGENT_THINK_ENDPOINT) || '').toLowerCase(),
    // Nepali calls: Flux has no Nepali, so the agent listens with Nova-3's Nepali model.
    nepaliListenModel: clean(e.AGENT_LISTEN_MODEL_NE) || 'nova-3',
    // The app's own voice in voice mode (Aura-2, billed per character), instead of the phone's robotic one.
    speakUrl: clean(e.DEEPGRAM_SPEAK_URL) || 'https://api.deepgram.com/v1/speak',
    appVoice: clean(e.APP_VOICE) || 'aura-2-thalia-en',
  },
  // ElevenLabs speaks Nepali calls (Deepgram has no Nepali voice), and English calls when an ElevenLabs voice is
  // picked. Your key; Deepgram's rate drops to "BYO TTS".
  elevenlabs: {
    apiKey: clean(e.ELEVENLABS_API_KEY),
    apiBase: (clean(e.ELEVENLABS_API_BASE) || 'https://api.elevenlabs.io').replace(/\/+$/, ''),
    voiceId: clean(e.ELEVENLABS_VOICE_ID_NE),
    model: clean(e.ELEVENLABS_MODEL_NE) || 'eleven_v4_turbo',
    // Tried if the main model fails. Slower (no live streaming), but better than silence. 'off' turns it off.
    fallbackModel: clean(e.ELEVENLABS_FALLBACK_MODEL_NE) || 'eleven_v3',
    // English calls: the default ElevenLabs voice (empty = a Deepgram voice stays the default) and its model.
    voiceIdEn: clean(e.ELEVENLABS_VOICE_ID_EN),
    modelEn: clean(e.ELEVENLABS_MODEL_EN) || 'eleven_v4_turbo',
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

/**
 * The numbers calls may show as coming from, picked per call in the app (Settings → Calling). Only numbers set
 * on the server can be used, so the app can't make a call look like it comes from anyone else.
 * 'caller-id' (TWILIO_CALLER_ID, your verified own number) is the default when it is set.
 */
export function callerIds() {
  const t = config.twilio;
  const list = [];
  const own = clean(process.env.TWILIO_CALLER_ID);
  if (own) list.push({ key: 'caller-id', number: own, label: 'Your caller ID' });
  if (t.phoneNumber && t.phoneNumber !== own) list.push({ key: 'twilio', number: t.phoneNumber, label: 'Twilio number' });
  return list;
}

/** The number a call goes out from: the one the app picked (by key), else the default. */
export function fromNumber(key) {
  const list = callerIds();
  return (list.find((c) => c.key === key) || list[0])?.number || config.twilio.callerId;
}

export const publicUrl = (p) => `https://${config.publicHost}${p}`;
export const publicWss = (p) => `wss://${config.publicHost}${p}`;

/** The assistant's name the app sends (Settings → Profile), or the server's default. Letters, spaces, . ' - only. */
export function assistantNameOf(name) {
  return String(name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || config.assistantName;
}
