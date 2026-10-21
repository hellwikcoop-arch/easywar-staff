// Ліміти викликів, спроб, раундів і захист від циклів (пункт 4 наказу).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubAdapter, scenarios } from '../src/adapters/stub.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, openEscalations, counting } from './helpers.mjs';

test('ліміт викликів задачі: зупинка, auto_on_limit і ескалація JE', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter());
  const j4 = makeJ4(root, { adapters: { J5: j5 }, limits: { max_calls_per_task: 1 } });
  j4.submit(draft(root, { body: { summary: 'перший' } }), { origin: 'agent_cli' });
  await j4.process();
  j4.submit(draft(root, { body: { summary: 'другий' } }), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(j5.calls, 1);
  const blocked = events(root, 'dispatch_blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].detail.code, 'limit-calls-task');
  const esc = openEscalations(root);
  assert.equal(esc.length, 1);
  assert.equal(esc[0].reason, 'auto_on_limit');
});

test('ліміт токенів задачі враховує резерв', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter() }, limits: { max_tokens_per_task: 3000, reserve_tokens_per_call: 4000 } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(events(root, 'dispatch_blocked')[0].detail.code, 'limit-tokens-task');
});

test('тимчасова помилка: одна повторна спроба й успіх', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter({ scenario: scenarios.transientThenOk(1) }));
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(j5.calls, 2);
  assert.equal(events(root, 'dispatch_failed')[0].detail.will_retry, true);
  assert.equal(events(root, 'reply_received').length, 1);
  assert.equal(inbox(root, 'J3').length, 1);
});

test('дві спроби вичерпано: третя лише за рішенням JE', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter({ scenario: scenarios.transientThenOk(2) }));
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(j5.calls, 2);
  const [esc] = openEscalations(root);
  assert.equal(esc.reason, 'attempts-exhausted');
  assert.deepEqual(esc.categories, ['third_attempt']);
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'third_attempt' }, { origin: 'agent_cli' }).code, 'origin-denied');
  assert.equal(j4.resolve(esc.escalation_id, { decision: 'third_attempt' }, { origin: 'human_cli' }).ok, true);
  await j4.process();
  assert.equal(j5.calls, 3);
  assert.equal(events(root, 'reply_received').length, 1);
});

test('невалідна відповідь агента повторюється один раз, далі ескалація', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter({ scenario: scenarios.badSchema() }));
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(j5.calls, 2);
  assert.equal(events(root, 'reply_received').length, 0);
  assert.equal(openEscalations(root).length, 1);
});

test('ліміт раундів нитки', () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { limits: { max_rounds_per_thread: 2 } });
  const a = j4.submit(draft(root, { body: { summary: 'раунд 1' } }), { origin: 'agent_cli' });
  // J5 без адаптера: доставка в inbox, тому нитка лишається відкритою; відповіді J5 моделюємо вручну
  j4.submit(draft(root, { from: 'J5', to: 'J3', kind: 'response', in_reply_to: a.msg_id, body: { summary: 'відповідь 1' } }), { origin: 'adapter', causedBy: a.msg_id });
  const b = j4.submit(draft(root, { thread_id: a.thread_id, body: { summary: 'раунд 2' } }), { origin: 'agent_cli' });
  assert.equal(b.ok, true);
  j4.submit(draft(root, { from: 'J5', to: 'J3', kind: 'response', in_reply_to: b.msg_id, body: { summary: 'відповідь 2' } }), { origin: 'adapter', causedBy: b.msg_id });
  const c = j4.submit(draft(root, { thread_id: a.thread_id, body: { summary: 'раунд 3' } }), { origin: 'agent_cli' });
  assert.equal(c.code, 'loop-max-rounds');
  assert.equal(openEscalations(root)[0].reason, 'loop-max-rounds');
});

test('ping-pong: повтор того самого повідомлення в нитці', () => {
  const root = tmpStaff();
  const j4 = makeJ4(root);
  const a = j4.submit(draft(root), { origin: 'agent_cli' });
  j4.submit(draft(root, { from: 'J5', to: 'J3', kind: 'response', in_reply_to: a.msg_id, body: { summary: 'ок' } }), { origin: 'adapter', causedBy: a.msg_id });
  assert.equal(j4.submit(draft(root, { thread_id: a.thread_id }), { origin: 'agent_cli' }).code, 'loop-ping-pong');
});

test('цикл очікування: J5 не може запитувати J3, поки J3 чекає на J5', () => {
  const root = tmpStaff();
  const j4 = makeJ4(root);
  const a = j4.submit(draft(root), { origin: 'agent_cli' });
  const r = j4.submit(draft(root, { from: 'J5', to: 'J3', kind: 'request', thread_id: a.thread_id, body: { summary: 'зустрічний запит' } }), { origin: 'adapter', causedBy: a.msg_id });
  assert.equal(r.code, 'loop-wait-cycle');
});

test('глибина делегування й хопи', () => {
  const root = tmpStaff();
  // J3 → J5 (горизонтальний запит) → C5.1-R: глибина 1 дозволена (розділ 1: глибина делегування 1)
  const j4 = makeJ4(root, { limits: { max_hops: 1 } });
  const a = j4.submit(draft(root), { origin: 'agent_cli' });
  const b = j4.submit(draft(root, { from: 'J5', to: 'C5.1-R', kind: 'request', thread_id: a.thread_id, body: { summary: 'рецензія' } }), { origin: 'adapter', causedBy: a.msg_id });
  assert.equal(b.ok, true);
  // з межею 0 той самий ланцюг зупиняється
  const r0 = tmpStaff();
  const z0 = makeJ4(r0, { limits: { max_delegation_depth: 0 } });
  const a0 = z0.submit(draft(r0), { origin: 'agent_cli' });
  assert.equal(z0.submit(draft(r0, { from: 'J5', to: 'C5.1-R', kind: 'request', thread_id: a0.thread_id, body: { summary: 'рецензія' } }), { origin: 'adapter', causedBy: a0.msg_id }).code, 'loop-delegation-depth');
  const root2 = tmpStaff();
  const k = makeJ4(root2, { limits: { max_hops: 1, max_delegation_depth: 5 } });
  const x = k.submit(draft(root2), { origin: 'agent_cli' });
  const y = k.submit(draft(root2, { from: 'J5', to: 'J3', kind: 'response', in_reply_to: x.msg_id, body: { summary: 'h1' } }), { origin: 'adapter', causedBy: x.msg_id });
  assert.equal(y.ok, true);
  const z = k.submit(draft(root2, { from: 'J3', to: 'J5', kind: 'report', in_reply_to: y.msg_id, body: { summary: 'h2' } }), { origin: 'adapter', causedBy: y.msg_id });
  assert.equal(z.code, 'loop-max-hops');
});

test('ліміт відкритих ниток на задачу', () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { limits: { max_open_threads_per_task: 2 } });
  assert.equal(j4.submit(draft(root, { body: { summary: '1' } }), { origin: 'agent_cli' }).ok, true);
  assert.equal(j4.submit(draft(root, { body: { summary: '2' } }), { origin: 'agent_cli' }).ok, true);
  assert.equal(j4.submit(draft(root, { body: { summary: '3' } }), { origin: 'agent_cli' }).code, 'limit-open-threads');
});
