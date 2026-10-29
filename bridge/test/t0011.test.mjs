// T-0011: ідентичність установки J4 — marker сховища, прив'язка журналу, закріплені значення JE, звірка подій ADM і ескалацій (F-T9-18).
// Лише синтетичні дані; адаптери не викликаються (dispatch_attempt == 0): повідомлення рівня C лише утримуються (held), `close`/`adopt`/`run --once` — через CLI.
// Сценарії I1–I19 відтворюють експерименти пакета J4-HARDENING (reports/J4-HARDENING/05-experiments.md), N1–N31 — вимоги специфікації 03-spec-T-0011.md
// і рішення T-0011 (tasks/T-0011/decisions-register.md). Кожну перевірку випробувано мутацією (reports/T-0011/mutants.yaml).
// Межі довіри (G4): тест I11 фіксує ЗАЛИШОК (знімок журналу до синхронізації); `by` і особа JE цим механізмом не автентифікуються —
// фікстура `staff()` сама записує приймання J3/J5 вручну, і це так само проходить бар'єр (F-9, F-3 лишаються відкритими).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BRIDGE_DIR, loadConfig } from '../src/policy.mjs';
import { Store } from '../src/store.mjs';
import { Ledger, verifyLedger } from '../src/ledger.mjs';
import { J4 } from '../src/router.mjs';
import { closeTask } from '../src/close.mjs';
import { sha256 } from '../src/protocol.mjs';
import { tmpStaff, draft, SHA_A } from './helpers.mjs';

const T = 'T-0900';
const CMD = "node --test 'bridge/test/*.test.mjs'";
const CLI = path.join(BRIDGE_DIR, 'bin', 'j4.mjs');
const ZERO = '0'.repeat(32);
const AT = '2026-10-27T00:00:00.000Z';
const CLOSE = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', 'reports/checks.yaml'];

