// Voice audition: npm run voices
// Asks Deepgram's voice agent to speak the same opening line in each candidate voice
// and saves playable WAV files to data/voice-samples, so you can pick by ear.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CANDIDATES, audition, wav, mulawToPcm16 } from './voiceSamples.js';

const owner = config.ownerName;
const LINE = `Hi, I'm trying to reach the front desk about a cleaning, on behalf of ${owner}. This is ${config.assistantName}, an AI assistant for ${owner}. Do you have anything open on a Monday morning?`;



if (!config.deepgram.apiKey) {
  console.error('DEEPGRAM_API_KEY is missing in .env');
  process.exit(1);
}
const outDir = path.join(process.env.CALLPILOT_DATA_DIR || path.join(config.root, 'data'), 'voice-samples');
fs.mkdirSync(outDir, { recursive: true });
console.log(`\nRecording each voice saying:\n  "${LINE}"\n`);
for (const c of CANDIDATES) {
  process.stdout.write(`  ${c.label} ... `);
  const { audio, error } = await audition(c, LINE);
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
