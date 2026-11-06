// Turns the owner's goal + free-form details (typed or dictated, can be long)
// into a structured call plan. The plan guides the voice agent; it is not a
// script to recite word for word.
import { config, assistantNameOf } from './config.js';
import { complete, parseJson } from './claude.js';
import { plannerLanguageNote } from './language.js';

const MAX_DETAILS = 40000; // characters sent to the planner

const SCHEMA = `{
  "kind": "personal or business",
  "ask_their_name": false,
  "objective": "one sentence: what success looks like",
  "reach": "who to ask for: the person's first name for a personal call, or the business or department",
  "regarding": "the reason for the call in 3-8 spoken words, e.g. moving my cleaning appointment",
  "greeting": "the agent's very first line when the owner's skills say how to open the call; otherwise empty",
  "opening": "1-2 sentences the agent says once it has introduced itself, stating why it is calling. Natural, spoken, no names of the business unless given.",
  "steps": ["ordered conversation flow, 3-7 short steps"],
  "facts_to_share": [{"label": "e.g. Name on the account", "value": "the fact itself, copied from the details"}],
  "can_agree_to": ["things the agent may accept without asking, e.g. any weekday slot 8-11am"],
  "ask_owner_before": ["decisions the agent must check with the owner first"],
  "never_share": ["types of info the agent must not say, e.g. Social Security number"],
  "likely_questions": [{"q": "question the other side may ask", "a": "answer, or 'Ask the owner'"}],
  "if_phone_menu": "which menu option or keyword to choose, or empty",
  "if_voicemail": "the short voicemail message to leave, always written (one or two sentences: who is calling, for whom, why, and that they will follow up)",
  "leave_voicemail": "true only if the owner explicitly asked to leave a voicemail or a message if nobody answers; otherwise false",
  "confirm_before_hanging_up": ["only hard details to read back: a date, time, price, address or confirmation number; usually empty for a simple favor or question"],
  "missing_info": ["things the business will probably ask that the details do not answer"]
}`;

export function plannerSystem(owner = config.ownerName, skills = [], assistant = config.assistantName, language = 'en') {
  return [
    `You are the call planner for ${owner}'s personal assistant. An AI voice agent named ${assistant} will phone someone on ${owner}'s behalf, and your plan is its briefing.`,
    `Read ${owner}'s standing details and the note for this call. The standing details are true on every call. The note is only for this call. Either may be long, rambling, or dictated by voice with transcription errors; extract what matters and ignore filler.`,
    'Rules:',
    '- Use only facts that appear in the goal or details. Never invent names, dates, prices, account numbers or preferences. If something important is unknown, put it in missing_info.',
    `- kind is "personal" when ${owner} is calling a specific person they already know (a friend, family, or anyone named as the person to reach). kind is "business" when calling a company, office, restaurant, or any place where the person who answers is unknown.`,
    '- ask_their_name is true only for a business call where you do not already know who will pick up. It is false for every personal call. Never put "ask their name" in steps or confirm_before_hanging_up for a personal call.',
    `- Write can_agree_to strictly from what ${owner} said is acceptable. Anything involving money, fees, cancellations, contracts, sign-ups or choices outside stated preferences goes in ask_owner_before.`,
    '- If the details contain a Social Security number, full card or bank account number, password, or PIN, never copy the value anywhere. List only the type under never_share.',
    '- Keep every string short and speakable. The opening must sound like a person talking, not a form.',
    `- Always write if_voicemail, short and ready to say. Set leave_voicemail to true only when ${owner} explicitly asked for a voicemail or a message to be left ("leave a voicemail", "leave a message if they don't pick up"); otherwise false, and no message is left.`,
    '- confirm_before_hanging_up holds only details that are easy to get wrong and needed afterwards (a date, time, price, address, confirmation number). Leave it empty when the call is a simple favor, question or yes/no, and never list how or when they will do something (by text, by email, today).',
    skills.length
      ? `${owner.toUpperCase()}'S SKILLS (how ${owner} wants every call handled; follow them, and where they conflict with the rules above, they win, except never invent facts):\n${skills.map((x) => `- ${x}`).join('\n')}\n` +
        'If a skill says how to open the call, write that first line in greeting, filled in with the real name of the person or business and the reason, and keep opening to what comes after it.'
      : 'Leave greeting empty.',
    plannerLanguageNote(language),
    `Reply ONLY with JSON in this shape:\n${SCHEMA}`,
  ].join('\n');
}