// Повний набір доказів для бар'єра на SHA_A (order без key_decision): єдина перешкода для done — ідентичність пари й ескалації.
// router: true — справжній J4 (marker + seq 1 у журналі); false — «стара» установка: лише тека сховища (з marker-ом або без), журнал порожній.
function staff({ router = true, marker = true } = {}) {
  const root = tmpStaff();
  const add = (e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), ['id: T-0900', 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', `  verify: ${JSON.stringify([CMD])}`, '  review_kind: code', ''].join('\n'));
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), `- {cmd: ${JSON.stringify(CMD)}, subject: ${SHA_A}, result: "76/76 pass"}\n`);
  add({ event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r' });
  add({ event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'a' });
  add({ event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'b' });
  const home = path.join(root, '.j4');
  const ledger = path.join(root, 'ledger.jsonl');
  const s = { root, home, ledger, add, j4: null, id: null };
  if (router) s.j4 = newRouter(s);
  else if (marker) new Store(home);
  else fs.mkdirSync(path.join(home, 'escalations'), { recursive: true });
  s.id = marker ? Store.open(home).installation().installation_id : null;
  return s;
}

function newRouter(s, { home = s.home, ledger = s.ledger } = {}) {
  return new J4({ config: loadConfig(), home, ledgerFile: ledger, staffRoot: s.root, adapters: {}, instructionsDir: path.join(BRIDGE_DIR, 'roles'), approvalFile: path.join(s.root, 'approval.json'), env: {}, taskEvents: true });
}

const oldLedger = (s, n = 3) => { const l = new Ledger(s.ledger); for (let i = 1; i <= n; i += 1) l.append({ event: 'test_entry', at: AT, detail: { n: i } }); return l; };
const entriesOf = (file) => new Ledger(file).readAll().entries;
const read = (file) => fs.readFileSync(file, 'utf8');
const eventsFile = (s) => path.join(s.root, 'tasks', T, 'events.jsonl');
const edit = (file, fn) => fs.writeFileSync(file, fn(read(file)));

function escalate(s, summary = 'Синтетичний запит рівня C') {
  const r = s.j4.submit(draft(s.root, { decision_level: 'C', body: { summary, text: 'потребує рішення JE' } }), { origin: 'agent_cli' });
  assert.equal(r.status, 'held');
  return fs.readdirSync(path.join(s.home, 'escalations')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort().at(-1);
}
const resolve = (s, id) => s.j4.resolve(id, { decision: 'reject' }, { origin: 'human_cli' });
function syncedResolved(s) {
  const id = escalate(s);
  assert.ok(s.j4.syncTaskEvents().written >= 1);
  resolve(s, id);
  return id;
}

// Чужа установка: власне сховище з marker-ом, журнал прив'язаний до нього й має ще один запис.
function alienPair(s) {
  const home = path.join(s.root, 'alien-home');
  const ledger = path.join(s.root, 'alien-ledger.jsonl');
  newRouter(s, { home, ledger });
  new Ledger(ledger).append({ event: 'test_entry', at: AT, detail: { n: 1 } });
  return { home, ledger, id: Store.open(home).installation().installation_id };
}

function cli(s, args, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: s.root, J4_HOME: s.home, J4_LEDGER: s.ledger, J4_MONTHLY_BUDGET: path.join(s.root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS', 'J4_INSTALLATION_ID', 'J4_LEDGER_MIN_SEQ', 'J4_LEDGER_FIRST_HASH']) if (!(k in extra)) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { json = null; }
  return { status: r.status, json, stderr: r.stderr };
}

const detail = (r) => JSON.stringify(r.json ?? r.stderr.slice(0, 300));
function expectRefusal(r, code, ...missing) {
  assert.equal(r.status, 3, detail(r));
  assert.equal(r.json?.code, code, detail(r));
  for (const m of missing) assert.ok(r.json.missing?.some((x) => (m instanceof RegExp ? m.test(x) : x === m || x.startsWith(m))), `очікувано ${m} у ${JSON.stringify(r.json.missing)}`);
}
function expectDone(r) {
  assert.equal(r.status, 0, detail(r));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.entry?.state, 'done');
}
const doneCount = (s) => read(eventsFile(s)).split('\n').filter((l) => l.includes('"state":"done"')).length;
const unchanged = (file, before, msg = 'файл не мав змінитися') => assert.equal(read(file), before, msg);
const truncate = (file, keep = 1) => fs.writeFileSync(file, `${read(file).split('\n').filter(Boolean).slice(0, keep).join('\n')}\n`);
const clearStoreEscalations = (s) => { for (const f of fs.readdirSync(path.join(s.home, 'escalations'))) fs.rmSync(path.join(s.home, 'escalations', f), { recursive: true, force: true }); };

// ---------- Контролі: правильна пара не змінює поведінку ----------

test('T-0011 I1: правильна пара + закріплений id, відкрита ескалація → open-escalation (поведінка без змін)', () => {
  const s = staff(); const id = escalate(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'open-escalation', `escalation:${id}`);
  assert.equal(doneCount(s), 0);
});

test('T-0011 I2: правильна пара + закріплений id, без ескалацій → done', () => {
  const s = staff();
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
  assert.equal(doneCount(s), 1);
});

test('T-0011 I2b: закріплене значення через прапорець --installation (а не змінну середовища) діє так само', () => {
  const s = staff();
  expectDone(cli(s, [...CLOSE, '--installation', s.id]));
});

// ---------- M1, M2: marker і прив'язка журналу ----------

test('T-0011 N1/N4: marker створюється один раз; новий журнал починається записом installation (seq 1) з тим самим id; ланцюг цілий', () => {
  const s = staff();
  const a = new Store(s.home).installation();
  const b = new Store(s.home).installation();
  assert.match(a.installation_id, /^[0-9a-f]{32}$/);
  assert.equal(a.installation_id, b.installation_id, 'повторне відкриття сховища marker не змінює');
  assert.equal(a.format, 'j4.installation/1');
  assert.ok(Number.isFinite(Date.parse(a.created_at)));
  const e = entriesOf(s.ledger);
  assert.equal(e[0].event, 'installation');
  assert.equal(e[0].seq, 1);
  assert.equal(e[0].detail.installation_id, a.installation_id);
  assert.equal(verifyLedger(s.ledger).ok, true);
  newRouter(s);
  assert.equal(entriesOf(s.ledger).filter((x) => x.event === 'installation').length, 1, 'другий роутер seq 1 не дописує');
});

test('T-0011 N1b: Store.open (лише читання) marker не створює і сліду в теці не лишає', () => {
  const s = staff({ router: false, marker: false });
  const before = fs.readdirSync(s.home).sort();
  const st = Store.open(s.home);
  assert.equal(st.installation(), null);
  assert.deepEqual(fs.readdirSync(s.home).sort(), before);
  assert.equal(fs.existsSync(path.join(s.home, 'installation.json')), false);
});

test('T-0011 N2/N3: marker не JSON, масив, id 31 символ, великі літери, невідомий format, тека замість файла → store-marker-missing (відмова, не виняток)', () => {
  const bad = ['не json', '[]', 'null', JSON.stringify({ installation_id: 'a'.repeat(31), format: 'j4.installation/1' }), JSON.stringify({ installation_id: 'A'.repeat(32), format: 'j4.installation/1' }), JSON.stringify({ installation_id: 'a'.repeat(32), format: 'j4.installation/2' }), JSON.stringify({ installation_id: 'a'.repeat(32) })];
  for (const content of bad) {
    const s = staff(); escalate(s);
    fs.writeFileSync(path.join(s.home, 'installation.json'), content);
    expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'store-marker-missing');
  }
  const s = staff(); escalate(s);
  fs.rmSync(path.join(s.home, 'installation.json'));
  fs.mkdirSync(path.join(s.home, 'installation.json'));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'store-marker-missing');
});

