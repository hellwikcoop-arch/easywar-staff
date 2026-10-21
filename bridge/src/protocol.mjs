// Протокол повідомлень J4 Bridge v0.1 (j4.msg/0.1). Опис полів: bridge/docs/PROTOCOL.md.
// Без залежностей. Лише перевірка форми; права й маршрути — policy.mjs.
import { createHash } from 'node:crypto';

export const PROTOCOL = 'j4.msg/0.1';
export const KINDS = ['request', 'response', 'report', 'ack', 'handoff', 'review', 'escalation', 'command', 'decision'];
export const INTENTS = ['question', 'proposal', 'review_request', 'acceptance_request', 'status', 'task', 'answer', 'other'];
export const LEVELS = ['A', 'B', 'C'];
export const SUBJECT_KINDS = ['commit', 'file_hash', 'doc_version'];
export const DECISION_CATEGORIES = [
  'budget_over_reserve', 'scope_change', 'end_state_change', 'priority_change', 'third_attempt',
  'migration_capabilities_csp', 'release', 'secrets', 'key_visual', 'new_integration', 'other',
];

const TASK_RE = /^T-\d{4}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REF_RE = /^[A-Za-z0-9._\-/]+(@[0-9a-f]{7,64})?$/;

export function sha256(data) {
  return createHash('sha256').update(typeof data === 'string' ? data : Buffer.from(data)).digest('hex');
}

// Канонічний JSON: ключі за абеткою, без пробілів. Основа хешів журналу й тіл.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function bodyHash(body) {
  return sha256(canonical(body ?? null));
}

function err(list, code, field, detail = '') {
  list.push({ code, field, detail });
}

// Перевіряє чернетку від відправника (без полів, які ставить J4) або повне повідомлення.
export function validateMessage(msg, { limits, draft = false } = {}) {
  const e = [];
  const max = { body: limits?.max_body_chars ?? 8000, summary: limits?.max_summary_chars ?? 300 };
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    err(e, 'not-object', '$');
    return e;
  }
  if (msg.protocol !== PROTOCOL) err(e, 'protocol', 'protocol', `очікується ${PROTOCOL}`);
  if (!draft) {
    for (const f of ['msg_id', 'thread_id', 'created_at']) if (typeof msg[f] !== 'string' || !msg[f]) err(e, 'missing', f);
    if (!Number.isInteger(msg.hop) || msg.hop < 0) err(e, 'invalid', 'hop');
  }
  if (!TASK_RE.test(msg.task_id ?? '')) err(e, 'invalid', 'task_id', 'формат T-0000');
  if (!Number.isInteger(msg.task_version) || msg.task_version < 1) err(e, 'invalid', 'task_version');
  if (!msg.contract || typeof msg.contract.version !== 'string' || !SHA256_RE.test(msg.contract.sha256 ?? '')) {
    err(e, 'invalid', 'contract', 'потрібні version і sha256 файла контракту');
  }
  const s = msg.subject;
  if (!s || !SUBJECT_KINDS.includes(s.kind)) err(e, 'invalid', 'subject.kind');
  else if (s.kind === 'commit' && !SHA40_RE.test(s.ref ?? '')) err(e, 'invalid', 'subject.ref', 'повний SHA коміту (40 hex)');
  else if (s.kind === 'file_hash' && !SHA256_RE.test(s.ref ?? '')) err(e, 'invalid', 'subject.ref', 'sha256 файла');
  else if (s.kind === 'doc_version' && (typeof s.ref !== 'string' || !s.ref)) err(e, 'invalid', 'subject.ref');
  for (const f of ['from', 'to']) if (typeof msg[f] !== 'string' || !msg[f]) err(e, 'missing', f);
  if (!KINDS.includes(msg.kind)) err(e, 'invalid', 'kind');
  if (msg.intent !== undefined && !INTENTS.includes(msg.intent)) err(e, 'invalid', 'intent');
  if (!LEVELS.includes(msg.decision_level)) err(e, 'invalid', 'decision_level', 'A | B | C');
  if (msg.data_class !== 'synthetic') err(e, 'data-class', 'data_class', 'дозволено лише synthetic (розділ 9)');
  if (msg.in_reply_to !== undefined && msg.in_reply_to !== null && typeof msg.in_reply_to !== 'string') err(e, 'invalid', 'in_reply_to');

  const b = msg.body;
  if (!b || typeof b !== 'object') err(e, 'missing', 'body');
  else {
    if (typeof b.summary !== 'string' || !b.summary.trim()) err(e, 'missing', 'body.summary');
    else if (b.summary.length > max.summary) err(e, 'too-long', 'body.summary', `> ${max.summary}`);
    if (b.text !== undefined && typeof b.text !== 'string') err(e, 'invalid', 'body.text');
    else if ((b.text ?? '').length > max.body) err(e, 'too-long', 'body.text', `> ${max.body}`);
    if (b.refs !== undefined) {
      if (!Array.isArray(b.refs) || b.refs.length > 20) err(e, 'invalid', 'body.refs');
      else b.refs.forEach((r, i) => { if (typeof r !== 'string' || !REF_RE.test(r) || r.includes('..')) err(e, 'invalid', `body.refs[${i}]`, 'шлях у репозиторії[@sha]'); });
    }
    if (b.decision_needed !== undefined) {
      if (!Array.isArray(b.decision_needed)) err(e, 'invalid', 'body.decision_needed');
      else b.decision_needed.forEach((d, i) => {
        if (!d || !DECISION_CATEGORIES.includes(d.category)) err(e, 'invalid', `body.decision_needed[${i}].category`);
        if (!d || typeof d.question !== 'string' || !d.question.trim()) err(e, 'missing', `body.decision_needed[${i}].question`);
      });
    }
  }
  return e;
}

// Відповідь агента-адаптера (структурований вихід). J4 обгортає її у повне повідомлення.
export const AGENT_REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'text', 'verdict', 'decision_needed'],
  properties: {
    summary: { type: 'string', maxLength: 300 },
    text: { type: 'string', maxLength: 8000 },
    verdict: { type: 'string', enum: ['answer', 'accepted', 'changes_requested', 'question', 'cannot_answer'] },
    decision_needed: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'question'],
        properties: { category: { type: 'string', enum: DECISION_CATEGORIES }, question: { type: 'string', maxLength: 500 } },
      },
    },
  },
};

export function validateAgentReply(r) {
  const e = [];
  if (!r || typeof r !== 'object') return [{ code: 'not-object', field: '$' }];
  const allowed = new Set(Object.keys(AGENT_REPLY_SCHEMA.properties));
  for (const k of Object.keys(r)) if (!allowed.has(k)) err(e, 'unexpected', k);
  if (typeof r.summary !== 'string' || !r.summary.trim() || r.summary.length > 300) err(e, 'invalid', 'summary');
  if (typeof r.text !== 'string' || r.text.length > 8000) err(e, 'invalid', 'text');
  if (!AGENT_REPLY_SCHEMA.properties.verdict.enum.includes(r.verdict)) err(e, 'invalid', 'verdict');
  if (!Array.isArray(r.decision_needed) || r.decision_needed.length > 5) err(e, 'invalid', 'decision_needed');
  else r.decision_needed.forEach((d, i) => {
    if (!d || !DECISION_CATEGORIES.includes(d.category)) err(e, 'invalid', `decision_needed[${i}].category`);
    if (!d || typeof d.question !== 'string' || !d.question.trim()) err(e, 'invalid', `decision_needed[${i}].question`);
  });
  return e;
}
