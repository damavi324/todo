import WebSocket from 'ws';
import { config } from './config.js';

/**
 * Live speech-to-text for one audio track (mulaw 8 kHz from Twilio).
 * Calls onEvent({ type: 'interim'|'final'|'utterance_end', text, speechFinal }).
 */
export function openLiveTranscriber({ label, onEvent, onError, encoding = 'mulaw', sampleRate = 8000 }) {
  const d = config.deepgram;
  const params = new URLSearchParams({
    model: d.listenModel,
    encoding,
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  });
  const ws = new WebSocket(`${d.listenUrl}?${params}`, { headers: { Authorization: `Token ${d.apiKey}` } });
  const backlog = [];
  let open = false;
  let closed = false;

  ws.on('open', () => {
    open = true;
    console.log(`[stt] ${label} transcription connected`);
    for (const chunk of backlog.splice(0)) ws.send(chunk);
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'Results') {
      const text = msg.channel?.alternatives?.[0]?.transcript || '';
      onEvent({ type: msg.is_final ? 'final' : 'interim', text, speechFinal: !!msg.speech_final });
    } else if (msg.type === 'UtteranceEnd') {
      onEvent({ type: 'utterance_end' });
    }
  });
  ws.on('error', (err) => onError?.(new Error(`Deepgram STT (${label}): ${err.message}`)));
  ws.on('unexpected-response', (_req, res) => {
    onError?.(new Error(`Deepgram STT (${label}) rejected the connection: HTTP ${res.statusCode}. Check DEEPGRAM_API_KEY.`));
  });

  const keepAlive = setInterval(() => {
    if (open && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 5000);

  return {
    send(chunk) {
      if (closed) return;
      if (open && ws.readyState === WebSocket.OPEN) ws.send(chunk);
      else if (backlog.length < 1500) backlog.push(chunk);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {}
      setTimeout(() => {
        try { ws.close(); } catch {}
      }, 1500);
    },
  };
}

/** Opens a Deepgram Voice Agent socket. Caller wires up the messages. */
export function openVoiceAgent() {
  const d = config.deepgram;
  return new WebSocket(d.agentUrl, { headers: { Authorization: `Token ${d.apiKey}` } });
}

/** Provider block for listen/speak; Flux models need version v2, Nova/Aura must omit it. */
export function deepgramProvider(model) {
  const p = { type: 'deepgram', model };
  if (model.startsWith('flux')) p.version = 'v2';
  return p;
}

/**
 * The agent's voice. Flux voices get speed + expressivity (more animated delivery).
 * Cartesia (managed by Deepgram) falls back to a Flux voice if it ever fails.
 */
export function speakConfig(override = {}) {
  const d = { ...config.deepgram, ...override };
  const num = (v, lo, hi, def) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v != null ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const voice = d.agentVoice || 'flux-alexis-en';
  const fluxVoice = voice.startsWith('flux') ? voice : 'flux-alexis-en';
  const flux = {
    provider: {
      type: 'deepgram', version: 'v2', model: fluxVoice,
      speed: num(d.agentSpeed, 0.5, 1.5, 1.05),
      expressivity: Math.round(num(d.agentExpressivity, -2, 2, 1)),
    },
  };
  const tts = d.agentTts || (voice.startsWith('aura') ? 'aura' : 'flux');
  if (tts === 'cartesia') {
    return [
      { provider: { type: 'cartesia', model_id: d.cartesiaModel, voice: { mode: 'id', id: d.cartesiaVoice } } },
      flux,
    ];
  }
  if (tts === 'aura') {
    return { provider: { type: 'deepgram', model: voice.startsWith('aura') ? voice : 'aura-2-thalia-en', speed: num(d.agentSpeed, 0.7, 1.5, 1.0) } };
  }
  return flux;
}