test('T-0011 N2b: зіпсований marker не переписується мовчки, а `run --once` на ньому відмовляє', () => {
  const s = staff();
  fs.writeFileSync(path.join(s.home, 'installation.json'), 'не json');
  const before = read(s.ledger);
  const r = cli(s, ['run', '--once', '--mode', 'stub']);
  assert.equal(r.status, 1, detail(r));
  assert.equal(read(path.join(s.home, 'installation.json')), 'не json', 'marker не переписано');
  unchanged(s.ledger, before);
});

test('T-0011 N5: журнал, чий seq 1 — не installation (стара установка без прив\'язки) → ledger-not-bound', () => {
  const s = staff();
  const old = new Ledger(path.join(s.root, 'old.jsonl'));
  old.append({ event: 'test_entry', at: AT, detail: { n: 1 } });
  fs.copyFileSync(path.join(s.root, 'old.jsonl'), s.ledger);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound');
});

test('T-0011 N25: суперечливі прив\'язки (seq 1 installation і пізніший installation_adopted іншої установки) → ledger-not-bound', () => {
  const s = staff();
  const first = entriesOf(s.ledger)[0];
  new Ledger(s.ledger).append({ event: 'installation_adopted', at: AT, detail: { installation_id: ZERO, first_hash: first.hash, adopted_at_seq: 1 } });
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound');
});

// ---------- M4: закріплене значення обов'язкове ----------

test('T-0011 I3: без закріпленого значення → installation-unknown[pinned], нічого не записано', () => {
  const s = staff();
  const before = read(eventsFile(s));
  expectRefusal(cli(s, CLOSE), 'installation-unknown', 'pinned');
  unchanged(eventsFile(s), before);
});

test('T-0011 I3b: бібліотечний closeTask без installationId → installation-unknown[pinned] (значення за замовчуванням немає)', () => {
  const s = staff();
  const r = closeTask({ staffRoot: s.root, taskId: T, subject: SHA_A, checksRef: 'reports/checks.yaml', store: Store.open(s.home), ledgerEntries: entriesOf(s.ledger) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'installation-unknown');
  assert.ok(r.missing.includes('pinned'));
});

test('T-0011 I4/N10: закріплене значення хибного формату (not-an-id, великі літери, 31 символ, 33 символи) → installation-unknown[pinned]', () => {
  const s = staff();
  for (const v of ['not-an-id', 'ABCDEF'.repeat(6).slice(0, 32), s.id.slice(1), `${s.id}0`, '']) {
    expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: v }), 'installation-unknown', 'pinned');
  }
  assert.equal(doneCount(s), 0);
});

test('T-0011 I9: закріплено чужий id для правильної пари → відмова (помилка в рішенні JE не проходить тихо)', () => {
  const s = staff(); const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: a.id }), 'installation-mismatch', 'store-marker-mismatch', 'ledger-binding-mismatch');
});

// ---------- M6: чуже сховище / журнал ----------

test('T-0011 I5: хибна наявна ціла пара (інша установка) при відкритій ескалації → installation-mismatch, а не done', () => {
  const s = staff(); escalate(s); const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger }), 'installation-mismatch', 'store-marker-mismatch', 'ledger-binding-mismatch');
  assert.equal(doneCount(s), 0);
});

test('T-0011 I6: чужий J4_HOME без marker-а (лише тека escalations) → store-marker-missing; close marker у чужій теці не створює', () => {
  const s = staff(); escalate(s);
  const home = path.join(s.root, 'bare'); fs.mkdirSync(path.join(home, 'escalations'), { recursive: true });
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: home }), 'installation-mismatch', 'store-marker-missing');
  assert.equal(fs.existsSync(path.join(home, 'installation.json')), false);
});

