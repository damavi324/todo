// Natural-language front door for the phone app: one spoken sentence becomes
// a task/reminder, a phone call for the assistant, or both.
import { config, assistantNameOf } from './config.js';
import { complete, parseJson } from './claude.js';
import { toE164 } from './twilio.js';

const SCHEMA = `{
  "kind": "task" | "call" | "both" | "unclear",
  "task": {
    "title": "short imperative task title without date/time words",
    "notes": "extra details worth keeping, or empty",
    "dueDate": "YYYY-MM-DD or empty",
    "dueTime": "HH:mm 24-hour or empty",
    "priority": "none|low|medium|high",
    "listId": "one of the given list ids, or empty"
  },
  "call": {
    "to": "phone number digits exactly as spoken, or empty",
    "contact": "who to call (business or person name), or empty",
    "goal": "one sentence: what the call should achieve",
    "details": "everything the assistant may need: names, account info, preferred times, limits, what not to agree to",
    "mode": "agent (the assistant makes the call) | copilot (the user talks, AI coaches)",
    "when": "now | later"
  },
  "say": "one short, friendly confirmation of what you understood",
  "question": "if kind is unclear: the single question to ask, else empty"
}`;

function systemPrompt(owner = config.ownerName, assistant = config.assistantName) {
  return [
    `You are the voice front door of ${owner}'s personal assistant app. ${owner} just spoke one request (transcribed by speech-to-text, so expect small errors and filler words).`,
    'Decide what they want:',
    '- task: a reminder or to-do ("remind me", "I need to", "add", "don\'t let me forget").',
    `- call: they want a phone call made now ("call", "phone", "ring", "have ${assistant} call", "find out from"). Default mode is agent (${assistant} calls for ${owner}); use copilot only if they say they will talk themselves.`,
    '- both: e.g. a call to make later becomes a task with call details, or a call now plus a separate reminder.',
    '- A call they want made LATER (with a day or time) is kind "both": a task to make the call at that time, plus call details with when = "later".',
    '- A request that starts with "call", "phone", "ring" or "dial" (speech-to-text may put a period right after it, like "Call. Ram…") is a call made NOW, kind "call", unless it also gives a day or time or says "remind me", "I need to" or "I have to". The rest of the sentence is who to call and what the call is about.',
    '- It stays a call even when the name is garbled or not among their contacts: put the name as you best heard it in call.contact. Never turn a call request into a task just because the name is unclear.',
    'Rules:',
    '- Resolve relative dates and times ("tomorrow", "next Monday", "in 2 hours", "this evening" = 18:00, "morning" = 09:00 only if they asked for a reminder time) using the current date and time given.',
    '- Never invent phone numbers, names or facts. Leave fields empty when unknown.',
    '- call.contact is the person or business name only, with no relationship words or brackets ("Pooja", not "Pooja (wife)"); put the relationship in details.',
    '- Fill only the sections that apply; omit or leave empty the other one.',
    '- Keep "say" under 20 words.',
    `Reply ONLY with JSON in this shape:\n${SCHEMA}`,
  ].join('\n');
}

const s = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function interpret({ text, now, timezone, weekday, lists, owner, about, contacts, assistant }, usage) {
  const spoken = s(text, 6000);
  if (!spoken) throw new Error('Nothing was heard');
  const listText = Array.isArray(lists) && lists.length
    ? lists.map((l) => `${s(l.id, 60)} = ${s(l.name, 60)}`).join(', ')
    : 'inbox = Inbox';
  const prompt = [
    `Current local date/time: ${s(now, 40) || new Date().toISOString()} (${s(weekday, 12)}), time zone ${s(timezone, 60) || 'unknown'}.`,
    `Task lists: ${listText}`,
    '',
    about ? `About ${s(owner, 80) || config.ownerName}, true on every call: ${s(about, 4000)}` : '',
    Array.isArray(contacts) && contacts.length
      ? `Contacts on their phone with a similar name (spelling may differ): ${contacts.slice(0, 12).map((c) => s(c, 80)).filter(Boolean).join('; ')}. Speech-to-text often garbles names ("Kesar Raz" for "Keshab Raj"), so if what they said sounds like one of them, put that contact's name in call.contact exactly as written here.`
      : '',
    `They said: "${spoken}"`,
  ].join('\n');
  const reply = await complete({ model: config.anthropic.fastModel, system: systemPrompt(s(owner, 80) || config.ownerName, assistantNameOf(assistant)), prompt, maxTokens: 900, timeoutMs: 25000, usage });
  return normalize(parseJson(reply), spoken, lists);
}

