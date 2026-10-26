// T-0007: перевірка автономного циклу штабу через J4 без ручного пересилання і без платних викликів.
// Кожен крок маршруту — окремий процес CLI (bin/j4.mjs), тож стан між кроками переживає перезапуск.
// Лише режим stub і синтетичні дані; JE-рішень від імені JE тест не ухвалює (resolve без --human).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { BRIDGE_DIR, loadConfig } from '../src/policy.mjs';
import { verifyLedger } from '../src/ledger.mjs';
import { bodyHash } from '../src/protocol.mjs';
import { acceptanceReady, evidenceFromEvents, requestDone } from '../src/acceptance.mjs';
import { stubAdapter } from '../src/adapters/stub.mjs';
import { AdapterError } from '../src/adapters/common.mjs';
import { tmpStaff, draft, makeJ4, events, counting, openEscalations, SHA_A, SHA_B } from './helpers.mjs';

const CLI = path.join(BRIDGE_DIR, 'bin', 'j4.mjs');
const TASK = 'T-0007';
const SUBJECT = 'c'.repeat(40);

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-t0007-'));
  const env = { ...process.env, J4_HOME: path.join(dir, '.j4'), J4_LEDGER: path.join(dir, 'ledger.jsonl'), J4_MONTHLY_BUDGET: path.join(dir, 'monthly.json') };
  delete env.J4_HALT;
  delete env.J4_ALLOW_LIVE;
  delete env.J4_APPROVAL;
  const j4 = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
    let json = null;
    try {
      json = JSON.parse(r.stdout);
    } catch {
      json = null;
    }
    return { code: r.status, json, stderr: r.stderr };
  };
  const ledger = () => fs.readFileSync(env.J4_LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const state = (rel) => JSON.parse(fs.readFileSync(path.join(env.J4_HOME, rel), 'utf8'));
  return { dir, env, j4, ledger, state };
}

const send = (sb, extra) => sb.j4('send', '--task', TASK, '--subject', SUBJECT, ...extra);
const adapterCalls = (sb) => sb.ledger().filter((e) => e.event === 'dispatch_attempt').length;