test('T-0011 I7: правильний J4_HOME, чужий журнал → ledger-binding-mismatch', () => {
  const s = staff(); escalate(s); const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER: a.ledger }), 'installation-mismatch', 'ledger-binding-mismatch');
});

test('T-0011 I8: чужий J4_HOME, правильний журнал → store-marker-mismatch', () => {
  const s = staff(); escalate(s); const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home }), 'installation-mismatch', 'store-marker-mismatch');
});

test('T-0011 N11: run --once із журналом, прив\'язаним до іншої установки → код 1, журнал не змінено', () => {
  const s = staff(); const a = alienPair(s); const before = read(a.ledger);
  const r = cli(s, ['run', '--once', '--mode', 'stub'], { J4_LEDGER: a.ledger });
  assert.equal(r.status, 1, detail(r));
  unchanged(a.ledger, before);
});

test('T-0011 N11b: run --once після втрати marker-а (журнал прив\'язаний, сховище нове) → код 1, журнал не змінено', () => {
  const s = staff(); fs.rmSync(path.join(s.home, 'installation.json'));
  const before = read(s.ledger);
  const r = cli(s, ['run', '--once', '--mode', 'stub']);
  assert.equal(r.status, 1, detail(r));
  unchanged(s.ledger, before);
});

test('T-0011 N11c: run --once на правильній парі → код 0 (контроль), прив\'язка й ланцюг цілі', () => {
  const s = staff();
  const r = cli(s, ['run', '--once', '--mode', 'stub']);
  assert.equal(r.status, 0, detail(r));
  assert.equal(verifyLedger(s.ledger).ok, true);
  assert.equal(entriesOf(s.ledger)[0].event, 'installation');
});

test('T-0011 N27 (неповна пара): marker є, журнал непорожній без прив\'язки → run --once і close відмовляють; після adopt обидва працюють', () => {
  const s = staff({ router: false }); oldLedger(s, 3); const before = read(s.ledger);
  const r1 = cli(s, ['run', '--once', '--mode', 'stub']);
  assert.equal(r1.status, 1, detail(r1));
  unchanged(s.ledger, before, 'run на неповній парі журнал не змінює');
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound');
  const ad = cli(s, ['adopt', '--human']);
  assert.equal(ad.status, 0, detail(ad));
  assert.equal(cli(s, ['run', '--once', '--mode', 'stub']).status, 0);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
});

// ---------- M5, M7: обрізання, підміна, звірка подій і ескалацій ----------

test('T-0011 I10/N14: журнал обрізано до запису установки, ескалація лишилась у сховищі → installation-mismatch[store-ledger-escalation-unknown] (не done)', () => {
  const s = staff(); const id = escalate(s); truncate(s.ledger);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'store-ledger-escalation-unknown', `escalation:${id}`);
});

test('T-0011 N14b: open-ескалація у сховищі, якої журнал не знає, і без обрізання → installation-mismatch[store-ledger-escalation-unknown]', () => {
  const s = staff();
  fs.writeFileSync(path.join(s.home, 'escalations', 'E-T-0900-777.json'), JSON.stringify({ escalation_id: 'E-T-0900-777', task_id: T, status: 'open' }));
  const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
  assert.equal(r.status, 3);
  assert.equal(r.json.code, 'installation-mismatch');
  assert.ok(r.json.missing.includes('store-ledger-escalation-unknown'), JSON.stringify(r.json));
});

test('T-0011 I11 (ЗАЛИШОК, характеризація): знімок журналу до несинхронізованої ескалації на чистому сховищі → done; закривається лише --ledger-min-seq (N8) і синхронізацією подій', () => {
  const s = staff(); escalate(s); truncate(s.ledger); clearStoreEscalations(s);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
});

test('T-0011 N8: --ledger-min-seq більше за довжину обрізаного журналу → installation-mismatch[ledger-truncated-below-min-seq]', () => {
  const s = staff(); escalate(s);
  const len = entriesOf(s.ledger).length;
  truncate(s.ledger); clearStoreEscalations(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_MIN_SEQ: String(len) }), 'installation-mismatch', 'ledger-truncated-below-min-seq');
  expectRefusal(cli(s, [...CLOSE, '--installation', s.id, '--ledger-min-seq', String(len)]), 'installation-mismatch', 'ledger-truncated-below-min-seq');
});

