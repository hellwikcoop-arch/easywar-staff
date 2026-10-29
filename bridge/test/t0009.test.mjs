// T-0009: автоматизація J4 — черга за розкладом (run --once, j4-tick.sh), події ADM у events.jsonl, j4 close.
// Лише stub і синтетичні дані. Адаптерних викликів у цьому файлі рівно 2 (сценарій Q1); решта — без адаптера:
// J5 у тестах API не налаштовано, тож J4 кладе повідомлення в скриньку (deposit) без виклику.
// Сховище штабу для CLI — копія у тимчасовому каталозі (J4_STAFF_ROOT), справжнє сховище тести не змінюють.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BRIDGE_DIR } from '../src/policy.mjs';
import { appendAdmEvent, readTaskEvents } from '../src/events.mjs';
import { closeTask, orderGate } from '../src/close.mjs';
import { Store } from '../src/store.mjs';
import { Ledger } from '../src/ledger.mjs';
import { tmpStaff, draft, makeJ4, openEscalations, events as ledgerEvents, SHA_A, SHA_B } from './helpers.mjs';

const CLI = path.join(BRIDGE_DIR, 'bin', 'j4.mjs');
const TICK = path.join(BRIDGE_DIR, 'bin', 'j4-tick.sh');
const T = 'T-0900';

const taskEvents = (root, id = T) => readTaskEvents(root, id).entries;
const addEvent = (root, e, id = T) => fs.appendFileSync(path.join(root, 'tasks', id, 'events.jsonl'), `${JSON.stringify({ task_id: id, ...e })}\n`);

function order(root, { key = false, review = 'code', id = T } = {}) {
  fs.writeFileSync(path.join(root, 'tasks', id, 'order.yaml'), [
    `id: ${id}`, 'data_class: synthetic',
    `acceptance: {technical: J3, content: J5, key_decision: ${key}}   # коментар`,
    'checks:', '  subject_kind: commit', `  review_kind: ${review}`, '',
  ].join('\n'));
}

function evidence(root, subject = SHA_A) {
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  // T-0012 (R11-13, C3H-8): запис без cmd більше не є доказом навіть без verify — фікстура містить cmd
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), `- {cmd: "node --test 'bridge/test/*.test.mjs'", subject: ${subject}, result: pass}\n`);
  return 'reports/checks.yaml';
}

// T-0012: до коду бар'єра додаються причини розбору доказів (evidence-*) — перевіряємо код і префікс причин
const notOnSubject = (r, msg) => { assert.equal(r.missing[0], 'checks-not-on-subject-or-failed', msg); assert.ok(r.missing.length >= 1 && r.missing.slice(1).every((m) => m.startsWith('evidence-')), `${msg ?? ''} ${JSON.stringify(r.missing)}`); };

function fullAcceptance(root, subject = SHA_A) {
  addEvent(root, { event: 'review_finished', by: 'C3', subject, review_status: 'complete', verdict: 'passed', ref: 'r' });
  addEvent(root, { event: 'acceptance', by: 'J3', role: 'technical', subject, result: 'accepted', scope: 'full', ref: 'a' });
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject, result: 'accepted', scope: 'full', ref: 'b' });
}

function cliEnv(root, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: root, J4_HOME: path.join(root, '.j4'), J4_LEDGER: path.join(root, 'ledger.jsonl'), J4_MONTHLY_BUDGET: path.join(root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS']) if (!(k in extra)) delete env[k];
  return env;
}

function cli(root, args, extra) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: cliEnv(root, extra), encoding: 'utf8', timeout: 60000 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, json, stderr: r.stderr };
}

const adapterCalls = (root) => ledgerEvents(root, 'dispatch_attempt').length;

// Справжні (порожні) сховище й журнал J4 у тимчасовому сховищі: close вимагає, щоб обидва існували й читались.
const prepareJ4 = (root) => {
  new Store(path.join(root, '.j4'));
  new Ledger(path.join(root, 'ledger.jsonl'));
};
// Обидва джерела ескалацій J4 для бібліотечного closeTask (store і ledgerEntries обов'язкові).
const src = (root) => ({ store: new Store(path.join(root, '.j4')), ledgerEntries: new Ledger(path.join(root, 'ledger.jsonl')).readAll().entries });

// ---------- B. Події ADM у events.jsonl ----------

