// Сценарій відновлення після збою (пункт 8): збій процесу під час виклику, після отримання
// відповіді, обірваний журнал, завислий замок, підробка журналу.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stubAdapter } from '../src/adapters/stub.mjs';
import { verifyLedger } from '../src/ledger.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, counting } from './helpers.mjs';

test('збій процесу під час виклику: результат невідомий, спроба зарахована, повтор без дубля', async () => {
  const root = tmpStaff();
  const crashing = counting(stubAdapter({ scenario: ({ n }) => (n === 1 ? new Error('process-killed') : null) }));
  const a = makeJ4(root, { adapters: { J5: crashing } });
  a.submit(draft(root), { origin: 'agent_cli' });
  await assert.rejects(a.process(), /process-killed/);
  // стан лишився dispatched; новий процес J4 відновлює
  fs.writeFileSync(path.join(root, '.j4', 'lock'), JSON.stringify({ pid: 999999, at: 0 }));
  const b = makeJ4(root, { adapters: { J5: crashing } });
  const r = await b.process();
  assert.equal(r.ok, true);
  assert.equal(events(root, 'lock_recovered').length, 1);
  assert.equal(events(root, 'dispatch_outcome_unknown').length, 1);
  assert.equal(crashing.calls, 2);
  assert.equal(events(root, 'reply_received').length, 1);
  assert.equal(inbox(root, 'J3').length, 1);
  const budget = JSON.parse(fs.readFileSync(path.join(root, '.j4', 'budget', 'T-0900.json'), 'utf8'));
  assert.equal(budget.calls, 2);
  assert.equal(budget.cost_accuracy, 'estimate');
  assert.equal(verifyLedger(path.join(root, 'ledger.jsonl')).ok, true);
});

test('збій після отримання відповіді: відновлення зі спулу без повторного виклику', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter());
  let crash = true;
  const a = makeJ4(root, { adapters: { J5: j5 }, hooks: { afterSpool: () => { if (crash) { crash = false; throw new Error('killed-after-spool'); } } } });
  a.submit(draft(root), { origin: 'agent_cli' });
  await assert.rejects(a.process(), /killed-after-spool/);
  assert.equal(events(root, 'reply_received').length, 0);
  const b = makeJ4(root, { adapters: { J5: j5 } });
  await b.process();
  assert.equal(j5.calls, 1);
  assert.equal(events(root, 'recovered').length, 0); // статус уже received: фіналізація без зміни стану dispatched
  assert.equal(events(root, 'reply_received').length, 1);
  assert.equal(inbox(root, 'J3').length, 1);
});

test('збій між записом у журнал і поданням відповіді: відповідь подається один раз', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter());
  const a = makeJ4(root, { adapters: { J5: j5 } });
  const orig = a.submitReply.bind(a);
  a.submitReply = () => { throw new Error('killed-before-reply'); };
  a.submit(draft(root), { origin: 'agent_cli' });
  await assert.rejects(a.process(), /killed-before-reply/);
  a.submitReply = orig;
  const b = makeJ4(root, { adapters: { J5: j5 } });
  await b.process();
  assert.equal(j5.calls, 1);
  assert.equal(events(root, 'reply_received').length, 1);
  assert.equal(events(root, 'recovered')[0].detail.action, 'submit-reply');
  assert.equal(inbox(root, 'J3').length, 1);
});

test('обірваний останній рядок журналу відкидається з подією', async () => {
  const root = tmpStaff();
  const a = makeJ4(root, { adapters: { J5: stubAdapter() } });
  a.submit(draft(root), { origin: 'agent_cli' });
  fs.appendFileSync(path.join(root, 'ledger.jsonl'), '{"event":"message_acc');
  assert.equal(verifyLedger(path.join(root, 'ledger.jsonl')).ok, false);
  await makeJ4(root, { adapters: { J5: stubAdapter() } }).process();
  assert.equal(events(root, 'ledger_repaired').length, 1);
  assert.equal(verifyLedger(path.join(root, 'ledger.jsonl')).ok, true);
  assert.equal(events(root, 'reply_received').length, 1);
});

test('живий чужий замок не перехоплюється', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root);
  fs.writeFileSync(path.join(root, '.j4', 'lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  assert.equal((await j4.process()).code, 'locked');
});

test('підробка запису журналу виявляється', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter() } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  const f = path.join(root, 'ledger.jsonl');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines[2] = lines[2].replace('"verdict":"answer"', '"verdict":"accepted"');
  fs.writeFileSync(f, lines.join('\n'));
  const v = verifyLedger(f);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.code === 'hash' && p.line === 3));
});
