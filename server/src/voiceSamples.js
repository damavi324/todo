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
export const voiceById = (id) => VOICES.find((v) => v.id === id) || null;

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
          think: { provider: { type: 'anthropic', model: config.deepgram.agentThinkModel }, prompt: 'Stay silent.' },
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
    const p = audition({ o: voice.o }, line).then(({ audio, error }) => {
      if (error || audio.length < 1600) throw new Error(error || 'No audio came back');
      return wav(mulawToPcm16(audio));
    });
    samples.set(key, p);
    p.catch(() => samples.delete(key));
    if (samples.size > 40) samples.delete(samples.keys().next().value);
  }
  return samples.get(key);
}
