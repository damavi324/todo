import { config } from './config.js';

/** One-shot Claude call via the Messages API. Returns the text of the reply. */
export async function complete({ model, system, prompt, maxTokens = 400, timeoutMs = 20000 }) {
  const a = config.anthropic;
  if (!a.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${a.baseUrl}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': a.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Claude ${res.status}: ${json?.error?.message || 'request failed'}`);
    return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the first JSON object out of a model reply (tolerates code fences / prose). */
export function parseJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