test('T-0009 E1: J4 пише report_filed і escalation з ref на журнал J4; повтор не дублює; seq продовжується', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: {} });
  j4.taskEvents = true;
  assert.equal(j4.submit(draft(root, { kind: 'report', intent: 'status', body: { summary: 'синтетичне донесення' } }), { origin: 'agent_cli' }).ok, true);
  assert.equal(j4.submit(draft(root, { decision_level: 'C', body: { summary: 'питання рівня C' } }), { origin: 'agent_cli' }).status, 'held');
  const r1 = await j4.process();
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.events, { written: 2, duplicate: 0, failed: 0 });
  const ev = taskEvents(root);
  assert.deepEqual(ev.map((e) => [e.seq, e.event, e.by]), [[1, 'task_accepted', 'J3'], [2, 'report_filed', 'ADM'], [3, 'escalation', 'ADM']]);
  for (const e of ev.slice(1)) {
    assert.equal(e.subject, SHA_A);
    assert.match(e.ref, /^j4-ledger#seq=\d+$/);
    assert.equal(e.ledger_file, 'ledger.jsonl'); // файл і seq (CONTRACT 9а.3), без повного шляху
    const led = JSON.parse(fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8').split('\n')[Number(e.ref.split('=')[1]) - 1]);
    assert.equal(led.hash, e.ledger_hash);
  }
  assert.equal(ev[1].report_author, 'J3');
  assert.equal(ev[2].reason, 'decision_level_c');
  // другий прохід (і новий процес) — нуль нових записів
  const r2 = await makeJ4(root, { adapters: {} }).process();
  assert.equal(r2.events.written, 0);
  const j4b = makeJ4(root, { adapters: {} });
  j4b.taskEvents = true;
  assert.deepEqual((await j4b.process()).events, { written: 0, duplicate: 2, failed: 0 });
  assert.equal(taskEvents(root).length, 3);
  assert.equal(adapterCalls(root), 0);
  // рішень JE і приймань автоматично не з'явилось; рівень C досі утримано
  assert.equal(taskEvents(root).filter((e) => ['acceptance', 'command', 'decision', 'state_changed'].includes(e.event)).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.j4', 'messages', 'M-T-0900-0002.json'), 'utf8')).status, 'held');
});

test('T-0009 E2: заборонені події й автори відхиляються; state_changed — лише через close', () => {
  const root = tmpStaff();
  for (const event of ['acceptance', 'review_finished', 'command', 'decision', 'task_accepted', 'amendment_approved', 'third_attempt_approved']) {
    assert.throws(() => appendAdmEvent(root, T, { event, by: 'ADM' }, { key: `k-${event}` }), { code: 'event-not-allowed' }, event);
  }
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed', by: 'JE' }, { key: 'k1' }), { code: 'by-not-adm' });
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed', by: 'J5' }, { key: 'k2' }), { code: 'by-not-adm' });
  assert.throws(() => appendAdmEvent(root, T, { event: 'state_changed', state: 'done', subject: SHA_A }, { key: 'k3' }), { code: 'state-change-not-allowed' });
  assert.throws(() => appendAdmEvent(root, T, { event: 'state_changed', state: 'working' }, { key: 'k4', allowDone: true }), { code: 'state-change-not-allowed' });
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed' }, {}), { code: 'key-required' });
  assert.throws(() => appendAdmEvent(root, 'T-0901', { event: 'report_filed' }, { key: 'k5' }), { code: 'task-unknown' });
  assert.throws(() => appendAdmEvent(root, '../x', { event: 'report_filed' }, { key: 'k6' }), { code: 'task-id-invalid' });
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed', note: 'api_key = sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123456' }, { key: 'k7' }), { code: 'scanner-block' });
  assert.equal(taskEvents(root).length, 1);
});

test('T-0009 E3: пошкоджений журнал задачі не перезаписується; паралельні записи дають неперервний seq', async () => {
  const root = tmpStaff();
  const f = path.join(root, 'tasks', T, 'events.jsonl');
  fs.appendFileSync(f, '{"seq":2,"event":"report_filed"');   // обірваний рядок
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed' }, { key: 'x' }), { code: 'events-corrupt' });
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  fs.writeFileSync(f, before.slice(0, before.lastIndexOf('\n') + 1));

  // 4 процеси × 5 подій одночасно
  const mod = JSON.stringify(pathToFileURL(path.join(BRIDGE_DIR, 'src', 'events.mjs')).href);
  const kids = [0, 1, 2, 3].map((w) => new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e',
      `const { appendAdmEvent } = await import(${mod}); for (let i = 0; i < 5; i++) appendAdmEvent(${JSON.stringify(root)}, 'T-0900', { event: 'report_filed' }, { key: 'w${w}-' + i });`], { signal: AbortSignal.timeout(60000) });
    p.on('exit', resolve);
  }));
  assert.deepEqual(await Promise.all(kids), [0, 0, 0, 0]);
  const ev = taskEvents(root);
  assert.equal(ev.length, 21);
  assert.deepEqual(ev.map((e) => e.seq), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(new Set(ev.map((e) => e.j4_key)).size, 21);
  assert.ok(fs.readFileSync(f, 'utf8').endsWith('\n'));
});

test('T-0009 E4: збій під час синхронізації — наступний прохід дописує без дублікатів', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: {} });
  j4.submit(draft(root, { decision_level: 'C', body: { summary: 'рівень C №1' } }), { origin: 'agent_cli' });
  j4.submit(draft(root, { kind: 'report', intent: 'status', body: { summary: 'донесення №1' } }), { origin: 'agent_cli' });
  // «збій»: записано лише першу подію, процес загинув
  const first = ledgerEvents(root, 'escalation_raised')[0];
  appendAdmEvent(root, T, { event: 'escalation', ref: `j4-ledger#seq=${first.seq}`, ledger_hash: first.hash }, { key: `j4:${first.hash.slice(0, 32)}` });
  const j4b = makeJ4(root, { adapters: {} });
  j4b.taskEvents = true;
  const r = await j4b.process();
  assert.deepEqual(r.events, { written: 1, duplicate: 1, failed: 0 });
  assert.deepEqual(taskEvents(root).map((e) => e.event), ['task_accepted', 'escalation', 'report_filed']);
});

