// Синтетичний адаптер без LLM. Детерміновано відповідає замість агента, щоб перевірити
// маршрутизацію, облік і докази без платних викликів. У журналі завжди позначений mode: stub,
// model_id: null — це не відповідь J5 і не може бути змістовим прийманням.
import { AdapterError } from './common.mjs';

export function stubAdapter({ role = 'J5', scenario = null } = {}) {
  let n = 0;
  return {
    name: 'stub',
    mode: 'sync',
    live: false,
    async call({ message }) {
      n += 1;
      if (scenario) {
        const r = await scenario({ message, n });
        if (r instanceof Error) throw r;
        if (r) return r;
      }
      return {
        rawText: JSON.stringify({
          summary: `${role}-STUB: отримано ${message.msg_id} щодо ${message.task_id} на ${message.subject.ref.slice(0, 12)}`,
          text: `Синтетична відповідь адаптера stub замість ${role}. Зміст не оцінювався. Конверт прийнято: kind=${message.kind}, decision_level=${message.decision_level}, contract=${message.contract.version}.`,
          verdict: 'answer',
          decision_needed: [],
        }),
        meta: { model_id: null, request_id: `stub-${message.msg_id}-${n}`, usage: { input_tokens: null, output_tokens: null } },
      };
    },
  };
}

// Сценарії для тестів.
export const scenarios = {
  transientThenOk: (failures = 1) => ({ n }) => (n <= failures ? new AdapterError('provider-5xx', { transient: true }) : null),
  alwaysTransient: () => () => new AdapterError('provider-5xx', { transient: true }),
  decisionNeeded: (category = 'budget_over_reserve') => () => ({
    rawText: JSON.stringify({ summary: 'Потрібне рішення JE', text: 'Синтетично: перевищення бюджету.', verdict: 'question', decision_needed: [{ category, question: 'Збільшити бюджет понад резерв?' }] }),
    meta: { model_id: null, request_id: 'stub-dn', usage: { input_tokens: null, output_tokens: null } },
  }),
  leaksSecret: () => () => ({
    rawText: JSON.stringify({ summary: 'ключ', text: 'api_key = sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123456', verdict: 'answer', decision_needed: [] }),
    meta: { model_id: null, request_id: 'stub-leak', usage: { input_tokens: null, output_tokens: null } },
  }),
  badSchema: () => () => ({ rawText: '{"summary":"x"}', meta: { model_id: null, request_id: 'stub-bad', usage: {} } }),
  withUsage: (input, output) => () => ({
    rawText: JSON.stringify({ summary: 'ok', text: 'ok', verdict: 'answer', decision_needed: [] }),
    meta: { model_id: 'stub-model', request_id: 'stub-u', usage: { input_tokens: input, output_tokens: output } },
  }),
};
