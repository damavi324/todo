import WebSocket from 'ws';
import { config, publicWss } from './config.js';
import { openLiveTranscriber, openVoiceAgent, deepgramProvider, speakConfig } from './deepgram.js';
import { hangupCall, updateCall, twiml, streamParams, xml } from './twilio.js';
import { dtmfMulaw, frames } from './dtmf.js';
import { planToPrompt } from './planner.js';
import {
  getSession, setStatus, addLine, emit, utteranceAssembler, askOwner, finalize,
} from './sessions.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// =====================================================================
// Copilot stream: Twilio <Start><Stream track="both_tracks"> -> two live
// transcribers (one per speaker) -> transcript + Claude suggestions.
// =====================================================================
export function handleListenStream(twilioWs) {
  let session = null;
  let byTrack = {}; // 'inbound' | 'outbound' -> transcriber

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.event === 'start') {
      const p = msg.start.customParameters || {};
      session = getSession(p.sessionId);
      if (!session) {
        log('[listen] unknown session', p.sessionId);
        return twilioWs.close();
      }
      if (session.callSid && msg.start.callSid && session.callSid !== msg.start.callSid) {
        console.warn(`[security] listen stream for session ${session.id.slice(0, 8)} came from an unexpected call; closing`);
        return twilioWs.close();
      }
      if (!session.callSid) session.callSid = msg.start.callSid;
      // Which human is on the "inbound" track depends on which leg is the parent call.
      const inboundSpeaker = p.inboundSpeaker === 'them' ? 'them' : 'you';
      const outboundSpeaker = inboundSpeaker === 'you' ? 'them' : 'you';
      const onError = (err) => emit(session, 'notice', { level: 'error', message: err.message });
      byTrack = {
        inbound: openLiveTranscriber({ label: inboundSpeaker, onEvent: utteranceAssembler(session, inboundSpeaker), onError }),
        outbound: openLiveTranscriber({ label: outboundSpeaker, onEvent: utteranceAssembler(session, outboundSpeaker), onError }),
      };
      if (session.joined) setStatus(session, 'live');
      log('[listen] stream started', session.id, msg.start.tracks);
    } else if (msg.event === 'media' && session) {
      const t = byTrack[msg.media.track];
      if (t) t.send(Buffer.from(msg.media.payload, 'base64'));
    } else if (msg.event === 'stop') {
      Object.values(byTrack).forEach((t) => t.close());
      byTrack = {};
    }
  });

  twilioWs.on('close', () => {
    Object.values(byTrack).forEach((t) => t.close());
    if (session && session.mode === 'copilot') finalize(session, 'stream closed');
  });
}

// =====================================================================
// Agent stream: Twilio <Connect><Stream> (bidirectional) <-> Deepgram
// Voice Agent (Flux STT + Claude + TTS, with barge-in and tools).
// =====================================================================

