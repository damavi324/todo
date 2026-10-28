import crypto from 'node:crypto';
import { config } from './config.js';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/**
 * Twilio Access Token (JWT) with a Voice grant, signed with the API key secret.
 * Same format the official helper library produces.
 */
export function voiceAccessToken(identity, ttlSeconds = 3600) {
  const t = config.twilio;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${t.apiKeySid}-${now}`,
    iss: t.apiKeySid,
    sub: t.accountSid,
    iat: now,
    exp: now + ttlSeconds,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: t.twimlAppSid },
      },
    },
  };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sig = crypto.createHmac('sha256', t.apiKeySecret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

function restAuthHeader() {
  const t = config.twilio;
  const [user, pass] = t.authToken ? [t.accountSid, t.authToken] : [t.apiKeySid, t.apiKeySecret];
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function twilioPost(pathname, params) {
  const t = config.twilio;
  const url = `${t.apiBase}/2010-04-01/Accounts/${t.accountSid}${pathname}`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => body.append(k, String(x)));
    else body.append(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: restAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.message || `HTTP ${res.status}`;
    const err = new Error(`Twilio: ${msg}${json.code ? ` (code ${json.code})` : ''}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function twilioGet(pathname) {
  const t = config.twilio;
  const res = await fetch(`${t.apiBase}/2010-04-01/Accounts/${t.accountSid}${pathname}`, { headers: { Authorization: restAuthHeader() } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio: ${json.message || `HTTP ${res.status}`}`);
  return json;
}

/** Makes sure the TwiML App's Voice URL points at this server's /twilio/outgoing. */
export async function ensureTwimlApp() {
  const url = `https://${config.publicHost}/twilio/outgoing`;
  const app = await twilioGet(`/Applications/${config.twilio.twimlAppSid}.json`);
  if (app.voice_url === url && (app.voice_method || 'POST') === 'POST') return { changed: false, url };
  await twilioPost(`/Applications/${config.twilio.twimlAppSid}.json`, { VoiceUrl: url, VoiceMethod: 'POST' });
  return { changed: true, url };
}

export const createCall = (params) => twilioPost('/Calls.json', params);
export const updateCall = (callSid, params) => twilioPost(`/Calls/${callSid}.json`, params);
export const hangupCall = (callSid) => updateCall(callSid, { Status: 'completed' });

// ---------- webhook signatures ----------
/**
 * Twilio signs every webhook: HMAC-SHA1 (auth token) over the full URL plus the POST params
 * sorted by name, base64-encoded, in the X-Twilio-Signature header.
 */
export function twilioSignature(url, params, authToken = config.twilio.authToken) {
  const data = Object.keys(params || {}).sort().reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}
export function validTwilioSignature(url, params, signature) {
  if (!config.twilio.authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(url, params));
  const got = Buffer.from(String(signature));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

// ---------- TwiML helpers ----------
export const xml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

export function streamParams(params) {
  return Object.entries(params)
    .map(([name, value]) => `<Parameter name="${xml(name)}" value="${xml(value)}"/>`)
    .join('');
}

/** Normalizes user input like "(214) 555-0100" to E.164. Returns null if not dialable. */
export function toE164(input, defaultCountryCode = config.defaultCountryCode) {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15 && raw.startsWith('00')) return `+${digits.slice(2)}`;
  return null;
}