test('T-0011 I12: ескалацію синхронізовано в events.jsonl, журнал обрізано, сховище порожнє → ledger-events-mismatch', () => {
  const s = staff(); escalate(s);
  assert.ok(s.j4.syncTaskEvents().written >= 1);
  truncate(s.ledger); clearStoreEscalations(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-');
});

test('T-0011 I13: ledger_hash події не збігається із записом N (підмінений журнал тієї ж установки) → ledger-events-mismatch', () => {
  const s = staff(); syncedResolved(s);
  edit(eventsFile(s), (t) => t.replace(/"ledger_hash":"[0-9a-f]{64}"/, `"ledger_hash":"${'f'.repeat(64)}"`));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-');
});

test('T-0011 I14 (G2): подію синхронізовано з installation_id і ledger_hash; installation_id іншої установки → ledger-events-mismatch[installation-mismatch]', () => {
  const s = staff(); syncedResolved(s);
  const txt = read(eventsFile(s));
  assert.match(txt, new RegExp(`"installation_id":"${s.id}"`), 'G2: поле має писатися роутером');
  assert.match(txt, /"ledger_hash":"[0-9a-f]{64}"/);
  edit(eventsFile(s), (t) => t.replace(`"installation_id":"${s.id}"`, `"installation_id":"${ZERO}"`));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', /^event-seq-\d+:installation-mismatch$/);
});

test('T-0011 N28 (G2): подія після прив\'язки без installation_id → ledger-events-mismatch[installation-id-missing]', () => {
  const s = staff(); syncedResolved(s);
  edit(eventsFile(s), (t) => t.replace(`,"installation_id":"${s.id}"`, ''));
  assert.doesNotMatch(read(eventsFile(s)), /installation_id/);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', /^event-seq-\d+:installation-id-missing$/);
});

test('T-0011 N30 (G2): подія з ref на журнал J4 без ledger_hash → ledger-events-mismatch', () => {
  const s = staff(); syncedResolved(s);
  edit(eventsFile(s), (t) => t.replace(/,"ledger_hash":"[0-9a-f]{64}"/, ''));
  assert.doesNotMatch(read(eventsFile(s)), /ledger_hash/);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-');
});

test('T-0011 N13: подія escalation посилається на запис N, що не escalation_raised з тим самим id → ledger-events-mismatch[kind-mismatch]', () => {
  const s = staff(); const id = syncedResolved(s);
  edit(eventsFile(s), (t) => t.replace(`"escalation_id":"${id}"`, '"escalation_id":"E-T-0900-999"'));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', /^event-seq-\d+:ledger-seq-\d+-kind-mismatch$/);
});

test('T-0011 N13b: подія report_filed посилається на запис журналу іншого виду (escalation_raised) → ledger-events-mismatch[kind-mismatch]', async () => {
  const s = staff();
  assert.equal(s.j4.submit(draft(s.root, { kind: 'report', intent: 'status', body: { summary: 'синтетичне донесення' } }), { origin: 'agent_cli' }).ok, true);
  const id = escalate(s);
  assert.deepEqual((await s.j4.process()).events.failed, 0);
  resolve(s, id);
  const evs = read(eventsFile(s)).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const rep = evs.find((e) => e.event === 'report_filed');
  const esc = evs.find((e) => e.event === 'escalation');
  assert.equal(rep.installation_id, s.id, 'report_filed також несе installation_id (G2)');
  assert.equal(esc.installation_id, s.id);
  edit(eventsFile(s), (t) => t.replace(`"ref":"${rep.ref}"`, `"ref":"${esc.ref}"`).replace(`"ledger_hash":"${rep.ledger_hash}"`, `"ledger_hash":"${esc.ledger_hash}"`));
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', /^event-seq-\d+:ledger-seq-\d+-kind-mismatch$/);
});

test('T-0011 N15: подія з ref на запис, якого в журналі немає (seq 99 при коротшому журналі) → ledger-events-mismatch', () => {
  const s = staff();
  s.add({ seq: 5, event: 'escalation', by: 'ADM', escalation_id: 'E-T-0900-001', ref: 'j4-ledger#seq=99', ledger_file: 'ledger.jsonl', ledger_hash: 'f'.repeat(64), installation_id: s.id, j4_key: 'j4:x' });
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'ledger-events-mismatch', 'event-seq-5:ledger-seq-99-mismatch');
});

test('T-0011 I15: ескалацію синхронізовано і вирішено, три джерела узгоджені → done (контроль)', () => {
  const s = staff(); syncedResolved(s);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
});

