// Voice audition: npm run voices
// Asks Deepgram's voice agent to speak the same opening line in each candidate voice
// and saves playable WAV files to data/voice-samples, so you can pick by ear.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openVoiceAgent, listenProvider, speakConfig } from './deepgram.js';

const owner = config.ownerName;
const LINE = `Hi, this is ${config.assistantName}, an AI assistant calling on behalf of ${owner}. Um, I'm hoping to move a cleaning appointment to a Monday morning. Do you have anything open?`;

const CANDIDATES = [
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

function mulawToPcm16(buf) {
  const out = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    let u = ~buf[i] & 0xff;
    const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    let x = (((man << 3) + 0x84) << exp) - 0x84;
    out.writeInt16LE(sign ? -x : x, i * 2);
  }
  return out;
}
function wav(pcm, rate = 8000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function audition(c) {
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
          greeting: LINE,
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

if (!config.deepgram.apiKey) {
  console.error('DEEPGRAM_API_KEY is missing in .env');
  process.exit(1);
}
const outDir = path.join(process.env.CALLPILOT_DATA_DIR || path.join(config.root, 'data'), 'voice-samples');
fs.mkdirSync(outDir, { recursive: true });
console.log(`\nRecording each voice saying:\n  "${LINE}"\n`);
for (const c of CANDIDATES) {
  process.stdout.write(`  ${c.label} ... `);
  const { audio, error } = await audition(c);
  if (error || audio.length < 1600) {
    console.log(`not available${error ? ` (${error})` : ''}`);
    continue;
  }
  const file = path.join(outDir, `${c.file}.wav`);
  fs.writeFileSync(file, wav(mulawToPcm16(audio)));
  console.log(`saved (${(audio.length / 8000).toFixed(1)}s)`);
  console.log(`      to use it, put in .env:  ${c.env}`);
}
console.log(`\nOpen this folder and play the files (they sound like a phone line, because they are):\n  ${outDir}\n`);
process.exit(0);
