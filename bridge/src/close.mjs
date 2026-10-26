// Завершення задачі через ADM (T-0009): `j4 close --task T-XXXX --subject <SHA> --checks-ref <файл>`.
// Перехід у done — лише після бар'єра CONTRACT_v0_4.md, розд. 6, на ОДНОМУ subject (acceptance.mjs, без змін).
// Що перевіряється:
//   - перевірки (checks): звичайний файл у сховищі штабу (не симлінк, realpath усередині сховища) із записом на одному
//     рядку, що містить повний subject і `result:` з `pass`; на рядку, поза значенням `cmd:`, немає fail/error
//     (`fail 0` / `0 fail` / `errors: 0` провалом не вважаються); якщо наказ має `verify: ["…", …]`, кожна його команда
//     — у такому ж рядку; нечитаний `verify` — відмова. sha256 файлу доказів пишеться в подію done;
//   - рецензія виду checks.review_kind і приймання кожної ролі з acceptance наказу (+ JE для key_decision);
//   - відсутність відкритих ескалацій JE за задачею: у сховищі J4, у журналі J4 (escalation_raised без
//     escalation_resolved) і в events.jsonl; ескалація, невідома сховищу, але є в журналі, вважається відкритою;
//   - ідемпотентність: повторний close на тому ж subject не пише нічого; done на іншому subject — відмова.
// Відкриті обов'язкові зауваження окремим джерелом не рахуються: вимога «C3 passed» на тому ж SHA (наказ T-0009).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requestDone, evidenceFromEvents } from './acceptance.mjs';
import { appendAdmEvent, readTaskEvents, TaskEventsError } from './events.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

// Коментар YAML `#` — лише поза лапками й після пропуску (або на початку рядка); у лапках `#` — звичайний символ.
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i += 1;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Мінімальний розбір потрібних полів order.yaml без залежностей: acceptance, review_kind і verify.
export function orderGate(staffRoot, taskId) {
  const f = path.join(staffRoot, 'tasks', taskId, 'order.yaml');
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8').split('\n').map(stripComment).join('\n');
  const acc = text.match(/^acceptance:\s*\{([^}]*)\}/m)?.[1] ?? text.match(/^acceptance:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  const field = (name) => acc.match(new RegExp(`${name}:\\s*([A-Za-z0-9.]+)`))?.[1] ?? null;
  const technical = field('technical');
  const content = field('content');
  const key = field('key_decision');
  const reviewKind = text.match(/^[ \t]*review_kind:[ \t]*([a-z]+)[ \t]*$/m)?.[1] ?? 'code';
  if (!technical || !content || !['true', 'false'].includes(key)) return { error: 'order-acceptance-unreadable' };
  if (!['code', 'logic', 'none'].includes(reviewKind)) return { error: 'order-review-kind-invalid' };
  // verify: ["команда", ...] в один рядок, з будь-яким відступом. Ключ є, а список не розібрано до кінця — відмова.
  const verifyLine = text.match(/^[ \t]*verify:[ \t]*(.*)$/m);
  let verify = [];
  if (verifyLine) {
    const q = '"(?:[^"\\\\]|\\\\.)*"';
    const list = verifyLine[1].trim().match(new RegExp(`^\\[\\s*((?:${q}(?:\\s*,\\s*${q})*)?)\\s*\\]$`));
    if (!list) return { error: 'order-verify-unreadable' };
    try {
      verify = [...list[1].matchAll(new RegExp(q, 'g'))].map((m) => JSON.parse(m[0]));
    } catch {
      return { error: 'order-verify-unreadable' };
    }
  }
  return { requiredRoles: [[technical, 'technical'], [content, 'content']], keyDecision: key === 'true', reviewKind, verify };
}

// Відкриті ескалації за задачею з трьох джерел: сховище J4, журнал J4 (ledgerEntries), журнал задачі (entries).
function openEscalations({ store, ledgerEntries, taskId, entries }) {
  const open = new Set();
  const status = new Map();
  if (store) {
    for (const f of store.list('escalations')) {
      const e = store.readJson(`escalations/${f}`);
      if (e?.task_id !== taskId) continue;
      status.set(e.escalation_id, e.status);
      if (e.status === 'open') open.add(e.escalation_id);
    }
  }
  const raised = new Set();
  const resolved = new Set();
  for (const x of ledgerEntries ?? []) {
    if (x.detail?.task_id !== taskId) continue;
    if (x.event === 'escalation_raised') raised.add(x.detail.escalation_id);
    if (x.event === 'escalation_resolved') resolved.add(x.detail.escalation_id);
  }
  for (const id of raised) if (!resolved.has(id) && status.get(id) !== 'resolved') open.add(id);
  // ескалація, записана в журнал задачі, але невідома жодному джерелу J4 (інший J4_HOME) — консервативно відкрита
  for (const e of entries) {
    if (e.event !== 'escalation') continue;
    const id = e.escalation_id ?? null;
    if (!id) open.add(`seq ${e.seq}`);
    else if (!status.has(id) && !raised.has(id)) open.add(id);
  }
  return [...open];
}