test('T-0009 E5: ручний допис не губиться; службові поля не підміняються; null-рядок і done без subject відхиляються', () => {
  const root = tmpStaff();
  const f = path.join(root, 'tasks', T, 'events.jsonl');
  const manual = (n) => fs.appendFileSync(f, `${JSON.stringify({ seq: n, event: 'command', task_id: T, by: 'JE', note: 'ручний запис' })}\n`);
  // ручний `>>` у вікні між читанням і записом ADM: запис ADM перечитує файл, чужий рядок лишається, seq продовжується
  let reads = 0;
  const res = appendAdmEvent(root, T, { event: 'report_filed' }, { key: 'm1', hooks: { afterRead: () => { reads += 1; if (reads === 1) manual(2); } } });
  assert.equal(reads, 2, 'після зміни файлу — перечитування');
  assert.deepEqual(taskEvents(root).map((e) => [e.seq, e.event, e.by]), [[1, 'task_accepted', 'J3'], [2, 'command', 'JE'], [3, 'report_filed', 'ADM']]);
  assert.equal(res.entry.seq, 3);
  // файл змінюють щоразу — після 5 спроб events-busy, нічого не затерто
  let n = 3;
  assert.throws(() => appendAdmEvent(root, T, { event: 'report_filed' }, { key: 'm2', hooks: { afterRead: () => manual(++n) } }), { code: 'events-busy' });
  assert.equal(taskEvents(root).length, 3 + 5);
  assert.equal(taskEvents(root).filter((e) => e.j4_key === 'm2').length, 0);

  // службові поля подія від викликача підмінити не може
  const root2 = tmpStaff();
  const e = appendAdmEvent(root2, T, { event: 'report_filed', seq: 99, task_id: 'T-0001', at: 'x', j4_key: 'evil', by: 'ADM' }, { key: 'k1', now: Date.UTC(2026, 9, 26) }).entry;
  assert.deepEqual([e.seq, e.task_id, e.by, e.j4_key, e.at], [2, T, 'ADM', 'k1', '2026-10-26T00:00:00.000Z']);

  // рядок JSON `null` — пошкодження, а не TypeError; close це теж бачить
  const root3 = tmpStaff();
  fs.appendFileSync(path.join(root3, 'tasks', T, 'events.jsonl'), 'null\n');
  assert.throws(() => appendAdmEvent(root3, T, { event: 'report_filed' }, { key: 'n1' }), { code: 'events-corrupt' });
  assert.equal(closeTask({ staffRoot: root3, taskId: T, subject: SHA_A, checksRef: null, ...src(root3) }).code, 'events-corrupt');

  // done без контрольного SHA неможливий навіть через allowDone
  assert.throws(() => appendAdmEvent(root2, T, { event: 'state_changed', state: 'done' }, { key: 'd1', allowDone: true }), { code: 'subject-invalid' });
});

// ---------- C. j4 close ----------

test('T-0009 C1: close відмовляє без повного комплекту на одному SHA; done лише після бар\'єра', () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  const close = (subject = SHA_A, checksRef = ref) => closeTask({ staffRoot: root, taskId: T, subject, checksRef, ...src(root) });

  assert.deepEqual(close().missing, ['review-C3-missing', 'acceptance-J3-technical-missing', 'acceptance-J5-content-missing']);
  addEvent(root, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r' });
  addEvent(root, { event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'a' });
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject: SHA_B, result: 'accepted', scope: 'full', ref: 'b' });
  assert.deepEqual(close().missing, ['acceptance-J5-content-missing'], 'J5 на іншому SHA не зараховано');
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'b2' });
  // перевірки: файл без контрольного SHA, відсутній файл, шлях поза сховищем
  fs.writeFileSync(path.join(root, 'reports', 'other.yaml'), `subject: ${SHA_B}\n`);
  assert.deepEqual(close(SHA_A, 'reports/other.yaml').missing, ['checks-not-on-subject-or-failed', 'evidence-no-record-on-subject']);   // T-0012: причина розбору
  assert.deepEqual(close(SHA_A, 'reports/none.yaml').missing, ['checks-not-on-subject-or-failed']);
  assert.deepEqual(close(SHA_A, '../outside.yaml').missing, ['checks-not-on-subject-or-failed']);
  assert.deepEqual(close(SHA_A, null).missing, ['checks-missing']);
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 0);

  const ok = close();
  assert.equal(ok.ok, true);
  assert.equal(ok.already, false);
  assert.equal(ok.entry.by, 'ADM');
  assert.equal(ok.entry.state, 'done');
  assert.equal(ok.entry.subject, SHA_A);
  assert.equal(ok.entry.ref, ref);
  // ідемпотентність і другий SHA
  const n = taskEvents(root).length;
  assert.equal(close().already, true);
  assert.equal(taskEvents(root).length, n);
  assert.equal(close(SHA_B).code, 'done-exists-other-subject');
  assert.equal(taskEvents(root).length, n);
});

