// The voices Pilot can use on calls, and short recorded samples of each, made by asking Deepgram's voice
// agent to speak a line in that voice (the same path a real call takes, so it sounds like a phone line).
import { config } from './config.js';
import { openVoiceAgent, listenProvider, speakConfig } from './deepgram.js';

export const CANDIDATES = [
  { file: '1-flux-miles', label: 'Flux Miles, clear and sincere (current default)', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-miles-en', o: { agentTts: 'flux', agentVoice: 'flux-miles-en', agentExpressivity: '0' } },
  { file: '2-flux-wes', label: 'Flux Wes, warm and friendly', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-wes-en', o: { agentTts: 'flux', agentVoice: 'flux-wes-en', agentExpressivity: '0' } },
  { file: '3-flux-bruce', label: 'Flux Bruce, amiable and natural', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-bruce-en', o: { agentTts: 'flux', agentVoice: 'flux-bruce-en', agentExpressivity: '0' } },
  { file: '4-flux-drew', label: 'Flux Drew, relaxed and soft', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-drew-en', o: { agentTts: 'flux', agentVoice: 'flux-drew-en', agentExpressivity: '0' } },
  { file: '5-flux-marcus', label: 'Flux Marcus, smooth and kind', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-marcus-en', o: { agentTts: 'flux', agentVoice: 'flux-marcus-en', agentExpressivity: '0' } },
  { file: '6-flux-cliff', label: 'Flux Cliff, deep and gravelly (previous default)', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-cliff-en', o: { agentTts: 'flux', agentVoice: 'flux-cliff-en', agentExpressivity: '0' } },
  { file: '7-flux-alexis', label: 'Flux Alexis, soothing female', env: 'AGENT_TTS=flux  AGENT_VOICE=flux-alexis-en', o: { agentTts: 'flux', agentVoice: 'flux-alexis-en', agentExpressivity: '0' } },
  { file: '8-aura-thalia', label: 'Aura 2 Thalia', env: 'AGENT_TTS=aura  AGENT_VOICE=aura-2-thalia-en', o: { agentTts: 'aura', agentVoice: 'aura-2-thalia-en' } },
  { file: '9-cartesia-sonic-2', label: 'Cartesia Sonic 2 (managed by Deepgram)', env: 'AGENT_TTS=cartesia  CARTESIA_MODEL=sonic-2', o: { agentTts: 'cartesia', cartesiaModel: 'sonic-2' }, only: true },
];

/** Voices the app can offer: id, label and the settings that select it. */
export const VOICES = CANDIDATES.filter((c) => !c.only).map((c) => ({ id: c.o.agentVoice, label: c.label.replace(/ \((current|previous) default\)$/, ''), o: c.o }));

// ElevenLabs voices are "el-" + the ElevenLabs voice ID, so any voice in your ElevenLabs library can be picked.
const EL_PREFIX = 'el-';
const elevenVoice = (id) => {
  const voiceId = String(id || '').slice(EL_PREFIX.length);
  return { id, label: 'ElevenLabs voice', provider: 'elevenlabs', o: { agentTts: 'elevenlabs', elevenVoice: voiceId, agentVoice: 'flux-miles-en' } };
};
const isElevenId = (id) => String(id || '').startsWith(EL_PREFIX) && /^[A-Za-z0-9]{8,40}$/.test(String(id).slice(EL_PREFIX.length));

export const voiceById = (id) => {
  if (isElevenId(id)) return config.elevenlabs.apiKey ? elevenVoice(id) : null;
  return VOICES.find((v) => v.id === id) || null;
};

/** The voice calls use when the app hasn't picked one: the English ElevenLabs voice if set, else the Deepgram one. */
export const defaultVoiceId = () => (config.elevenlabs.apiKey && config.elevenlabs.voiceIdEn
  ? EL_PREFIX + config.elevenlabs.voiceIdEn
  : config.deepgram.agentVoice);

let elevenList = { at: 0, voices: [] };
/**
 * The voices in your ElevenLabs library (its ready-made ones plus any you added), for the app to offer on
 * English calls. Read from ElevenLabs at most every 10 minutes; empty without a key or if ElevenLabs can't be reached.
 */
export async function elevenLabsVoices() {
  const el = config.elevenlabs;
  if (!el.apiKey) return [];
  if (Date.now() - elevenList.at < 10 * 60 * 1000) return elevenList.voices;
  try {
    const r = await fetch(`${el.apiBase}/v1/voices`, { headers: { 'xi-api-key': el.apiKey }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`ElevenLabs answered ${r.status}`);
    const { voices = [] } = await r.json();
    const words = (l = {}) => [l.description, l.use_case, l.accent].filter(Boolean).map((x) => String(x).replace(/_/g, ' ')).join(', ');
    const list = voices
      .filter((v) => /^[A-Za-z0-9]{8,40}$/.test(v.voice_id || ''))
      .map((v) => {
        // Built-in voices are named like "Roger - Laid-Back, Casual, Resonant": the name, then how it sounds.
        const [name, ...about] = String(v.name || 'Voice').split(' - ');
        return { id: EL_PREFIX + v.voice_id, label: [name.trim(), about.join(' - ').trim() || words(v.labels)].filter(Boolean).join(', '), provider: 'elevenlabs' };
      })
      .slice(0, 40);
    elevenList = { at: Date.now(), voices: list };
  } catch (err) {
    console.warn('[voices] ElevenLabs voices unavailable:', err.message);
    elevenList = { at: Date.now() - 9 * 60 * 1000, voices: elevenList.voices }; // try again in a minute
  }
  return elevenList.voices;
}

/** An ElevenLabs voice saying `line`, as phone-quality audio (8 kHz mu-law, like a real call). */
async function elevenSample(voiceId, line) {
  const el = config.elevenlabs;
  const r = await fetch(`${el.apiBase}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=ulaw_8000`, {
    method: 'POST',
    headers: { 'xi-api-key': el.apiKey, 'Content-Type': 'application/json', Accept: 'audio/basic' },
    body: JSON.stringify({ text: line, model_id: el.modelEn }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`ElevenLabs answered ${r.status}`);
  return { audio: Buffer.from(await r.arrayBuffer()), error: null };
}

export function mulawToPcm16(buf) {
  const out = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    let u = ~buf[i] & 0xff;
    const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    let x = (((man << 3) + 0x84) << exp) - 0x84;
    out.writeInt16LE(sign ? -x : x, i * 2);
  }
  return out;
}
export function wav(pcm, rate = 8000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export function audition(c, line) {
  return new Promise((resolve) => {
    let speak = speakConfig(c.o);
    if (c.only && Array.isArray(speak)) speak = speak[0]; // test Cartesia alone, without the Flux fallback
    const ws = openVoiceAgent();
    const chunks = [];
    let error = null;
    let silence;
    const done = () => {
      clearTimeout(timer);
      clearInterval(silence);
      try { ws.close(); } catch {}
      resolve({ audio: Buffer.concat(chunks), error });
    };
    const timer = setTimeout(done, 20000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'Settings',
        audio: { input: { encoding: 'mulaw', sample_rate: 8000 }, output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' } },
        agent: {
          language: 'en',
          listen: { provider: listenProvider(config.deepgram.agentListenModel) },
          // A model Deepgram runs itself: the sample only speaks its greeting, so no thinking is needed.
          think: { provider: { type: 'anthropic', model: config.deepgram.agentFastThinkModel }, prompt: 'Stay silent.' },
          speak,
          greeting: line,
        },
      }));
      silence = setInterval(() => ws.readyState === 1 && ws.send(Buffer.alloc(160, 0xff)), 20);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return chunks.push(Buffer.from(data));
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.type === 'Error') { error = m.description || m.message || JSON.stringify(m); done(); }
      if (m.type === 'AgentAudioDone') setTimeout(done, 300);
    });
    ws.on('unexpected-response', (_q, res) => { error = `HTTP ${res.statusCode}`; done(); });
    ws.on('error', (e) => { error = e.message; done(); });
  });
}


const samples = new Map();
/** A playable WAV of `voice` saying `line`, cached so each one is recorded once. */
export async function voiceSample(voice, line) {
  const key = `${voice.id}|${line}`;
  if (!samples.has(key)) {
    const recorded = voice.provider === 'elevenlabs' ? elevenSample(voice.o.elevenVoice, line) : audition({ o: voice.o }, line);
    const p = recorded.then(({ audio, error }) => {
      if (error || audio.length < 1600) throw new Error(error || 'No audio came back');
      return wav(mulawToPcm16(audio));
    });
    samples.set(key, p);
    p.catch(() => samples.delete(key));
    if (samples.size > 40) samples.delete(samples.keys().next().value);
  }
  return samples.get(key);
}
