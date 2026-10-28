#!/usr/bin/env node
// Місія J4 AUTONOMY HARDENING (2026-10-27): відтворення підтверджених дефектів бар'єра на СИНТЕТИЧНИХ тимчасових копіях.
// Нічого не пише в репозиторій і не викликає адаптерів (dispatch_attempt = 0 — перевіряється наприкінці).
// Запуск: node reports/J4-HARDENING/tools/repro.mjs [--bridge <тека bridge/ (копія з PoC)>] [--json]
//   без --bridge — поточний bridge/ репозиторію (очікувані результати «старий код»);
//   з --bridge — ізольована копія з прикладеними правилами (очікувані результати «новий код»).
// Кожен сценарій повертає {id, defect, outcome} де outcome — результат бар'єра (ok / missing) або код CLI.
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

const { closeTask } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'close.mjs')));
const { acceptanceReady, evidenceFromEvents } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'acceptance.mjs')));
const { Store } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'store.mjs')));
const { Ledger } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'ledger.mjs')));
const { J4 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'router.mjs')));
const { loadConfig } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'policy.mjs')));
const { PROTOCOL, sha256 } = await import(pathToFileURL(path.join(BRIDGE, 'src', 'protocol.mjs')));

const T = 'T-0900';
const SHA_A = 'a'.repeat(40);
const CMD = "node --test 'bridge/test/*.test.mjs'";
const CLI = path.join(BRIDGE, 'bin', 'j4.mjs');
const ledgers = [];

function staff() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4h-'));
  fs.copyFileSync(CONTRACT, path.join(root, 'CONTRACT_v0_4.md'));
  fs.mkdirSync(path.join(root, 'tasks', T), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ seq: 1, event: 'task_accepted', task_id: T, by: 'J3' })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), [
    `id: ${T}`, 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}',
    'checks:', '  subject_kind: commit', `  verify: ${JSON.stringify([CMD])}`, '  review_kind: code', '',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'reports'));
  new Store(path.join(root, '.j4'));
  const led = new Ledger(path.join(root, 'ledger.jsonl'));
  led.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } });
  ledgers.push(path.join(root, 'ledger.jsonl'));
  return root;
}
const add = (root, e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);
const rec = (result, cmd = CMD) => `- {cmd: ${JSON.stringify(cmd)}, subject: ${SHA_A}, result: ${JSON.stringify(result)}}\n`;
const evidence = (root, text) => { fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), text); return 'reports/checks.yaml'; };
const review = (root, extra = {}) => add(root, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r', ...extra });
// scope: full — форма за варіантом B (T-0012); старий код поле ігнорує, тож результати «старого коду» від нього не залежать
const accept = (root, by, role, extra = {}) => add(root, { event: 'acceptance', by, role, subject: SHA_A, result: 'accepted', scope: 'full', ref: `a-${by}`, ...extra });
const src = (root) => ({ store: Store.open(path.join(root, '.j4')), ledgerEntries: new Ledger(path.join(root, 'ledger.jsonl')).readAll().entries });
const close = (root, ref) => { const r = closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, ...src(root) }); return r.ok ? 'done' : `refused:${r.code}${r.missing?.length ? `[${r.missing.join(',')}]` : ''}`; };
const barrier = (root) => { const ev = evidenceFromEvents(root, T); const r = acceptanceReady({ subject: SHA_A, checks: [{ subject: SHA_A, passed: true, evidence_ref: 'x' }], reviews: ev.reviews, acceptances: ev.acceptances }); return r.ready ? 'ready' : `not-ready[${r.missing.join(',')}]`; };

const results = [];
const run = (id, defect, fn) => { let outcome; try { outcome = fn(); } catch (e) { outcome = `exception:${e.code ?? e.message}`; } results.push({ id, defect, outcome }); };

