// Синтетичні тести reconcile-close.mjs (JE-T9-04 D-8). Журнал будується справжнім класом Ledger у тимчасовій теці;
// адаптери й мережа не використовуються (0 викликів). Запуск: node --test tasks/T-0009/tools/reconcile-close.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ledger } from '../../../bridge/src/ledger.mjs';
import { reconcile, fingerprint } from './reconcile-close.mjs';

const TOOL = fileURLToPath(new URL('./reconcile-close.mjs', import.meta.url));
const TASK = 'T-0900';
const at = '2026-10-27T10:00:00+00:00';

function install(extra = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'escalations'), { recursive: true });
  const ledgerFile = path.join(root, 'ledger.jsonl');
  const led = new Ledger(ledgerFile);
  led.append({ event: 'message_accepted', at, task_id: TASK, kind: 'report', from: 'J3', msg_id: 'm1' });
  for (const e of extra) led.append({ at, ...e });
  const eventsFile = path.join(root, 'events.jsonl');
  fs.writeFileSync(eventsFile, `${JSON.stringify({ seq: 1, event: 'task_created', task_id: TASK })}\n`);
  return { root, home, ledgerFile, eventsFile, led };
}
const raise = (id) => ({ event: 'escalation_raised', task_id: TASK, detail: { escalation_id: id, task_id: TASK } });
const resolve = (id) => ({ event: 'escalation_resolved', detail: { escalation_id: id, task_id: TASK } });
function exp(i) {
  const f = fingerprint(i.ledgerFile);
  return { first: f.first_hash, headSeq: f.head_seq, headHash: f.head_hash };
}
const run = (i, over = {}) => reconcile({ task: TASK, home: i.home, ledgerFile: i.ledgerFile, eventsFile: i.eventsFile, expect: exp(i), ...over });
const store = (i, id, status = 'open') => fs.writeFileSync(path.join(i.home, 'escalations', `${id}.json`), JSON.stringify({ escalation_id: id, task_id: TASK, status }));
const journal = (i, id) => fs.appendFileSync(i.eventsFile, `${JSON.stringify({ seq: 2, event: 'escalation', task_id: TASK, escalation_id: id })}\n`);

test('R1 канонічна пара без ескалацій → ok', () => {
  const i = install();
  const r = run(i);
  assert.equal(r.ok, true);
  assert.deepEqual(r.stop, []);
});

test('R2 без записаних очікувань — «expectations-missing», навіть для порожніх значень', () => {
  const i = install();
  const ok = exp(i);
  // кожне поле окремо: порожнє значення будь-якого з трьох не може дати «ok»
  for (const expect of [{}, { first: null, headSeq: null, headHash: null }, { ...ok, first: null }, { ...ok, first: 'x' }, { ...ok, headSeq: null }, { ...ok, headSeq: 0 }, { ...ok, headHash: 'y' }, { ...ok, headHash: undefined }]) {
    const r = run(i, { expect });
    assert.equal(r.ok, false);
    assert.deepEqual(r.stop, ['expectations-missing']);
  }
});

test('R3 інша наявна порожня пара (відтворення F-T9-18 A) → ledger-identity-mismatch', () => {
  const real = install([raise('E-1')]);
  const other = install();
  fs.rmSync(other.ledgerFile);
  fs.writeFileSync(other.ledgerFile, '');
  const r = reconcile({ task: TASK, home: other.home, ledgerFile: other.ledgerFile, eventsFile: other.eventsFile, expect: exp(real) });
  assert.equal(r.ok, false);
  assert.ok(r.stop.includes('ledger-identity-mismatch'));
  assert.ok(r.stop.includes('ledger-head-mismatch'));
});

test('R4 відкрита ескалація лише в J4 (не в events.jsonl) → open-escalation і unsynced_open', () => {
  const i = install([raise('E-1')]);
  store(i, 'E-1');
  const r = run(i);
  assert.equal(r.ok, false);
  assert.ok(r.stop.includes('open-escalation'));
  assert.deepEqual(r.facts.unsynced_open, ['E-1']);
});

