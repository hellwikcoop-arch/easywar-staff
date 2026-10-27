#!/usr/bin/env node
// Місія J4 AUTONOMY HARDENING: сценарії ідентичності установки (T-0011) на СИНТЕТИЧНИХ тимчасових копіях.
// Запуск: node reports/J4-HARDENING/tools/repro-t0011.mjs --bridge <копія bridge/ з PoC T-0011>   (на поточному bridge/ — «старий код»)
// Нічого не пише в репозиторій; адаптери не викликаються (dispatch_attempt = 0 перевіряється наприкінці).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const { values: o } = parseArgs({ options: { bridge: { type: 'string' }, json: { type: 'boolean', default: false } } });
const BRIDGE = path.resolve(o.bridge ?? path.join(REPO, 'bridge'));
const CONTRACT = path.join(BRIDGE, '..', 'CONTRACT_v0_4.md');
if (!fs.existsSync(CONTRACT)) fs.copyFileSync(path.join(REPO, 'CONTRACT_v0_4.md'), CONTRACT);
const { Store } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'store.mjs')));
const { Ledger, verifyLedger } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'ledger.mjs')));
const { J4 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'router.mjs')));
const { loadConfig } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'policy.mjs')));
const { PROTOCOL, sha256 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'protocol.mjs')));

const T = 'T-0900';
const SHA_A = 'a'.repeat(40);
const CMD = "node --test 'bridge/test/*.test.mjs'";
const CLI = path.join(BRIDGE, 'bin', 'j4.mjs');
const ledgers = [];
const results = [];
const run = (id, title, fn) => { let outcome; try { outcome = fn(); } catch (e) { outcome = `exception:${e.code ?? e.message}`; } results.push({ id, title, outcome }); };

function staff({ marker = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4h11-'));
  fs.copyFileSync(CONTRACT, path.join(root, 'CONTRACT_v0_4.md'));
  fs.mkdirSync(path.join(root, 'tasks', T), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ seq: 1, event: 'task_accepted', task_id: T, by: 'J3' })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), [`id: ${T}`, 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', `  verify: ${JSON.stringify([CMD])}`, '  review_kind: code', ''].join('\n'));
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), `- {cmd: ${JSON.stringify(CMD)}, subject: ${SHA_A}, result: "76/76 pass"}\n`);
  const add = (e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);
  add({ event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r' });
  add({ event: 'acceptance', by: 'J3', role: 'technical', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'a' });
  add({ event: 'acceptance', by: 'J5', role: 'content', subject: SHA_A, result: 'accepted', scope: 'full', ref: 'b' });
  const home = path.join(root, '.j4');
  const ledger = path.join(root, 'ledger.jsonl');
  const config = loadConfig(path.join(BRIDGE, 'config'));
  const j4 = new J4({ config, home, ledgerFile: ledger, staffRoot: root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(root, 'approval.json'), env: {}, taskEvents: true });
  if (!marker) { fs.rmSync(path.join(home, 'installation.json'), { force: true }); }
  ledgers.push(ledger);
  const id = j4.store.installation?.()?.installation_id ?? null;
  return { root, home, ledger, j4, id, add };
}
function escalate(s) {
  const d = { protocol: PROTOCOL, task_id: T, task_version: 1, contract: { version: '0.4', sha256: sha256(fs.readFileSync(path.join(s.root, 'CONTRACT_v0_4.md'))) }, subject: { kind: 'commit', ref: SHA_A }, from: 'J3', to: 'J5', kind: 'request', intent: 'question', decision_level: 'C', data_class: 'synthetic', in_reply_to: null, body: { summary: 'Синтетичний запит рівня C', text: 'потребує рішення JE' } };
  const r = s.j4.submit(d, { origin: 'agent_cli' });
  if (r.status !== 'held') throw new Error(`очікувалось held: ${JSON.stringify(r)}`);
  return 'E-T-0900-001';
}
function alienPair(s) {
  const home = path.join(s.root, 'alien-home');
  new Store(home);
  const ledger = path.join(s.root, 'alien-ledger.jsonl');
  const config = loadConfig(path.join(BRIDGE, 'config'));
  new J4({ config, home, ledgerFile: ledger, staffRoot: s.root, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(s.root, 'approval.json'), env: {} });
  new Ledger(ledger).append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } });
  ledgers.push(ledger);
  return { home, ledger };
}
function cli(s, args, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: s.root, J4_HOME: s.home, J4_LEDGER: s.ledger, J4_MONTHLY_BUDGET: path.join(s.root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS', 'J4_INSTALLATION_ID']) if (!(k in extra)) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { json = null; }
  return `exit ${r.status}${json ? ` ${json.ok ? (json.entry?.state ?? (json.already ? 'already' : 'ok')) : json.code}${json.missing?.length ? `[${json.missing.join(',')}]` : ''}` : ` ${r.stderr.trim().slice(0, 80)}`}`;
}
const CLOSE = ['close', '--task', T, '--subject', SHA_A, '--checks-ref', 'reports/checks.yaml'];
const truncate = (file) => { const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); fs.writeFileSync(file, `${lines[0]}\n`); };

