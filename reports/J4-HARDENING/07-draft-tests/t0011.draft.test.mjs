// ЧЕРНЕТКА майбутнього bridge/test/t0011.test.mjs (місія J4 AUTONOMY HARDENING). Не є частиною bridge/, CI не запускає.
// Tests-first: на поточному коді 21/30 червоні (F-T9-18); на копії з poc/t0011-poc.patch 26/30 зелені, червоні — вимоги 03-spec, яких PoC ще
// не має: N2/N3 (marker не-JSON має давати store-marker-missing, а не виняток), N6/N7/N9 (first_hash, min_seq), N8, N11 (run --once),
// N13 (kind-mismatch), N14 (ескалація сховища, невідома журналу), N23 (порядок M11: already до звірки подій). Виміряно 2026-10-27 (05-experiments.md §5.8). Запуск лише на копіях:
//   J4H_BRIDGE=<тека bridge/ копії> node --test reports/J4-HARDENING/07-draft-tests/t0011.draft.test.mjs
// Адаптери не викликаються (тільки submit рівня C → held і close/adopt через CLI). Усе синтетичне, у тимчасових теках.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const BRIDGE = path.resolve(process.env.J4H_BRIDGE ?? path.join(REPO, 'bridge'));
const CONTRACT = fs.existsSync(path.join(BRIDGE, '..', 'CONTRACT_v0_4.md')) ? path.join(BRIDGE, '..', 'CONTRACT_v0_4.md') : path.join(REPO, 'CONTRACT_v0_4.md');
const { Store } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'store.mjs')));
const { Ledger, verifyLedger } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'ledger.mjs')));
const { J4 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'router.mjs')));
const { closeTask } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'close.mjs')));
const { loadConfig } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'policy.mjs')));
const { PROTOCOL, sha256 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'protocol.mjs')));

const T = 'T-0900';
const SHA_A = 'a'.repeat(40);
const CMD = "node --test 'bridge/test/*.test.mjs'";
const CLI = path.join(BRIDGE, 'bin', 'j4.mjs');
const ZERO = '0'.repeat(32);

function staff({ marker = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4h-t11-'));
  fs.copyFileSync(CONTRACT, path.join(root, 'CONTRACT_v0_4.md'));
  fs.mkdirSync(path.join(root, 'tasks', T), { recursive: true });
  const add = (e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ seq: 1, event: 'task_accepted', task_id: T, by: 'J3' })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), ['id: T-0900', 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', `  verify: ${JSON.stringify([CMD])}`, '  review_kind: code', ''].join('\n'));
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), `- {cmd: ${JSON.stringify(CMD)}, subject: ${SHA_A}, result: "76/76 pass"}\n`);
  add({ event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r' });
  add({ event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'a' });
  add({ event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'b' });
  const home = path.join(root, '.j4');
  const ledger = path.join(root, 'ledger.jsonl');
  const config = loadConfig(path.join(BRIDGE, 'config'));
  const j4 = new J4({ config, home, ledgerFile: ledger, staffRoot: root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(root, 'approval.json'), env: {}, taskEvents: true });
  if (!marker) fs.rmSync(path.join(home, 'installation.json'), { force: true });
  const id = j4.store.installation?.()?.installation_id ?? null;
  return { root, home, ledger, j4, id, add };
}
function escalate(s) {
  const d = { protocol: PROTOCOL, task_id: T, task_version: 1, contract: { version: '0.4', sha256: sha256(fs.readFileSync(path.join(s.root, 'CONTRACT_v0_4.md'))) }, subject: { kind: 'commit', ref: SHA_A }, from: 'J3', to: 'J5', kind: 'request', intent: 'question', decision_level: 'C', data_class: 'synthetic', in_reply_to: null, body: { summary: 'Синтетичний запит рівня C', text: 'потребує рішення JE' } };
  const r = s.j4.submit(d, { origin: 'agent_cli' });
  assert.equal(r.status, 'held');
  return 'E-T-0900-001';
}
function alienPair(s) {
  const home = path.join(s.root, 'alien-home');
  new Store(home);
  const ledger = path.join(s.root, 'alien-ledger.jsonl');
  new J4({ config: loadConfig(path.join(BRIDGE, 'config')), home, ledgerFile: ledger, staffRoot: s.root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(s.root, 'approval.json'), env: {} });
  new Ledger(ledger).append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } });
  return { home, ledger, id: new Store(home).installation?.()?.installation_id ?? null };
}
function cli(s, args, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: s.root, J4_HOME: s.home, J4_LEDGER: s.ledger, J4_MONTHLY_BUDGET: path.join(s.root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS', 'J4_INSTALLATION_ID', 'J4_LEDGER_MIN_SEQ', 'J4_LEDGER_FIRST_HASH']) if (!(k in extra)) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { json = null; }
  return { status: r.status, json, stderr: r.stderr };
}
const CLOSE = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', 'reports/checks.yaml'];
const truncate = (file) => { const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); fs.writeFileSync(file, `${lines[0]}\n`); };
const clearStoreEsc = (s) => { for (const f of fs.readdirSync(path.join(s.home, 'escalations'))) fs.rmSync(path.join(s.home, 'escalations', f), { recursive: true, force: true }); };
const expectRefusal = (r, code, ...missing) => { assert.equal(r.status, 3, JSON.stringify(r.json ?? r.stderr)); assert.equal(r.json?.code, code, JSON.stringify(r.json)); for (const m of missing) assert.ok(r.json.missing?.some((x) => x === m || x.startsWith(m)), `очікувано ${m} у ${JSON.stringify(r.json.missing)}`); };
const expectDone = (r) => { assert.equal(r.status, 0, JSON.stringify(r.json ?? r.stderr)); assert.equal(r.json.ok, true); assert.equal(r.json.entry?.state, 'done'); };
const ledgerUnchanged = (file, before) => assert.equal(fs.readFileSync(file, 'utf8'), before, 'журнал не мав змінитися');

