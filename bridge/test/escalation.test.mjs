// Ескалація рішень рівня C до JE (пункт 5) і захист доказів від витоків (пункт 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stubAdapter, scenarios } from '../src/adapters/stub.mjs';
import { verifyLedger } from '../src/ledger.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, openEscalations, counting } from './helpers.mjs';

test('рівень C від J3 не йде до J5 до рішення JE', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter());
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  const r = j4.submit(draft(root, { decision_level: 'C', body: { decision_needed: [{ category: 'scope_change', question: 'Розширити обсяг?' }] } }), { origin: 'agent_cli' });
  assert.equal(r.status, 'held');
  await j4.process();
  assert.equal(j5.calls, 0);
  const [esc] = openEscalations(root);
  assert.deepEqual(esc.categories, ['scope_change']);
  assert.equal(esc.questions[0].question_sha256.length, 64);
  // нитка чекає JE: нові повідомлення в ній не приймаються
  assert.equal(j4.submit(draft(root, { thread_id: r.thread_id, body: { summary: 'ще' } }), { origin: 'agent_cli' }).code, 'thread-awaiting-founder');
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'release', note: 'Погоджено' }, { origin: 'human_cli' }).ok, true);
  await j4.process();
  assert.equal(j5.calls, 1);
  assert.equal(inbox(root, 'J3').length, 1);
  assert.equal(events(root, 'escalation_resolved')[0].detail.by, 'JE');
});

test('відповідь J5 з decision_needed тримається до рішення JE', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter({ scenario: scenarios.decisionNeeded('budget_over_reserve') }) } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(inbox(root, 'J3').length, 0);
  const [esc] = openEscalations(root);
  assert.equal(esc.reason, 'decision_level_c');
  assert.deepEqual(esc.categories, ['budget_over_reserve']);
  j4.resolve(esc.escalation_id, { decision: 'reject' }, { origin: 'human_cli' });
  await j4.process();
  assert.equal(inbox(root, 'J3').length, 0);
});

test('відповідь із секретом блокується, секрет не потрапляє в журнал', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter({ scenario: scenarios.leaksSecret() }) } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(inbox(root, 'J3').length, 0);
  assert.equal(events(root, 'reply_blocked').length, 1);
  assert.equal(openEscalations(root)[0].reason, 'red_line_risk');
  const raw = fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8');
  assert.ok(!raw.includes('sk-proj-'));
  assert.equal(verifyLedger(path.join(root, 'ledger.jsonl')).ok, true);
  assert.deepEqual(fs.readdirSync(path.join(root, '.j4', 'spool')), []);
});

test('чернетка з операційними шаблонами відхиляється без тексту в журналі', () => {
  const root = tmpStaff();
  const j4 = makeJ4(root);
  const r = j4.submit(draft(root, { body: { summary: 'Ціль 48.123456, 37.654321' } }), { origin: 'agent_cli' });
  assert.equal(r.code, 'scanner-block');
  const raw = fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8');
  assert.ok(!raw.includes('48.123456'));
  assert.deepEqual(events(root, 'message_rejected')[0].detail.rules, ['ops.coordinates']);
});

test('стоп-кран: J4_HALT і файл bridge/HALT', async () => {
  const root = tmpStaff();
  assert.equal(makeJ4(root, { env: { J4_HALT: '1' } }).submit(draft(root), { origin: 'agent_cli' }).code, 'halted');
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter() } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  fs.mkdirSync(path.join(root, 'bridge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bridge', 'HALT'), '');
  assert.equal((await j4.process()).code, 'halted');
  assert.equal(events(root, 'dispatch_attempt').length, 0);
});