test('T-0009 C2: відкрита ескалація JE, key_decision і пізніший changes_requested блокують close', async () => {
  // відкрита ескалація в стані J4
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  fullAcceptance(root);
  const j4 = makeJ4(root, { adapters: {} });
  j4.submit(draft(root, { decision_level: 'C' }), { origin: 'agent_cli' });
  const r = closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, ...src(root) });
  assert.equal(r.code, 'open-escalation');
  assert.match(r.missing[0], /^escalation:E-T-0900-/);

  // ескалація в журналі задачі, невідома цьому стану J4 (інший J4_HOME) — теж відкрита
  const root2 = tmpStaff();
  order(root2);
  fullAcceptance(root2);
  appendAdmEvent(root2, T, { event: 'escalation', escalation_id: 'E-T-0900-007' }, { key: 'esc-7' });
  assert.equal(closeTask({ staffRoot: root2, taskId: T, subject: SHA_A, checksRef: evidence(root2), ...src(root2) }).code, 'open-escalation');

  // key_decision: true вимагає приймання JE
  const root3 = tmpStaff();
  order(root3, { key: true });
  fullAcceptance(root3);
  assert.deepEqual(closeTask({ staffRoot: root3, taskId: T, subject: SHA_A, checksRef: evidence(root3), ...src(root3) }).missing, ['acceptance-JE-key_decision-missing']);

  // пізніший changes_requested C3 закриває бар'єр
  const root4 = tmpStaff();
  order(root4);
  fullAcceptance(root4);
  addEvent(root4, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'changes_requested', ref: 'r2' });
  assert.deepEqual(closeTask({ staffRoot: root4, taskId: T, subject: SHA_A, checksRef: evidence(root4), ...src(root4) }).missing, ['review-C3-not-passed']);

  // без наказу або з нечитаним acceptance — відмова
  const root5 = tmpStaff();
  assert.equal(closeTask({ staffRoot: root5, taskId: T, subject: SHA_A, checksRef: evidence(root5), ...src(root5) }).code, 'order-missing');
  fs.writeFileSync(path.join(root5, 'tasks', T, 'order.yaml'), 'acceptance: {technical: J3}\n');
  assert.equal(orderGate(root5, T).error, 'order-acceptance-unreadable');
});

test('T-0009 C3: j4 close через CLI — повтор ідемпотентний, стоп-кран 4, відкрита ескалація блокує, resolved знімає, без J4_HOME/J4_LEDGER — відмова', () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  fullAcceptance(root);
  prepareJ4(root);
  const args = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref];
  // без явних J4_HOME і J4_LEDGER close не знає, де шукати ескалації, — відмова до будь-якого запису
  const env = cliEnv(root);
  delete env.J4_HOME;
  delete env.J4_LEDGER;
  const blind = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(blind.status, 3);
  assert.equal(JSON.parse(blind.stdout).code, 'escalation-source-unknown');
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 0);

  const a = cli(root, args);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.entry.state, 'done');
  assert.match(a.json.entry.evidence_sha256, /^[0-9a-f]{64}$/);
  const b = cli(root, args);
  assert.equal(b.code, 0);
  assert.equal(b.json.already, true);
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 1);
  assert.equal(cli(root, args, { J4_HALT: '1' }).code, 4);

  // відкрита ескалація JE (сховище й журнал J4 цього сховища) блокує; після resolve (origin human_cli) — дозволено
  const root2 = tmpStaff();
  order(root2);
  const ref2 = evidence(root2);
  fullAcceptance(root2);
  const j4 = makeJ4(root2, { adapters: {} });
  j4.submit(draft(root2, { decision_level: 'C' }), { origin: 'agent_cli' });
  const args2 = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref2];
  const blocked = cli(root2, args2);
  assert.equal(blocked.code, 3);
  assert.equal(blocked.json.code, 'open-escalation');
  const esc = openEscalations(root2)[0];
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'release' }, { origin: 'agent_cli' }).code, 'origin-denied');
  assert.equal(cli(root2, args2).code, 3, 'агент ескалацію не знімає');
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'release' }, { origin: 'human_cli' }).ok, true);
  assert.equal(cli(root2, args2).code, 0);
  assert.equal(adapterCalls(root2), 0);
});

