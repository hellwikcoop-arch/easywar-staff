#!/usr/bin/env node
// Мутаційна перевірка T-0011 (spec §3.7 п. 2; Р-Т11-4). Кожен мутант — точкова правка копії `bridge/` у тимчасовому каталозі;
// репозиторій не змінюється. Для кожного мутанта запускаються лише файли без диспетчеризації (t0010, t0011, t0012 і тести C з t0009),
// у ізольованому TMPDIR зі сканером dispatch_attempt: будь-який виклик адаптера — збій процедури. Результат — YAML-рядки на stdout.
// Використання: node tasks/T-0011/tools/mutate.mjs [id…]   (без аргументів — усі мутанти й контрольний прогін без правок)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const L = (...lines) => lines.join('\n');

export const MUTANTS = [
  { id: 'M01', what: 'перевірка marker-а сховища вилучена', file: 'bridge/src/close.mjs', patches: [{
    from: L("  if (!marker) missing.push('store-marker-missing');", "  else if (marker.installation_id !== installationId) missing.push('store-marker-mismatch');", ''),
    to: '' }] },
  { id: 'M02', what: 'прив\'язка журналу до іншої установки приймається', file: 'bridge/src/close.mjs', patches: [{
    from: "\n  else if (binding.installation_id !== installationId) missing.push('ledger-binding-mismatch');", to: '' }] },
  { id: 'M03', what: 'неприв\'язаний журнал приймається', file: 'bridge/src/close.mjs', patches: [{
    from: "  if (!binding) missing.push('ledger-not-bound');", to: "  if (!binding) { /* мутант */ }" }] },
  { id: 'M04', what: 'marker порівнюється за префіксом (8 символів)', file: 'bridge/src/close.mjs', patches: [{
    from: "else if (marker.installation_id !== installationId) missing.push('store-marker-mismatch');", to: "else if (marker.installation_id.slice(0, 8) !== installationId.slice(0, 8)) missing.push('store-marker-mismatch');" }] },
  { id: 'M05', what: 'подія ADM без ledger_hash приймається', file: 'bridge/src/close.mjs', patches: [{
    from: "if (!rec || typeof e.ledger_hash !== 'string' || rec.hash !== e.ledger_hash) {", to: "if (!rec || (typeof e.ledger_hash === 'string' && rec.hash !== e.ledger_hash)) {" }] },
  { id: 'M06', what: 'Store.open (читання) створює теки й marker', file: 'bridge/src/store.mjs', patches: [{
    from: "return new Store(home, { create: false });", to: "return new Store(home);" }] },
  { id: 'M07', what: 'ledgerBinding не звіряє first_hash запису installation_adopted з першим записом', file: 'bridge/src/ledger.mjs', patches: [{
    from: "const own = adopted.filter((e) => e.detail.first_hash === first.hash);", to: "const own = adopted;" }] },
  { id: 'M08', what: 'adopt записує first_hash не першого запису', file: 'bridge/src/ledger.mjs', patches: [{
    from: "first_hash: entries[0].hash, adopted_at_seq", to: "first_hash: entries[entries.length - 1].hash, adopted_at_seq" }] },
  { id: 'M09', what: 'ідентичність пари перевіряється після already / done-exists-other-subject', file: 'bridge/src/close.mjs', patches: [{
    from: L(
      "  const unknown = pinnedProblems({ installationId, ledgerFirstHash, ledgerMinSeq });",
      "  if (unknown.length) return refuse('installation-unknown', unknown);",
      "  const ident = checkInstallation({ store, ledgerEntries, installationId, ledgerFirstHash, ledgerMinSeq });",
      "  if (!ident.ok) return refuse('installation-mismatch', ident.missing);",
      "  const done = entries.filter((e) => e.event === 'state_changed' && e.state === 'done');",
      "  if (done.some((e) => e.subject === subject)) return { ok: true, already: true, entry: done.find((e) => e.subject === subject) };",
      "  if (done.length) return refuse('done-exists-other-subject');"),
    to: L(
      "  const done = entries.filter((e) => e.event === 'state_changed' && e.state === 'done');",
      "  if (done.some((e) => e.subject === subject)) return { ok: true, already: true, entry: done.find((e) => e.subject === subject) };",
      "  if (done.length) return refuse('done-exists-other-subject');",
      "  const unknown = pinnedProblems({ installationId, ledgerFirstHash, ledgerMinSeq });",
      "  if (unknown.length) return refuse('installation-unknown', unknown);",
      "  const ident = checkInstallation({ store, ledgerEntries, installationId, ledgerFirstHash, ledgerMinSeq });",
      "  if (!ident.ok) return refuse('installation-mismatch', ident.missing);") }] },
  { id: 'M10', what: 'run --once / роутер не перевіряє пару сховище—журнал', file: 'bridge/src/router.mjs', patches: [{
    from: "    this.assertPairOfOneInstallation();\n", to: '' }] },
  { id: 'M11', what: 'ліміт ledger_min_seq зсунуто на одиницю', file: 'bridge/src/close.mjs', patches: [{
    from: "ledgerEntries.length < Number(ledgerMinSeq)", to: "ledgerEntries.length < Number(ledgerMinSeq) - 1" }] },
  { id: 'M12', what: 'перевірка закріпленого першого хеша журналу вилучена', file: 'bridge/src/close.mjs', patches: [{
    from: "  if (ledgerFirstHash && ledgerEntries.length && ledgerEntries[0].hash !== ledgerFirstHash) missing.push('ledger-first-hash-mismatch');\n", to: '' }] },
  { id: 'M13', what: 'вид запису журналу для події ADM не перевіряється', file: 'bridge/src/close.mjs', patches: [{
    from: "    if (!(EXPECTED_RECORD[e.event]?.(e, rec) ?? false)) problems.push(`${at}:ledger-seq-${n}-kind-mismatch`);\n", to: '' }] },
  { id: 'M14', what: 'нова подія ADM без installation_id приймається', file: 'bridge/src/close.mjs', patches: [{
    from: "      if (n > binding.seq) problems.push(`${at}:installation-id-missing`);", to: "      if (false) problems.push(`${at}:installation-id-missing`);" }] },
  { id: 'M15', what: 'installation_id події ADM не звіряється із закріпленим', file: 'bridge/src/close.mjs', patches: [{
    from: "} else if (e.installation_id !== installationId) {", to: "} else if (false) {" }] },
  { id: 'M16', what: 'ескалація лише в сховищі ігнорується', file: 'bridge/src/close.mjs', patches: [{
    from: "  if (esc.storeOnly.length) return refuse('installation-mismatch', ['store-ledger-escalation-unknown', ...esc.storeOnly.map((x) => `escalation:${x}`)]);\n", to: '' }] },
  { id: 'M17', what: 'формат закріпленого installation_id не перевіряється', file: 'bridge/src/close.mjs', patches: [{
    from: "if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId)) missing.push('pinned');", to: "if (typeof installationId !== 'string' || !installationId) missing.push('pinned');" }] },
  { id: 'M18', what: 'adopt працює на журналі з обірваним рядком', file: 'bridge/src/ledger.mjs', patches: [{
    from: "      if (partial !== null) {\n        const e = new Error('ledger-partial-line');", to: "      if (false) {\n        const e = new Error('ledger-partial-line');" }] },
  { id: 'M19', what: 'нові події ADM пишуться без installation_id', file: 'bridge/src/router.mjs', patches: [{
    from: "      if (this.installationId) ev.installation_id = this.installationId;", to: "      // мутант: installation_id не додається" }] },
  { id: 'M20', what: 'наявний marker перезаписується', file: 'bridge/src/store.mjs', patches: [
    { from: "    if (fs.existsSync(file)) return;\n", to: '' },
    { from: "fs.linkSync(tmp, file);", to: "fs.renameSync(tmp, file);" }] },
  { id: 'M21', what: 'відкинутий обірваний перший рядок не фіксується (sha256)', file: 'bridge/src/ledger.mjs', patches: [{
    from: "        detail.dropped_sha256 = sha256(state.partial);\n", to: '' }] },
  { id: 'M22', what: 'закріплене значення бере змінна середовища раніше за прапорець', file: 'bridge/bin/j4.mjs', patches: [{
    from: "installationId: o.installation ?? process.env.J4_INSTALLATION_ID,", to: "installationId: process.env.J4_INSTALLATION_ID ?? o.installation," }] },
  { id: 'M23', what: 'adopt працює без --human', file: 'bridge/bin/j4.mjs', patches: [{
    from: "      if (!o.human) throw new Error('adopt лише за рішенням JE: потрібен --human');\n", to: '' }] },
  { id: 'M24', what: 'відсутнє закріплене значення підставляється з marker-а сховища', file: 'bridge/bin/j4.mjs', patches: [{
    from: "installationId: o.installation ?? process.env.J4_INSTALLATION_ID,", to: "installationId: o.installation ?? process.env.J4_INSTALLATION_ID ?? Store.open(home).installation()?.installation_id," }] },
  { id: 'M25', what: 'друга, суперечлива прив\'язка журналу не скасовує прив\'язку', file: 'bridge/src/ledger.mjs', patches: [{
    from: "return adopted.some((e) => e.detail.installation_id !== id) ? null : { installation_id: id, seq: first.seq };", to: "return { installation_id: id, seq: first.seq };" }] },
];