// Доказ перевірок — запис на одному рядку (як у reports/T-0007/001.yaml): `{cmd: ..., subject: <SHA>, result: "... pass ..."}`.
// Достатньо не згадки SHA, а рядка, де цей SHA стоїть поруч із result: pass і немає fail/error (поза значенням cmd);
// команди verify наказу мають бути в рядках, що пройшли. Файл — звичайний, не симлінк, realpath усередині сховища.
function checksFrom(staffRoot, subject, checksRef, verify = []) {
  const bad = { checks: [{ subject, passed: false, evidence_ref: null }], sha256: null };
  if (!checksRef || typeof checksRef !== 'string') return { checks: [], sha256: null };
  const rel = path.normalize(checksRef);
  if (path.isAbsolute(rel) || rel.startsWith('..')) return bad;
  const f = path.join(staffRoot, rel);
  let real;
  try {
    if (!fs.lstatSync(f).isFile()) return bad; // lstat: симлінк тут не файл
    real = fs.realpathSync(f);
    if (!real.startsWith(`${fs.realpathSync(staffRoot)}${path.sep}`)) return bad;
  } catch {
    return bad;
  }
  const buf = fs.readFileSync(real);
  const passing = buf.toString('utf8').split('\n').filter((line) => {
    if (!line.includes(subject)) return false;
    const rest = line.replace(/\bcmd:\s*"(?:[^"\\]|\\.)*"/g, '');
    if (rest.search(/\bresult:/) < 0) return false;
    // «fail 0», «0 fail», «errors: 0» — звичайний підсумок успішного прогону, провалом не вважається
    const cleaned = rest.replace(/\b(fail\w*|errors?)[ :=]*0\b/gi, '').replace(/\b0[ ]+(fail\w*|errors?)\b/gi, '');
    return /\bpass(ed)?\b/i.test(cleaned.slice(cleaned.search(/\bresult:/))) && !/\b(fail\w*|not ok|errors?)\b/i.test(cleaned);
  });
  const ok = passing.length > 0 && verify.every((cmd) => passing.some((line) => line.includes(cmd)));
  return { checks: [{ subject, passed: ok, evidence_ref: ok ? rel : null }], sha256: ok ? createHash('sha256').update(buf).digest('hex') : null };
}

export function closeTask({ staffRoot, taskId, subject, checksRef, store = null, ledgerEntries = null, now = Date.now() }) {
  const refuse = (code, missing = []) => ({ ok: false, code, missing });
  if (!SHA40.test(subject ?? '')) return refuse('subject-invalid');
  let entries;
  try {
    entries = readTaskEvents(staffRoot, taskId).entries;
  } catch (e) {
    if (e instanceof TaskEventsError) return refuse(e.code);
    throw e;
  }
  const done = entries.filter((e) => e.event === 'state_changed' && e.state === 'done');
  if (done.some((e) => e.subject === subject)) return { ok: true, already: true, entry: done.find((e) => e.subject === subject) };
  if (done.length) return refuse('done-exists-other-subject');

  const gate = orderGate(staffRoot, taskId);
  if (!gate) return refuse('order-missing');
  if (gate.error) return refuse(gate.error);

  const esc = openEscalations({ store, ledgerEntries, taskId, entries });
  if (esc.length) return refuse('open-escalation', esc.map((x) => `escalation:${x}`));

  const ev = evidenceFromEvents(staffRoot, taskId);
  const { checks, sha256 } = checksFrom(staffRoot, subject, checksRef, gate.verify);
  const r = requestDone({ by: 'ADM', subject, checks, reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: gate.keyDecision, reviewKind: gate.reviewKind, requiredRoles: gate.requiredRoles });
  if (!r.allowed) return refuse('barrier-not-passed', r.missing);

  try {
    const res = appendAdmEvent(staffRoot, taskId, {
      event: 'state_changed', state: 'done', subject, ref: checks[0].evidence_ref, evidence_sha256: sha256,
      note: `j4 close: acceptanceReady ready:true; requestDone(ADM) allowed:true; review_kind ${gate.reviewKind}; ролі ${gate.requiredRoles.map(([b, x]) => `${b}/${x}`).join(', ')}${gate.keyDecision ? ', JE/key_decision' : ''}`,
    }, { key: `done:${subject}`, now, allowDone: true });
    return { ok: true, already: res.duplicate, entry: res.entry };
  } catch (e) {
    if (e instanceof TaskEventsError) return refuse(e.code);
    throw e;
  }
}
