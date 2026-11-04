// The language the agent speaks on a call. English runs on Flux + Deepgram voices; Nepali swaps the agent's
// ears to Nova-3 Nepali and its voice to ElevenLabs. The instructions stay in English (Claude follows them
// best that way); a language block tells it to speak Nepali, and the lines the server says itself are here.
import { config } from './config.js';

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'ne', label: 'नेपाली (Nepali)' },
];

export const cleanLanguage = (v) => (v === 'ne' ? 'ne' : 'en');

/** Why calls in this language can't be made with the server's settings, or '' when they can. */
export function languageProblem(lang) {
  if (lang !== 'ne') return '';
  const el = config.elevenlabs;
  if (!el.apiKey) return 'Nepali calls need an ElevenLabs key on the server (ELEVENLABS_API_KEY).';
  if (!el.voiceId) return 'Nepali calls need an ElevenLabs voice on the server (ELEVENLABS_VOICE_ID_NE).';
  return '';
}

/** Lines the server has the agent say on its own (not written by Claude). */
const LINES = {
  en: {
    // The first line leads with who the call is for (see greetingOf); the AI introduction follows (introOf).
    greetPersonal: (reach, owner) => `Hi, is this ${reach}? I'm calling on behalf of ${owner}.`,
    greetReach: (reach, why, owner) => `Hi, I'm trying to reach ${reach}${why ? ` about ${why}` : ''}, on behalf of ${owner}.`,
    greet: (why, owner) => `Hi, I'm calling on behalf of ${owner}${why ? ` about ${why}` : ''}.`,
    aiIntro: (name, owner) => `This is ${name}, an AI assistant for ${owner}.`,
    hasAi: (g) => /\bAI\b/.test(g),
    transcribedMark: /transcrib/i,
    transcribed: 'Just so you know, this call is being transcribed.',
    holding: 'Thanks for holding, I’m still checking on that.',
    holdingLonger: 'Sorry for the wait, just a few more seconds.',
    connecting: (owner) => `One moment, I'm connecting ${owner} to the call now.`,
  },
  ne: {
    greetPersonal: (reach, owner) => `नमस्ते, के यो ${reach} हो? म ${owner}को तर्फबाट फोन गर्दैछु।`,
    greetReach: (reach, why, owner) => `नमस्ते, म ${owner}को तर्फबाट ${reach}सँग कुरा गर्न खोज्दैछु${why ? `, ${why}को बारेमा` : ''}।`,
    greet: (why, owner) => `नमस्ते, म ${owner}को तर्फबाट फोन गर्दैछु${why ? `, ${why}को बारेमा` : ''}।`,
    aiIntro: (name, owner) => `म ${name}, ${owner}को एआई सहायक हुँ।`,
    hasAi: (g) => /\bAI\b|एआई/.test(g),
    transcribedMark: /transcrib|रेकर्ड/i,
    transcribed: 'जानकारीका लागि, यो कल लिखित रूपमा रेकर्ड भइरहेको छ।',
    holding: 'पर्खिदिनुभएकोमा धन्यवाद, म अझै बुझ्दै छु।',
    holdingLonger: 'ढिलो भएकोमा माफ गर्नुहोला, केही सेकेन्ड मात्र।',
    connecting: (owner) => `एकछिन, म ${owner}लाई यो कलमा जोड्दै छु।`,
  },
};

export const lines = (lang) => LINES[cleanLanguage(lang)];

/** Added to the agent's instructions on a Nepali call. */
export function languagePrompt(lang, owner) {
  if (cleanLanguage(lang) !== 'ne') return '';
  return [
    'LANGUAGE: NEPALI (this whole call is in Nepali)',
    '- Speak only Nepali, in Devanagari script. Use everyday spoken Nepali as people talk on the phone in Nepal: polite (तपाईं, हजुर), warm, simple. Not formal written Nepali, and never Hindi words or Hindi grammar (छ, not है; हो or हजुर, not हाँ).',
    '- English words Nepalis normally use (appointment, booking, OK, online) are fine; write them in Devanagari, e.g. अपोइन्टमेन्ट.',
    '- Say numbers, times, dates and prices in Nepali words: "बिहान दस बजे", "बुधबार", "पाँच सय रुपैयाँ". Read phone and confirmation numbers digit by digit in Nepali words, in small groups.',
    '- What they say reaches you through speech recognition, which sometimes garbles Nepali. If a reply does not make sense, ask them politely to say it again.',
    '- The example lines below are in English. They show what to say; always say the Nepali equivalent, never the English.',
    `- Write ask_owner questions and finish_call notes in English, for ${owner}.`,
    `- If they say they do not understand Nepali, say briefly in English that ${owner} will call back, then call finish_call with outcome "failed".`,
    '',
  ].join('\n');
}

/** Added to the call planner's instructions so the lines the agent speaks come out in Nepali. */
export function plannerLanguageNote(lang) {
  if (cleanLanguage(lang) !== 'ne') return '';
  return 'This call will be in Nepali. Write greeting, regarding, opening and if_voicemail in natural, polite spoken Nepali (Devanagari script, not Hindi). Write every other field in English.';
}