const RUNS = [
  { label: 'файли', args: ['--test', 'bridge/test/t0010.test.mjs', 'bridge/test/t0011.test.mjs', 'bridge/test/t0012.test.mjs'] },
  { label: 't0009-C', args: ['--test', '--test-name-pattern', 'T-0009 C', 'bridge/test/t0009.test.mjs'] },
];

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-mut-'));
  fs.cpSync(path.join(REPO, 'bridge'), path.join(dir, 'bridge'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'CONTRACT_v0_4.md'), path.join(dir, 'CONTRACT_v0_4.md'));
  for (const d of ['tasks', 'reports']) if (fs.existsSync(path.join(REPO, d))) fs.cpSync(path.join(REPO, d), path.join(dir, d), { recursive: true });
  return dir;
}

function runAll(dir) {
  const failed = [];
  let tests = 0;
  let dispatch = 0;
  for (const run of RUNS) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-mut-tmp-'));
    const r = spawnSync(process.execPath, run.args, { cwd: dir, env: { ...process.env, TMPDIR: tmp }, encoding: 'utf8', timeout: 300000 });
    const out = `${r.stdout}\n${r.stderr}`;
    for (const m of out.matchAll(/^not ok \d+ - (.+)$/gm)) failed.push(m[1].replace(/\s+#.*$/, ''));
    const t = /^# tests (\d+)/m.exec(out);
    tests += t ? Number(t[1]) : 0;
    if (r.status !== 0 && !failed.length) failed.push(`${run.label}: процес завершився з кодом ${r.status}`);
    const scan = spawnSync('sh', ['-c', `grep -rho '"dispatch_attempt"' ${JSON.stringify(tmp)} 2>/dev/null | wc -l`], { encoding: 'utf8' });
    dispatch += Number(scan.stdout.trim() || 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { failed, tests, dispatch };
}

const want = process.argv.slice(2);
const results = [];
const base = copyTree();
const control = runAll(base);
fs.rmSync(base, { recursive: true, force: true });
console.log(`control: {tests: ${control.tests}, failed: ${control.failed.length}, dispatch_attempt: ${control.dispatch}}`);
if (control.failed.length) {
  console.log(`# КОНТРОЛЬ ЧЕРВОНИЙ: ${JSON.stringify(control.failed)}`);
  process.exit(2);
}
for (const m of MUTANTS) {
  if (want.length && !want.includes(m.id)) continue;
  const dir = copyTree();
  const file = path.join(dir, m.file);
  let src = fs.readFileSync(file, 'utf8');
  let applied = true;
  for (const p of m.patches) {
    const n = src.split(p.from).length - 1;
    if (n !== 1) {
      applied = false;
      console.log(`- {id: ${m.id}, status: NOT_APPLIED, reason: "фрагмент знайдено ${n} разів"}`);
      break;
    }
    src = src.replace(p.from, () => p.to);
  }
  if (applied) {
    fs.writeFileSync(file, src);
    const r = runAll(dir);
    results.push({ id: m.id, killed: r.failed.length > 0 });
    const by = [...new Set(r.failed)].slice(0, 6).map((x) => JSON.stringify(x.length > 90 ? `${x.slice(0, 90)}…` : x)).join(', ');
    console.log(`- {id: ${m.id}, what: ${JSON.stringify(m.what)}, file: ${m.file}, status: ${r.failed.length ? 'KILLED' : 'SURVIVED'}, failed: ${new Set(r.failed).size}, dispatch_attempt: ${r.dispatch}, by: [${by}]}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
const survived = results.filter((r) => !r.killed).map((r) => r.id);
console.log(`# підсумок: мутантів ${results.length}, вбито ${results.length - survived.length}, вижили ${survived.length}${survived.length ? ` (${survived.join(', ')})` : ''}`);
process.exit(survived.length ? 1 : 0);
