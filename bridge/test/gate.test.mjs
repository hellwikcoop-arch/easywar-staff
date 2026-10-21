// Ворота платних викликів і адаптери без мережі (fake fetch / fake spawn). Жодного живого виклику.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openaiAdapter, buildRequest, extractText } from '../src/adapters/openai.mjs';
import { codexArgs, claudeArgs, codexAdapter } from '../src/adapters/cli.mjs';
import { AdapterError } from '../src/adapters/common.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, openEscalations } from './helpers.mjs';

const T0 = Date.parse('2026-10-21T18:00:00Z');

function approval(root, over = {}) {
  const a = {
    approved_by: 'JE', approved_at: '2026-10-21T17:00:00Z', expires_at: '2026-10-22T17:00:00Z',
    adapters: ['openai'], task_ids: ['T-0900'], max_calls: 3, max_tokens: 20000, max_cost_usd: 0.5,
    models: { openai: 'synthetic-model-id' }, price: { input_per_mtok: 1, output_per_mtok: 4 },
    ref: 'tasks/T-0900/events.jsonl#seq=9', ...over,
  };
  fs.writeFileSync(path.join(root, 'approval.json'), JSON.stringify(a));
}

function fakeFetch(body, { status = 200 } = {}) {
  const f = async (url, init) => {
    f.calls.push({ url, init });
    return { ok: status < 300, status, headers: { get: (h) => (h === 'x-request-id' ? 'req_synthetic' : null) }, json: async () => body };
  };
  f.calls = [];
  return f;
}

const OK_BODY = {
  id: 'resp_synthetic', status: 'completed', model: 'synthetic-model-id-2026',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'J5: прийнято', text: 'Синтетична відповідь.', verdict: 'answer', decision_needed: [] }) }] }],
  usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
};

test('без J4_ALLOW_LIVE платний адаптер не викликається', async () => {
  const root = tmpStaff();
  approval(root);
  const f = fakeFetch(OK_BODY);
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: { OPENAI_API_KEY: 'x' } }) }, env: {}, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(f.calls.length, 0);
  assert.equal(events(root, 'dispatch_blocked')[0].detail.code, 'live-not-enabled');
  assert.equal(openEscalations(root)[0].reason, 'live-gate');
});

test('ворота: погодження JE обов\'язкове, чинне і для цієї задачі', async () => {
  const cases = [
    [null, 'approval-missing'],
    [{ approved_by: 'J3' }, 'approval-not-je'],
    [{ expires_at: '2026-10-21T17:30:00Z' }, 'approval-expired'],
    [{ task_ids: ['T-0901'] }, 'approval-task'],
    [{ adapters: ['codex'] }, 'approval-adapter'],
  ];
  for (const [over, code] of cases) {
    const root = tmpStaff();
    if (over) approval(root, over);
    const f = fakeFetch(OK_BODY);
    const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: { OPENAI_API_KEY: 'x' } }) }, env: { J4_ALLOW_LIVE: '1', OPENAI_API_KEY: 'x' }, now: () => T0 });
    j4.submit(draft(root), { origin: 'agent_cli' });
    await j4.process();
    assert.equal(f.calls.length, 0, code);
    assert.equal(events(root, 'dispatch_blocked')[0].detail.code, code);
  }
  const root = tmpStaff();
  approval(root);
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: fakeFetch(OK_BODY), env: {} }) }, env: { J4_ALLOW_LIVE: '1' }, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(events(root, 'dispatch_blocked')[0].detail.code, 'credentials-missing');
});

