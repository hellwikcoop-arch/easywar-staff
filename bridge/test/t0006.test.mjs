// T-0006: місячна стеля $50 (пороги $35/$45/$50), бар'єр приймання на одному SHA,
// заборона done у повідомленнях. Лише синтетичні дані; живі виклики — fake fetch, без мережі.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MonthlyBudget, toMicro } from '../src/monthly.mjs';
import { acceptanceReady, evidenceFromEvents, requestDone } from '../src/acceptance.mjs';
import { openaiAdapter } from '../src/adapters/openai.mjs';
import { stubAdapter } from '../src/adapters/stub.mjs';
import { AdapterError } from '../src/adapters/common.mjs';
import { loadConfig } from '../src/policy.mjs';
import { tmpStaff, draft, makeJ4, events, inbox, openEscalations, SHA_A, SHA_B } from './helpers.mjs';

const CFG = loadConfig().limits.monthly;
const T0 = Date.parse('2026-10-21T18:00:00Z');
const NOV = Date.parse('2026-11-01T00:00:01Z');

function approval(root, over = {}) {
  fs.writeFileSync(path.join(root, 'approval.json'), JSON.stringify({
    approved_by: 'JE', approved_at: '2026-10-21T17:00:00Z', expires_at: '2026-12-31T00:00:00Z',
    adapters: ['openai'], task_ids: ['T-0900'], max_calls: 20, max_tokens: 200000, max_cost_usd: 100,
    models: { openai: 'synthetic-model-id' }, price: { input_per_mtok: 1, output_per_mtok: 4 },
    ref: 'tasks/T-0900/events.jsonl#seq=9', ...over,
  }));
}

function reply(usage = { input_tokens: 1000, output_tokens: 100 }) {
  return {
    id: 'resp_s', status: 'completed', model: 'synthetic-model-id',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'ok', text: 'ok', verdict: 'answer', decision_needed: [] }) }] }],
    usage,
  };
}

function fakeFetch(body) {
  const f = async () => { f.calls += 1; return { ok: true, status: 200, headers: { get: () => null }, json: async () => body }; };
  f.calls = 0;
  return f;
}

const LIVE_ENV = { J4_ALLOW_LIVE: '1', OPENAI_API_KEY: 'x' };

test('місячний облік: пороги 35/45/50 і блокування на 50', () => {
  const root = tmpStaff();
  const mb = new MonthlyBudget(path.join(root, 'm.json'), CFG);
  const step = (id, usd) => {
    const r = mb.reserve(id, toMicro(usd), T0);
    assert.equal(r.ok, true, id);
    return mb.settle(id, toMicro(usd), 'exact', T0).crossed;
  };
  assert.deepEqual(step('a', 34.99), []);
  assert.deepEqual(step('b', 0.02), ['warning_35']);
  assert.deepEqual(step('c', 10), ['critical_45']);
  assert.deepEqual(step('d', 4.99), ['stop_50']);
  assert.equal(mb.snapshot(T0).level, 'stop_50');
  assert.equal(mb.reserve('e', 1, T0).code, 'monthly-stop');
  // новий календарний місяць UTC — новий облік
  assert.equal(mb.reserve('f', toMicro(1), NOV).ok, true);
});

test('резерв верхньої межі: запит, що може перевищити стелю, відхиляється заздалегідь', () => {
  const root = tmpStaff();
  const mb = new MonthlyBudget(path.join(root, 'm.json'), CFG);
  assert.equal(mb.reserve('a', toMicro(30), T0).ok, true);
  // ще не розраховано, але резерв враховується (паралельний запит)
  assert.equal(mb.reserve('b', toMicro(25), T0).code, 'monthly-cap-would-exceed');
  assert.equal(mb.reserve('c', toMicro(20), T0).ok, true);
  assert.equal(mb.reserve('d', 0, T0).code, 'monthly-upper-bound-unknown');
});

test('невідома вартість зараховується консервативно (весь резерв, estimate)', () => {
  const root = tmpStaff();
  const mb = new MonthlyBudget(path.join(root, 'm.json'), CFG);
  mb.reserve('a', toMicro(2), T0);
  const r = mb.settle('a', null, 'exact', T0);
  assert.equal(r.snapshot.estimated_usd, 2);
  assert.equal(r.snapshot.confirmed_usd, 0);
  assert.equal(r.snapshot.accuracy, 'estimate');
});