test('T-0011 N12: дві ескалації синхронізовано й вирішено; report_filed і escalation несуть installation_id → done', async () => {
  const s = staff();
  s.j4.submit(draft(s.root, { kind: 'report', intent: 'status', body: { summary: 'синтетичне донесення' } }), { origin: 'agent_cli' });
  const a = escalate(s, 'перший запит рівня C'); const b = escalate(s, 'другий запит рівня C');
  assert.notEqual(a, b);
  assert.equal((await s.j4.process()).events.failed, 0);
  resolve(s, a); resolve(s, b);
  const evs = read(eventsFile(s)).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.by === 'ADM');
  assert.equal(evs.length, 3);
  for (const e of evs) { assert.equal(e.installation_id, s.id); assert.match(e.ledger_hash, /^[0-9a-f]{64}$/); }
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
});

// ---------- M3: ledger_first_hash і ledger_min_seq ----------

test('T-0011 N6: правильний ledger_first_hash і ledger_min_seq (рівний довжині) → без змін (done)', () => {
  const s = staff(); const e = entriesOf(s.ledger);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_FIRST_HASH: e[0].hash, J4_LEDGER_MIN_SEQ: String(e.length) }));
});

test('T-0011 N7: ledger_first_hash іншого журналу → installation-mismatch[ledger-first-hash-mismatch]', () => {
  const s = staff();
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_FIRST_HASH: 'f'.repeat(64) }), 'installation-mismatch', 'ledger-first-hash-mismatch');
  const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_FIRST_HASH: entriesOf(a.ledger)[0].hash }), 'installation-mismatch', 'ledger-first-hash-mismatch');
});

test('T-0011 N9: ledger_min_seq не додатне ціле і ledger_first_hash хибного формату → installation-unknown (fail-closed на вході)', () => {
  const s = staff();
  for (const v of ['abc', '-1', '1.5', '0', ' 1', '1e2']) expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_MIN_SEQ: v }), 'installation-unknown', 'ledger-min-seq');
  for (const v of ['xyz', 'F'.repeat(64), 'f'.repeat(63)]) expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER_FIRST_HASH: v }), 'installation-unknown', 'ledger-first-hash');
  assert.equal(doneCount(s), 0);
});

// ---------- M8, M10: crash/restart і міграція без втрати історії ----------

test('T-0011 N17: marker є, журнал порожній (збій між marker-ом і seq 1) → наступні роутери дописують seq 1 рівно один раз', () => {
  const s = staff({ router: false }); fs.writeFileSync(s.ledger, '');
  newRouter(s); newRouter(s);
  const e = entriesOf(s.ledger);
  assert.equal(e.length, 1);
  assert.equal(e[0].event, 'installation');
  assert.equal(e[0].detail.installation_id, s.id);
});

test('T-0011 N24: збій посеред запису seq 1 (у журналі лише обірваний перший рядок) → роутер відкидає його, фіксує розмір і sha256, дописує installation seq 1', () => {
  const s = staff({ router: false }); const partial = '{"event":"installation","at":"2026';
  fs.writeFileSync(s.ledger, partial);
  newRouter(s);
  const e = entriesOf(s.ledger);
  assert.equal(e.length, 1);
  assert.equal(e[0].event, 'installation');
  assert.equal(e[0].seq, 1);
  assert.equal(e[0].detail.installation_id, s.id);
  assert.equal(e[0].detail.dropped_bytes, Buffer.byteLength(partial));
  assert.equal(e[0].detail.dropped_sha256, sha256(partial));
  assert.equal(verifyLedger(s.ledger).ok, true);
});

test('T-0011 N26: обірваний рядок після seq 1 → роутер стартує, repairIfNeeded дописує ledger_repaired, прив\'язка (seq 1) ціла, close з закріпленим id працює', () => {
  const s = staff();
  fs.appendFileSync(s.ledger, '{"event":"x","at":');
  const r = newRouter(s);
  assert.equal(r.ledger.repairIfNeeded(AT).event, 'ledger_repaired');
  const e = entriesOf(s.ledger);
  assert.equal(e[0].event, 'installation');
  assert.equal(e.at(-1).event, 'ledger_repaired');
  assert.equal(verifyLedger(s.ledger).ok, true);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
});