export function normalize(r, spoken, lists = []) {
  const kinds = ['task', 'call', 'both', 'unclear'];
  const out = {
    kind: kinds.includes(r?.kind) ? r.kind : 'task',
    say: s(r?.say, 200),
    question: s(r?.question, 200),
    heard: spoken,
    task: null,
    call: null,
  };
  const listIds = new Set((lists || []).map((l) => l.id));
  if (r?.task && (out.kind === 'task' || out.kind === 'both')) {
    const t = r.task;
    out.task = {
      title: s(t.title, 200) || spoken.slice(0, 120),
      notes: s(t.notes, 2000),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '') ? t.dueDate : '',
      dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime || '') ? t.dueTime : '',
      priority: ['none', 'low', 'medium', 'high'].includes(t.priority) ? t.priority : 'none',
      listId: listIds.has(t.listId) ? t.listId : '',
    };
  }
  if (r?.call && (out.kind === 'call' || out.kind === 'both')) {
    const c = r.call;
    const raw = s(c.to, 40);
    out.call = {
      to: toE164(raw) || raw.replace(/[^\d+]/g, ''),
      contact: s(c.contact, 120),
      goal: s(c.goal, 400),
      details: s(c.details, 6000),
      mode: c.mode === 'copilot' ? 'copilot' : 'agent',
      when: c.when === 'later' ? 'later' : 'now',
    };
  }
  if (out.kind === 'task' && !out.task) out.task = { title: spoken.slice(0, 120), notes: '', dueDate: '', dueTime: '', priority: 'none', listId: '' };
  if (out.kind === 'call' && !out.call) out.kind = 'unclear';
  if (out.kind === 'both' && !out.task && out.call) out.kind = 'call';
  if (out.kind === 'both' && !out.call && out.task) out.kind = 'task';
  return out;
}

const TASK_SCHEMA = `{"title": "short task title without date/time words or lead-ins like 'remind me to'", "notes": "extra details worth keeping, or empty", "dueDate": "YYYY-MM-DD or empty", "dueTime": "HH:mm 24-hour or empty", "priority": "none|low|medium|high"}`;

/**
 * One spoken (or typed) sentence becomes task fields. A simple extraction, so it runs on the fast,
 * cheapest model with a short reply.
 */
export async function parseTask({ text, now, timezone, weekday }, usage) {
  const spoken = s(text, 1000);
  if (!spoken) throw new Error('Nothing was heard');
  const reply = await complete({
    model: config.anthropic.fastModel,
    maxTokens: 250,
    timeoutMs: 15000,
    usage,
    system: [
      'Turn one spoken reminder into a to-do task. It came from speech-to-text, so expect small errors and filler words.',
      'Resolve relative dates and times ("tomorrow", "next Monday", "in 2 hours", "this evening" = 18:00) from the current date and time.',
      'When a time is given but no day, use today, or tomorrow if that time has already passed today. Leave dueDate and dueTime empty when none was said.',
      'priority is high only if they say urgent or important, otherwise none.',
      `Reply ONLY with JSON: ${TASK_SCHEMA}`,
    ].join('\n'),
    prompt: `Current local date/time: ${s(now, 40) || new Date().toISOString()} (${s(weekday, 12)}), time zone ${s(timezone, 60) || 'unknown'}.\nThey said: "${spoken}"`,
  });
  const t = parseJson(reply) || {};
  return {
    title: s(t.title, 200) || spoken.slice(0, 200),
    notes: s(t.notes, 1000),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : '',
    dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime) ? t.dueTime : '',
    priority: ['none', 'low', 'medium', 'high'].includes(t.priority) ? t.priority : 'none',
  };
}
