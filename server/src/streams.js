import WebSocket from 'ws';
import { config, publicWss } from './config.js';
import { openLiveTranscriber, openVoiceAgent, listenProvider, speakConfig, thinkConfig, thinkUsesOwnKey, nepaliListenProvider, elevenLabsSpeak } from './deepgram.js';
import { lines, languagePrompt } from './language.js';
import { hangupCall, updateCall, twiml, streamParams, xml } from './twilio.js';
import { dtmfMulaw, frames } from './dtmf.js';
import { planToPrompt } from './planner.js';
import { voiceById, defaultVoiceId } from './voiceSamples.js';
import {
  getSession, setStatus, addLine, emit, utteranceAssembler, askOwner, finalize, markVoicemail,
} from './sessions.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// How long the agent holds for the owner's answer before carrying on without it.
const OWNER_ANSWER_MS = Number(process.env.OWNER_ANSWER_MS) || 90000;
// People answer with "Hello?" before the caller talks. If nobody speaks this long after pickup, the agent opens anyway.
const HELLO_WAIT_MS = Number(process.env.AGENT_HELLO_WAIT_MS) || 2000;
// Their "Hello?" counts as over after this much quiet, or after this long however much they say (a voicemail greeting).
const HELLO_QUIET_MS = 450;
const HELLO_MAX_MS = 5000;
// After the agent's audio is all sent, this much quiet means its goodbye is over and the call can end.
const GOODBYE_QUIET_MS = 600;

// Rough loudness of a 20 ms mu-law frame from the caller (0 = silence), for spotting their "Hello?".
const MULAW = Array.from({ length: 256 }, (_, b) => {
  const u = ~b & 0xff;
  const x = ((((u & 0x0f) << 3) + 0x84) << ((u >> 4) & 7)) - 0x84;
  return Math.abs(x);
});
const loudness = (buf) => { let sum = 0; for (const b of buf) sum += MULAW[b]; return buf.length ? sum / buf.length : 0; };
const SPEECH_LEVEL = Number(process.env.AGENT_SPEECH_LEVEL) || 900;

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
    `You are ${s.assistantName || config.assistantName}, an AI assistant placing a phone call on behalf of ${owner}. You are speaking on a live phone call.`,
    '',
    languagePrompt(s.language, owner),
    s.about ? `ABOUT ${owner.toUpperCase()} (true on every call; use these facts, and do not ask the other person for them):\n${s.about}\n` : '',
    `THIS CALL: ${s.goal || 'See context.'}`,
    s.plan ? planToPrompt(s.plan, owner) : '',
    s.skills?.length ? `${owner.toUpperCase()}'S SKILLS (follow these on every call):\n${s.skills.map((x) => `- ${x}`).join('\n')}\n` : '',
    `THIS CALL, IN ${owner.toUpperCase()}'S WORDS (reference only; the plan above takes priority): ${(s.brief || s.goal || '(none)').slice(0, s.plan ? 5000 : 9000)}`,
    '',
    'HOW THE CALL OPENS',
    `- You have already said your first line: "${greetingOf(s)}" Never say it again.`,
    introOf(s)
      ? `- Your next turn, whatever they answer, starts with exactly this: "${introOf(s)}" Then go straight into why you are calling. If they said it is the wrong person or number, still say it, then ask for the right person or apologize and end the call.`
      : '- They already know who you are and that the call is transcribed: go straight into why you are calling.',
    s.plan?.opening ? `- When you get to why you are calling, say it along these lines: "${s.plan.opening}"` : '',
    '- If what you hear is a voicemail greeting, follow the voicemail rule below instead.',
    '',
    'HOW TO TALK (you are on the phone; sound like a relaxed, friendly person, not a script)',
    '- Keep each turn SHORT: usually one sentence, at most two, under about 20 words. Ask one thing at a time, then stop and let them answer.',
    '- A quick reaction is fine when it fits ("oh, great", "okay", "sure, that works"), but vary it and often skip it. Never start two turns the same way.',
    '- Do not repeat back what they just said. "Got it" or "great, thanks" is enough.',
    '- When they agree to something, take it as done. Do not ask follow-ups about how, when or by what means (text, email, call), unless the goal depends on it. People send things the way they normally do.',
    '- Use contractions and everyday words (I\'m, that\'s, we\'d). Write numbers the way people say them: "ten a.m. Wednesday", "the fourth", "about forty dollars".',
    '- Read phone, account, and confirmation numbers in small groups separated by periods, like "555. 867. 5309".',
    '- Do not write filler words like "um" or "uh".',
    '- If you did not catch something, say so simply: "Sorry, I missed that. Was it the fourth or the fifth?"',
    '- If they say "hold on" or "one sec", say "Sure, take your time." and wait.',
    '- Do not over-apologize or over-explain. One "sorry about that" is plenty.',
    '- No lists, no markdown, no emojis, no stage directions.',
    '- This is a live conversation. Respond to what they actually said; the plan is guidance, not lines to recite. If they offer something new, use judgment within your limits.',
    `- You tell them early that you are an AI assistant calling for ${owner}. If asked again whether you are an AI, say yes, plainly. Never claim to be human.`,
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
    `- Before ending, read back only details that are easy to get wrong and that ${owner} needs later: a date, time, price, address, or confirmation or reference number. Say them once, briefly. A simple yes ("I'll send it", "sounds good", "I'll call him") needs no read-back: just thank them and say goodbye. Do not ask for a name just so you have something to read back.`,
    '- If you reach an automated phone menu, listen to the options. Use press_digits to press keys, or say a short keyword if it asks you to speak. Stay silent during hold music.',
    `- Voicemail: if you hear a recorded greeting ("leave a message", "after the tone", "is not available", "the mailbox", a beep), nobody is on the line. Do not talk to it as a person. Leave one short message: who you are, that you are calling for ${owner}, the reason, and that ${owner} will follow up. Then call finish_call with outcome "voicemail".`,
    s.voicemail ? '- IMPORTANT: this call has already been detected as voicemail. Nobody is listening live.' : '',
    '- If they will not talk to an AI assistant, apologize, say ' + owner + ' will call back personally, and call finish_call.',
    '- When the goal is done or cannot be done, end right away with one short line, like "Great, thanks so much. Have a good day, bye!", then call finish_call. No summary of the call.',
  ].join('\n');
}