test('T-0011 I18: стара установка (без marker-а, журнал без прив\'язки) → відмова; adopt --human → close працює; історія збережена без змін', () => {
  const s = staff({ router: false, marker: false }); oldLedger(s, 3);
  const before = read(s.ledger);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: ZERO }), 'installation-mismatch', 'store-marker-missing', 'ledger-not-bound');
  const ad = cli(s, ['adopt', '--human']);
  assert.equal(ad.status, 0, detail(ad));
  assert.equal(ad.json.ok, true);
  const id = Store.open(s.home).installation().installation_id;
  assert.equal(ad.json.installation_id, id);
  assert.ok(read(s.ledger).startsWith(before), 'стару історію не переписано');
  assert.equal(verifyLedger(s.ledger).ok, true);
  const e = entriesOf(s.ledger);
  assert.equal(e.at(-1).event, 'installation_adopted');
  assert.equal(e.at(-1).detail.first_hash, e[0].hash);
  assert.equal(e.at(-1).detail.adopted_at_seq, 3);
  assert.equal(ad.json.first_hash, e[0].hash, 'adopt друкує значення, які закріплює JE');
  assert.equal(ad.json.ledger_head_seq, e.length);
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: id, J4_LEDGER_FIRST_HASH: e[0].hash, J4_LEDGER_MIN_SEQ: String(e.length) }));
});

test('T-0011 I18b: adopt на порожньому журналі пише installation seq 1 (не installation_adopted)', () => {
  const s = staff({ router: false, marker: false }); fs.writeFileSync(s.ledger, '');
  const ad = cli(s, ['adopt', '--human']);
  assert.equal(ad.status, 0, detail(ad));
  const e = entriesOf(s.ledger);
  assert.equal(e.length, 1);
  assert.equal(e[0].event, 'installation');
  assert.equal(e[0].detail.installation_id, ad.json.installation_id);
});

test('T-0011 I19/N21: adopt повторно → already і журнал не росте; adopt журналу іншої установки → ledger-bound-to-other-installation (код 3)', () => {
  const s = staff(); const len = () => entriesOf(s.ledger).length; const n0 = len();
  const r1 = cli(s, ['adopt', '--human']);
  assert.equal(r1.status, 0, detail(r1));
  assert.equal(r1.json.already, true);
  assert.equal(len(), n0);
  const a = alienPair(s); const before = read(a.ledger);
  const r2 = cli(s, ['adopt', '--human'], { J4_LEDGER: a.ledger });
  assert.equal(r2.status, 3, detail(r2));
  assert.equal(r2.json.code, 'ledger-bound-to-other-installation');
  unchanged(a.ledger, before);
});

test('T-0011 N21b: два adopt поспіль на старій установці → перший приєднує, другий already; другий installation_adopted не з\'являється', () => {
  const s = staff({ router: false, marker: false }); oldLedger(s, 2);
  assert.equal(cli(s, ['adopt', '--human']).status, 0);
  const n = entriesOf(s.ledger).length;
  const r = cli(s, ['adopt', '--human']);
  assert.equal(r.status, 0, detail(r));
  assert.equal(r.json.already, true);
  assert.equal(entriesOf(s.ledger).length, n);
});

test('T-0011 N16: adopt на журналі з обірваним останнім рядком → відмова, журнал не змінено', () => {
  const s = staff({ router: false }); oldLedger(s, 2); fs.appendFileSync(s.ledger, '{"event":"x"');
  const before = read(s.ledger);
  const r = cli(s, ['adopt', '--human']);
  assert.equal(r.status, 1, detail(r));
  assert.match(r.stderr, /ledger-partial-line/);
  unchanged(s.ledger, before);
});

test('T-0011 N20: adopt без --human → помилка використання, нічого не записано (ні marker-а, ні запису в журнал)', () => {
  const s = staff({ router: false, marker: false }); oldLedger(s, 2); const before = read(s.ledger);
  const r = cli(s, ['adopt']);
  assert.equal(r.status, 1, detail(r));
  assert.match(r.stderr, /--human/);
  unchanged(s.ledger, before);
  assert.equal(fs.existsSync(path.join(s.home, 'installation.json')), false);
});

test('T-0011 N20b: adopt під стоп-краном (J4_HALT=1) → code halted, код 4, нічого не записано', () => {
  const s = staff({ router: false, marker: false }); oldLedger(s, 2); const before = read(s.ledger);
  const r = cli(s, ['adopt', '--human'], { J4_HALT: '1' });
  assert.equal(r.status, 4, detail(r));
  assert.equal(r.json.code, 'halted');
  unchanged(s.ledger, before);
  assert.equal(fs.existsSync(path.join(s.home, 'installation.json')), false);
});

