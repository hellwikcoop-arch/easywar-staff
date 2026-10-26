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
import { pathToFileURL } from 'node:url';
import { BRIDGE_DIR } from '../src/policy.mjs';
import { appendAdmEvent, readTaskEvents } from '../src/events.mjs';
import { closeTask, orderGate } from '../src/close.mjs';
import { Store } from '../src/store.mjs';
import { tmpStaff, draft, makeJ4, events as ledgerEvents, SHA_A, SHA_B } from './helpers.mjs';

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
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), `checks: {subject: ${subject}, result: pass}\n`);
  return 'reports/checks.yaml';
}

function fullAcceptance(root, subject = SHA_A) {
  addEvent(root, { event: 'review_finished', by: 'C3', subject, review_status: 'complete', verdict: 'passed', ref: 'r' });
  addEvent(root, { event: 'acceptance', by: 'J3', role: 'technical', subject, result: 'accepted', ref: 'a' });
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject, result: 'accepted', ref: 'b' });
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
      `const { appendAdmEvent } = await import(${mod}); for (let i = 0; i < 5; i++) appendAdmEvent(${JSON.stringify(root)}, 'T-0900', { event: 'report_filed' }, { key: 'w${w}-' + i });`]);
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

// ---------- C. j4 close ----------

test('T-0009 C1: close відмовляє без повного комплекту на одному SHA; done лише після бар\'єра', () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  const close = (subject = SHA_A, checksRef = ref) => closeTask({ staffRoot: root, taskId: T, subject, checksRef });

  assert.deepEqual(close().missing, ['review-C3-missing', 'acceptance-J3-technical-missing', 'acceptance-J5-content-missing']);
  addEvent(root, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r' });
  addEvent(root, { event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', ref: 'a' });
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject: SHA_B, result: 'accepted', ref: 'b' });
  assert.deepEqual(close().missing, ['acceptance-J5-content-missing'], 'J5 на іншому SHA не зараховано');
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', ref: 'b2' });
  // перевірки: файл без контрольного SHA, відсутній файл, шлях поза сховищем
  fs.writeFileSync(path.join(root, 'reports', 'other.yaml'), `subject: ${SHA_B}\n`);
  assert.deepEqual(close(SHA_A, 'reports/other.yaml').missing, ['checks-not-on-subject-or-failed']);
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
  const store = new Store(path.join(root, '.j4'));
  const r = closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, store });
  assert.equal(r.code, 'open-escalation');
  assert.match(r.missing[0], /^escalation:E-T-0900-/);

  // ескалація в журналі задачі, невідома цьому стану J4 (інший J4_HOME) — теж відкрита
  const root2 = tmpStaff();
  order(root2);
  fullAcceptance(root2);
  appendAdmEvent(root2, T, { event: 'escalation', escalation_id: 'E-T-0900-007' }, { key: 'esc-7' });
  assert.equal(closeTask({ staffRoot: root2, taskId: T, subject: SHA_A, checksRef: evidence(root2), store: new Store(path.join(root2, '.j4')) }).code, 'open-escalation');

  // key_decision: true вимагає приймання JE
  const root3 = tmpStaff();
  order(root3, { key: true });
  fullAcceptance(root3);
  assert.deepEqual(closeTask({ staffRoot: root3, taskId: T, subject: SHA_A, checksRef: evidence(root3) }).missing, ['acceptance-JE-key_decision-missing']);

  // пізніший changes_requested C3 закриває бар'єр
  const root4 = tmpStaff();
  order(root4);
  fullAcceptance(root4);
  addEvent(root4, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'changes_requested', ref: 'r2' });
  assert.deepEqual(closeTask({ staffRoot: root4, taskId: T, subject: SHA_A, checksRef: evidence(root4) }).missing, ['review-C3-not-passed']);

  // без наказу або з нечитаним acceptance — відмова
  const root5 = tmpStaff();
  assert.equal(closeTask({ staffRoot: root5, taskId: T, subject: SHA_A, checksRef: evidence(root5) }).code, 'order-missing');
  fs.writeFileSync(path.join(root5, 'tasks', T, 'order.yaml'), 'acceptance: {technical: J3}\n');
  assert.equal(orderGate(root5, T).error, 'order-acceptance-unreadable');
});

test('T-0009 C3: j4 close через CLI на копії сховища; повтор не пише другий done; ескалація без JE не знімається', () => {
  const root = tmpStaff();
  order(root);
  const ref = evidence(root);
  fullAcceptance(root);
  const a = cli(root, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.json.entry.state, 'done');
  const b = cli(root, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref]);
  assert.equal(b.code, 0);
  assert.equal(b.json.already, true);
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 1);
  const halted = cli(root, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], { J4_HALT: '1' });
  assert.equal(halted.code, 4);
});