/**
 * The first line, said by the server itself once they answer. It leads with who the call is for, so the person
 * hears a name they know before anything else: "Hi, is this Matt? I'm calling on behalf of Manoj." The skills can
 * word it their own way (the plan's greeting). The AI introduction always follows in the next turn (see introOf).
 */
export function greetingOf(s) {
  const owner = s.ownerName || config.ownerName;
  const L = lines(s.language);
  if (s.plan?.greeting) return s.plan.greeting;
  const reach = s.plan?.reach;
  const why = s.plan?.regarding ? s.plan.regarding.replace(/^(about|regarding)\s+/i, '') : '';
  if (reach && s.plan?.kind === 'personal') return L.greetPersonal(reach, owner);
  if (reach) return L.greetReach(reach, why, owner);
  return L.greet(why, owner);
}

/** Said right after they answer the first line, unless that line already said it. */
export function introOf(s) {
  const owner = s.ownerName || config.ownerName;
  const L = lines(s.language);
  const g = greetingOf(s);
  const parts = [];
  if (!L.hasAi(g)) parts.push(L.aiIntro(s.assistantName || config.assistantName, owner));
  if (!L.transcribedMark.test(g)) parts.push(L.transcribed);
  return parts.join(' ');
}

/**
 * A correction added to the call instructions so the model listens to audio it is about to receive instead of
 * talking over it. UpdatePrompt adds to the prompt, so only the change is sent, not the whole prompt again.
 */
function listenInstead(s) {
  const line = greetingOf(s);
  const fix = 'CORRECTION: you have NOT said your first line yet; ignore the instruction above that says you already did. Audio from the start of the call is arriving now. Listen to it before you say anything.';
  const now = s.voicemail
    ? 'RIGHT NOW: this is voicemail, not a person. Do not ask questions. Wait for the beep if a greeting is still playing, leave one short message, then call finish_call with outcome "voicemail".'
    : `RIGHT NOW: they were already talking when you connected. Do not talk over them. If it is a voicemail or recorded greeting, wait for the beep, leave one short message, and call finish_call with outcome "voicemail". If it is a person, wait until they pause, then say exactly: "${line}"`;
  return `${fix}\n\n${now}`;
}

/**
 * The Claude model that thinks on this call: the smarter one, unless the app asked for fast or the smarter one
 * needs your Anthropic key and the server has none.
 */
export function thinkModelOf(s) {
  const d = config.deepgram;
  if (s.thinking === 'fast' || s._thinkFallback) return d.agentFastThinkModel;
  if (thinkUsesOwnKey(d) && !config.anthropic.apiKey) return d.agentFastThinkModel;
  return d.agentThinkModel;
}

