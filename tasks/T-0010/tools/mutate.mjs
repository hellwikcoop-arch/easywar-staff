// T-0010: мутаційна перевірка нових і суміжних перевірок на ТИМЧАСОВИХ копіях bridge/ (репозиторій не змінюється).
// Запуск: node tasks/T-0010/tools/mutate.mjs [--out reports/T-0010/mutants.yaml]
// Для кожного мутанта: копія bridge/ + CONTRACT_v0_4.md у tmp, точна заміна `find` -> `replace` (рівно одне входження),
// прогін лише bridge/test/t0010.test.mjs (без адаптера: 0 викликів; лічильник викликів підтверджує). Мутант убитий, якщо прогін впав.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COUNTER = path.join(REPO, 'tasks', 'T-0009', 'tools', 'call-counter.mjs');

const M = (id, file, find, replace, covers) => ({ id, file, find, replace, covers });
const MUTANTS = [
  M('M01', 'src/store.mjs', "      if (e.code === 'ENOENT') return [];\n      throw e;\n    }\n  }\n\n  remove", "      return [];\n    }\n  }\n\n  remove", 'F-T9-19: list ковтає всі помилки'),
  M('M02', 'src/store.mjs', "static open(home) {\n    return new Store(home, { create: false });", "static open(home) {\n    return new Store(home, { create: true });", 'F-T9-20: open створює теки'),
  M('M03', 'src/store.mjs', "    this.assertWritable();\n    const file = this.p(rel);", "    const file = this.p(rel);", 'F-T9-20: writeJson без захисту'),
  M('M04', 'src/store.mjs', "    this.assertWritable();\n    fs.rmSync(this.p(rel), { force: true });", "    fs.rmSync(this.p(rel), { force: true });", 'F-T9-20: remove без захисту'),
  M('M05', 'src/store.mjs', "    this.assertWritable();\n    const file = this.p('lock');\n    const mine", "    const file = this.p('lock');\n    const mine", 'F-T9-20: acquireLock без захисту'),
  M('M06', 'src/store.mjs', "    this.assertWritable();\n    const file = this.p('lock');\n    try {\n      const held", "    const file = this.p('lock');\n    try {\n      const held", 'F-T9-20: releaseLock без захисту'),
  M('M07', 'src/store.mjs', "    this.assertWritable();\n    return withFileLock", "    return withFileLock", 'F-T9-20: locked без захисту'),
  M('M08', 'src/close.mjs', "  try {\n    fsImpl.readdirSync(dir);\n  } catch {\n    return { ok: false, reason: 'home-unreadable' };\n  }", "", 'F-T9-19: inspectJ4Home не читає вміст'),
  M('M09', 'src/close.mjs', "reason: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'home-not-j4-store' : 'home-unreadable'", "reason: 'home-not-j4-store'", 'F-T9-19: помилка stat завжди «не сховище»'),
  M('M10', 'src/close.mjs', "  try {\n    esc = openEscalations({ store, ledgerEntries, taskId, entries });\n  } catch {\n    // сховище J4 не читається (EIO, зіпсований файл ескалації…): «не вдалося прочитати» ≠ «ескалацій немає» (F-T9-19)\n    return refuse('escalation-source-unreadable', ['store-unreadable']);\n  }", "  esc = openEscalations({ store, ledgerEntries, taskId, entries });", 'F-T9-19: виняток замість відмови'),
  M('M11', 'src/close.mjs', "    hooks.afterVerify?.();\n", "", 'F-T9-23: хук afterVerify не викликається'),
  M('M12', 'src/close.mjs', "if (entries.length !== v.entries || (entries.length ? entries[entries.length - 1].hash : v.head) !== v.head)", "if ((entries.length ? entries[entries.length - 1].hash : v.head) !== v.head)", 'F-T9-23: немає перевірки кількості'),
  M('M13', 'src/close.mjs', "if (entries.length !== v.entries || (entries.length ? entries[entries.length - 1].hash : v.head) !== v.head)", "if (entries.length !== v.entries)", 'F-T9-23: немає перевірки голови'),
  M('M14', 'src/close.mjs', "  for (const k of map.keys()) if (!EVIDENCE_KEYS.has(k)) return null;\n", "", 'F-T9-22: дозволено будь-які ключі'),
  M('M15', 'src/close.mjs', "if (!m || map.has(m[1])) return null;", "if (!m) return null;", 'F-T9-22: подвоєні ключі'),
  M('M16', 'src/close.mjs', "r.get('subject') === subject &&", "String(r.get('subject')).includes(subject.slice(0, 12)) &&", 'F-T9-22: subject порівнюється за префіксом'),
  M('M17', 'src/close.mjs', "!(m[1] === m[2] && Number(m[1]) > 0)", "!(m[1] === m[2])", 'F-T9-22: порожній відбір 0/0'),
  M('M18', 'src/close.mjs', "!(m[1] === m[2] && Number(m[1]) > 0)", "!(Number(m[1]) > 0)", 'F-T9-22: неповний відбір N/M'),
  M('M19', 'src/close.mjs', "  if (!/^[ \\t]*(?:$|[,;(])/.test(m[3])) return false;", "", 'F-T9-22: продовження після pass'),
  M('M20', 'src/close.mjs', "return !/\\b(fail\\w*|errors?|not|never|false)\\b/i.test(cleaned);", "return !/\\b(fail\\w*|errors?)\\b/i.test(cleaned);", 'F-T9-22: слова not/never/false'),
  M('M21', 'src/close.mjs', "verify.every((cmd) => passing.some((r) => (r.get('cmd') ?? '').includes(cmd)))", "true", 'F-T9-22: команди verify не вимагаються'),
  M('M22', 'src/close.mjs', "const line = stripComment(rawLine).trim();", "const line = rawLine.trim();", 'F-T9-22: коментар після запису'),
  M('M23', 'src/close.mjs', "  const m = line.match(/^(?:-[ \\t]+|[A-Za-z_][A-Za-z0-9_]*:[ \\t]+)?(\\{.*\\})$/s);", "  const m = line.match(/(\\{.*\\})/s);", 'F-T9-22: текст навколо запису'),
  M('M24', 'src/close.mjs', "if (/^[&*!|>%@`#]/.test(raw) || /: |\\s#/.test(raw)) return null;", "", 'F-T9-22: службові символи в простому скалярі'),
  M('M25', 'bin/j4.mjs', "store: Store.open(home)", "store: new Store(home)", 'F-T9-20: CLI відкриває сховище для запису'),
  M('M26', 'bin/j4.mjs', "const homeState = inspectJ4Home(home);\n      if (!homeState.ok) {\n        sourceUnreadable(homeState.reason);\n        break;\n      }", "", 'F-T9-23: CLI не перевіряє J4_HOME'),
  M('M27', 'src/close.mjs', "  if (!v.ok) {\n    const onlyPartial", "  if (false) {\n    const onlyPartial", 'F-T9-23: журнал із витоком приймається'),
  M('M28', 'src/close.mjs', "  } catch {\n    return { ok: false, reason: 'ledger-unreadable' };\n  }\n  if (!v.ok) {", "  } catch {\n    return { ok: true, entries: [] };\n  }\n  if (!v.ok) {", 'F-T9-23: рядок null у журналі дає порожній список'),
  M('M29', 'src/close.mjs', "problems: v.problems.slice(0, 3).map((p) => p.code) }", "problems: [] }", 'F-T9-23: причини журналу не повідомляються'),
];

