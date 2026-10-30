// Turns the owner's goal + free-form details (typed or dictated, can be long)
// into a structured call plan. The plan guides the voice agent; it is not a
// script to recite word for word.
import { config } from './config.js';
import { complete, parseJson } from './claude.js';

const MAX_DETAILS = 40000; // characters sent to the planner

const SCHEMA = `{
  "kind": "personal or business",
  "ask_their_name": false,
  "objective": "one sentence: what success looks like",
  "opening": "1-2 sentences the agent says right after its AI-assistant introduction, stating why it is calling. Natural, spoken, no names of the business unless given.",
  "steps": ["ordered conversation flow, 3-7 short steps"],
  "facts_to_share": [{"label": "e.g. Name on the account", "value": "e.g. Mk Khanal"}],
  "can_agree_to": ["things the agent may accept without asking, e.g. any weekday slot 8-11am"],
  "ask_owner_before": ["decisions the agent must check with the owner first"],
  "never_share": ["types of info the agent must not say, e.g. Social Security number"],
  "likely_questions": [{"q": "question the other side may ask", "a": "answer, or 'Ask the owner'"}],
  "if_phone_menu": "which menu option or keyword to choose, or empty",
  "if_voicemail": "the short voicemail message to leave",
  "confirm_before_hanging_up": ["details to read back, e.g. date, time, confirmation number"],
  "missing_info": ["things the business will probably ask that the details do not answer"]
}`;

export function plannerSystem() {
  const owner = config.ownerName;
  return [
    `You are the call planner for ${owner}'s personal assistant. An AI voice agent named ${config.assistantName} will phone someone on ${owner}'s behalf, and your plan is its briefing.`,
    `Read ${owner}'s goal and details carefully. Details may be long, rambling, or dictated by voice with transcription errors; extract what matters and ignore filler.`,
    'Rules:',
    '- Use only facts that appear in the goal or details. Never invent names, dates, prices, account numbers or preferences. If something important is unknown, put it in missing_info.',
    `- kind is "personal" when ${owner} is calling a specific person they already know (a friend, family, or anyone named as the person to reach). kind is "business" when calling a company, office, restaurant, or any place where the person who answers is unknown.`,
    '- ask_their_name is true only for a business call where you do not already know who will pick up. It is false for every personal call. Never put "ask their name" in steps or confirm_before_hanging_up for a personal call.',
    `- Write can_agree_to strictly from what ${owner} said is acceptable. Anything involving money, fees, cancellations, contracts, sign-ups or choices outside stated preferences goes in ask_owner_before.`,
    '- If the details contain a Social Security number, full card or bank account number, password, or PIN, never copy the value anywhere. List only the type under never_share.',
    '- Keep every string short and speakable. The opening must sound like a person talking, not a form.',
    `Reply ONLY with JSON in this shape:\n${SCHEMA}`,
  ].join('\n');
}

export async function generatePlan({ to, goal, brief }) {
  const details = String(brief || '').slice(0, MAX_DETAILS);
  const prompt = `Phone number being called: ${to}\n\nGoal: ${goal || '(not given)'}\n\nDetails from ${config.ownerName}:\n${details || '(none)'}`;
  let text;
  try {
    text = await complete({ model: config.anthropic.smartModel, system: plannerSystem(), prompt, maxTokens: 1800, timeoutMs: 60000 });
  } catch (err) {
    // Fall back to the fast model so a slow or unavailable model never blocks the call.
    text = await complete({ model: config.anthropic.fastModel, system: plannerSystem(), prompt, maxTokens: 1800, timeoutMs: 30000 });
  }
  const plan = normalizePlan(parseJson(text));
  if (!plan) throw new Error('Could not build a call plan from the details. Try rephrasing the goal.');
  return plan;
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
    confirm_before_hanging_up: strList(p.confirm_before_hanging_up),
    missing_info: strList(p.missing_info, 8),
  };
  if (!plan.objective && !plan.steps.length) return null;
  return plan;
}

/** Renders the plan as the briefing section of the voice agent's prompt. */
export function planToPrompt(plan) {
  if (!plan) return '';
  const owner = config.ownerName;
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
    plan.if_voicemail ? `If you reach voicemail, say: ${plan.if_voicemail}\n` : '',
    list('Before hanging up, confirm:', plan.confirm_before_hanging_up),
    list(`Not covered by ${owner}'s details (ask ${owner} if it comes up):`, plan.missing_info),
  ].filter(Boolean).join('\n');
}