test('T-0009 C4: checks — не згадка SHA, а рядок result: pass на subject і команди verify з наказу; симлінки, fail до result, # у verify', () => {
  const CMD = "node --test 'bridge/test/*.test.mjs'";
  const setup = (verifyLine) => {
    const root = tmpStaff();
    fullAcceptance(root);
    fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), [
      `id: ${T}`, 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', verifyLine, '  review_kind: code', '',
    ].join('\n'));
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    const file = (name, text) => {
      fs.writeFileSync(path.join(root, 'reports', name), text);
      return `reports/${name}`;
    };
    const close = (ref) => closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, ...src(root) });
    return { root, file, close };
  };
  const NOT = ['checks-not-on-subject-or-failed'];

  const a = setup(`  verify: ["${CMD}"]`);
  notOnSubject(a.close(a.file('mention.yaml', `note: контрольний SHA ${SHA_A}\n`)));                                       // лише згадка
  notOnSubject(a.close(a.file('nopass.yaml', `- {cmd: "${CMD}", subject: ${SHA_A}, result: "75/76 pass, 1 fail"}\n`)));    // є fail
  notOnSubject(a.close(a.file('failfirst.yaml', `- {fail: 3, cmd: "${CMD}", subject: ${SHA_A}, result: pass}\n`)));         // fail до result
  notOnSubject(a.close(a.file('othercmd.yaml', `- {cmd: "інша команда", subject: ${SHA_A}, result: "pass"}\n`)));          // немає команди verify
  notOnSubject(a.close(a.file('othersha.yaml', `- {cmd: "${CMD}", subject: ${SHA_B}, result: "pass"}\n`)));                 // інший SHA
  // симлінк на файл поза сховищем і файл у каталозі-симлінку поза сховищем — відмова, хоч вміст «ідеальний»
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-outside-'));
  fs.writeFileSync(path.join(outside, 'good.yaml'), `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass"}\n`);
  fs.symlinkSync(path.join(outside, 'good.yaml'), path.join(a.root, 'reports', 'link.yaml'));
  fs.symlinkSync(outside, path.join(a.root, 'reports', 'dirlink'));
  notOnSubject(a.close('reports/link.yaml'));
  notOnSubject(a.close('reports/dirlink/good.yaml'));
  assert.equal(taskEvents(a.root).filter((e) => e.event === 'state_changed').length, 0);
  const text = `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass, fail 0", by: J3}\n`;
  const good = a.close(a.file('good.yaml', text));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(good.entry.ref, 'reports/good.yaml');
  assert.equal(good.entry.evidence_sha256, createHash('sha256').update(text).digest('hex'));

  // слово fail у значенні cmd провалом не є
  const b = setup(`  verify: ["${CMD}"]`);
  assert.equal(b.close(b.file('c.yaml', `- {cmd: "${CMD} --test-name-pattern failover", subject: ${SHA_A}, result: "76/76 pass"}\n`)).ok, true);

  // `#` усередині лапок — не коментар: друга команда verify не губиться; коментар після значення прибирається
  const c = setup('  verify: ["echo A", "echo B # x"]   # коментар');
  assert.deepEqual(orderGate(c.root, T).verify, ['echo A', 'echo B # x']);
  notOnSubject(c.close(c.file('onlyA.yaml', `- {cmd: "echo A", subject: ${SHA_A}, result: pass}\n`)));
  assert.equal(c.close(c.file('both.yaml', `- {cmd: "echo A", subject: ${SHA_A}, result: pass}\n- {cmd: "echo B # x", subject: ${SHA_A}, result: pass}\n`)).ok, true);

  // verify без відступу діє; нечитаний (блоковий) verify і порожній ключ — безпечна відмова
  const d = setup('verify: ["echo A"]');
  notOnSubject(d.close(d.file('x.yaml', `- {cmd: "echo B", subject: ${SHA_A}, result: pass}\n`)));
  for (const bad of ['  verify:\n    - "echo A"', '  verify: [echo A]', '  verify: ["echo A", ]', '  verify: null']) {
    const e = setup(bad);
    assert.equal(e.close(e.file('y.yaml', `- {cmd: "echo A", subject: ${SHA_A}, result: pass}\n`)).code, 'order-verify-unreadable', bad);
  }
  // явно порожній список — команд не вимагається, але рядок із pass на subject усе одно потрібен
  const f = setup('  verify: []');
  notOnSubject(f.close(f.file('z.yaml', `note: ${SHA_A}\n`)));
  // T-0012 (R11-13, C3H-8): запис без cmd більше не є доказом і без verify; потрібен хоча б один запис із cmd
  assert.deepEqual(f.close(f.file('w.yaml', `{subject: ${SHA_A}, result: pass}\n`)).missing, ['checks-not-on-subject-or-failed', 'evidence-no-cmd-record']);
  assert.equal(f.close(f.file('w2.yaml', `- {cmd: "echo A", subject: ${SHA_A}, result: pass}\n`)).ok, true);
});

test('T-0009 C5: ескалація з журналу J4 видна при порожньому сховищі J4; resolved у журналі її знімає; гонка двох close дає один done', async () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  fullAcceptance(root);
  const j4 = makeJ4(root, { adapters: {} });
  j4.submit(draft(root, { decision_level: 'C' }), { origin: 'agent_cli' });
  const ledgerEntries = () => new Ledger(path.join(root, 'ledger.jsonl')).readAll().entries;
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-clone-'));
  fs.cpSync(root, clone, { recursive: true });   // контроль на копії: без журналу J4 ескалація невидима
  const elsewhere = new Store(path.join(root, 'other-home'));   // «інший J4_HOME»: ескалацій у ньому немає
  const close = () => closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, store: elsewhere, ledgerEntries: ledgerEntries() });
  assert.equal(close().code, 'open-escalation');
  assert.equal(closeTask({ staffRoot: clone, taskId: T, subject: SHA_A, checksRef: ref, store: new Store(path.join(clone, 'other-home')), ledgerEntries: [] }).ok, true, 'з порожнім списком журналу така ескалація невидима — тому CLI читає журнал суворо (C6/C7)');
  assert.deepEqual(closeTask({ staffRoot: clone, taskId: T, subject: SHA_A, checksRef: ref, store: new Store(path.join(clone, 'other-home')) }).missing, ['ledgerEntries'], 'бібліотека не приймає виклик без журналу J4');
  assert.deepEqual(closeTask({ staffRoot: clone, taskId: T, subject: SHA_A, checksRef: ref, ledgerEntries: [] }).missing, ['store'], 'і без сховища J4');
  const esc = openEscalations(root)[0];
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'release' }, { origin: 'human_cli' }).ok, true);
  assert.equal(close().ok, true);

  // гонка: два процеси close з різними subject одночасно — рівно один done
  const root2 = tmpStaff();
  order(root2);
  const ref2 = evidence(root2);
  fs.writeFileSync(path.join(root2, ref2), `- {cmd: "echo A", subject: ${SHA_A}, result: pass}\n- {cmd: "echo A", subject: ${SHA_B}, result: pass}\n`);   // T-0012: запис із cmd
  fullAcceptance(root2, SHA_A);
  fullAcceptance(root2, SHA_B);
  prepareJ4(root2);
  const run = (subject) => new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'close', '--task', T, '--subject', subject, '--checks-ref', ref2], { env: cliEnv(root2), signal: AbortSignal.timeout(60000) });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, json: JSON.parse(out) }));
  });
  const [x, y] = await Promise.all([run(SHA_A), run(SHA_B)]);
  assert.deepEqual([x.code, y.code].sort(), [0, 3]);
  assert.match([x, y].find((r) => r.code === 3).json.code, /^done-exists/);
  assert.equal(taskEvents(root2).filter((e) => e.event === 'state_changed').length, 1);
});

