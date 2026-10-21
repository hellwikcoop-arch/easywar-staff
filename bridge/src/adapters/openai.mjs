// Адаптер J5: OpenAI Responses API (POST /v1/responses). Платний: працює лише через ворота gate.mjs.
// store: false — провайдер не зберігає відповідь для повторного отримання; тому J4 спулить сиру відповідь
// локально до запису в журнал (відновлення без повторного виклику).
// Поля запиту й відповіді звірено з довідником OpenAI 21.10.2026; формат text.format json_schema
// потрібно підтвердити першим погодженим живим викликом (DESIGN.md, питання JE).
import { AdapterError } from './common.mjs';
import { AGENT_REPLY_SCHEMA } from '../protocol.mjs';

export function buildRequest({ model, instructions, input, maxOutputTokens }) {
  if (!model) throw new AdapterError('model-not-configured', { detail: 'модель задає погодження JE (models.openai)' });
  return {
    model,
    instructions,
    input,
    store: false,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: 'j4_reply', schema: AGENT_REPLY_SCHEMA, strict: true } },
  };
}

export function extractText(resp) {
  if (resp?.error) throw new AdapterError(`provider-error:${resp.error.code ?? 'unknown'}`, { transient: ['server_error', 'rate_limit_exceeded'].includes(resp.error.code) });
  if (resp?.status && resp.status !== 'completed') throw new AdapterError(`provider-status:${resp.status}:${resp.incomplete_details?.reason ?? ''}`);
  const parts = [];
  for (const item of resp?.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      if (c.type === 'refusal') throw new AdapterError('provider-refusal');
    }
  }
  if (!parts.length) throw new AdapterError('provider-empty');
  return parts.join('');
}

export function openaiAdapter({ fetchImpl = globalThis.fetch, baseUrl = 'https://api.openai.com/v1', env = process.env, timeoutMs = 120000 } = {}) {
  return {
    name: 'openai',
    mode: 'sync',
    live: true,
    outputLimit: true, // max_output_tokens у запиті
    requiredEnv: ['OPENAI_API_KEY'],
    async call({ instructions, input, model, limits }) {
      const body = buildRequest({ model, instructions, input, maxOutputTokens: limits.max_output_tokens });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/responses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        throw new AdapterError('network', { transient: true, detail: e?.name ?? '' });
      } finally {
        clearTimeout(timer);
      }
      const requestId = res.headers?.get?.('x-request-id') ?? null;
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        throw new AdapterError(`http-${res.status}`, { transient, detail: json?.error?.code ?? '' });
      }
      const rawText = extractText(json);
      return {
        rawText,
        meta: {
          model_id: json?.model ?? null,
          request_id: requestId ?? json?.id ?? null,
          usage: { input_tokens: json?.usage?.input_tokens ?? null, output_tokens: json?.usage?.output_tokens ?? null },
        },
      };
    },
  };
}
