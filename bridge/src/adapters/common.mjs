// Спільне для адаптерів: помилка з ознакою тимчасовості та розбір структурованої відповіді агента.
import { redact } from '../scanner.mjs';
import { validateAgentReply } from '../protocol.mjs';

export class AdapterError extends Error {
  constructor(code, { transient = false, detail = '' } = {}) {
    super(code);
    this.code = code;
    this.transient = transient;
    this.detail = redact(String(detail));
  }
}

export function parseAgentJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
    if (!m) throw new AdapterError('reply-not-json');
    try {
      obj = JSON.parse(m[0]);
    } catch {
      throw new AdapterError('reply-not-json');
    }
  }
  const errors = validateAgentReply(obj);
  if (errors.length) throw new AdapterError('reply-schema', { detail: errors.map((e) => `${e.field}:${e.code}`).join(',') });
  return obj;
}

// Текст для агента: конверт і тіло повідомлення. Інструкції ролі передаються окремо.
export function renderInput(msg) {
  const env = {
    msg_id: msg.msg_id, thread_id: msg.thread_id, task_id: msg.task_id, task_version: msg.task_version,
    contract: msg.contract, subject: msg.subject, from: msg.from, to: msg.to, kind: msg.kind,
    intent: msg.intent ?? null, decision_level: msg.decision_level, data_class: msg.data_class,
  };
  return [
    'J4 ENVELOPE (json):',
    JSON.stringify(env),
    'SUMMARY:',
    msg.body.summary,
    'TEXT:',
    msg.body.text ?? '',
    'REFS:',
    (msg.body.refs ?? []).join('\n') || '-',
    'Відповідай лише JSON за схемою j4_reply.',
  ].join('\n');
}