export async function generatePlan({ to, goal, brief, owner, about, skills, assistant, usage, language }) {
  const name = String(owner || '').trim() || config.ownerName;
  const standing = String(about || '').trim().slice(0, 8000);
  const details = String(brief || goal || '').slice(0, MAX_DETAILS);
  const skillList = cleanSkills(skills);
  const prompt = `Phone number being called: ${to}\n\nAbout ${name} (true on every call; do not ask the other person for these):\n${standing || '(none)'}\n\nThis call only:\n${details || '(not given)'}`;
  const system = plannerSystem(name, skillList, assistantNameOf(assistant), language);
  // Room for a full plan: Nepali text takes about twice the tokens of English, and a cut-off reply is unusable JSON.
  const ask = (model, timeoutMs) => {
    const meta = {};
    return complete({ model, system, prompt, maxTokens: 4000, timeoutMs, usage, meta }).then((text) => ({ text, meta }));
  };
  let reply;
  try {
    reply = await ask(config.anthropic.smartModel, 60000);
  } catch (err) {
    // Fall back to the fast model so a slow or unavailable model never blocks the call.
    console.warn(`[plan] ${config.anthropic.smartModel} failed (${err.message}); trying ${config.anthropic.fastModel}`);
    reply = await ask(config.anthropic.fastModel, 30000);
  }
  let plan = normalizePlan(parseJson(reply.text));
  if (!plan) {
    // A reply that isn't a readable plan (cut off, or not JSON) gets one more try with the fast model.
    console.warn(`[plan] reply not usable (stop: ${reply.meta.stopReason || '?'}, ${reply.text.length} chars); trying ${config.anthropic.fastModel}`);
    reply = await ask(config.anthropic.fastModel, 30000);
    plan = normalizePlan(parseJson(reply.text));
    if (!plan) console.warn(`[plan] second reply not usable either (stop: ${reply.meta.stopReason || '?'}, ${reply.text.length} chars)`);
  }
  if (!plan) throw new Error('Could not build a call plan from the details. Try rephrasing the goal.');
  // Asked for in so many words ("leave a voicemail", "leave them a message"): leave one, whatever the model said.
  if (asksForVoicemail(`${goal || ''}\n${details}`)) plan.leave_voicemail = true;
  return plan;
}

/** The owner's own words ask for a voicemail or message to be left. */
export function asksForVoicemail(text) {
  return /\b(leave|drop)\b[^.!?\n]{0,25}\b(voice ?mail|vm|message)\b/i.test(String(text || ''));
}

/** The owner's call skills from the app: short instructions, at most 20. */
export function cleanSkills(v) {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim().slice(0, 600) : '')).filter(Boolean).slice(0, 20) : [];
}

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 12) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : []);

/** Validates and trims a plan (from Claude, or edited by the client) to a safe shape. */
export function normalizePlan(p) {
  if (!p || typeof p !== 'object') return null;
  const plan = {
    kind: p.kind === 'business' ? 'business' : p.kind === 'personal' ? 'personal' : '',
    ask_their_name: p.kind === 'personal' ? false : p.ask_their_name === true,
    objective: str(p.objective, 300),
    reach: str(p.reach, 80),
    regarding: str(p.regarding, 120),
    greeting: str(p.greeting, 300).replace(/^["']|["']$/g, ''),
    opening: str(p.opening, 300).replace(/^["']|["']$/g, ''),
    steps: strList(p.steps, 10),
    facts_to_share: Array.isArray(p.facts_to_share)
      ? p.facts_to_share
          .map((f) => ({ label: str(f?.label, 80), value: str(f?.value, 300) }))
          .filter((f) => f.label && f.value)
          .slice(0, 20)
      : [],
    can_agree_to: strList(p.can_agree_to),
    ask_owner_before: strList(p.ask_owner_before),
    never_share: strList(p.never_share),
    likely_questions: Array.isArray(p.likely_questions)
      ? p.likely_questions
          .map((x) => ({ q: str(x?.q, 200), a: str(x?.a, 300) }))
          .filter((x) => x.q)
          .slice(0, 10)
      : [],
    if_phone_menu: str(p.if_phone_menu, 300),
    if_voicemail: str(p.if_voicemail, 400),
    leave_voicemail: p.leave_voicemail === true || p.leave_voicemail === 'true',
    confirm_before_hanging_up: strList(p.confirm_before_hanging_up),
    missing_info: strList(p.missing_info, 8),
  };
  if (!plan.objective && !plan.steps.length) return null;
  return plan;
}

/** Renders the plan as the briefing section of the voice agent's prompt. */
export function planToPrompt(plan, owner = config.ownerName) {
  if (!plan) return '';
  const list = (title, items) => (items?.length ? `${title}\n${items.map((x) => `- ${x}`).join('\n')}\n` : '');
  return [
    'CALL PLAN (a guide, not a script: follow its intent, adapt to what the other person actually says, and never read it out word for word)',
    plan.kind === 'personal'
      ? `Call type: personal. ${owner} already knows this person. Do not ask their name. If someone else answers, ask to speak with the person you were told to call.`
      : plan.kind === 'business'
        ? (plan.ask_their_name
          ? `Call type: business. You do not know who will answer. Once the reason for the call is settled, you may ask once who you are speaking with, so you can tell ${owner}. If they already said their name, do not ask again.`
          : `Call type: business. Ask who you are speaking with only if the call is wrapping up and you still do not know.`)
        : '',
    plan.objective ? `Objective: ${plan.objective}\n` : '',
    list('Suggested flow:', plan.steps),
    list(`Facts you may share about ${owner}:`, plan.facts_to_share.map((f) => `${f.label}: ${f.value}`)),
    list('You may agree to, without asking:', plan.can_agree_to),
    list(`Check with ${owner} (ask_owner) before:`, plan.ask_owner_before),
    list('Never share:', plan.never_share),
    list('Likely questions and answers:', plan.likely_questions.map((x) => `${x.q} -> ${x.a || 'ask ' + owner}`)),
    plan.if_phone_menu ? `If you hit a phone menu: ${plan.if_phone_menu}\n` : '',
    plan.if_voicemail ? `Prepared voicemail message (leave it only when the voicemail rule says to): ${plan.if_voicemail}\n` : '',
    list('Before hanging up, confirm:', plan.confirm_before_hanging_up),
    list(`Not covered by ${owner}'s details (ask ${owner} if it comes up):`, plan.missing_info),
  ].filter(Boolean).join('\n');
}