// ---- F-T9-16: значення за замовчуванням у evidenceFromEvents ----
run('S16-1', 'F-T9-16', () => { const r = staff(); review(r, { review_status: undefined }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return barrier(r); });
run('S16-2', 'F-T9-16', () => { const r = staff(); review(r, { review_status: null }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return barrier(r); });
run('S16-3', 'F-T9-16', () => { const r = staff(); review(r, { review_status: 'partial' }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return barrier(r); });
run('S16-4', 'F-T9-16', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: undefined }); return barrier(r); });
run('S16-5', 'F-T9-16', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: null }); return barrier(r); });
run('S16-6', 'F-T9-16 (контроль)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return barrier(r); });
run('S16-7', 'F-T9-16 (контроль: accepted_with_restrictions, як T-0006 seq 12)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: 'accepted_with_restrictions' }); return barrier(r); });

// ---- SCOPE-1: приймання з межами ----
run('SC1-0', 'SCOPE-1 (acceptance без поля scope, як T-0005…T-0010)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: undefined }); return barrier(r); });
run('SC1-1', 'SCOPE-1', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { note: 'лише A/B; C не прийнято' }); return barrier(r); });
run('SC1-2', 'SCOPE-1', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: ['A', 'B'] }); return barrier(r); });
run('SC1-2b', 'SCOPE-1 (scope: limited + limits)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: 'limited', limits: ['C не прийнято'] }); return barrier(r); });
run('SC1-3', 'SCOPE-1 (варіант: scope повний)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: 'full' }); return barrier(r); });
run('SC1-4', 'SCOPE-1 (варіант: scope без відомої форми)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: 42 }); return barrier(r); });

// ---- F-T10-11 / R-11: варіантна команда й запис без cmd ----
run('R11-1', 'F-T10-11', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', `${CMD} --test-name-pattern x`))); });
run('R11-2', 'F-T10-11', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', `${CMD} `))); });
run('R11-3', 'F-T10-11', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + `- {subject: ${SHA_A}, result: "75/76 pass, 1 fail"}\n`)); });
run('R11-4', 'F-T10-11 (контроль: збій → успіх тієї ж cmd)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('75/76 pass, 1 fail') + rec('76/76 pass'))); });
run('R11-5', 'F-T10-11 (контроль: збій іншої команди)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + rec('0/1 pass', 'echo other'))); });
run('R11-6', 'F-T10-11 (успіх варіантною, потім збій базовою)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass', `${CMD} --x`) + rec('75/76 pass, 1 fail'))); });