function agentPrompt(s) {
  const owner = (s.ownerName || '').trim() || config.ownerName;
  return [
    `You are ${config.assistantName}, an AI assistant placing a phone call on behalf of ${owner}. You are speaking on a live phone call.`,
    '',
    s.about ? `ABOUT ${owner.toUpperCase()} (true on every call; use these facts, and do not ask the other person for them):\n${s.about}\n` : '',
    `THIS CALL: ${s.goal || 'See context.'}`,
    s.plan ? planToPrompt(s.plan) : '',
    `THIS CALL, IN ${owner.toUpperCase()}'S WORDS (reference only; the plan above takes priority): ${(s.brief || s.goal || '(none)').slice(0, s.plan ? 5000 : 9000)}`,
    '',
    'HOW TO TALK (you are on the phone; sound like a relaxed, friendly person, not a script)',
    '- Keep each turn SHORT: usually one sentence, at most two. Ask one thing at a time, then stop and let them answer.',
    '- Lead with a quick, natural reaction before the substance: "Oh, perfect.", "Got it.", "Okay, sure.", "Hmm, okay."',
    '- Use contractions and everyday words (I\'m, that\'s, we\'d). Say times and dates the way people do: "ten a.m. Wednesday", "the fourth".',
    '- Now and then, at most once every few turns, a light filler is fine: "um", "so", "let\'s see", "oh". Never put fillers inside names, numbers, or confirmations.',
    '- Do not over-apologize or over-explain. One "sorry about that" is plenty.',
    '- No lists, no markdown, no emojis, no stage directions.',
    '- This is a live conversation. Respond to what they actually said; the plan is guidance, not lines to recite. If they offer something new, use judgment within your limits.',
    `- You already introduced yourself as an AI assistant calling for ${owner}. If asked again whether you are an AI, say yes, plainly. Never claim to be human.`,
    '',
    'WHO YOU ARE CALLING',
    `- If the goal or details name a specific person ${owner} already knows, this is a personal call. Do not ask "what's your name?" You already know who they are. If a different person answers, ask to speak to the person you called.`,
    `- If this is a business, a front desk, or anyone whose name was not given, you may ask once, near the end, who you are speaking with so you can tell ${owner}. Skip that if they already introduced themselves.`,
    `- Never ask the other person for ${owner}'s name. You already have it.`,
    '- Do not ask for any fact already in the standing details or in this call.',
    '',
    'RULES',
    `- Only agree to things that clearly fit the goal and context. If an offer or question falls outside them (a different time, a price, a fee, a policy, a decision), say you need to check with ${owner}, then call ask_owner.`,
    '- Before calling ask_owner, tell the other person: "One moment, let me check that quickly."',
    '- Never give out Social Security numbers, full card or bank numbers, or passwords, even if you were told them. Offer to have ' + owner + ' call back for that.',
    '- Never make payments, accept charges, cancel services, or sign up for anything without an explicit yes from ' + owner + ' via ask_owner.',
    '- Before ending, read back the details you actually agreed, such as the date, time, price, or confirmation number. Do not ask for a name just so you have something to read back.',
    '- If you reach an automated phone menu, listen to the options. Use press_digits to press keys, or say a short keyword if it asks you to speak. Stay silent during hold music.',
    `- If you reach voicemail, leave one short message: who you are, that you are calling for ${owner}, the reason, and that ${owner} will follow up. Then call finish_call.`,
    '- If they will not talk to an AI assistant, apologize, say ' + owner + ' will call back personally, and call finish_call.',
    '- When the goal is done or cannot be done, say a brief thank-you and goodbye FIRST, then call finish_call.',
  ].join('\n');
}

function agentSettings(s) {
  const d = config.deepgram;
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'mulaw', sample_rate: 8000 },
      output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
    },
    agent: {
      language: 'en',
      listen: { provider: deepgramProvider(d.agentListenModel) },
      think: {
        provider: { type: 'anthropic', model: d.agentThinkModel },
        prompt: agentPrompt(s),
        functions: [
          {
            name: 'ask_owner',
            description: `Ask ${s.ownerName || config.ownerName} a question in real time and wait for the answer. Use when you need information or a decision you do not have.`,
            parameters: {
              type: 'object',
              properties: { question: { type: 'string', description: `Short, specific question for ${s.ownerName || config.ownerName}.` } },
              required: ['question'],
            },
          },
          {
            name: 'press_digits',
            description: 'Press keys on the phone keypad to navigate an automated menu. Use digits 0-9, * and #. Use w for a half-second pause.',
            parameters: {
              type: 'object',
              properties: { digits: { type: 'string', description: 'Keys to press, e.g. "2" or "1w3".' } },
              required: ['digits'],
            },
          },
          {
            name: 'finish_call',
            description: 'Hang up. Call this only after you have said goodbye.',
            parameters: {
              type: 'object',
              properties: {
                outcome: { type: 'string', enum: ['done', 'needs_owner', 'failed', 'voicemail', 'refused'] },
                note: { type: 'string', description: 'One sentence on what happened.' },
              },
              required: ['outcome'],
            },
          },
        ],
      },
      speak: speakConfig(),
      greeting:
        `Hi, this is ${config.assistantName}, an AI assistant calling on behalf of ${s.ownerName || config.ownerName}. ` +
        `This call is being transcribed. ${s.plan?.opening || ''}`.trim(),
    },
  };
}

