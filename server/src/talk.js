// Voice mode, out loud: a natural Deepgram voice for what the app says, and a short spoken back-and-forth with
// Claude when something needs you (a request it didn't understand, a question from a live call, a call that
// couldn't start). Cheap on purpose: Haiku for the words, a Deepgram voice (the one picked for calls), the app's own dictation to listen.
import { config, assistantNameOf } from './config.js';
import { complete, parseJson } from './claude.js';
import { voiceById, defaultVoiceId, speedOf } from './voiceSamples.js';

const s = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The Deepgram voice voice mode speaks in: the one picked for calls, so the app sounds the same everywhere.
 * A non-Deepgram pick (ElevenLabs) uses the default Flux voice instead.
 */
export function appVoice(id) {
  const v = voiceById(id) || voiceById(defaultVoiceId());
  const model = v?.o?.agentVoice;
  return v?.provider !== 'elevenlabs' && /^(flux|aura)-/.test(model || '') ? model : 'flux-miles-en';
}

/** `text` spoken as MP3 in the picked voice and speed (slower | normal | faster). */
export async function speak(text, { voice, speed } = {}) {
  const line = s(text, 1500);
  if (!line) throw new Error('Nothing to say');
  if (!config.deepgram.apiKey) throw new Error('DEEPGRAM_API_KEY is not set');
  const model = appVoice(voice);
  // Flux voices are on /v2/speak, Aura on /v1/speak; both take a speed.
  const path = model.startsWith('flux') ? '/v2/speak' : '/v1/speak';
  const rate = Math.min(1.5, Math.max(model.startsWith('flux') ? 0.5 : 0.7, speedOf(speed)));
  const url = `${config.deepgram.speakBase}${path}?model=${encodeURIComponent(model)}&encoding=mp3&speed=${rate}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${config.deepgram.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: line }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Deepgram answered ${r.status}`);
  return { audio: Buffer.from(await r.arrayBuffer()), chars: line.length };
}

// What each situation is, and the ways a conversation about it can end.
const TOPICS = {
  unclear: {
    about: (c) => `They asked the app for something, but it wasn't clear. They said: "${s(c.heard, 1000)}". The app asked: "${s(c.question, 300)}".`,
    outcomes: () => '"request" (you now know what they want: put the complete request in "text", in their words, as one sentence they could have said in the first place, e.g. "Call Ram and ask if he is free for dinner on Friday"), "stop" (they want to leave it), or "continue" (ask one more short question).',
  },
  question: {
    about: (c) => `${s(c.assistant, 40)} is on a phone call for them right now${c.with ? ` with ${s(c.with, 120)}` : ''}${c.goal ? `, to ${s(c.goal, 300)}` : ''}, and asked them: "${s(c.question, 400)}". The other side is waiting, so be quick.`,
    outcomes: (c) => `"answer" (put the answer for ${s(c.assistant, 40)} in "text", short and exact, e.g. "Yes, 3 pm Tuesday works" or "Don't agree to any fee"), "stop" (they won't answer), or "continue" (only if their reply truly can't be passed on).`,
  },
  problem: {
    about: (c) => `They asked for a call${c.with ? ` to ${s(c.with, 120)}` : ''}${c.goal ? ` (${s(c.goal, 300)})` : ''}, and it couldn't go ahead: "${s(c.problem, 600)}".`,
    outcomes: () => '"retry" (try the same call again), "request" (they want something different: put the complete new request in "text", e.g. "Call Ram on his work number instead"), "stop" (leave it), or "continue" (ask one more short question).',
  },
};

/**
 * One turn of a spoken conversation. `turns` is the conversation so far ({ role: 'assistant' | 'user', text }),
 * starting with what the app said. Returns { reply, outcome, text }: what to say back, and how it ends.
 */
export async function talk({ topic, context = {}, turns = [], owner, assistant, now, weekday }, usage) {
  const t = TOPICS[topic];
  if (!t) throw new Error('Unknown topic');
  const name = assistantNameOf(assistant);
  const who = s(owner, 80) || config.ownerName;
  const lines = (Array.isArray(turns) ? turns : []).slice(-12)
    .map((x) => `${x?.role === 'user' ? who : name}: ${s(x?.text, 1000)}`)
    .filter((l) => !l.endsWith(': '));
  if (!lines.length || !lines[lines.length - 1].startsWith(`${who}:`)) throw new Error('Nothing was heard');
  const reply = await complete({
    model: config.anthropic.fastModel,
    maxTokens: 300,
    timeoutMs: 15000,
    usage,
    system: [
      `You are ${name}, ${who}'s assistant, talking with them out loud in a phone app. What they say comes from speech-to-text, so expect small errors; what you write is read aloud by a voice.`,
      t.about({ ...context, assistant: name }),
      'Talk like a calm, friendly person on the phone: one or two short sentences, no lists, no emoji, nothing to read on screen.',
      'Never invent phone numbers, names or facts. If you are about to act, say briefly what you will do.',
      `End the conversation with one of: ${t.outcomes({ ...context, assistant: name })}`,
      'Reply ONLY with JSON: {"reply": "what you say out loud", "outcome": "...", "text": "..."}',
    ].join('\n'),
    prompt: `${now ? `Local time: ${s(now, 40)} (${s(weekday, 12)}).\n` : ''}The conversation so far:\n${lines.join('\n')}`,
  });
  const r = parseJson(reply) || {};
  const allowed = { unclear: ['request', 'stop', 'continue'], question: ['answer', 'stop', 'continue'], problem: ['retry', 'request', 'stop', 'continue'] }[topic];
  let outcome = allowed.includes(r.outcome) ? r.outcome : 'continue';
  const text = s(r.text, 2000);
  // An answer or a new request with nothing in it would do nothing: ask again instead.
  if ((outcome === 'answer' || outcome === 'request') && !text) outcome = 'continue';
  return { reply: s(r.reply, 400) || (outcome === 'continue' ? 'Sorry, could you say that again?' : ''), outcome, text };
}