function run(m) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-mut-'));
  fs.cpSync(path.join(REPO, 'bridge'), path.join(tmp, 'bridge'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'CONTRACT_v0_4.md'), path.join(tmp, 'CONTRACT_v0_4.md'));
  const file = path.join(tmp, 'bridge', m.file);
  const text = fs.readFileSync(file, 'utf8');
  const n = text.split(m.find).length - 1;
  if (n !== 1) return { id: m.id, status: 'not-applied', occurrences: n };
  fs.writeFileSync(file, text.replace(m.find, () => m.replace));
  const counts = path.join(tmp, 'calls.txt');
  const r = spawnSync(process.execPath, ['--test', path.join('bridge', 'test', 't0010.test.mjs')], {
    cwd: tmp, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, J4_CALL_COUNT_FILE: counts, NODE_OPTIONS: `--import ${COUNTER}` },
  });
  const failed = (r.stdout.match(/^not ok /gm) ?? []).length;
  const syntax = /SyntaxError/.test(r.stderr + r.stdout);
  const calls = fs.existsSync(counts) ? fs.readFileSync(counts, 'utf8').split('\n').filter(Boolean).length : 0;
  fs.rmSync(tmp, { recursive: true, force: true });
  return { id: m.id, status: syntax ? 'syntax-error' : r.status !== 0 ? 'killed' : 'SURVIVED', failed_tests: failed, adapter_calls: calls };
}

const results = MUTANTS.map((m) => ({ ...run(m), covers: m.covers }));
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const yaml = [
  '# T-0010: результат мутаційної перевірки (tasks/T-0010/tools/mutate.mjs) на тимчасових копіях; репозиторій не змінювався.',
  `# убито ${results.filter((r) => r.status === 'killed').length} з ${results.length}; виклики адаптера: ${results.reduce((a, r) => a + (r.adapter_calls ?? 0), 0)}`,
  'mutants:',
  ...results.map((r) => `  - {id: ${r.id}, status: ${r.status}, failed_tests: ${r.failed_tests ?? 'null'}, adapter_calls: ${r.adapter_calls ?? 'null'}, covers: ${JSON.stringify(r.covers)}}`),
  '',
].join('\n');
if (out) fs.writeFileSync(path.join(REPO, out), yaml);
process.stdout.write(yaml);