test('T-0009 C6: CLI передає журнал J4 у перевірку ескалацій — ескалація лише в журналі видна при порожньому J4_HOME; resolved у журналі знімає', () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  fullAcceptance(root);
  const j4 = makeJ4(root, { adapters: {} });
  j4.submit(draft(root, { decision_level: 'C' }), { origin: 'agent_cli' });
  const other = path.join(root, 'other-home');
  assert.deepEqual(new Store(other).list('escalations'), [], 'інше сховище J4 порожнє: ескалації в ньому немає');
  const args = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref];
  const blocked = cli(root, args, { J4_HOME: other });
  assert.equal(blocked.code, 3, blocked.stderr);
  assert.equal(blocked.json.code, 'open-escalation', 'бачить лише журнал J4 — значить, CLI справді його читає й передає');
  assert.match(blocked.json.missing[0], /^escalation:E-T-0900-/);
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 0);
  const esc = openEscalations(root)[0];
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'release' }, { origin: 'human_cli' }).ok, true);
  const ok = cli(root, args, { J4_HOME: other });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.json.entry.state, 'done');
  assert.equal(adapterCalls(root), 0);
});

test('T-0009 C7: j4 close відмовляє без запису, якщо журнал J4 відсутній, обірваний, пошкоджений чи не файл, а J4_HOME — не сховище J4', () => {
  const base = () => {
    const root = tmpStaff();
    order(root);
    const ref = evidence(root);
    fullAcceptance(root);
    prepareJ4(root);
    const led = new Ledger(path.join(root, 'ledger.jsonl'));
    for (let n = 1; n <= 3; n += 1) led.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } });
    return { root, args: ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], file: path.join(root, 'ledger.jsonl') };
  };
  const refused = (t, reason, extra) => {
    const r = cli(t.root, t.args, extra);
    assert.equal(r.code, 3, `${reason}: ${r.stderr}`);
    assert.equal(r.json.code, 'escalation-source-unreadable', reason);
    assert.deepEqual(r.json.missing, [reason], reason);
    assert.equal(taskEvents(t.root).filter((e) => e.event === 'state_changed').length, 0, `${reason}: done не записано`);
    // журнал навмисно пошкоджено, тож рахуємо dispatch_attempt текстом, а не розбором JSON
    assert.equal(fs.readFileSync(t.file, 'utf8').split('\n').filter((l) => l.includes('"dispatch_attempt"')).length, 0);
    return r;
  };
  const lines = (file) => fs.readFileSync(file, 'utf8').split('\n');

  // контроль: цілий журнал приймається
  const t0 = base();
  assert.equal(cli(t0.root, t0.args).code, 0);

  // журнал відсутній (друкарська помилка в J4_LEDGER) — файл не створюється
  const t1 = base();
  const nowhere = path.join(t1.root, 'no-such-ledger.jsonl');
  refused(t1, 'ledger-missing', { J4_LEDGER: nowhere });
  assert.equal(fs.existsSync(nowhere), false);

  // обірваний останній рядок
  const t2 = base();
  fs.appendFileSync(t2.file, '{"event":"half"');
  refused(t2, 'ledger-partial');

  // змінене значення всередині запису — не збігається хеш
  const t3 = base();
  fs.writeFileSync(t3.file, fs.readFileSync(t3.file, 'utf8').replace('"n":2', '"n":9'));
  const r3 = refused(t3, 'ledger-corrupt');
  assert.ok(r3.json.problems.length > 0);

  // видалений запис посередині — порушені seq і ланцюг
  const t4 = base();
  const l4 = lines(t4.file);
  l4.splice(1, 1);
  fs.writeFileSync(t4.file, l4.join('\n'));
  refused(t4, 'ledger-corrupt');

  // рядок, що не є JSON
  const t5 = base();
  const l5 = lines(t5.file);
  l5.splice(1, 0, 'це не JSON');
  fs.writeFileSync(t5.file, l5.join('\n'));
  refused(t5, 'ledger-corrupt');

  // J4_LEDGER вказує на каталог
  const t6 = base();
  refused(t6, 'ledger-unreadable', { J4_LEDGER: t6.root });

  // J4_HOME не існує — тека не створюється; J4_HOME існує, але це не сховище J4
  const t7 = base();
  const ghost = path.join(t7.root, 'ghost-home');
  refused(t7, 'home-not-j4-store', { J4_HOME: ghost });
  assert.equal(fs.existsSync(ghost), false, 'close не створює сховище J4 мовчки');
  const plain = path.join(t7.root, 'plain-dir');
  fs.mkdirSync(plain);
  refused(t7, 'home-not-j4-store', { J4_HOME: plain });
  assert.deepEqual(fs.readdirSync(plain), [], 'і не наповнює чужу теку');

  // порожній, але справжній журнал і сховище — це читний стан, а не відмова
  const t8 = base();
  fs.writeFileSync(t8.file, '');
  assert.equal(cli(t8.root, t8.args).code, 0);
});