// ---- R-10 / F-T10-10: блоковий скаляр із тегом чи якорем ----
run('R10-1', 'F-T10-10', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, `note: !!str |\n  ${rec('76/76 pass').trim()}\n`)); });
run('R10-2', 'F-T10-10', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, `note: &a |\n  ${rec('76/76 pass').trim()}\n`)); });
run('R10-3', 'F-T10-10', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, `note: !!str >-\n  ${rec('76/76 pass').trim()}\n`)); });
run('R10-4', 'F-T10-10 (контроль: звичайний блок)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, `note: |\n  ${rec('76/76 pass').trim()}\n`)); });
run('R12-1', 'F-T10-12 (порожній рядок усередині блоку)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, `note: |\n\n  ${rec('76/76 pass').trim()}\n`)); });

// ---- F-T9-18: хибна, але наявна й ціла пара J4_HOME/J4_LEDGER ----
function cli(root, args, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: root, J4_HOME: path.join(root, '.j4'), J4_LEDGER: path.join(root, 'ledger.jsonl'), J4_MONTHLY_BUDGET: path.join(root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS']) if (!(k in extra)) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { json = null; }
  return `exit ${r.status}${json ? ` ${json.ok ? (json.entry?.state ?? 'ok') : json.code}${json.missing?.length ? `[${json.missing.join(',')}]` : ''}` : ` ${r.stderr.trim().slice(0, 60)}`}`;
}
function withEscalation() {
  const r = staff();
  review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content');
  const ref = evidence(r, rec('76/76 pass'));
  const config = loadConfig(path.join(BRIDGE, 'config'));
  const j4 = new J4({ config, home: path.join(r, '.j4'), ledgerFile: path.join(r, 'ledger.jsonl'), staffRoot: r, adapters: {}, instructionsDir: path.join(BRIDGE, 'roles'), approvalFile: path.join(r, 'approval.json'), env: {} });
  const d = { protocol: PROTOCOL, task_id: T, task_version: 1, contract: { version: '0.4', sha256: sha256(fs.readFileSync(path.join(r, 'CONTRACT_v0_4.md'))) }, subject: { kind: 'commit', ref: SHA_A }, from: 'J3', to: 'J5', kind: 'request', intent: 'question', decision_level: 'C', data_class: 'synthetic', in_reply_to: null, body: { summary: 'Синтетичний запит рівня C', text: 'потребує рішення JE' } };
  const s = j4.submit(d, { origin: 'agent_cli' });
  if (s.status !== 'held') throw new Error(`очікувалось held, отримано ${JSON.stringify(s)}`);
  const alien = path.join(r, 'alien-home');
  fs.mkdirSync(path.join(alien, 'escalations'), { recursive: true });
  const alienLedger = path.join(r, 'alien-ledger.jsonl');
  new Ledger(alienLedger).append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } });
  ledgers.push(alienLedger);
  return { r, ref, alien, alienLedger };
}
run('S18-1', 'F-T9-18 (контроль: правильна пара)', () => { const { r, ref } = withEscalation(); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref]); });
run('S18-2', 'F-T9-18 (хибна наявна ціла пара)', () => { const { r, ref, alien, alienLedger } = withEscalation(); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], { J4_HOME: alien, J4_LEDGER: alienLedger }); });
run('S18-3', 'F-T9-18 (правильний J4_HOME, чужий журнал)', () => { const { r, ref, alienLedger } = withEscalation(); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], { J4_LEDGER: alienLedger }); });
run('S18-4', 'F-T9-18 (чужий J4_HOME, правильний журнал)', () => { const { r, ref, alien } = withEscalation(); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], { J4_HOME: alien }); });
run('S18-5', 'F-T9-18 (обрізаний журнал: лише seq 1, ескалація зникла)', () => { const { r, ref } = withEscalation(); const f = path.join(r, 'ledger.jsonl'); const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); fs.writeFileSync(f, `${lines[0]}\n`); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref]); });
run('S18-6', 'F-T9-18 (знімок сховища до ескалації: порожній J4_HOME тієї ж форми)', () => { const { r, ref, alien } = withEscalation(); const f = path.join(r, 'ledger.jsonl'); const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); fs.writeFileSync(f, `${lines[0]}\n`); return cli(r, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], { J4_HOME: alien }); });

// ---- лічильник викликів адаптера ----

// ---- R11-7/8/9: уточнення специфікації 04-spec-T-0012.md §4.4 (cmd: "", порожній verify, контроль варіантного успіху) ----
run('R11-7', 'F-T10-11 (успіх, далі збій із cmd: "")', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', ''))); });
run('R11-8', 'F-T10-11 (verify порожній: дві cmd, остання другої — збій)', () => { const r = staff(); fs.writeFileSync(path.join(r, 'tasks', T, 'order.yaml'), fs.readFileSync(path.join(r, 'tasks', T, 'order.yaml'), 'utf8').replace(/^\s*verify:.*$/m, '  verify: []')); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('76/76 pass') + rec('10/10 pass', 'other') + rec('9/10 pass, 1 fail', 'other'))); });
run('R11-9', 'F-T10-11 (контроль: збій базовою, далі успіх варіантною, що містить вимогу)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); return close(r, evidence(r, rec('75/76 pass, 1 fail') + rec('76/76 pass', `${CMD} --test-reporter spec`))); });

// лічильник — ПІСЛЯ останнього сценарію; dispatch > 0 — код виходу 1 (C3H-15)
const dispatch = ledgers.reduce((n, f) => n + (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('"dispatch_attempt"')).length : 0), 0);
if (dispatch > 0) process.exitCode = 1;
if (o.json) process.stdout.write(`${JSON.stringify({ bridge: BRIDGE, dispatch_attempt: dispatch, results }, null, 2)}\n`);
else {
  process.stdout.write(`bridge: ${BRIDGE}\n`);
  for (const x of results) process.stdout.write(`${x.id.padEnd(7)} ${x.defect.padEnd(62)} → ${x.outcome}\n`);
  process.stdout.write(`dispatch_attempt у всіх журналах: ${dispatch}\n`);
}