// ---- контролі ----
test('T-0011 I1: правильна пара + закріплений id, відкрита ескалація → open-escalation (без змін)', () => { const s = staff(); escalate(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'open-escalation', 'escalation:E-T-0900-001'); });
test('T-0011 I2: правильна пара + закріплений id, без ескалацій → done', () => { const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); });
test('T-0011 N1/N4: marker створюється один раз; новий журнал починається записом installation seq 1 з тим самим id', () => {
  const s = staff(); const a = new Store(s.home).installation(); const b = new Store(s.home).installation(); assert.equal(a.installation_id, b.installation_id); assert.match(a.installation_id, /^[0-9a-f]{32}$/);
  const e = new Ledger(s.ledger).readAll().entries; assert.equal(e[0].event, 'installation'); assert.equal(e[0].seq, 1); assert.equal(e[0].detail.installation_id, a.installation_id); assert.equal(verifyLedger(s.ledger).ok, true);
});
// ---- M4: закріплене значення обов'язкове ----
test('T-0011 I3: без закріпленого значення → installation-unknown, нічого не записано', () => { const s = staff(); const before = fs.readFileSync(path.join(s.root, 'tasks', T, 'events.jsonl'), 'utf8'); expectRefusal(cli(s, CLOSE), 'installation-unknown', 'pinned'); assert.equal(fs.readFileSync(path.join(s.root, 'tasks', T, 'events.jsonl'), 'utf8'), before); });
test('T-0011 I4/N10: закріплене значення хибного формату (not-an-id, великі літери) → installation-unknown', () => { const s = staff(); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: 'not-an-id' }), 'installation-unknown', 'pinned'); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id.toUpperCase() }), 'installation-unknown', 'pinned'); });
// ---- M6: чуже сховище / журнал ----
test('T-0011 I5: хибна наявна ціла пара (інша установка) при відкритій ескалації → installation-mismatch, а не done', () => { const s = staff(); escalate(s); const a = alienPair(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger }), 'installation-mismatch', 'store-marker-mismatch', 'ledger-binding-mismatch'); });
test('T-0011 I6: чужий J4_HOME без marker-а (лише тека escalations) → store-marker-missing', () => { const s = staff(); escalate(s); const home = path.join(s.root, 'bare'); fs.mkdirSync(path.join(home, 'escalations'), { recursive: true }); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: home }), 'installation-mismatch', 'store-marker-missing'); assert.equal(fs.existsSync(path.join(home, 'installation.json')), false, 'close не створює marker у чужій теці'); });
test('T-0011 I7: правильний J4_HOME, чужий журнал → ledger-binding-mismatch', () => { const s = staff(); escalate(s); const a = alienPair(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER: a.ledger }), 'installation-mismatch', 'ledger-binding-mismatch'); });
test('T-0011 I8: чужий J4_HOME, правильний журнал → store-marker-mismatch', () => { const s = staff(); escalate(s); const a = alienPair(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home }), 'installation-mismatch', 'store-marker-mismatch'); });
test('T-0011 I9: закріплено чужий id для правильної пари → відмова (помилка рішення JE не проходить тихо)', () => { const s = staff(); const a = alienPair(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: a.id }), 'installation-mismatch', 'store-marker-mismatch', 'ledger-binding-mismatch'); });
test('T-0011 N2/N3: marker не JSON, масив, id 31 символ, невідомий format, тека замість файла → store-marker-missing', () => {
  for (const content of ['не json', '[]', JSON.stringify({ installation_id: 'a'.repeat(31), format: 'j4.installation/1' }), JSON.stringify({ installation_id: 'a'.repeat(32), format: 'j4.installation/2' })]) {
    const s = staff(); escalate(s); fs.writeFileSync(path.join(s.home, 'installation.json'), content); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'store-marker-missing');
  }
  const s = staff(); escalate(s); fs.rmSync(path.join(s.home, 'installation.json')); fs.mkdirSync(path.join(s.home, 'installation.json')); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'store-marker-missing');
});
test('T-0011 N5: журнал, чий seq 1 — не installation (стара установка) → ledger-not-bound', () => { const s = staff(); const old = new Ledger(path.join(s.root, 'old.jsonl')); old.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } }); fs.copyFileSync(path.join(s.root, 'old.jsonl'), s.ledger); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound'); });
// ---- M5/M7: обрізання, підміна, звірка подій ----
test('T-0011 I10: журнал обрізано до запису установки, ескалація в сховищі → open-escalation', () => { const s = staff(); escalate(s); truncate(s.ledger); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'open-escalation'); });
test('T-0011 I11 (ЗАЛИШОК, характеризація): знімок до несинхронізованої ескалації → done; закривається N8', () => { const s = staff(); escalate(s); truncate(s.ledger); clearStoreEsc(s); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); });
test('T-0011 N8: ledger_min_seq більший за довжину обрізаного журналу → installation-mismatch[ledger-truncated-below-min-seq]', () => { const s = staff(); escalate(s); const len = new Ledger(s.ledger).readAll().entries.length; truncate(s.ledger); clearStoreEsc(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_MIN_SEQ: String(len) }), 'installation-mismatch', 'ledger-truncated-below-min-seq'); });
test('T-0011 I12: ескалацію синхронізовано в events.jsonl, журнал обрізано, сховище порожнє → ledger-events-mismatch', () => { const s = staff(); escalate(s); assert.ok(s.j4.syncTaskEvents().written >= 1); truncate(s.ledger); clearStoreEsc(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-'); });
test('T-0011 I13: ledger_hash події не збігається із записом N (підмінений журнал тієї ж установки) → ledger-events-mismatch', () => {
  const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' });
  const ev = path.join(s.root, 'tasks', T, 'events.jsonl'); fs.writeFileSync(ev, fs.readFileSync(ev, 'utf8').replace(/"ledger_hash":"[0-9a-f]{64}"/, `"ledger_hash":"${'f'.repeat(64)}"`));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-');
});
test('T-0011 I14 (лише за G2): installation_id події іншої установки → ledger-events-mismatch', () => {
  const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' });
  const ev = path.join(s.root, 'tasks', T, 'events.jsonl'); const txt = fs.readFileSync(ev, 'utf8'); assert.match(txt, /"installation_id":"[0-9a-f]{32}"/, 'G2: поле має писатися');
  fs.writeFileSync(ev, txt.replace(/"installation_id":"[0-9a-f]{32}"/, `"installation_id":"${ZERO}"`));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-');
});
test('T-0011 N13: подія escalation посилається на seq N, що не є escalation_raised з тим самим id → kind-mismatch', () => {
  const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' });
  // підмінити escalation_id у події (хеш запису лишається правильним)
  const ev = path.join(s.root, 'tasks', T, 'events.jsonl'); fs.writeFileSync(ev, fs.readFileSync(ev, 'utf8').replace('"escalation_id":"E-T-0900-001"', '"escalation_id":"E-T-0900-999"'));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'kind-mismatch'); // C3H-5: саме kind-mismatch, не open-escalation
});
test('T-0011 N14: ескалація open у сховищі, невідома журналу → installation-mismatch[store-ledger-escalation-unknown]', () => {
  const s = staff(); fs.writeFileSync(path.join(s.home, 'escalations', 'E-T-0900-777.json'), JSON.stringify({ escalation_id: 'E-T-0900-777', task_id: T, status: 'open' }));
  const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); assert.equal(r.status, 3); assert.ok(r.json?.code === 'installation-mismatch' && r.json.missing.includes('store-ledger-escalation-unknown'), JSON.stringify(r.json));
});
test('T-0011 N15: подія з ref на seq, якого в журналі немає (N > довжини) → ledger-events-mismatch', () => { const s = staff(); s.add({ seq: 5, event: 'escalation', by: 'ADM', escalation_id: 'E-T-0900-001', ref: 'j4-ledger#seq=99', ledger_file: 'ledger.jsonl', ledger_hash: 'f'.repeat(64), j4_key: 'j4:x' }); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-5:ledger-seq-99-mismatch'); });
test('T-0011 I15: ескалацію синхронізовано і вирішено → done (контроль)', () => { const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' }); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); });
// ---- M3: first_hash і min_seq ----
test('T-0011 N6/N7: правильний ledger_first_hash → без змін; хеш іншого журналу → installation-mismatch[ledger-first-hash-mismatch]', () => { const s = staff(); const first = new Ledger(s.ledger).readAll().entries[0].hash; expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_FIRST_HASH: first })); const s2 = staff(); expectRefusal(cli(s2, CLOSE, { J4_INSTALLATION_ID: s2.id, J4_LEDGER_FIRST_HASH: 'f'.repeat(64) }), 'installation-mismatch', 'ledger-first-hash-mismatch'); });
test('T-0011 N9: ledger_min_seq не ціле або від\'ємне → installation-unknown[ledger-min-seq] (fail-closed на вході)', () => { for (const v of ['abc', '-1', '1.5']) { const s = staff(); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_MIN_SEQ: v }), 'installation-unknown', 'ledger-min-seq'); } });
test('T-0011 N12: три джерела узгоджені, дві ескалації синхронізовані й вирішені → done', () => { const s = staff(); escalate(s); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' }); const r = s.j4.submit({ protocol: PROTOCOL, task_id: T, task_version: 1, contract: { version: '0.4', sha256: sha256(fs.readFileSync(path.join(s.root, 'CONTRACT_v0_4.md'))) }, subject: { kind: 'commit', ref: SHA_A }, from: 'J3', to: 'J5', kind: 'request', intent: 'question', decision_level: 'C', data_class: 'synthetic', in_reply_to: null, body: { summary: 'Другий запит рівня C', text: 'потребує рішення JE' } }, { origin: 'agent_cli' }); assert.equal(r.status, 'held'); s.j4.syncTaskEvents(); const ids = fs.readdirSync(path.join(s.home, 'escalations')).map((f) => f.replace(/\.json$/, '')); for (const id of ids) { const e = JSON.parse(fs.readFileSync(path.join(s.home, 'escalations', `${id}.json`), 'utf8')); if (e.status === 'open') s.j4.resolve(e.escalation_id, { decision: 'reject' }, { origin: 'human_cli' }); } expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); });
test('T-0011 N17: marker є, журнал порожній (збій між marker-ом і seq 1) → наступний роутер дописує seq 1 рівно один раз', () => { const s = staff(); fs.writeFileSync(s.ledger, ''); new J4({ config: loadConfig(path.join(BRIDGE, 'config')), home: s.home, ledgerFile: s.ledger, staffRoot: s.root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(s.root, 'approval.json'), env: {} }); new J4({ config: loadConfig(path.join(BRIDGE, 'config')), home: s.home, ledgerFile: s.ledger, staffRoot: s.root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(s.root, 'approval.json'), env: {} }); const e = new Ledger(s.ledger).readAll().entries; assert.equal(e.length, 1); assert.equal(e[0].event, 'installation'); assert.equal(e[0].detail.installation_id, s.id); });
test('T-0011 N22: запис installation_adopted, перенесений у інший журнал (first_hash не збігається) → ledger-not-bound', () => { const s = staff({ marker: false }); const old = new Ledger(path.join(s.root, 'old.jsonl')); for (let n = 1; n <= 2; n += 1) old.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } }); fs.copyFileSync(path.join(s.root, 'old.jsonl'), s.ledger); const ad = cli(s, ['adopt', '--human']); assert.equal(ad.status, 0); const adopted = new Ledger(s.ledger).readAll().entries.at(-1); const other = new Ledger(path.join(s.root, 'other.jsonl')); other.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 9 } }); other.append({ event: adopted.event, at: adopted.at, detail: adopted.detail }); const id = new Store(s.home).installation().installation_id; expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: id, J4_LEDGER: path.join(s.root, 'other.jsonl') }), 'installation-mismatch', 'ledger-not-bound'); });
// ---- M11: повтор після done ----
test('T-0011 N23 (C3H-3): done є на subject + застаріла подія ADM з хибним ledger_hash → already, а не ledger-events-mismatch', () => { const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); s.add({ seq: 9, event: 'report_filed', by: 'ADM', ref: 'j4-ledger#seq=1', ledger_file: 'ledger.jsonl', ledger_hash: 'f'.repeat(64), j4_key: 'j4:stale' }); const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); assert.equal(r.status, 0, JSON.stringify(r.json)); assert.equal(r.json.already, true); });
test('T-0011 I16: повтор після done на чужій парі → installation-mismatch, а не already', () => { const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); const a = alienPair(s); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger }), 'installation-mismatch'); });
test('T-0011 I17: повтор після done на правильній парі → already, без запису', () => { const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id })); const ev = fs.readFileSync(path.join(s.root, 'tasks', T, 'events.jsonl'), 'utf8'); const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); assert.equal(r.status, 0); assert.equal(r.json.already, true); assert.equal(fs.readFileSync(path.join(s.root, 'tasks', T, 'events.jsonl'), 'utf8'), ev); });
// ---- M9: режим без журналу ----
test('T-0011 N18/N19: порожній список журналу в бібліотеці й порожній файл журналу в CLI → installation-mismatch[ledger-not-bound]', () => {
  const s = staff(); const r = closeTask({ staffRoot: s.root, taskId: T, subject: SHA_A, checksRef: 'reports/checks.yaml', store: Store.open(s.home), ledgerEntries: [], installationId: s.id }); assert.equal(r.ok, false); assert.equal(r.code, 'installation-mismatch'); assert.ok(r.missing.includes('ledger-not-bound'));
  fs.writeFileSync(s.ledger, ''); expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound');
});
// ---- M10: міграція ----
test('T-0011 I18: стара установка (без marker-а, журнал без прив\'язки) → відмова; adopt --human → close працює; історія збережена', () => {
  const s = staff({ marker: false }); const old = new Ledger(path.join(s.root, 'old.jsonl')); for (let n = 1; n <= 3; n += 1) old.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } }); fs.copyFileSync(path.join(s.root, 'old.jsonl'), s.ledger);
  const before = fs.readFileSync(s.ledger, 'utf8');
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: ZERO }), 'installation-mismatch', 'store-marker-missing', 'ledger-not-bound');
  const ad = cli(s, ['adopt', '--human']); assert.equal(ad.status, 0, JSON.stringify(ad.json ?? ad.stderr)); assert.equal(ad.json.ok, true);
  const id = new Store(s.home).installation().installation_id; assert.equal(ad.json.installation_id, id);
  const after = fs.readFileSync(s.ledger, 'utf8'); assert.ok(after.startsWith(before), 'стара історія збережена без змін'); assert.equal(verifyLedger(s.ledger).ok, true);
  const last = new Ledger(s.ledger).readAll().entries.at(-1); assert.equal(last.event, 'installation_adopted'); assert.equal(last.detail.first_hash, new Ledger(s.ledger).readAll().entries[0].hash);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: id }));
});
test('T-0011 I19/N21: adopt повторно → already і журнал не росте; adopt журналу іншої установки → ledger-bound-to-other-installation', () => {
  const s = staff(); const len = () => new Ledger(s.ledger).readAll().entries.length; const n0 = len();
  const r1 = cli(s, ['adopt', '--human']); assert.equal(r1.status, 0); assert.equal(r1.json.already, true); assert.equal(len(), n0);
  const a = alienPair(s); const r2 = cli(s, ['adopt', '--human'], { J4_LEDGER: a.ledger }); assert.equal(r2.status, 3); assert.equal(r2.json.code, 'ledger-bound-to-other-installation');
});
test('T-0011 N16: adopt на журналі з обірваним останнім рядком → відмова, файл не змінено', () => { const s = staff({ marker: false }); fs.appendFileSync(s.ledger, '{"event":"x"'); const before = fs.readFileSync(s.ledger, 'utf8'); const r = cli(s, ['adopt', '--human']); assert.notEqual(r.status, 0); ledgerUnchanged(s.ledger, before); });
test('T-0011 N20: adopt без --human → помилка використання, нічого не записано', () => { const s = staff({ marker: false }); const before = fs.readFileSync(s.ledger, 'utf8'); const r = cli(s, ['adopt']); assert.notEqual(r.status, 0); ledgerUnchanged(s.ledger, before); assert.equal(fs.existsSync(path.join(s.home, 'installation.json')), false); });
// ---- M6 для run --once ----
test('T-0011 N11: run --once із журналом, прив\'язаним до іншої установки → код 1, журнал не змінено', () => { const s = staff(); const a = alienPair(s); const before = fs.readFileSync(a.ledger, 'utf8'); const r = cli(s, ['run', '--once', '--mode', 'stub'], { J4_LEDGER: a.ledger }); assert.equal(r.status, 1, JSON.stringify(r.json ?? r.stderr.slice(0, 200))); ledgerUnchanged(a.ledger, before); });