test('облік переживає перезапуск і не скидається при зміні задачі; пошкоджений файл — відмова', () => {
  const root = tmpStaff();
  const f = path.join(root, 'm.json');
  const a = new MonthlyBudget(f, CFG);
  a.reserve('x', toMicro(40), T0);
  a.settle('x', toMicro(40), 'exact', T0);
  const b = new MonthlyBudget(f, CFG); // «перезапуск»
  assert.equal(b.snapshot(T0).spent_usd, 40);
  assert.equal(b.reserve('y', toMicro(11), T0).code, 'monthly-cap-would-exceed');
  fs.writeFileSync(f, '{bad');
  assert.throws(() => b.reserve('z', 1, T0), /monthly-state-corrupt/);
});

test('паралельні процеси з одним файлом не перевищують стелю', () => {
  const root = tmpStaff();
  const f = path.join(root, 'm.json');
  const mod = new URL('../src/monthly.mjs', import.meta.url).href;
  const script = `import { MonthlyBudget, toMicro } from '${mod}';
    const mb = new MonthlyBudget(${JSON.stringify(f)}, ${JSON.stringify(CFG)});
    let ok = 0; for (let i = 0; i < 10; i++) if (mb.reserve(process.argv[2] + i, toMicro(3), ${T0}).ok) ok++;
    console.log(ok);`;
  const sf = path.join(root, 'w.mjs');
  fs.writeFileSync(sf, script);
  const runs = [0, 1, 2].map((i) => spawnSync(process.execPath, [sf, `p${i}-`], { encoding: 'utf8' }));
  const granted = runs.reduce((s, r) => s + Number(r.stdout.trim()), 0);
  assert.equal(granted, 16); // 16 × $3 = $48 ≤ $50, сімнадцятий перевищив би
  assert.ok(new MonthlyBudget(f, CFG).snapshot(T0).reserved_usd <= 50);
});

test('живий виклик через J4: резерв, розрахунок, поріг і блок на $50 (fake fetch)', async () => {
  const root = tmpStaff();
  // синтетично дорогий тариф; кожен виклик — інша задача: місячний облік спільний і не скидається
  const tasks = Array.from({ length: 10 }, (_, i) => `T-09${String(i).padStart(2, '0')}`);
  approval(root, { task_ids: tasks, price: { input_per_mtok: 1000, output_per_mtok: 1000 } });
  const f = fakeFetch(reply({ input_tokens: 4000, output_tokens: 1000 })); // 5 000 токенів × $1000/M = $5
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: LIVE_ENV }) }, env: LIVE_ENV, now: () => T0 });
  for (const t of tasks) {
    j4.submit(draft(root, { task_id: t, body: { summary: `запит ${t}` } }), { origin: 'agent_cli' });
    await j4.process();
  }
  const [first] = events(root, 'dispatch_attempt');
  assert.ok(first); // верхня межа одного виклику між $5 і $10 (байти інструкцій і входу + max_output_tokens)
  const levels = events(root, 'budget_threshold').map((e) => e.detail.level);
  assert.deepEqual(levels, ['warning_35', 'critical_45']); // $35 після 7-го, $45 після 9-го
  const blocked = events(root, 'dispatch_blocked').map((e) => e.detail.code);
  assert.deepEqual(blocked, ['monthly-cap-would-exceed']); // 10-й: $45 + резерв > $50
  assert.equal(f.calls, 9);
  assert.equal(inbox(root, 'J3').length, 9);
  const snap = new MonthlyBudget(path.join(root, '.j4', 'budget', 'monthly.json'), CFG).snapshot(T0);
  assert.equal(snap.spent_usd, 45);
  assert.equal(snap.reserved_usd, 0);
  assert.equal(snap.accuracy, 'estimate'); // вартість за ціною з погодження — оцінка
  assert.ok(openEscalations(root).some((e) => e.reason === 'budget_threshold'));
  assert.ok(openEscalations(root).some((e) => e.reason === 'monthly_cap'));
});

test('погодження JE не піднімає місячну стелю й мусить містити модель і ціну', async () => {
  for (const [over, code] of [[{ models: {} }, 'approval-model-missing'], [{ price: null }, 'approval-price-missing'], [{ price: { input_per_mtok: 0, output_per_mtok: 1 } }, 'approval-price-missing']]) {
    const root = tmpStaff();
    approval(root, over);
    const f = fakeFetch(reply());
    const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: LIVE_ENV }) }, env: LIVE_ENV, now: () => T0 });
    j4.submit(draft(root), { origin: 'agent_cli' });
    await j4.process();
    assert.equal(f.calls, 0, code);
    assert.equal(events(root, 'dispatch_blocked')[0].detail.code, code);
  }
  const root = tmpStaff();
  approval(root, { max_cost_usd: 1000 }); // межа задачі більша за місячну стелю
  const mf = path.join(root, '.j4', 'budget', 'monthly.json');
  const pre = new MonthlyBudget(mf, CFG);
  pre.reserve('old', toMicro(49.999), T0);
  pre.settle('old', toMicro(49.999), 'exact', T0);
  const f = fakeFetch(reply());
  const j4 = makeJ4(root, { adapters: { J5: openaiAdapter({ fetchImpl: f, env: LIVE_ENV }) }, env: LIVE_ENV, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  assert.equal(f.calls, 0);
  assert.equal(events(root, 'dispatch_blocked')[0].detail.code, 'monthly-cap-would-exceed');
});