test('T-0009 C8: F-T9-13/14/17 — «not passed», порожній відбір і SHA лише в cmd не є доказом; кілька verify: — відмова; ескалація без id має читну мітку', () => {
  const CMD = "node --test 'bridge/test/*.test.mjs'";
  const root = tmpStaff();
  fullAcceptance(root);
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  const write = (verifyLines) => fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), [
    `id: ${T}`, 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', ...verifyLines, '  review_kind: code', '',
  ].join('\n'));
  const close = (name, text) => {
    fs.writeFileSync(path.join(root, 'reports', name), text);
    return closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: `reports/${name}`, ...src(root) });
  };
  const NOT = ['checks-not-on-subject-or-failed'];

  write([`  verify: ["${CMD}"]`]);
  ['not passed', 'Not Passed', '0 passed', '0 pass, 0 fail', '0/76 pass', 'pass: 0', 'tests 0 pass 0 fail 0'].forEach((result, i) => {
    notOnSubject(close(`bad${i}.yaml`, `- {cmd: "${CMD}", subject: ${SHA_A}, result: "${result}"}\n`), result);
  });
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 0);

  // SHA лише всередині значення cmd, без поля subject, — не доказ на subject
  write(['  verify: []']);
  notOnSubject(close('incmd.yaml', `- {cmd: "echo ${SHA_A}", result: pass}\n`));

  // кілька ключів verify: — невідомо, який діє, тому відмова
  write([`  verify: ["${CMD}"]`, '  verify: ["echo B"]']);
  assert.equal(orderGate(root, T).error, 'order-verify-unreadable');
  assert.equal(close('multi.yaml', `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass"}\n`).code, 'order-verify-unreadable');

  // контроль: звичайний підсумок успішного прогону приймається
  write([`  verify: ["${CMD}"]`]);
  assert.equal(close('good.yaml', `- {cmd: "${CMD}", subject: ${SHA_A}, result: "90/90 pass, fail 0"}\n`).ok, true);

  // ескалація в журналі задачі без escalation_id і без seq: мітка читна, а не «seq undefined»
  const root2 = tmpStaff();
  order(root2);
  fullAcceptance(root2);
  addEvent(root2, { event: 'escalation' });
  const r = closeTask({ staffRoot: root2, taskId: T, subject: SHA_A, checksRef: evidence(root2), ...src(root2) });
  assert.equal(r.code, 'open-escalation');
  assert.match(r.missing[0], /^escalation:(seq \d+|entry \d+)$/);
});

// ---------- A. Черга: run --once і j4-tick.sh ----------