run('I1', 'контроль: правильна пара + закріплений id, відкрита ескалація', () => { const s = staff(); escalate(s); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); });
run('I2', 'контроль: правильна пара + закріплений id, ескалацій немає → done', () => { const s = staff(); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); });
run('I3', 'без закріпленого значення → відмова', () => { const s = staff(); return cli(s, CLOSE); });
run('I4', 'закріплене значення хибного формату', () => { const s = staff(); return cli(s, CLOSE, { J4_INSTALLATION_ID: 'not-an-id' }); });
run('I5', 'хибна наявна ціла пара (інша установка, свій marker і журнал)', () => { const s = staff(); escalate(s); const a = alienPair(s); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger }); });
run('I6', 'чужий J4_HOME без marker-а (лише тека escalations)', () => { const s = staff(); escalate(s); const home = path.join(s.root, 'bare'); fs.mkdirSync(path.join(home, 'escalations'), { recursive: true }); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: home }); });
run('I7', 'правильний J4_HOME, чужий журнал', () => { const s = staff(); escalate(s); const a = alienPair(s); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_LEDGER: a.ledger }); });
run('I8', 'чужий J4_HOME, правильний журнал', () => { const s = staff(); escalate(s); const a = alienPair(s); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home }); });
run('I9', 'закріплено чужий id (помилка в рішенні JE) для правильної пари', () => { const s = staff(); const a = alienPair(s); const aid = new Store(a.home).installation().installation_id; return cli(s, CLOSE, { J4_INSTALLATION_ID: aid }); });
run('I10', 'обрізаний журнал (лишився лише запис установки), ескалація в сховищі', () => { const s = staff(); escalate(s); truncate(s.ledger); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); });
run('I11', 'знімок установки до ескалації: правильний marker, обрізаний журнал, порожнє сховище (вікно до синхронізації)', () => {
  const s = staff(); escalate(s); truncate(s.ledger);
  for (const f of fs.readdirSync(path.join(s.home, 'escalations'))) fs.rmSync(path.join(s.home, 'escalations', f), { recursive: true, force: true });
  return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
});
run('I12', 'те саме, але ескалацію синхронізовано в events.jsonl (ref seq=N) до обрізання', () => {
  const s = staff(); escalate(s);
  const r = s.j4.syncTaskEvents(); if (r.written < 1) throw new Error('sync not written');
  truncate(s.ledger);
  for (const f of fs.readdirSync(path.join(s.home, 'escalations'))) fs.rmSync(path.join(s.home, 'escalations', f), { recursive: true, force: true });
  return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
});
run('I13', 'подія ADM у events.jsonl посилається на seq N, але хеш не збігається (підмінений журнал тієї ж установки)', () => {
  const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' });
  const ev = path.join(s.root, 'tasks', T, 'events.jsonl');
  fs.writeFileSync(ev, fs.readFileSync(ev, 'utf8').replace(/"ledger_hash":"[0-9a-f]{64}"/, `"ledger_hash":"${'f'.repeat(64)}"`));
  return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
});
run('I14', 'подія ADM з installation_id іншої установки', () => {
  const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' });
  const ev = path.join(s.root, 'tasks', T, 'events.jsonl');
  fs.writeFileSync(ev, fs.readFileSync(ev, 'utf8').replace(/"installation_id":"[0-9a-f]{32}"/, `"installation_id":"${'0'.repeat(32)}"`));
  return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id });
});
run('I15', 'контроль: ескалацію синхронізовано і вирішено JE → done', () => { const s = staff(); escalate(s); s.j4.syncTaskEvents(); s.j4.resolve('E-T-0900-001', { decision: 'reject' }, { origin: 'human_cli' }); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); });
run('I16', 'повтор після done на чужій парі → відмова, а не already', () => { const s = staff(); const first = cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); const a = alienPair(s); return `${first} | потім ${cli(s, CLOSE, { J4_INSTALLATION_ID: s.id, J4_HOME: a.home, J4_LEDGER: a.ledger })}`; });
run('I17', 'повтор після done на правильній парі → already', () => { const s = staff(); cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); return cli(s, CLOSE, { J4_INSTALLATION_ID: s.id }); });
run('I18', 'міграція: стара установка (без marker-а, журнал без прив\'язки) → close відмовляє; adopt → close працює; історія журналу збережена', () => {
  const s = staff({ marker: false });
  // старий журнал: прибрати запис installation, лишити історію з 3 записів (імітація T-0005…T-0010)
  const old = new Ledger(path.join(s.root, 'old.jsonl'));
  for (let n = 1; n <= 3; n += 1) old.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } });
  fs.copyFileSync(path.join(s.root, 'old.jsonl'), s.ledger);
  const before = fs.readFileSync(s.ledger, 'utf8');
  const r1 = cli(s, CLOSE, { J4_INSTALLATION_ID: '0'.repeat(32) });
  const ad = cli(s, ['adopt', '--human']);
  const id = new Store(s.home).installation().installation_id;
  const after = fs.readFileSync(s.ledger, 'utf8');
  const kept = after.startsWith(before) && verifyLedger(s.ledger).ok;
  const r2 = cli(s, CLOSE, { J4_INSTALLATION_ID: id });
  return `до adopt: ${r1} | adopt: ${ad} | історія збережена: ${kept} | після adopt: ${r2}`;
});
run('I19', 'adopt повторно — already; adopt журналу, прив\'язаного до іншої установки — відмова', () => {
  const s = staff(); const a = alienPair(s);
  return `${cli(s, ['adopt', '--human'])} | чужий журнал: ${cli(s, ['adopt', '--human'], { J4_LEDGER: a.ledger })}`;
});

const dispatch = ledgers.reduce((n, f) => n + (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('"dispatch_attempt"')).length : 0), 0);
if (o.json) process.stdout.write(`${JSON.stringify({ bridge: BRIDGE, dispatch_attempt: dispatch, results }, null, 2)}\n`);
else {
  process.stdout.write(`bridge: ${BRIDGE}\n`);
  for (const x of results) process.stdout.write(`${x.id.padEnd(4)} ${x.title}\n     → ${x.outcome}\n`);
  process.stdout.write(`dispatch_attempt у всіх журналах: ${dispatch}\n`);
}
