// Завершення задачі через ADM (T-0009): `j4 close --task T-XXXX --subject <SHA> --checks-ref <файл>`.
// Перехід у done — лише після бар'єра CONTRACT_v0_4.md, розд. 6, на ОДНОМУ subject (acceptance.mjs, без змін).
// Що перевіряється:
//   - перевірки (checks): файл доказів у сховищі штабу з записом на одному рядку, що містить повний subject і
//     `result:` з `pass` без `fail`/`error`; якщо наказ має `verify`, кожна його команда — у такому ж рядку;
//   - рецензія виду checks.review_kind і приймання кожної ролі з acceptance наказу (+ JE для key_decision);
//   - відсутність відкритих ескалацій JE за задачею (у стані J4 і в events.jsonl); невідома ескалація = відкрита;
//   - ідемпотентність: повторний close на тому ж subject не пише нічого; done на іншому subject — відмова.
// Відкриті обов'язкові зауваження окремим джерелом не рахуються: вимога «C3 passed» на тому ж SHA (наказ T-0009).
import fs from 'node:fs';
import path from 'node:path';
import { requestDone, evidenceFromEvents } from './acceptance.mjs';
import { appendAdmEvent, readTaskEvents, TaskEventsError } from './events.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

// Мінімальний розбір потрібних полів order.yaml без залежностей: acceptance і checks.review_kind.
export function orderGate(staffRoot, taskId) {
  const f = path.join(staffRoot, 'tasks', taskId, 'order.yaml');
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8').replace(/#.*$/gm, '');
  const one = (re) => (text.match(re) ?? [])[1] ?? null;
  const acc = text.match(/^acceptance:\s*\{([^}]*)\}/m)?.[1] ?? text.match(/^acceptance:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  const field = (name) => acc.match(new RegExp(`${name}:\\s*([A-Za-z0-9.]+)`))?.[1] ?? null;
  const technical = field('technical');
  const content = field('content');
  const key = field('key_decision');
  const reviewKind = one(/^[ \t]+review_kind:\s*([a-z]+)/m) ?? 'code';
  if (!technical || !content || !['true', 'false'].includes(key)) return { error: 'order-acceptance-unreadable' };
  if (!['code', 'logic', 'none'].includes(reviewKind)) return { error: 'order-review-kind-invalid' };
  // verify: ["команда", ...] в один рядок; ключ є, а команд не розібрано — відмова (безпечний бік)
  const verifyLine = text.match(/^[ \t]+verify:[ \t]*(.*)$/m);
  const verify = verifyLine ? [...verifyLine[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : [];
  if (verifyLine && !verify.length) return { error: 'order-verify-unreadable' };
  return { requiredRoles: [[technical, 'technical'], [content, 'content']], keyDecision: key === 'true', reviewKind, verify };
}

function openEscalations({ store, taskId, entries }) {
  const open = [];
  const known = new Map();
  if (store) {
    for (const f of store.list('escalations')) {
      const e = store.readJson(`escalations/${f}`);
      if (e?.task_id !== taskId) continue;
      known.set(e.escalation_id, e.status);
      if (e.status === 'open') open.push(e.escalation_id);
    }
  }
  // ескалація, записана в журнал задачі, але невідома цьому стану J4 (інший J4_HOME) — консервативно відкрита
  for (const e of entries) {
    if (e.event !== 'escalation') continue;
    const id = e.escalation_id ?? null;
    if (!id || !known.has(id)) open.push(id ?? `seq ${e.seq}`);
  }
  return [...new Set(open)];
}

// Доказ перевірок — запис на одному рядку (як у reports/T-0007/001.yaml): `{cmd: ..., subject: <SHA>, result: "... pass ..."}`.
// Достатньо не згадки SHA, а рядка, де цей SHA стоїть поруч із result: pass і немає fail/error;
// команди verify наказу мають бути в рядках, що пройшли. Інакше checks вважаються не пройденими на subject.
function checksFrom(staffRoot, subject, checksRef, verify = []) {
  const bad = [{ subject, passed: false, evidence_ref: null }];
  if (!checksRef || typeof checksRef !== 'string') return [];
  const rel = path.normalize(checksRef);
  if (path.isAbsolute(rel) || rel.startsWith('..')) return bad;
  const f = path.join(staffRoot, rel);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return bad;
  const passing = fs.readFileSync(f, 'utf8').split('\n').filter((line) => {
    if (!line.includes(subject)) return false;
    const i = line.search(/\bresult:/);
    if (i < 0) return false;
    // «fail 0», «0 fail», «errors: 0» — звичайний підсумок успішного прогону, провалом не вважається
    const result = line.slice(i).replace(/\b(fail\w*|errors?)[ :=]*0\b/gi, '').replace(/\b0[ ]+(fail\w*|errors?)\b/gi, '');
    return /\bpass(ed)?\b/i.test(result) && !/\b(fail\w*|not ok|errors?)\b/i.test(result);
  });
  const ok = passing.length > 0 && verify.every((cmd) => passing.some((line) => line.includes(cmd)));
  return [{ subject, passed: ok, evidence_ref: ok ? rel : null }];
}

export function closeTask({ staffRoot, taskId, subject, checksRef, store = null, now = Date.now() }) {
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

  const esc = openEscalations({ store, taskId, entries });
  if (esc.length) return refuse('open-escalation', esc.map((x) => `escalation:${x}`));

  const ev = evidenceFromEvents(staffRoot, taskId);
  const checks = checksFrom(staffRoot, subject, checksRef, gate.verify);
  const r = requestDone({ by: 'ADM', subject, checks, reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: gate.keyDecision, reviewKind: gate.reviewKind, requiredRoles: gate.requiredRoles });
  if (!r.allowed) return refuse('barrier-not-passed', r.missing);

  try {
    const res = appendAdmEvent(staffRoot, taskId, {
      event: 'state_changed', state: 'done', subject, ref: checks[0].evidence_ref,
      note: `j4 close: acceptanceReady ready:true; requestDone(ADM) allowed:true; review_kind ${gate.reviewKind}; ролі ${gate.requiredRoles.map(([b, x]) => `${b}/${x}`).join(', ')}${gate.keyDecision ? ', JE/key_decision' : ''}`,
    }, { key: `done:${subject}`, now, allowDone: true });
    return { ok: true, already: res.duplicate, entry: res.entry };
  } catch (e) {
    if (e instanceof TaskEventsError) return refuse(e.code);
    throw e;
  }
}
