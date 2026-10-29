// Критерій успіху наказу T-0005 у режимі stub: J3 → J4 → J5, автоматична відповідь J5 → J3,
// обидва повідомлення зафіксовано в журналі з доказами, без ручного пересилання.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stubAdapter } from '../src/adapters/stub.mjs';
import { verifyLedger } from '../src/ledger.mjs';
import { sha256 } from '../src/protocol.mjs';
import { BRIDGE_DIR } from '../src/policy.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, ledgerEntries, counting, SHA_A } from './helpers.mjs';

test('J3 → J5 через J4: автоматична відповідь і докази', async () => {
  const root = tmpStaff();
  const j5 = counting(stubAdapter({ role: 'J5' }));
  const j4 = makeJ4(root, { adapters: { J5: j5 } });
  const marker = 'ТЕКСТ-ТІЛА-НЕ-ДЛЯ-ЖУРНАЛУ';
  const sent = j4.submit(draft(root, { body: { text: marker } }), { origin: 'agent_cli' });
  assert.equal(sent.ok, true);
  assert.equal(sent.status, 'queued');

  const run = await j4.process();
  assert.equal(run.ok, true);
  assert.equal(j5.calls, 1);

  const box = inbox(root, 'J3');
  assert.equal(box.length, 1);
  const reply = box[0];
  assert.equal(reply.from, 'J5');
  assert.equal(reply.to, 'J3');
  assert.equal(reply.kind, 'response');
  assert.equal(reply.in_reply_to, sent.msg_id);
  assert.equal(reply.thread_id, sent.thread_id);
  assert.equal(reply.subject.ref, SHA_A);
  assert.equal(reply.task_id, 'T-0900');
  assert.equal(reply.hop, 1);

  const kinds = ledgerEntries(root).map((e) => e.event);
  assert.deepEqual(kinds, ['message_accepted', 'dispatch_attempt', 'reply_received', 'message_accepted', 'message_delivered']);
  const [accReq, , got, accRep] = ledgerEntries(root);
  assert.equal(accReq.msg_id, sent.msg_id);
  assert.equal(accReq.body_sha256.length, 64);
  assert.equal(got.detail.mode, 'stub');
  assert.equal(got.detail.model_id, null);
  assert.equal(got.detail.raw_sha256.length, 64);
  assert.equal(got.detail.prompt_sha256.length, 64);
  assert.equal(accRep.msg_id, reply.msg_id);
  assert.equal(accRep.detail.caused_by, sent.msg_id);

  const v = verifyLedger(path.join(root, 'ledger.jsonl'));
  assert.equal(v.ok, true, JSON.stringify(v.problems));

  // у журналі немає тексту тіла, інструкцій ролі й сирої відповіді
  const raw = fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8');
  assert.ok(!raw.includes(marker));
  const instructions = fs.readFileSync(path.join(BRIDGE_DIR, 'roles', 'J5.md'), 'utf8');
  assert.ok(!raw.includes(instructions.slice(0, 80)));
  assert.ok(!raw.includes('Синтетична відповідь адаптера stub'));
  const st = JSON.parse(fs.readFileSync(path.join(root, '.j4', 'messages', `${sent.msg_id}.json`), 'utf8'));
  assert.equal(st.dispatch.instructions_sha256, sha256(instructions));
  assert.equal(st.dispatch.prompt_sha256, got.detail.prompt_sha256);

  // спул сирої відповіді прибрано після запису
  assert.deepEqual(fs.readdirSync(path.join(root, '.j4', 'spool')), []);
});

test('рівень доказів hash: без резюме в журналі', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter() }, evidence: 'hash' });
  j4.submit(draft(root, { body: { summary: 'РЕЗЮМЕ-МАРКЕР' } }), { origin: 'agent_cli' });
  await j4.process();
  assert.ok(!fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8').includes('РЕЗЮМЕ-МАРКЕР'));
  assert.equal(events(root, 'reply_received').length, 1);
});

test('J3 відповідає J5 у тій самій нитці з inbox', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root, { adapters: { J5: stubAdapter() } });
  const a = j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  const r = inbox(root, 'J3')[0];
  const b = j4.submit(draft(root, { kind: 'report', in_reply_to: r.msg_id, body: { summary: 'Синтетичне донесення J3 після відповіді J5' } }), { origin: 'agent_cli' });
  assert.equal(b.ok, true);
  assert.equal(b.thread_id, a.thread_id);
});