test('погоджений живий шлях (fake fetch): запит, облік, вартість, без ключа в журналі', async () => {
  const root = tmpStaff();
  approval(root);
  const f = fakeFetch(OK_BODY);
  const key = 'sk-proj-SYNTHETICKEYSYNTHETICKEY0000';
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: { OPENAI_API_KEY: key } }) }, env: { J4_ALLOW_LIVE: '1', OPENAI_API_KEY: key }, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(f.calls.length, 1);
  const req = JSON.parse(f.calls[0].init.body);
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(req.model, 'synthetic-model-id');
  assert.equal(req.store, false);
  assert.equal(req.max_output_tokens, 1500);
  assert.equal(req.text.format.type, 'json_schema');
  assert.equal(req.text.format.strict, true);
  assert.ok(req.instructions.startsWith('# Правила ролі J5'));
  const [got] = events(root, 'reply_received');
  assert.equal(got.detail.mode, 'live');
  assert.equal(got.detail.model_id, 'synthetic-model-id-2026');
  assert.equal(got.detail.request_id, 'req_synthetic');
  assert.equal(got.detail.usage.input_tokens.value, 1200);
  assert.equal(got.detail.usage.input_tokens.accuracy, 'exact');
  assert.equal(got.detail.usage.cost_usd.value, (1200 * 1 + 300 * 4) / 1e6);
  assert.equal(got.detail.usage.cost_usd.accuracy, 'estimate');
  assert.equal(got.detail.approval.ref, 'tasks/T-0900/events.jsonl#seq=9');
  assert.equal(inbox(root, 'J3').length, 1);
  assert.ok(!fs.readFileSync(path.join(root, 'ledger.jsonl'), 'utf8').includes('SYNTHETICKEY'));
});

test('межа вартості з погодження: резерв понад max_cost_usd блокує виклик', async () => {
  const root = tmpStaff();
  approval(root, { max_cost_usd: 0.001, price: { input_per_mtok: 10, output_per_mtok: 40 } });
  const f = fakeFetch(OK_BODY);
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: { OPENAI_API_KEY: 'x' } }) }, env: { J4_ALLOW_LIVE: '1', OPENAI_API_KEY: 'x' }, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(f.calls.length, 0);
  assert.equal(events(root, 'dispatch_blocked')[0].detail.code, 'limit-cost-task');
});

test('HTTP 429/5xx тимчасові, 4xx — ні', async () => {
  for (const [status, transient] of [[429, true], [503, true], [400, false]]) {
    const ad = openaiAdapter({ fetchImpl: fakeFetch({ error: { code: 'x' } }, { status }), env: { OPENAI_API_KEY: 'x' } });
    await assert.rejects(ad.call({ instructions: '', input: '', model: 'm', limits: { max_output_tokens: 10 } }), (e) => e instanceof AdapterError && e.transient === transient);
  }
});

test('розбір відповіді Responses API', () => {
  assert.throws(() => buildRequest({ model: null, instructions: '', input: '', maxOutputTokens: 1 }), /model-not-configured/);
  assert.equal(extractText(OK_BODY).startsWith('{'), true);
  assert.throws(() => extractText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), /provider-status:incomplete:max_output_tokens/);
  assert.throws(() => extractText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), /provider-refusal/);
  assert.throws(() => extractText({ status: 'completed', output: [] }), /provider-empty/);
});

test('Codex і Claude CLI: аргументи пісочниці', () => {
  assert.deepEqual(codexArgs({ workdir: '/w', sandbox: 'read-only', schemaFile: '/s', outFile: '/o' }).slice(0, 4), ['exec', '--json', '-s', 'read-only']);
  assert.throws(() => codexArgs({ workdir: '/w', sandbox: 'danger-full-access', schemaFile: '/s', outFile: '/o' }), /sandbox-denied/);
  const c = claudeArgs({ instructions: 'r', readOnly: true });
  assert.equal(c[c.indexOf('--allowedTools') + 1], 'Read,Grep,Glob');
});

test('адаптер Codex (fake spawn) читає останнє повідомлення з файла -o', async () => {
  const spawnImpl = (cmd, args) => {
    const ch = new EventEmitter();
    ch.stdout = new EventEmitter();
    ch.stderr = new EventEmitter();
    ch.stdin = { end: () => {
      const out = args[args.indexOf('-o') + 1];
      fs.writeFileSync(out, JSON.stringify({ summary: 'рецензія', text: 'ok', verdict: 'accepted', decision_needed: [] }));
      setImmediate(() => ch.emit('close', 0));
    } };
    ch.kill = () => {};
    assert.equal(cmd, 'codex');
    return ch;
  };
  const r = await codexAdapter({ spawnImpl, workdir: '/tmp' }).call({ instructions: 'i', input: 'x' });
  assert.equal(JSON.parse(r.rawText).verdict, 'accepted');
});