test('збій живого виклику: резерв зараховано як оцінку; stub не потрапляє в місячний облік', async () => {
  const root = tmpStaff();
  approval(root);
  const failing = { name: 'openai', mode: 'sync', live: true, outputLimit: true, requiredEnv: ['OPENAI_API_KEY'], call: async () => { throw new AdapterError('http-400'); } };
  const j4 = makeJ4(root, { adapters: { J5: failing }, env: LIVE_ENV, now: () => T0 });
  j4.submit(draft(root), { origin: 'agent_cli' });
  await j4.process();
  const snap = new MonthlyBudget(path.join(root, '.j4', 'budget', 'monthly.json'), CFG).snapshot(T0);
  assert.ok(snap.estimated_usd > 0);
  assert.equal(snap.reserved_usd, 0);
  const root2 = tmpStaff();
  const k = makeJ4(root2, { adapters: { J5: stubAdapter() }, now: () => T0 });
  k.submit(draft(root2), { origin: 'agent_cli' });
  await k.process();
  assert.equal(new MonthlyBudget(path.join(root2, '.j4', 'budget', 'monthly.json'), CFG).snapshot(T0).spent_usd, 0);
  assert.equal(events(root2, 'reply_received')[0].detail.usage.monthly, null);
});

test('повідомлення агента не може встановити done; невідомий стан відхиляється', async () => {
  const root = tmpStaff();
  const j4 = makeJ4(root);
  assert.equal(j4.submit(draft(root, { kind: 'report', body: { task_state: 'done' } }), { origin: 'agent_cli' }).code, 'done-forbidden');
  assert.equal(j4.submit(draft(root, { kind: 'report', body: { task_state: 'finished' } }), { origin: 'agent_cli' }).code, 'invalid');
  assert.equal(j4.submit(draft(root, { kind: 'report', body: { task_state: 'review' } }), { origin: 'agent_cli' }).ok, true);
  // відповідь агента зі станом done не проходить схему відповіді
  const j = makeJ4(tmpStaff(), { adapters: { J5: stubAdapter({ scenario: () => ({ rawText: JSON.stringify({ summary: 's', text: 't', verdict: 'answer', decision_needed: [], task_state: 'done' }), meta: {} }) }) } });
  j.submit(draft(j.staffRoot), { origin: 'agent_cli' });
  await j.process();
  assert.equal(events(j.staffRoot, 'reply_received').length, 0);
});

const ok = (subject = SHA_A) => ({
  subject,
  checks: [{ subject, passed: true, evidence_ref: 'log' }],
  reviews: [{ by: 'C3', subject, review_status: 'complete', verdict: 'passed', evidence_ref: 'r' }],
  acceptances: [{ by: 'J3', role: 'technical', subject, evidence_ref: 'a', result: 'accepted', scope: 'full' }, { by: 'J5', role: 'content', subject, evidence_ref: 'b', result: 'accepted', scope: 'full' }],
});

test('бар\'єр приймання: усе на одному SHA', () => {
  assert.deepEqual(acceptanceReady(ok()), { ready: true, missing: [] });
  const mixed = ok();
  mixed.acceptances[1].subject = SHA_B; // J5 прийняв інший коміт
  assert.deepEqual(acceptanceReady(mixed).missing, ['acceptance-J5-content-missing']);
  const later = ok();
  later.reviews.push({ by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'changes_requested', evidence_ref: 'r2' });
  assert.ok(acceptanceReady(later).missing.includes('review-C3-not-passed'));
  const fake = ok();
  fake.reviews[0].by = 'C5.1-R'; // рецензія не від C3 не замінює C3
  assert.ok(acceptanceReady(fake).missing.includes('review-C3-missing'));
  assert.ok(acceptanceReady({ ...ok(), openMandatoryFindings: 1 }).missing.includes('open-mandatory-findings'));
  assert.ok(acceptanceReady({ ...ok(), keyDecision: true }).missing.includes('acceptance-JE-key_decision-missing'));
  assert.ok(acceptanceReady({ ...ok(), checks: [{ subject: SHA_A, passed: true }] }).missing.includes('checks-not-on-subject-or-failed'));
  assert.deepEqual(acceptanceReady({ ...ok(), subject: 'abc' }).missing, ['subject-invalid']);
});