test('R5 розв’язана ескалація не блокує', () => {
  const i = install([raise('E-1'), resolve('E-1')]);
  store(i, 'E-1', 'resolved');
  journal(i, 'E-1');
  assert.equal(run(i).ok, true);
});

test('R6 ескалація в журналі завдання невідома наданому журналу J4 → journal-escalation-unknown-to-ledger', () => {
  const i = install();
  journal(i, 'E-77');
  const r = run(i);
  assert.ok(r.stop.includes('journal-escalation-unknown-to-ledger'));
});

test('R7 журнал з тим самим початком, але іншим продовженням → ledger-head-mismatch', () => {
  const real = install([raise('E-1')]);
  const fork = install();
  fork.led.append({ at, event: 'message_accepted', task_id: TASK, kind: 'report', from: 'J5', msg_id: 'm2' });
  const r = reconcile({ task: TASK, home: fork.home, ledgerFile: fork.ledgerFile, eventsFile: fork.eventsFile, expect: { ...exp(real), first: fingerprint(fork.ledgerFile).first_hash } });
  assert.ok(r.stop.includes('ledger-head-mismatch'));
});

test('R8 пошкоджений або обірваний журнал → ledger-corrupt', () => {
  const i = install([raise('E-1')]);
  const e = exp(i);
  const raw = fs.readFileSync(i.ledgerFile, 'utf8');
  fs.writeFileSync(i.ledgerFile, raw.replace('"m1"', '"m9"'));
  assert.deepEqual(reconcile({ task: TASK, home: i.home, ledgerFile: i.ledgerFile, eventsFile: i.eventsFile, expect: e }).stop, ['ledger-corrupt']);
  fs.writeFileSync(i.ledgerFile, raw.slice(0, -5));
  assert.deepEqual(reconcile({ task: TASK, home: i.home, ledgerFile: i.ledgerFile, eventsFile: i.eventsFile, expect: e }).stop, ['ledger-corrupt']);
  fs.rmSync(i.ledgerFile);
  assert.deepEqual(reconcile({ task: TASK, home: i.home, ledgerFile: i.ledgerFile, eventsFile: i.eventsFile, expect: e }).stop, ['ledger-missing']);
});

test('R9 J4_HOME без теки escalations → home-not-j4-store; відсутній events.jsonl → events-missing', () => {
  const i = install();
  fs.rmSync(path.join(i.home, 'escalations'), { recursive: true });
  assert.ok(run(i).stop.includes('home-not-j4-store'));
  const j = install();
  fs.rmSync(j.eventsFile);
  assert.ok(run(j).stop.includes('events-missing'));
});

test('R10 відкрита ескалація у сховищі, якої немає в журналі J4 → store-ledger-mismatch', () => {
  const i = install();
  store(i, 'E-5');
  const r = run(i);
  assert.ok(r.stop.includes('store-ledger-mismatch'));
  assert.ok(r.stop.includes('open-escalation'));
});

test('R11 лише читання: файли й теки не змінюються', () => {
  const i = install([raise('E-1')]);
  store(i, 'E-1');
  const snap = () => {
    const out = {};
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    });
    walk(i.root);
    return out;
  };
  const before = snap();
  run(i);
  assert.deepEqual(snap(), before);
});

test('R12 CLI: exit 0 при збігу, 3 при СТОП, 2 при хибному виклику; --print-fingerprint', () => {
  const i = install();
  const f = JSON.parse(spawnSync('node', [TOOL, '--print-fingerprint', '--ledger', i.ledgerFile], { encoding: 'utf8' }).stdout);
  assert.equal(f.ok, true);
  const base = ['--task', TASK, '--home', i.home, '--ledger', i.ledgerFile, '--events', i.eventsFile];
  const good = spawnSync('node', [TOOL, ...base, '--expect-first', f.first_hash, '--expect-head-seq', String(f.head_seq), '--expect-head-hash', f.head_hash], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stdout);
  const bad = spawnSync('node', [TOOL, ...base], { encoding: 'utf8' });
  assert.equal(bad.status, 3);
  assert.deepEqual(JSON.parse(bad.stdout).stop, ['expectations-missing']);
  assert.equal(spawnSync('node', [TOOL, '--nonsense'], { encoding: 'utf8' }).status, 2);
});