test('T-0009 C4: checks — не згадка SHA, а рядок result: pass на subject і команди verify з наказу', () => {
  const root = tmpStaff();
  fullAcceptance(root);
  const CMD = "node --test 'bridge/test/*.test.mjs'";
  const orderWith = (dir, verifyLine) => fs.writeFileSync(path.join(dir, 'tasks', T, 'order.yaml'), [
    `id: ${T}`, 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', verifyLine, '  review_kind: code', '',
  ].join('\n'));
  const evidenceFile = (name, text) => {
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports', name), text);
    return `reports/${name}`;
  };
  const close = (ref) => closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref });
  orderWith(root, `  verify: ["${CMD}"]`);
  const refused = (ref) => assert.deepEqual(close(ref).missing, ['checks-not-on-subject-or-failed']);

  refused(evidenceFile('mention.yaml', `note: контрольний SHA ${SHA_A}\n`));                                          // лише згадка
  refused(evidenceFile('nopass.yaml', `- {cmd: "${CMD}", subject: ${SHA_A}, result: "75/76 pass, 1 fail"}\n`));       // є fail
  refused(evidenceFile('othercmd.yaml', `- {cmd: "інша команда", subject: ${SHA_A}, result: "pass"}\n`));             // немає команди verify
  refused(evidenceFile('othersha.yaml', `- {cmd: "${CMD}", subject: ${SHA_B}, result: "pass"}\n`));                    // інший SHA
  assert.equal(taskEvents(root).filter((e) => e.event === 'state_changed').length, 0);

  const good = close(evidenceFile('good.yaml', `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass, fail 0", by: J3}\n`));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(good.entry.ref, 'reports/good.yaml');

  // verify є, але не розібраний — безпечна відмова
  const root2 = tmpStaff();
  fullAcceptance(root2);
  orderWith(root2, '  verify: [node --test]');
  fs.mkdirSync(path.join(root2, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'reports', 'c.yaml'), `{subject: ${SHA_A}, result: pass}\n`);
  assert.equal(closeTask({ staffRoot: root2, taskId: T, subject: SHA_A, checksRef: 'reports/c.yaml' }).code, 'order-verify-unreadable');
});

// ---------- A. Черга: run --once і j4-tick.sh ----------

test('T-0009 Q1: один такт обробляє всю чергу, підхоплює мертвий замок і пише події; рівень C не рухається (2 виклики stub)', () => {
  const root = tmpStaff();
  const env = { J4_TASK_EVENTS: '1' };
  const send = (summary, extra = []) => cli(root, ['send', '--from', 'J3', '--to', 'J5', '--task', T, '--subject', SHA_A, '--intent', 'question', '--summary', summary, ...extra]);
  assert.equal(send('T-0009 Q1: запит 1').code, 0);
  assert.equal(send('T-0009 Q1: запит 2').code, 0);
  assert.equal(send('T-0009 Q1: рівень C', ['--level', 'C']).json.status, 'held');
  // замок загиблого обробника
  fs.writeFileSync(path.join(root, '.j4', 'lock'), JSON.stringify({ pid: 999999, at: 0 }));
  const t1 = cli(root, ['run', '--once'], env);
  assert.equal(t1.code, 0, t1.stderr);
  assert.equal(t1.json.steps, 4); // 2 запити до J5 + 2 відповіді в скриньку J3
  assert.equal(adapterCalls(root), 2);
  assert.equal(ledgerEvents(root, 'lock_recovered').length, 1);
  assert.equal(cli(root, ['inbox', '--role', 'J3']).json.length, 2);
  assert.deepEqual(taskEvents(root).map((e) => e.event), ['task_accepted', 'escalation']);
  // другий такт — порожня черга, нуль викликів, нуль нових подій; повідомлення рівня C утримане
  const t2 = cli(root, ['run', '--once'], env);
  assert.equal(t2.json.steps, 0);
  assert.deepEqual(t2.json.events, { written: 0, duplicate: 1, failed: 0 });
  assert.equal(adapterCalls(root), 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.j4', 'messages', 'M-T-0900-0003.json'), 'utf8')).status, 'held');
});

test('T-0009 Q2: такт — замок живого обробника (75), стоп-кран (4), live заборонено, скрипт розкладу', () => {
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

  // скрипт розкладу: знімає змінні живого режиму, пише журнал такту, код виходу проходить
  const r = spawnSync('sh', [TICK], { env: cliEnv(root, { J4_ALLOW_LIVE: '1', J4_APPROVAL: '/nonexistent' }), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(root, '.j4', 'tick.log'), 'utf8');
  assert.match(log, /"ok": true/);
  assert.match(log, /exit=0/);
  assert.equal(adapterCalls(root), 0);
});
