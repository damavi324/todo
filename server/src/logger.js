// Captures every console line from the server, keeps the last 1,000 in memory
// for the Logs panel, streams them live, and appends them to data/server.log.
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { config } from './config.js';

const MAX = 1000;
const buffer = [];
const listeners = new Set();
const dataDir = process.env.CALLPILOT_DATA_DIR || path.join(config.root, 'data');
let file = null;
try {
  fs.mkdirSync(dataDir, { recursive: true });
  file = fs.createWriteStream(path.join(dataDir, 'server.log'), { flags: 'a' });
} catch {}

const SECRETS = [config.twilio.authToken, config.twilio.apiKeySecret, config.deepgram.apiKey, config.anthropic.apiKey].filter((s) => s && s.length > 8);
const redact = (text) => SECRETS.reduce((t, s) => t.split(s).join('[redacted]'), text);

export function record(level, text) {
  const entry = { at: new Date().toISOString(), level, text: redact(String(text)) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  file?.write(`${entry.at} ${level.toUpperCase().padEnd(5)} ${entry.text}\n`);
  for (const fn of listeners) {
    try { fn(entry); } catch {}
  }
  return entry;
}

export const recentLogs = () => buffer.slice();
export const onLog = (fn) => listeners.add(fn);

let installed = false;
export function installConsoleCapture() {
  if (installed) return;
  installed = true;
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const wrap = (level, fn) => (...args) => {
    fn(...args);
    const text = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 }))).join(' ');
    // Server lines start with an HH:MM:SS stamp; drop it, the entry has its own time.
    record(level, text.replace(/^\d\d:\d\d:\d\d\s+/, ''));
  };
  console.log = wrap('info', orig.log);
  console.warn = wrap('warn', orig.warn);
  console.error = wrap('error', orig.error);
  process.on('uncaughtException', (err) => console.error('[crash]', err.stack || err.message));
  process.on('unhandledRejection', (err) => console.error('[unhandled]', err?.stack || err));
}
installConsoleCapture();