function agentSettings(s) {
  const d = config.deepgram;
  const nepali = s.language === 'ne';
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'mulaw', sample_rate: 8000 },
      output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
    },
    agent: {
      // Nepali: Flux has no Nepali, so Nova-3 listens; the language lives on the listen and speak providers.
      ...(nepali ? {} : { language: 'en' }),
      listen: { provider: nepali ? nepaliListenProvider() : listenProvider(d.agentListenModel) },
      think: {
        ...thinkConfig({ agentThinkModel: thinkModelOf(s) }),
        prompt: agentPrompt(s),
        functions: [
          {
            name: 'ask_owner',
            defer_until_eot: true,
            description: `Ask ${s.ownerName || config.ownerName} a question in real time and wait for the answer. Use when you need information or a decision you do not have.`,
            parameters: {
              type: 'object',
              properties: { question: { type: 'string', description: `Short, specific question for ${s.ownerName || config.ownerName}.` } },
              required: ['question'],
            },
          },
          {
            name: 'press_digits',
            defer_until_eot: true,
            description: 'Press keys on the phone keypad to navigate an automated menu. Use digits 0-9, * and #. Use w for a half-second pause.',
            parameters: {
              type: 'object',
              properties: { digits: { type: 'string', description: 'Keys to press, e.g. "2" or "1w3".' } },
              required: ['digits'],
            },
          },
          {
            name: 'finish_call',
            defer_until_eot: true,
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
      // No greeting: the first line is spoken after they say hello (see the prompt and the hello timer).
      speak: nepali ? elevenLabsSpeak() : speakConfig(voiceById(s.voice || defaultVoiceId())?.o),
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
  let helloTimer = null;
  // Until the first line is said, their audio is held back from the agent, so it can't answer their "Hello?"
  // itself and skip the line. hello: { start, speechFrames, lastSpeech } while listening for it.
  let opened = false;
  // Their audio during the hello wait, so a long greeting can be heard instead of talked over.
  const helloAudio = [];
  // The scripted first line is still playing. Their "hello" must not wipe it.
  let protectOpening = false;
  let openingTimer = null;
  const hello = { start: 0, speechFrames: 0, lastSpeech: 0 };

  const sendTwilio = (obj) => {
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(obj));
  };
  const sendAgent = (obj) => {
    if (agentWs?.readyState === WebSocket.OPEN) agentWs.send(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
  };
  // Say the first line exactly as written, then let their audio through to the agent.
  // Someone who is already talking (a receptionist, a voicemail greeting) is listened to instead.
  const openCall = (why) => {
    if (opened) return;
    opened = true;
    clearTimeout(helloTimer);
    log('[agent] first line (' + why + ')');
    if (why === 'they kept talking' || session.voicemail) {
      sendAgent({ type: 'UpdatePrompt', prompt: listenInstead(session) });
      for (const buf of helloAudio) sendAgent(buf);
      helloAudio.length = 0;
      return;
    }
    protectOpening = true;
    sendAgent({ type: 'InjectAgentMessage', message: greetingOf(session) });
    // If the spoken line never reports that it finished, allow interruptions again.
    clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { protectOpening = false; }, 8000);
  };
  const listenForHello = (buf) => {
    const now = Date.now();
    if (helloAudio.length < 250) helloAudio.push(buf); // ~5s of what they said before we speak
    if (loudness(buf) > SPEECH_LEVEL) {
      hello.speechFrames++;
      hello.lastSpeech = now;
    }
    const spoke = hello.speechFrames >= 3; // ~60 ms of voice, not a click
    if (spoke && now - hello.lastSpeech >= HELLO_QUIET_MS) openCall('after their hello');
    else if (spoke && now - hello.start >= HELLO_MAX_MS) openCall('they kept talking');
  };

  const playToCaller = (buf) => {
    for (const f of frames(buf)) sendTwilio({ event: 'media', streamSid, media: { payload: f.toString('base64') } });
  };

  // Ending the call. The agent asks to finish while its goodbye may still be streaming in from Deepgram, so the
  // "hang up after playback" mark goes to Twilio only once Deepgram says the agent's audio is all sent and a
  // short quiet spell shows nothing more is coming. Twilio echoes the mark when the goodbye has finished playing.
  let agentTalking = false;
  let hangupMarkTimer = null;
  const markHangupSoon = () => {
    clearTimeout(hangupMarkTimer);
    hangupMarkTimer = setTimeout(() => sendTwilio({ event: 'mark', streamSid, mark: { name: 'hangup' } }), GOODBYE_QUIET_MS);
  };

  let hungUp = false;
  const doHangup = async (why) => {
    if (!session?.callSid || hungUp) return;
    hungUp = true;
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
      // The owner may need a moment to see the question. Don't leave the other person in silence: thank
      // them for holding now and then, and give the owner time to answer before moving on.
      const reassure = [
        setTimeout(() => sendAgent({ type: 'InjectAgentMessage', message: lines(session.language).holding }), 20000),
        setTimeout(() => sendAgent({ type: 'InjectAgentMessage', message: lines(session.language).holdingLonger }), 55000),
      ];
      const answer = await askOwner(session, args.question || 'Can you help?', OWNER_ANSWER_MS);
      reassure.forEach(clearTimeout);
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
      if (args.outcome === 'voicemail') markVoicemail(session);
      hangupRequested = true;
      respond('Hanging up now.');
      // Hang up once the goodbye has been fully sent and played (see markHangupSoon), with a fallback timer.
      if (!agentTalking) markHangupSoon();
      setTimeout(() => doHangup('fallback timer'), 15000);
    } else {
      respond(`Unknown function ${fn.name}.`);
    }
  }

  function connectAgent() {
    const ws = openVoiceAgent();
    agentWs = ws;
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
          setStatus(session, 'live');
          emit(session, 'agent_state', { state: 'talking' });
          pendingAudio.length = 0; // pickup noise and the start of their "Hello?" stay with us
          hello.start = Date.now();
          // Nobody says hello: open the call ourselves.
          helloTimer = setTimeout(() => { if (!hello.speechFrames) openCall('nobody spoke'); }, HELLO_WAIT_MS);
          break;
        case 'ConversationText':
          addLine(session, msg.role === 'assistant' ? 'agent' : 'them', msg.content);
          break;
        case 'UserStartedSpeaking':
          if (protectOpening) break; // the opening line is still playing; don't cut off who is calling
          sendTwilio({ event: 'clear', streamSid }); // barge-in: drop queued agent audio
          break;
        case 'AgentAudioDone':
          protectOpening = false;
          clearTimeout(openingTimer);
          agentTalking = false;
          if (hangupRequested) markHangupSoon();
          break;
        case 'AgentThinking':
          emit(session, 'agent_state', { state: 'thinking' });
          break;
        case 'AgentStartedSpeaking':
          agentTalking = true;
          clearTimeout(hangupMarkTimer); // more goodbye is on its way; wait for it to finish
          emit(session, 'agent_state', { state: 'talking' });
          break;
        case 'FunctionCallRequest':
          log('[agent] tool:', (msg.functions || []).map((f) => `${f.name}(${f.arguments})`).join(', '));
          for (const fn of msg.functions || []) if (fn.client_side) onFunctionCall(fn);
          break;
        case 'Error':
          console.error('[agent] Deepgram error:', JSON.stringify(msg));
          // The smarter model on our own key was refused before the agent went live: reconnect with the faster
          // model Deepgram runs itself, so the person who answered hears the assistant instead of silence.
          if (!ready && !session._thinkFallback && thinkModelOf(session) !== config.deepgram.agentFastThinkModel) {
            session._thinkFallback = true;
            log(`[agent] ${thinkModelOf({ ...session, _thinkFallback: false })} refused; reconnecting with ${config.deepgram.agentFastThinkModel}`);
            ws.removeAllListeners('close');
            clearInterval(keepAlive);
            try { ws.close(); } catch {}
            connectAgent();
            break;
          }
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
      clearTimeout(helloTimer);
      clearTimeout(openingTimer);
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
        // Adds to the agent's instructions mid-call, without it saying anything.
        note: (text) => sendAgent({ type: 'UpdatePrompt', prompt: text }),
        close: () => agentWs?.close(),
      };
      log('[agent] stream started', session.id);
      connectAgent();
    } else if (msg.event === 'media' && session) {
      const buf = Buffer.from(msg.media.payload, 'base64');
      if (!ready) { if (pendingAudio.length < 250) pendingAudio.push(buf); }
      else if (opened) sendAgent(buf);
      else listenForHello(buf);
    } else if (msg.event === 'mark' && msg.mark?.name === 'hangup' && hangupRequested) {
      // A natural beat after the last word before the line drops.
      setTimeout(() => doHangup('goodbye played'), 900);
    } else if (msg.event === 'stop') {
      agentWs?.close();
    }
  });

  twilioWs.on('close', () => {
    clearInterval(keepAlive);
    clearTimeout(openingTimer);
    clearTimeout(hangupMarkTimer);
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
  s._agent?.say(lines(s.language).connecting(s.ownerName || config.ownerName));
  emit(s, 'agent_state', { state: 'handing_off' });
  // Long enough for that sentence to finish. Cutting the audio sooner leaves them mid-word as you join.
  await new Promise((r) => setTimeout(r, 5500));
  s.joined = true;
  const inner =
    `<Start><Stream url="${xml(publicWss('/streams/listen'))}" track="both_tracks">` +
    streamParams({ sessionId: s.id, inboundSpeaker: 'them' }) +
    `</Stream></Start>` +
    `<Dial><Client>${xml(config.clientIdentity)}</Client></Dial>`;
  await updateCall(s.callSid, { Twiml: twiml(inner) });
  emit(s, 'agent_state', { state: 'you_are_on' });
}