export function handleAgentStream(twilioWs) {
  let session = null;
  let streamSid = null;
  let agentWs = null;
  let ready = false;
  const pendingAudio = [];
  let hangupRequested = false;
  let keepAlive = null;

  const sendTwilio = (obj) => {
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(obj));
  };
  const sendAgent = (obj) => {
    if (agentWs?.readyState === WebSocket.OPEN) agentWs.send(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
  };
  const playToCaller = (buf) => {
    for (const f of frames(buf)) sendTwilio({ event: 'media', streamSid, media: { payload: f.toString('base64') } });
  };

  const doHangup = async (why) => {
    if (!session?.callSid) return;
    try {
      await hangupCall(session.callSid);
      log('[agent] hung up:', why);
    } catch (err) {
      log('[agent] hangup failed', err.message);
    }
  };

  async function onFunctionCall(fn) {
    let args = {};
    try { args = JSON.parse(fn.arguments || '{}'); } catch {}
    const respond = (content) => sendAgent({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: String(content) });

    if (fn.name === 'ask_owner') {
      emit(session, 'agent_state', { state: 'waiting_for_you', detail: args.question });
      const answer = await askOwner(session, args.question || 'Can you help?');
      emit(session, 'agent_state', { state: 'talking' });
      const who = session.ownerName || config.ownerName;
      respond(answer ? `${who} says: ${answer}` : `${who} did not answer in time. Do not agree to anything new; say ${who} will follow up, and continue or wrap up politely.`);
    } else if (fn.name === 'press_digits') {
      const digits = String(args.digits || '').replace(/[^0-9*#wW,]/g, '');
      emit(session, 'agent_state', { state: 'pressing_keys', detail: digits });
      addLine(session, 'agent', `[pressed ${digits}]`);
      playToCaller(dtmfMulaw(digits));
      respond(`Pressed ${digits}. Listen for the next prompt.`);
    } else if (fn.name === 'finish_call') {
      session.agentOutcome = { outcome: args.outcome, note: args.note || '' };
      hangupRequested = true;
      respond('Hanging up now.');
      // Hang up once Twilio has played everything queued (mark echo), with a fallback timer.
      sendTwilio({ event: 'mark', streamSid, mark: { name: 'hangup' } });
      setTimeout(() => doHangup('fallback timer'), 8000);
    } else {
      respond(`Unknown function ${fn.name}.`);
    }
  }

  function connectAgent() {
    agentWs = openVoiceAgent();
    agentWs.on('open', () => {
      sendAgent(agentSettings(session));
      keepAlive = setInterval(() => sendAgent({ type: 'KeepAlive' }), 8000);
    });
    agentWs.on('unexpected-response', (_req, res) => {
      emit(session, 'notice', { level: 'error', message: `Deepgram agent rejected the connection (HTTP ${res.statusCode}). Check DEEPGRAM_API_KEY.` });
    });
    agentWs.on('error', (err) => emit(session, 'notice', { level: 'error', message: `Deepgram agent: ${err.message}` }));
    agentWs.on('message', (data, isBinary) => {
      if (isBinary) {
        if (streamSid) sendTwilio({ event: 'media', streamSid, media: { payload: Buffer.from(data).toString('base64') } });
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      switch (msg.type) {
        case 'Welcome':
          log('[agent] connected to Deepgram');
          break;
        case 'SettingsApplied':
          log('[agent] settings accepted; agent is live');
          ready = true;
          for (const chunk of pendingAudio.splice(0)) sendAgent(chunk);
          setStatus(session, 'live');
          emit(session, 'agent_state', { state: 'talking' });
          break;
        case 'ConversationText':
          addLine(session, msg.role === 'assistant' ? 'agent' : 'them', msg.content);
          break;
        case 'UserStartedSpeaking':
          sendTwilio({ event: 'clear', streamSid }); // barge-in: drop queued agent audio
          break;
        case 'AgentThinking':
          emit(session, 'agent_state', { state: 'thinking' });
          break;
        case 'AgentStartedSpeaking':
          emit(session, 'agent_state', { state: 'talking' });
          break;
        case 'FunctionCallRequest':
          log('[agent] tool:', (msg.functions || []).map((f) => `${f.name}(${f.arguments})`).join(', '));
          for (const fn of msg.functions || []) if (fn.client_side) onFunctionCall(fn);
          break;
        case 'Error':
          console.error('[agent] Deepgram error:', JSON.stringify(msg));
          emit(session, 'notice', { level: 'error', message: `Agent error: ${msg.description || msg.message || JSON.stringify(msg)}` });
          break;
        case 'Warning':
          console.warn('[agent] Deepgram warning:', msg.description || msg.message || JSON.stringify(msg));
          break;
        default:
          break;
      }
    });
    agentWs.on('close', (code, reason) => {
      clearInterval(keepAlive);
      (code === 1000 || code === 1005 ? log : console.warn)(`[agent] Deepgram connection closed (${code}${reason?.length ? ` ${reason}` : ''})`);
    });
  }

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      const p = msg.start.customParameters || {};
      session = getSession(p.sessionId);
      if (!session) {
        log('[agent] unknown session', p.sessionId);
        return twilioWs.close();
      }
      if (session.callSid && msg.start.callSid && session.callSid !== msg.start.callSid) {
        console.warn(`[security] agent stream for session ${session.id.slice(0, 8)} came from an unexpected call; closing`);
        return twilioWs.close();
      }
      session.callSid = msg.start.callSid || session.callSid;
      session._agent = {
        say: (text) => sendAgent({ type: 'InjectAgentMessage', message: text }),
        close: () => agentWs?.close(),
      };
      log('[agent] stream started', session.id);
      connectAgent();
    } else if (msg.event === 'media' && session) {
      const buf = Buffer.from(msg.media.payload, 'base64');
      if (ready) sendAgent(buf);
      else if (pendingAudio.length < 250) pendingAudio.push(buf);
    } else if (msg.event === 'mark' && msg.mark?.name === 'hangup' && hangupRequested) {
      setTimeout(() => doHangup('goodbye played'), 400);
    } else if (msg.event === 'stop') {
      agentWs?.close();
    }
  });

  twilioWs.on('close', () => {
    clearInterval(keepAlive);
    agentWs?.close();
    if (session) session._agent = null;
  });
}

// =====================================================================
// "Join call": the agent hands an in-progress call to the owner's browser,
// and live transcription + suggestions continue.
// =====================================================================
export async function joinAgentCall(s) {
  if (!s.callSid) throw new Error('Call is not connected yet');
  s._agent?.say(`One moment, I'm connecting ${s.ownerName || config.ownerName} to the call now.`);
  emit(s, 'agent_state', { state: 'handing_off' });
  await new Promise((r) => setTimeout(r, 3500));
  s.joined = true;
  const inner =
    `<Start><Stream url="${xml(publicWss('/streams/listen'))}" track="both_tracks">` +
    streamParams({ sessionId: s.id, inboundSpeaker: 'them' }) +
    `</Stream></Start>` +
    `<Dial><Client>${xml(config.clientIdentity)}</Client></Dial>`;
  await updateCall(s.callSid, { Twiml: twiml(inner) });
  emit(s, 'agent_state', { state: 'you_are_on' });
}