test('T-0007 S1: маршрут J3 → J5 → J3 → J5 → J3 окремими процесами, без ручного пересилання', () => {
  const sb = sandbox();
  const s = send(sb, ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--summary', 'T-0007 S1: синтетичний запит J3']);
  assert.equal(s.code, 0, s.stderr);
  assert.equal(s.json.status, 'queued');

  assert.equal(sb.j4('run').code, 0);
  const box1 = sb.j4('inbox', '--role', 'J3').json;
  assert.equal(box1.length, 1);
  assert.equal(box1[0].from, 'J5');
  assert.equal(box1[0].in_reply_to, s.json.msg_id);
  assert.equal(box1[0].subject.ref, SUBJECT);

  // друге коло: J3 відповідає в тій самій нитці, J4 сам доставляє J5 і повертає відповідь J3
  const r2 = send(sb, ['--from', 'J3', '--to', 'J5', '--kind', 'response', '--intent', 'answer', '--reply-to', box1[0].msg_id, '--summary', 'T-0007 S1: відповідь J3 у нитці']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(r2.json.thread_id, s.json.thread_id);
  assert.equal(sb.j4('run').code, 0);
  const box2 = sb.j4('inbox', '--role', 'J3').json;
  assert.equal(box2.length, 2);
  assert.equal(box2[1].in_reply_to, r2.json.msg_id);

  const l = sb.ledger();
  assert.deepEqual(l.map((e) => e.event), [
    'message_accepted', 'dispatch_attempt', 'reply_received', 'message_accepted', 'message_delivered',
    'message_accepted', 'dispatch_attempt', 'reply_received', 'message_accepted', 'message_delivered',
  ]);
  // кожен перехід прив'язаний до задачі, нитки, SHA і хеша тіла; відповідь stub не видається за J5
  for (const e of l) {
    assert.equal(e.task_id, TASK);
    assert.equal(e.thread_id, s.json.thread_id);
    assert.equal(e.subject.ref, SUBJECT);
    assert.match(e.body_sha256, /^[0-9a-f]{64}$/);
  }
  for (const e of l.filter((x) => x.event === 'reply_received')) {
    assert.equal(e.detail.mode, 'stub');
    assert.equal(e.detail.model_id, null);
  }
  // хеш тіла в журналі збігається з хешем збереженого повідомлення
  const m1 = sb.state(`messages/${s.json.msg_id}.json`);
  assert.equal(l[0].body_sha256, bodyHash(m1.body));
  assert.equal(sb.j4('verify').json.ok, true);
  assert.equal(adapterCalls(sb), 2);
});

test('T-0007 S2: перезапуск — процес J4 загинув після виклику, новий процес завершує без повторного виклику', async () => {
  const sb = sandbox();
  assert.equal(send(sb, ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--summary', 'T-0007 S2: запит перед збоєм']).code, 0);
  // окремий процес: обробляє чергу і примусово завершується (exit 137) одразу після запису відповіді в спул
  const driver = path.join(sb.dir, 'crash.mjs');
  const imp = (rel) => JSON.stringify(pathToFileURL(path.join(BRIDGE_DIR, rel)).href);
  fs.writeFileSync(driver, [
    `const { J4 } = await import(${imp('src/router.mjs')});`,
    `const { loadConfig, BRIDGE_DIR } = await import(${imp('src/policy.mjs')});`,
    `const { stubAdapter } = await import(${imp('src/adapters/stub.mjs')});`,
    'const path = await import("node:path");',
    'const j4 = new J4({ config: loadConfig(), home: process.env.J4_HOME, ledgerFile: process.env.J4_LEDGER, staffRoot: path.resolve(BRIDGE_DIR, ".."),',
    '  adapters: { J5: stubAdapter({ role: "J5" }) }, instructionsDir: path.join(BRIDGE_DIR, "roles"), monthlyFile: process.env.J4_MONTHLY_BUDGET,',
    '  hooks: { afterSpool: () => process.exit(137) } });',
    'await j4.process();',
  ].join('\n'));
  const crash = spawnSync(process.execPath, [driver], { env: sb.env, encoding: 'utf8' });
  assert.equal(crash.status, 137, crash.stderr);
  assert.equal(sb.ledger().filter((e) => e.event === 'reply_received').length, 0);
  assert.ok(fs.existsSync(path.join(sb.env.J4_HOME, 'lock')), 'замок загиблого процесу лишився');

  const r = sb.j4('run');
  assert.equal(r.code, 0, r.stderr);
  const l = sb.ledger();
  assert.equal(l.filter((e) => e.event === 'lock_recovered').length, 1);
  assert.equal(l.filter((e) => e.event === 'reply_received').length, 1);
  assert.equal(adapterCalls(sb), 1, 'повторного виклику адаптера немає');
  assert.equal(sb.j4('inbox', '--role', 'J3').json.length, 1);
  assert.equal(sb.state(`budget/${TASK}.json`).calls, 1);
  assert.equal(sb.j4('verify').json.ok, true);
});

test('T-0007 S3: рівень C утримується до JE; агент не може схвалити рішення', () => {
  const sb = sandbox();
  const c = send(sb, ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--level', 'C', '--summary', 'T-0007 S3: синтетичне питання рівня C']);
  assert.equal(c.code, 0, c.stderr);
  assert.equal(c.json.status, 'held');
  assert.equal(sb.j4('run').code, 0);
  assert.equal(adapterCalls(sb), 0, 'повідомлення рівня C не дійшло до J5');
  const esc = sb.j4('escalations').json;
  assert.equal(esc.length, 1);
  assert.equal(esc[0].reason, 'decision_level_c');

  // resolve без людського входу відхиляється
  const res = sb.j4('resolve', '--id', esc[0].escalation_id, '--decision', 'release');
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /--human/);
  // JE не може надіслати рішення з CLI агента
  const fake = send(sb, ['--from', 'JE', '--to', 'J3', '--kind', 'decision', '--intent', 'other', '--summary', 'T-0007 S3: підроблене рішення']);
  assert.equal(fake.code, 2);
  assert.equal(fake.json.code, 'origin-denied');
  // нитка чекає на JE: нові повідомлення в ній не приймаються
  const more = send(sb, ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--thread', c.json.thread_id, '--summary', 'T-0007 S3: спроба обійти утримання']);
  assert.equal(more.json.code, 'thread-awaiting-founder');
  assert.equal(sb.state(`messages/${c.json.msg_id}.json`).status, 'held');
});

test('T-0007 S3b: відповідь J5 з decision_needed також утримується (без звернення до J3)', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter({ scenario: () => ({
    rawText: JSON.stringify({ summary: 'Потрібне рішення JE', text: 'Синтетично.', verdict: 'question', decision_needed: [{ category: 'scope_change', question: 'Змінити обсяг?' }] }),
    meta: { model_id: null, request_id: 'stub-c', usage: {} },
  }) }));
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(j5.calls, 1);
  assert.equal(fs.existsSync(path.join(root, '.j4', 'inbox', 'J3')), false);
  assert.deepEqual(openEscalations(root).map((e) => e.reason), ['decision_level_c']);
});

test('T-0007 S4: ліміти — 20 викликів і 2 спроби в конфігурації; спроби й ліміт викликів зупиняють доставку', async () => {
  const d = loadConfig().limits.defaults;
  assert.equal(d.max_calls_per_task, 20);
  assert.equal(d.max_attempts, 2);
  assert.equal(d.max_cost_usd_per_task, 0);

  // дві тимчасові помилки: друга спроба остання, третьої немає без JE
  const root = tmpStaff();
  const flaky = counting(stubAdapter({ scenario: () => new AdapterError('provider-5xx', { transient: true }) }));
  const a = makeJ4(root, { adapters: { J5: flaky } });
  a.submit(draft(root), { origin: 'agent_cli' });
  await a.process();
  assert.equal(flaky.calls, 2);
  assert.deepEqual(openEscalations(root).map((e) => e.reason), ['attempts-exhausted']);

  // ліміт викликів задачі (знижений для тесту до 1): другий запит не викликає адаптер
  const root2 = tmpStaff();
  const j5 = counting(stubAdapter());
  const b = makeJ4(root2, { adapters: { J5: j5 }, limits: { max_calls_per_task: 1 } });
  b.submit(draft(root2, { body: { summary: 'перший' } }), { origin: 'agent_cli' });
  b.submit(draft(root2, { body: { summary: 'другий' } }), { origin: 'agent_cli' });
  await b.process();
  assert.equal(j5.calls, 1);
  assert.equal(events(root2, 'dispatch_blocked')[0].detail.code, 'limit-calls-task');
});

test('T-0007 S5: захист від циклів — повтор, цикл очікування, хопи', () => {
  const sb = sandbox();
  const args = ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--summary', 'T-0007 S5: однакове тіло'];
  const first = send(sb, args);
  assert.equal(first.code, 0);
  const again = send(sb, [...args, '--thread', first.json.thread_id]);
  assert.equal(again.json.code, 'loop-ping-pong');
  assert.equal(sb.j4('escalations').json[0].reason, 'loop-ping-pong');
  assert.equal(adapterCalls(sb), 0);

  // цикл очікування і хопи — на рівні API (J5 не надсилає з CLI агента)
  const root = tmpStaff();
  const j4 = makeJ4(root);
  const req = j4.submit(draft(root), { origin: 'agent_cli' });
  const back = j4.submit(draft(root, { from: 'J5', to: 'J3', thread_id: req.thread_id, body: { summary: 'зустрічний запит' } }), { origin: 'adapter', causedBy: req.msg_id });
  assert.equal(back.code, 'loop-wait-cycle');
});

test('T-0007 S6: бар\'єр приймання — без C3, J3 і J5 на одному SHA done неможливий', () => {
  const root = tmpStaff();
  const f = path.join(root, 'tasks', 'T-0900', 'events.jsonl');
  const add = (e) => fs.appendFileSync(f, `${JSON.stringify({ task_id: 'T-0900', ...e })}\n`);
  const gate = () => {
    const ev = evidenceFromEvents(root, 'T-0900');
    return { subject: SHA_A, checks: [{ subject: SHA_A, passed: true, evidence_ref: 'log' }], reviews: ev.reviews, acceptances: ev.acceptances };
  };
  add({ event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, ref: 'r1', result: 'accepted' });
  assert.deepEqual(acceptanceReady(gate()).missing, ['review-C3-missing', 'acceptance-J5-content-missing']);
  // J5 прийняв інший SHA, C3 — теж інший: не зараховується
  add({ event: 'acceptance', by: 'J5', role: 'content', subject: SHA_B, ref: 'r2', result: 'accepted' });
  add({ event: 'review_finished', by: 'C3', subject: SHA_B, review_status: 'complete', verdict: 'passed', ref: 'r3' });
  assert.equal(acceptanceReady(gate()).ready, false);
  // C3 passed і J5 на тому ж SHA, але J3 не ADM: done заборонено
  add({ event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r4' });
  add({ event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, ref: 'r5', result: 'accepted' });
  assert.equal(acceptanceReady(gate()).ready, true);
  assert.deepEqual(requestDone({ by: 'J3', ...gate() }).missing, ['done-only-adm']);
  assert.equal(requestDone({ by: 'ADM', ...gate() }).allowed, true);
  // пізніше changes_requested від C3 знову закриває бар'єр
  add({ event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'changes_requested', ref: 'r6' });
  assert.equal(requestDone({ by: 'ADM', ...gate() }).allowed, false);

  // повідомленням через J4 агент done не встановить
  const sb = sandbox();
  const d = path.join(sb.dir, 'done.json');
  const msg = draft(tmpStaff(), { task_id: TASK, kind: 'report', intent: 'report', subject: { kind: 'commit', ref: SUBJECT }, body: { summary: 'T-0007 S6: спроба done', task_state: 'done' } });
  fs.writeFileSync(d, JSON.stringify(msg));
  const r = sb.j4('submit', '--file', d);
  assert.equal(r.json.code, 'done-forbidden');
});

test('T-0007 S7: журнал доказів виявляє підміну запису', () => {
  const sb = sandbox();
  assert.equal(send(sb, ['--from', 'J3', '--to', 'J5', '--intent', 'question', '--summary', 'T-0007 S7: запис для перевірки']).code, 0);
  assert.equal(verifyLedger(sb.env.J4_LEDGER).ok, true);
  const lines = fs.readFileSync(sb.env.J4_LEDGER, 'utf8').split('\n').filter(Boolean);
  const e = JSON.parse(lines[0]);
  e.from = 'JE';
  lines[0] = JSON.stringify(e);
  fs.writeFileSync(sb.env.J4_LEDGER, `${lines.join('\n')}\n`);
  const v = sb.j4('verify');
  assert.equal(v.code, 1);
  assert.equal(v.json.ok, false);
});