test('T-0011 N22: запис installation_adopted, перенесений в інший журнал (first_hash не збігається) → ledger-not-bound', () => {
  const s = staff({ router: false, marker: false }); oldLedger(s, 2);
  assert.equal(cli(s, ['adopt', '--human']).status, 0);
  const adopted = entriesOf(s.ledger).at(-1);
  const other = new Ledger(path.join(s.root, 'other.jsonl'));
  other.append({ event: 'test_entry', at: AT, detail: { n: 9 } });
  other.append({ event: adopted.event, at: adopted.at, detail: adopted.detail });
  const id = Store.open(s.home).installation().installation_id;
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: id, J4_LEDGER: path.join(s.root, 'other.jsonl') }), 'installation-mismatch', 'ledger-not-bound');
});

test('T-0011 N29 (G2): після adopt події, чиї записи журналу передують прив\'язці, чинні без installation_id; з хибним installation_id — відмова', () => {
  const s = staff({ router: false, marker: false });
  const led = new Ledger(s.ledger);
  const old = led.append({ event: 'message_accepted', at: AT, task_id: T, kind: 'report', from: 'J3', msg_id: 'M-T-0900-0001', subject: { kind: 'commit', ref: SHA_A } });
  assert.equal(cli(s, ['adopt', '--human']).status, 0);
  const id = Store.open(s.home).installation().installation_id;
  s.add({ seq: 5, event: 'report_filed', by: 'ADM', report_author: 'J3', msg_id: 'M-T-0900-0001', ref: `j4-ledger#seq=${old.seq}`, ledger_file: 'ledger.jsonl', ledger_hash: old.hash, j4_key: 'j4:legacy' });
  expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: id }));
  const s2 = staff({ router: false, marker: false });
  const old2 = new Ledger(s2.ledger).append({ event: 'message_accepted', at: AT, task_id: T, kind: 'report', from: 'J3', msg_id: 'M-T-0900-0001', subject: { kind: 'commit', ref: SHA_A } });
  assert.equal(cli(s2, ['adopt', '--human']).status, 0);
  const id2 = Store.open(s2.home).installation().installation_id;
  s2.add({ seq: 5, event: 'report_filed', by: 'ADM', report_author: 'J3', msg_id: 'M-T-0900-0001', ref: `j4-ledger#seq=${old2.seq}`, ledger_file: 'ledger.jsonl', ledger_hash: old2.hash, installation_id: ZERO, j4_key: 'j4:legacy' });
  expectRefusal(cli(s2, CLOSE, { J4_INSTALLATION_ID: id2 }), 'ledger-events-mismatch', /^event-seq-5:installation-mismatch$/);
});

// ---------- M11: повтор після done ----------

test('T-0011 I17: повтор після done на правильній парі → already, без запису', () => {
  const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
  const ev = read(eventsFile(s));
  const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
  assert.equal(r.status, 0, detail(r));
  assert.equal(r.json.already, true);
  unchanged(eventsFile(s), ev);
});

test('T-0011 I16: повтор після done на чужій парі → installation-mismatch, а не already', () => {
  const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
  const a = alienPair(s);
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger }), 'installation-mismatch');
  expectRefusal(cli(s, CLOSE), 'installation-unknown', 'pinned');
});

test('T-0011 N23 (M11): done є на subject + застаріла подія ADM з хибним ledger_hash → already, а не ledger-events-mismatch', () => {
  const s = staff(); expectDone(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }));
  s.add({ seq: 9, event: 'report_filed', by: 'ADM', ref: 'j4-ledger#seq=1', ledger_file: 'ledger.jsonl', ledger_hash: 'f'.repeat(64), installation_id: s.id, j4_key: 'j4:stale' });
  const r = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
  assert.equal(r.status, 0, detail(r));
  assert.equal(r.json.already, true);
});

test('T-0011 N31: events.jsonl, що не читається (обірваний рядок), лишається першою причиною відмови (events-corrupt) навіть без закріпленого значення', () => {
  const s = staff(); fs.appendFileSync(eventsFile(s), '{"seq":');
  expectRefusal(cli(s, CLOSE), 'events-corrupt');
});

// ---------- M9: режим без журналу ----------

test('T-0011 N18/N19: порожній список журналу в бібліотеці й порожній файл журналу в CLI → installation-mismatch[ledger-not-bound]', () => {
  const s = staff();
  const r = closeTask({ staffRoot: s.root, taskId: T, subject: SHA_A, checksRef: 'reports/checks.yaml', store: Store.open(s.home), ledgerEntries: [], installationId: s.id });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'installation-mismatch');
  assert.ok(r.missing.includes('ledger-not-bound'));
  fs.writeFileSync(s.ledger, '');
  expectRefusal(cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }), 'installation-mismatch', 'ledger-not-bound');
});