test('T-0009 Q1: один такт обробляє всю чергу, підхоплює мертвий замок і пише події; рівень C не рухається (2 виклики stub)', () => {
  const root = tmpStaff();
  const env = { J4_TASK_EVENTS: '1' };
  const send = (summary, extra = []) => cli(root, ['send', '--from', 'J3', '--to', 'J5', '--task', T, '--subject', SHA_A, '--intent', 'question', '--summary', summary, ...extra]);
  assert.equal(send('T-0009 Q1: запит 1').code, 0);
  assert.equal(send('T-0009 Q1: запит 2').code, 0);
  assert.equal(send('T-0009 Q1: рівень C', ['--level', 'C']).json.status, 'held');
  // замок загиблого обробника: pid справді завершеного процесу, час свіжий — замок прострочений лише через мертвий pid
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  assert.throws(() => process.kill(dead, 0), { code: 'ESRCH' });
  fs.writeFileSync(path.join(root, '.j4', 'lock'), JSON.stringify({ pid: dead, at: Date.now() }));
  const t1 = cli(root, ['run', '--once'], env);
  assert.equal(t1.code, 0, t1.stderr);
  assert.equal(t1.json.steps, 4); // 2 запити до J5 + 2 відповіді в скриньку J3
  assert.equal(adapterCalls(root), 2);
  assert.equal(ledgerEvents(root, 'lock_recovered').length, 1);
  assert.equal(ledgerEvents(root, 'lock_recovered')[0].detail.stale_pid, dead);
  assert.equal(cli(root, ['inbox', '--role', 'J3']).json.length, 2);
  assert.deepEqual(taskEvents(root).map((e) => e.event), ['task_accepted', 'escalation']);
  // другий такт — порожня черга, нуль викликів, нуль нових подій; повідомлення рівня C утримане
  const t2 = cli(root, ['run', '--once'], env);
  assert.equal(t2.json.steps, 0);
  assert.deepEqual(t2.json.events, { written: 0, duplicate: 1, failed: 0 });
  assert.equal(adapterCalls(root), 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.j4', 'messages', 'M-T-0900-0003.json'), 'utf8')).status, 'held');
});

test('T-0009 Q2: такт — замок живого обробника (75), стоп-кран (4), live заборонено; скрипт розкладу знімає змінні живого режиму й викликає run --once --mode stub', () => {
  const root = tmpStaff();
  fs.mkdirSync(path.join(root, '.j4'), { recursive: true });
  fs.writeFileSync(path.join(root, '.j4', 'lock'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.equal(cli(root, ['run', '--once']).code, 75);
  fs.rmSync(path.join(root, '.j4', 'lock'));
  assert.equal(cli(root, ['run', '--once'], { J4_HALT: '1' }).code, 4);
  fs.mkdirSync(path.join(root, 'bridge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bridge', 'HALT'), '');
  assert.equal(cli(root, ['run', '--once']).code, 4);
  fs.rmSync(path.join(root, 'bridge', 'HALT'));
  const live = cli(root, ['run', '--once', '--mode', 'live']);
  assert.equal(live.code, 1);
  assert.match(live.stderr, /лише в режимі stub/);

  // скрипт розкладу, крок 1: підміна node в PATH показує, які змінні й аргументи реально отримує j4.mjs
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-shim-'));
  const shimOut = path.join(shim, 'out.txt');
  fs.writeFileSync(path.join(shim, 'node'), '#!/bin/sh\n{ echo "ARGS: $*"; env | grep -E \'^(J4_ALLOW_LIVE|J4_APPROVAL|OPENAI_API_KEY|CODEX_API_KEY|J4_HOME|J4_LEDGER)=\' | sed \'s/=.*/=<set>/\'; } > "$SHIM_OUT"\nexit 0\n', { mode: 0o755 });
  const liveEnv = { J4_ALLOW_LIVE: '1', J4_APPROVAL: '/nonexistent', OPENAI_API_KEY: 'not-a-real-key', CODEX_API_KEY: 'not-a-real-key', SHIM_OUT: shimOut };
  const sh = spawnSync('sh', [TICK], { env: { ...cliEnv(root, liveEnv), PATH: `${shim}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  assert.equal(sh.status, 0, sh.stderr);
  const seen = fs.readFileSync(shimOut, 'utf8');
  assert.match(seen, /ARGS: .*j4\.mjs run --once --mode stub --task-events --max-steps 10/);
  assert.match(seen, /J4_HOME=<set>/);
  assert.match(seen, /J4_LEDGER=<set>/);
  for (const v of ['J4_ALLOW_LIVE', 'J4_APPROVAL', 'OPENAI_API_KEY', 'CODEX_API_KEY']) assert.doesNotMatch(seen, new RegExp(v), `${v} має бути знято`);
  fs.rmSync(shim, { recursive: true, force: true });

  // крок 2: справжній такт — пише журнал такту, код виходу проходить
  const r = spawnSync('sh', [TICK], { env: cliEnv(root, { J4_ALLOW_LIVE: '1', J4_APPROVAL: '/nonexistent' }), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(root, '.j4', 'tick.log'), 'utf8');
  assert.match(log, /"ok": true/);
  assert.match(log, /exit=0/);
  assert.equal(adapterCalls(root), 0);
});

test('T-0009 Q3: невдалий запис події ADM — код виходу 6, один task_event_failed на ключ; черга не ламається', () => {
  const root = tmpStaff();
  fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), '{"seq":2,"event":"x"');   // обірваний рядок
  assert.equal(cli(root, ['send', '--from', 'J3', '--to', 'J5', '--task', T, '--subject', SHA_A, '--intent', 'question', '--summary', 'T-0009 Q3: рівень C', '--level', 'C']).json.status, 'held');
  const env = { J4_TASK_EVENTS: '1' };
  const t1 = cli(root, ['run', '--once'], env);
  assert.equal(t1.code, 6);
  assert.deepEqual(t1.json.events, { written: 0, duplicate: 0, failed: 1 });
  assert.equal(cli(root, ['run', '--once'], env).code, 6);
  const failed = ledgerEvents(root, 'task_event_failed');
  assert.equal(failed.length, 1, 'повторний такт не множить записи про той самий збій');
  assert.equal(failed[0].detail.code, 'events-corrupt');
  assert.equal(adapterCalls(root), 0);
  // без --task-events такт з тим самим журналом задачі проходить із кодом 0
  assert.equal(cli(root, ['run', '--once']).code, 0);
});

test('T-0009 H1: канонічний bridge/HALT зупиняє run --once і close, навіть коли J4_STAFF_ROOT вказує на інше сховище', () => {
  const canon = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-canon-'));
  for (const d of ['bin', 'src', 'config', 'roles', 'schema']) fs.cpSync(path.join(BRIDGE_DIR, d), path.join(canon, 'bridge', d), { recursive: true });
  const root = tmpStaff();
  const run = (...args) => spawnSync(process.execPath, [path.join(canon, 'bridge', 'bin', 'j4.mjs'), ...args], { env: cliEnv(root), encoding: 'utf8', timeout: 60000 });
  fs.writeFileSync(path.join(canon, 'bridge', 'HALT'), '');
  assert.equal(run('run', '--once').status, 4);
  assert.equal(run('close', '--task', T, '--subject', SHA_A).status, 4);
  // контроль: без HALT той самий каталог працює (порожня черга, нуль викликів)
  fs.rmSync(path.join(canon, 'bridge', 'HALT'));
  assert.equal(run('run', '--once').status, 0);
  assert.equal(adapterCalls(root), 0);
  fs.rmSync(canon, { recursive: true, force: true });
});
