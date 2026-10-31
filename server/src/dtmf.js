// In-band DTMF tones encoded as 8 kHz mu-law, so the agent can "press keys" on phone menus
// by playing tones into the Twilio media stream.

const FREQS = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477], A: [697, 1633],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477], B: [770, 1633],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477], C: [852, 1633],
  '*': [941, 1209], 0: [941, 1336], '#': [941, 1477], D: [941, 1633],
};

const RATE = 8000;
const SILENCE = 0xff; // mu-law zero

export function linearToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** digits: string of 0-9 * # A-D, plus "w" for a half-second pause. Returns a mu-law Buffer. */
export function dtmfMulaw(digits, { toneMs = 160, gapMs = 100, amplitude = 9000 } = {}) {
  const parts = [];
  for (const ch of String(digits).toUpperCase()) {
    if (ch === 'W' || ch === ',') {
      parts.push(Buffer.alloc((RATE * 500) / 1000, SILENCE));
      continue;
    }
    const f = FREQS[ch];
    if (!f) continue;
    const n = (RATE * toneMs) / 1000;
    const tone = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const v = amplitude * (Math.sin(2 * Math.PI * f[0] * t) + Math.sin(2 * Math.PI * f[1] * t));
      tone[i] = linearToMulaw(v);
    }
    parts.push(tone, Buffer.alloc((RATE * gapMs) / 1000, SILENCE));
  }
  return Buffer.concat(parts);
}

/** Splits audio into 20 ms (160-byte) frames for Twilio. */
export function frames(buf, size = 160) {
  const out = [];
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}