test('done лише ADM і лише після бар\'єра; докази з events.jsonl', () => {
  assert.deepEqual(requestDone({ by: 'J3', ...ok() }).missing, ['done-only-adm']);
  assert.equal(requestDone({ by: 'ADM', ...ok() }).allowed, true);
  const root = tmpStaff();
  const lines = [
    { event: 'review_finished', task_id: 'T-0900', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'reports/x.yaml' },
    { event: 'acceptance', task_id: 'T-0900', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'reports/y.yaml' },
    { event: 'acceptance', task_id: 'T-0901', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'чужа задача' },
  ];
  fs.appendFileSync(path.join(root, 'tasks', 'T-0900', 'events.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const ev = evidenceFromEvents(root, 'T-0900');
  const r = acceptanceReady({ subject: SHA_A, checks: [{ subject: SHA_A, passed: true, evidence_ref: 'log' }], ...ev });
  assert.deepEqual(r.missing, ['acceptance-J5-content-missing']);
});

// --- виправлення за рецензією C3 (T-0006, донесення C3 на b83cd93)
import { Ledger, verifyLedger } from '../src/ledger.mjs';
import { validateMessage } from '../src/protocol.mjs';

test('F-1: пізніше відхилення скасовує приймання; лише явне accepted', () => {
  const base = ok();
  base.acceptances.push({ by: 'J5', role: 'content', subject: SHA_A, evidence_ref: 'c', result: 'rejected', scope: 'full' });
  assert.ok(acceptanceReady(base).missing.includes('acceptance-J5-content-not-accepted'));
  const pending = ok();
  pending.acceptances[1].result = 'pending';
  assert.ok(acceptanceReady(pending).missing.includes('acceptance-J5-content-not-accepted'));
  const fixed = ok();
  fixed.acceptances.push({ by: 'J5', role: 'content', subject: SHA_A, evidence_ref: 'd', result: 'rejected', scope: 'full' }, { by: 'J5', role: 'content', subject: SHA_A, evidence_ref: 'e', result: 'accepted', scope: 'full' });
  assert.equal(acceptanceReady(fixed).ready, true);
});

test('F-5: довжина й формат полів, що потрапляють у журнал', () => {
  const root = tmpStaff();
  const codes = (d) => validateMessage(d, { draft: true }).map((x) => x.field);
  assert.ok(codes(draft(root, { subject: { kind: 'doc_version', ref: 'x'.repeat(20000) } })).includes('subject.ref'));
  assert.deepEqual(codes(draft(root, { subject: { kind: 'doc_version', ref: 'contract-v0.4@2026-10-22' } })), []);
  assert.ok(codes(draft(root, { contract: { version: 'x'.repeat(500), sha256: 'a'.repeat(64) } })).includes('contract'));
  assert.ok(codes(draft(root, { thread_id: 'довільний текст' })).includes('thread_id'));
  assert.ok(codes(draft(root, { in_reply_to: 'довільний текст' })).includes('in_reply_to'));
});

test('F-4: паралельні процеси send не рвуть ланцюг журналу й не дублюють msg_id', () => {
  const root = tmpStaff();
  const mod = (f) => new URL(`../src/${f}`, import.meta.url).href;
  const sf = path.join(root, 'send.mjs');
  fs.writeFileSync(sf, `import { J4 } from '${mod('router.mjs')}'; import { loadConfig } from '${mod('policy.mjs')}';
    import { PROTOCOL, sha256 } from '${mod('protocol.mjs')}'; import fs from 'node:fs';
    const root = ${JSON.stringify(root)};
    const j4 = new J4({ config: loadConfig(), home: root + '/.j4', ledgerFile: root + '/ledger.jsonl', staffRoot: root, env: {} });
    const c = { version: '0.4', sha256: sha256(fs.readFileSync(root + '/CONTRACT_v0_4.md')) };
    for (let i = 0; i < 3; i++) j4.submit({ protocol: PROTOCOL, task_id: 'T-09' + process.argv[2], task_version: 1, contract: c, subject: { kind: 'commit', ref: '${SHA_A}' }, from: 'J3', to: 'J5', kind: 'request', decision_level: 'A', data_class: 'synthetic', body: { summary: 'p' + process.argv[2] + '-' + i } }, { origin: 'agent_cli' });`);
  const procs = ['10', '11', '12', '13'].map((n) => spawnSync(process.execPath, [sf, n], { encoding: 'utf8' }));
  for (const p of procs) assert.equal(p.status, 0, p.stderr);
  const v = verifyLedger(path.join(root, 'ledger.jsonl'));
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.entries, 12);
  const ids = events(root, 'message_accepted').map((e) => e.msg_id);
  assert.equal(new Set(ids).size, 12);
});

test('F-6: замок загиблого процесу не блокує облік назавжди', () => {
  const root = tmpStaff();
  const f = path.join(root, 'm.json');
  fs.writeFileSync(`${f}.lock`, JSON.stringify({ pid: 999999, at: Date.now() }));
  assert.equal(new MonthlyBudget(f, CFG).reserve('a', toMicro(1), T0).ok, true);
  assert.equal(fs.existsSync(`${f}.lock`), false);
});

test('F-7: ремонт журналу атомарний і зберігає цілі записи', () => {
  const root = tmpStaff();
  const f = path.join(root, 'l.jsonl');
  const l = new Ledger(f);
  l.append({ event: 'a', at: 'x' });
  l.append({ event: 'b', at: 'y' });
  fs.appendFileSync(f, '{"event":"c"');
  l.repairIfNeeded('z');
  const v = verifyLedger(f);
  assert.equal(v.ok, true);
  assert.equal(v.entries, 3);
  assert.deepEqual(fs.readdirSync(root).filter((x) => x.startsWith('l.jsonl.')), []);
});

// --- повторна рецензія C3 на cec9281: F-10…F-13
import { withFileLock } from '../src/store.mjs';
import { checkLive } from '../src/gate.mjs';

test('F-10: живий замок не знімається — ні порожній свіжий, ні старий живого pid; чужий замок не звільняється', () => {
  const root = tmpStaff();
  const lf = path.join(root, 'x.lock');
  fs.writeFileSync(lf, ''); // свіжий нечитаний замок (вікно створення в старій схемі)
  assert.throws(() => withFileLock(lf, () => 1, { timeoutMs: 100 }), /lock-timeout/);
  fs.writeFileSync(lf, JSON.stringify({ pid: process.ppid, at: Date.now() - 3600_000, nonce: 'x' })); // живий, старий
  assert.throws(() => withFileLock(lf, () => 1, { timeoutMs: 100 }), /lock-timeout/);
  fs.writeFileSync(lf, JSON.stringify({ pid: 999999, at: Date.now(), nonce: 'dead' })); // мертвий
  // fn підміняє замок «чужим» — після виходу чужий замок лишається
  withFileLock(lf, () => fs.writeFileSync(lf, JSON.stringify({ pid: process.ppid, at: Date.now(), nonce: 'other' })));
  assert.equal(JSON.parse(fs.readFileSync(lf, 'utf8')).nonce, 'other');
  fs.rmSync(lf);
  const old = Date.now() / 1000 - 3600;
  fs.writeFileSync(lf, '');
  fs.utimesSync(lf, old, old); // нечитаний і старий — знімається
  assert.equal(withFileLock(lf, () => 7, { timeoutMs: 100 }), 7);
  assert.equal(fs.existsSync(lf), false);
});

test('F-11: ідентифікатори J4 з великими лічильниками приймаються', () => {
  const root = tmpStaff();
  const f = (d) => validateMessage(d, { draft: true }).map((x) => x.field);
  assert.deepEqual(f(draft(root, { thread_id: 'TH-T-0006-1000', in_reply_to: 'M-T-0006-10000' })), []);
});

test('F-13: живий адаптер без стелі виходу або без max_output_tokens не допускається', () => {
  const root = tmpStaff();
  approval(root);
  const base = { taskId: 'T-0900', env: LIVE_ENV, approvalFile: path.join(root, 'approval.json'), now: T0 };
  const defaults = loadConfig().limits.defaults;
  assert.equal(checkLive({ ...base, adapter: { name: 'openai', requiredEnv: [] }, defaults }).code, 'adapter-output-unbounded');
  assert.equal(checkLive({ ...base, adapter: { name: 'openai', outputLimit: true, requiredEnv: [] }, defaults: { ...defaults, max_output_tokens: undefined } }).code, 'max-output-tokens-missing');
  assert.equal(checkLive({ ...base, adapter: { name: 'openai', outputLimit: true, requiredEnv: [] }, defaults }).ok, true);
});
