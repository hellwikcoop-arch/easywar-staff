// Завершення задачі через ADM (T-0009): `j4 close --task T-XXXX --subject <SHA> --checks-ref <файл>`.
// Перехід у done — лише після бар'єра CONTRACT_v0_4.md, розд. 6, на ОДНОМУ subject (acceptance.mjs, без змін).
// Що перевіряється:
//   - перевірки (checks): звичайний файл у сховищі штабу (не симлінк, realpath усередині сховища) із записом на одному
//     рядку у вигляді плоского YAML-відображення `{cmd: …, subject: <повний SHA>, result: "N/N pass …", by: …}` (T-0010,
//     F-T9-22: суворий розбір без залежностей; SHA лише в полі `subject`; `result` починається з `pass`/`N/N pass`, без
//     fail/error — `fail 0` / `0 fail` / `errors: 0` дозволені); якщо наказ має `verify: ["…", …]`, кожна його команда
//     — підрядком поля `cmd` запису, який пройшов; нечитаний `verify` — відмова. T-0012 (R-11, F-T10-11): для КОЖНОЇ
//     вимоги діє ОСТАННІЙ запис серед тих, що її стосуються (cmd містить вимогу або cmd відсутній); пізніший збій варіантною
//     командою, запис без cmd чи нерозпізнаний result скасовують раніший успіх (fail-closed; причини `evidence-*` у missing).
//     sha256 файлу доказів пишеться в подію done;
//   - рецензія виду checks.review_kind і приймання кожної ролі з acceptance наказу (+ JE для key_decision);
//   - відсутність відкритих ескалацій JE за задачею: у сховищі J4, у журналі J4 (escalation_raised без
//     escalation_resolved) і в events.jsonl; ескалація, невідома сховищу, але є в журналі, вважається відкритою;
//     closeTask вимагає ОБИДВА джерела J4 явно (store і ledgerEntries): без них перевірка мовчки пропустила б ескалацію.
//     Журнал J4 читає readLedgerStrict: відсутній, обірваний, пошкоджений (ланцюг хешів) чи змінений під час читання
//     журнал — відмова, а не порожній список (JE-T9-03 D-3, C3 F-T9-11/12). Сховище J4 CLI відкриває лише для читання
//     (Store.open) і перевіряє inspectJ4Home; помилка читання сховища — відмова, а не «ескалацій немає» (T-0010);
//   - ідемпотентність: повторний close на тому ж subject нічого не пише (`already: true`), але лише коли джерела ескалацій
//     читні — CLI перевіряє їх ДО розбору done; done на іншому subject — відмова (T-0010, F-T9-21: опис, не поведінка).
// Відкриті обов'язкові зауваження окремим джерелом не рахуються: вимога «C3 passed» на тому ж SHA (наказ T-0009).
// T-0011 (ідентичність установки, F-T9-18): перед усім іншим, окрім читання events.jsonl, пара «сховище—журнал» мусить належати закріпленій
// установці (checkInstallation: закріплене значення JE, marker сховища, прив'язка журналу, ledger_first_hash, ledger_min_seq); після
// ідемпотентності й наказу події ADM у events.jsonl звіряються із записами журналу, а ескалації сховища — з журналом (reconcileSources).
// Єдиний нормативний порядок (03-spec-T-0011.md, M11) — у closeTask. Механізм не автентифікує `by` і особу JE (F-9, F-3).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requestDone, evidenceFromEvents } from './acceptance.mjs';
import { verifyLedger, ledgerBinding } from './ledger.mjs';
import { INSTALLATION_ID } from './store.mjs';
import { appendAdmEvent, readTaskEvents, TaskEventsError } from './events.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

// Коментар YAML `#` — лише поза лапками й після пропуску (або на початку рядка); у лапках `#` — звичайний символ.
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i += 1;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Мінімальний розбір потрібних полів order.yaml без залежностей: acceptance, review_kind і verify.
export function orderGate(staffRoot, taskId) {
  const f = path.join(staffRoot, 'tasks', taskId, 'order.yaml');
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8').split('\n').map(stripComment).join('\n');
  const acc = text.match(/^acceptance:\s*\{([^}]*)\}/m)?.[1] ?? text.match(/^acceptance:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  const field = (name) => acc.match(new RegExp(`${name}:\\s*([A-Za-z0-9.]+)`))?.[1] ?? null;
  const technical = field('technical');
  const content = field('content');
  const key = field('key_decision');
  const reviewKind = text.match(/^[ \t]*review_kind:[ \t]*([a-z]+)[ \t]*$/m)?.[1] ?? 'code';
  if (!technical || !content || !['true', 'false'].includes(key)) return { error: 'order-acceptance-unreadable' };
  if (!['code', 'logic', 'none'].includes(reviewKind)) return { error: 'order-review-kind-invalid' };
  // verify: ["команда", ...] в один рядок, з будь-яким відступом. Ключ є, а список не розібрано до кінця — відмова.
  const verifyLines = [...text.matchAll(/^[ \t]*verify:[ \t]*(.*)$/gm)];
  if (verifyLines.length > 1) return { error: 'order-verify-unreadable' }; // кілька ключів verify: який із них діє — невідомо
  const verifyLine = verifyLines[0] ?? null;
  let verify = [];
  if (verifyLine) {
    const q = '"(?:[^"\\\\]|\\\\.)*"';
    const list = verifyLine[1].trim().match(new RegExp(`^\\[\\s*((?:${q}(?:\\s*,\\s*${q})*)?)\\s*\\]$`));
    if (!list) return { error: 'order-verify-unreadable' };
    try {
      verify = [...list[1].matchAll(new RegExp(q, 'g'))].map((m) => JSON.parse(m[0]));
    } catch {
      return { error: 'order-verify-unreadable' };
    }
  }
  return { requiredRoles: [[technical, 'technical'], [content, 'content']], keyDecision: key === 'true', reviewKind, verify };
}

// Чи є J4_HOME сховищем J4, яке можна прочитати: тека `escalations` існує, є текою і її вміст читається.
// Не створює нічого. Ознака сховища лишається слабкою (одна підтека): ідентичність установки — задача T-0011 (F-T9-18).
//   home-not-j4-store — теки немає, вона не тека або `J4_HOME` її не містить (ENOENT/ENOTDIR);
//   home-unreadable   — перевірити не вдалося (EACCES, ELOOP, EIO…): «нечитне» не плутаємо з «порожнє» (F-T9-19).
export function inspectJ4Home(home, fsImpl = fs) {
  const dir = path.join(home, 'escalations');
  let st;
  try {
    st = fsImpl.statSync(dir);
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'home-not-j4-store' : 'home-unreadable' };
  }
  if (!st.isDirectory()) return { ok: false, reason: 'home-not-j4-store' };
  try {
    fsImpl.readdirSync(dir);
  } catch {
    return { ok: false, reason: 'home-unreadable' };
  }
  return { ok: true };
}

// Відкриті ескалації за задачею з трьох джерел: сховище J4, журнал J4 (ledgerEntries), журнал задачі (entries).
// storeOnly (T-0011, M7 п. 4) — ескалації, відкриті у сховищі, яких журнал J4 не знає (немає escalation_raised за задачею): сховище і журнал
// однієї установки не розходяться в наборі ескалацій, бо escalate() пише обидва; розбіжність — чуже сховище, обрізаний журнал або збій
// між двома записами.
function openEscalations({ store, ledgerEntries, taskId, entries }) {
  const open = new Set();
  const storeOnly = new Set();
  const status = new Map();
  if (store) {
    for (const f of store.list('escalations')) {
      const e = store.readJson(`escalations/${f}`);
      // файл ескалації — JSON-об'єкт; інша форма (null, масив, рядок) — пошкодження, а не «чужа задача»
      if (e === null || typeof e !== 'object' || Array.isArray(e)) throw Object.assign(new Error('escalation-file-malformed'), { code: 'escalation-file-malformed' });
      if (e.task_id !== taskId) continue;
      status.set(e.escalation_id, e.status);
      if (e.status === 'open') open.add(e.escalation_id);
    }
  }
  const raised = new Set();
  const resolved = new Set();
  for (const x of ledgerEntries ?? []) {
    if (x.detail?.task_id !== taskId) continue;
    if (x.event === 'escalation_raised') raised.add(x.detail.escalation_id);
    if (x.event === 'escalation_resolved') resolved.add(x.detail.escalation_id);
  }
  for (const id of raised) if (!resolved.has(id) && status.get(id) !== 'resolved') open.add(id);
  for (const [id, st] of status) if (st === 'open' && !raised.has(id)) storeOnly.add(id);
  // ескалація, записана в журнал задачі, але невідома жодному джерелу J4 (інший J4_HOME) — консервативно відкрита
  entries.forEach((e, i) => {
    if (e.event !== 'escalation') return;
    const id = e.escalation_id ?? null;
    if (!id) open.add(e.seq === undefined ? `entry ${i + 1}` : `seq ${e.seq}`);
    else if (!status.has(id) && !raised.has(id)) open.add(id);
  });
  return { open: [...open], storeOnly: [...storeOnly] };
}

// Доказ перевірок (T-0010, F-T9-22) — запис на ОДНОМУ рядку у вигляді плоского YAML-відображення, як у reports/T-0007/001.yaml:
//   `- {cmd: "…", subject: <повний SHA>, result: "76/76 pass, fail 0", by: J3, calls: 44}`
// (допустимі префікси `- ` і `ключ: `, коментар `# …` після запису). Розбір суворий і без залежностей:
//   - дозволені лише ключі cmd, subject, result, by, calls, at; будь-який інший ключ, подвоєний ключ, вкладена структура,
//     незакриті лапки, зайвий текст чи кома після запису — це не доказ;
//   - SHA має бути значенням поля `subject` (повний, без регістрових розбіжностей), а не згадкою в note чи cmd;
//   - `result` починається з `pass`/`passed` або `N/N pass` (N > 0, обидва числа рівні); далі — лише `, … ; … ( …`, без fail/error
//     (звичайний підсумок `fail 0`, `0 fail`, `errors: 0` дозволений), без not/never/false;
//   - команди `verify` наказу мають бути підрядками поля `cmd` записів, що пройшли; хоча б один запис має пройти
//     (T-0012: правило «останнього релевантного запису» — evidenceVerdict нижче).
// Файл — звичайний, не симлінк, realpath усередині сховища.
const EVIDENCE_KEYS = new Set(['cmd', 'subject', 'result', 'by', 'calls', 'at', 'ref', 'date', 'note']);

function flowScalar(raw) {
  if (raw.startsWith('"')) {
    try {
      const v = JSON.parse(raw);
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'")) {
    const m = raw.match(/^'((?:[^']|'')*)'$/);
    return m ? m[1].replace(/''/g, "'") : null;
  }
  if (/^[&*!|>%@`#]/.test(raw) || /: |\s#/.test(raw)) return null;
  return raw;
}

// {ключ: значення, …} → Map або null. Значення — скаляр у лапках чи простий скаляр без , [ ] { }.
function parseFlowMap(text) {
  if (text.length < 2 || text[0] !== '{' || text[text.length - 1] !== '}') return null;
  const body = text.slice(1, -1);
  const items = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (q) {
      cur += c;
      if (q === '"' && c === '\\') {
        i += 1;
        if (i >= body.length) return null;
        cur += body[i];
      } else if (c === q) {
        if (q === "'" && body[i + 1] === "'") {
          i += 1;
          cur += "'";
        } else {
          q = null;
        }
      }
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '{' || c === '[' || c === ']' || c === '}') {
      return null;
    } else if (c === ',') {
      items.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (q) return null;
  items.push(cur);
  const map = new Map();
  for (const item of items) {
    const m = item.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s+(\S[\s\S]*)$/);
    if (!m || map.has(m[1])) return null;
    const v = flowScalar(m[2].trim());
    if (v === null) return null;
    map.set(m[1], v);
  }
  return map;
}

// Рядок файла доказів → Map із полями запису або null, якщо рядок не є записом доказу за граматикою вище.
function evidenceRecord(rawLine) {
  const line = stripComment(rawLine).trim();
  const m = line.match(/^(?:-[ \t]+|checks:[ \t]+)?(\{.*\})$/s);
  if (!m) return null;
  const map = parseFlowMap(m[1]);
  if (!map || !map.has('subject') || !map.has('result')) return null;
  for (const k of map.keys()) if (!EVIDENCE_KEYS.has(k)) return null;
  return map;
}

function resultIsPass(res) {
  const m = res.trim().match(/^(?:(\d+)[ \t]*\/[ \t]*(\d+)[ \t]+|(\d+)[ \t]+)?pass(?:ed)?(?![A-Za-z0-9_])([\s\S]*)$/i);
  if (!m) return false; // «0 of 76 pass», «never passed», «not passed», «0 passed», «tests 0 pass 0 fail 0»
  if (m[1] !== undefined && !(m[1] === m[2] && Number(m[1]) > 0)) return false; // порожній чи неповний відбір: «0/76 pass», «75/76 pass»
  if (m[3] !== undefined && Number(m[3]) === 0) return false; // «0 pass»
  if (!/^[ \t]*(?:$|[,;(])/.test(m[4])) return false; // «pass: false», «pass: 0», «pass 0 fail 0»
  // «fail 0», «0 fail», «errors: 0», «cancelled 0» — звичайний підсумок успішного прогону; будь-яка інша цифра чи слово — ні
  const counter = '(?:fail\\w*|errors?|cancel\\w*|time[ -]?outs?|abort\\w*|crash\\w*)';
  const cleaned = m[4]
    .replace(new RegExp(`\\b${counter}[ :=]*0(?![\\w.])`, 'gi'), '')
    .replace(new RegExp(`(?<![\\w.])0[ ]+${counter}\\b(?![ ]*[\\d.])`, 'gi'), '');
  return !new RegExp(`\\b(?:${counter}|not|never|false|partial|incomplete)\\b`, 'i').test(cleaned) && !/(?<![\w.])0[ ]+tests?\b/i.test(cleaned);
}

// Записи доказу з тексту файла на subject у порядку файла: { cmd (рядок після trim або null), pass } (T-0010, F-T10-2;
// T-0012). Рядки всередині блокових скалярів YAML (`|`, `>`) пропускаються — там «запис» лише текст. `cmd` із самих
// пробілів або порожній = відсутній (R11-7, C3H-1). `pass` — лише те, що розпізнає resultIsPass; інше = збій (fail-closed).
function evidenceRecords(text, subject) {
  const out = [];
  let blockIndent = null;
  for (const raw of text.split('\n')) {
    const indent = raw.match(/^[ \t]*/)[0].length;
    if (blockIndent !== null) {
      if (raw.trim() === '' || indent > blockIndent) continue;
      blockIndent = null;
    }
    // T-0012 (R-10, F-T10-10): перед `|`/`>` допускаються теги (`!!str`, `!custom`) і якорі (`&a`) — такий заголовок теж відкриває
    // блок. Побічний ефект (відомий, fail-closed): `note: ->` чи `key: -|` теж відкривають «блок»; запис на тому ж відступі далі діє.
    if (/(?:^|:|-)[ \t]*(?:(?:![^\s]*|&[^\s]+)[ \t]+)*[|>][+\-0-9]*$/.test(stripComment(raw).trimEnd())) {
      blockIndent = indent;
      continue;
    }
    const r = evidenceRecord(raw);
    if (r && r.get('subject') === subject) {
      const cmd = r.has('cmd') ? r.get('cmd').trim() : '';
      out.push({ cmd: cmd === '' ? null : cmd, pass: resultIsPass(r.get('result')) });
    }
  }
  return out;
}

// T-0012 P1 (R-11, F-T10-11): для КОЖНОЇ вимоги verify діє останній запис серед тих, що її стосуються: запис, чий cmd містить
// вимогу (підрядок, без канонізації лапок/пробілів/регістру — свідома межа, Р-Т12-4), або запис БЕЗ cmd (невідомо, якої
// команди він стосується — отже стосується всіх; fail-closed). Останній такий запис має мати cmd і пройти: пізніший збій
// варіантною командою, запис без cmd чи нерозпізнаний result скасовують раніший успіх; запис без cmd, що «пройшов», вимогу не
// доводить. Без verify: потрібен хоча б один запис із cmd (C3H-8); групи за cmd (без cmd — своя група), остання в кожній групі
// має пройти. Повертає { ok, reasons[] } — причини йдуть у `missing` події відмови / виводу CLI.
function evidenceVerdict(records, verify) {
  if (!records.length) return { ok: false, reasons: ['evidence-no-record-on-subject'] };
  const reasons = [];
  if (!verify.length) {
    if (!records.some((r) => r.cmd !== null)) reasons.push('evidence-no-cmd-record');
    const latest = new Map();
    for (const r of records) latest.set(r.cmd ?? '', r);
    for (const [cmd, r] of latest) if (!r.pass) reasons.push(`evidence-latest-failed:${cmd || '<без cmd>'}`);
    return { ok: reasons.length === 0, reasons };
  }
  for (const req of verify) {
    const related = records.filter((r) => r.cmd === null || r.cmd.includes(req));
    const last = related.at(-1);
    if (!last) reasons.push(`evidence-missing:${req}`);
    else if (last.cmd === null) reasons.push(`evidence-latest-without-cmd:${req}`);
    else if (!last.pass) reasons.push(`evidence-latest-failed:${req}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function checksFrom(staffRoot, subject, checksRef, verify = []) {
  const bad = { checks: [{ subject, passed: false, evidence_ref: null }], sha256: null };
  if (!checksRef || typeof checksRef !== 'string') return { checks: [], sha256: null };
  const rel = path.normalize(checksRef);
  if (path.isAbsolute(rel) || rel.startsWith('..')) return bad;
  const f = path.join(staffRoot, rel);
  let real;
  try {
    if (!fs.lstatSync(f).isFile()) return bad; // lstat: симлінк тут не файл
    real = fs.realpathSync(f);
    if (!real.startsWith(`${fs.realpathSync(staffRoot)}${path.sep}`)) return bad;
  } catch {
    return bad;
  }
  const buf = fs.readFileSync(real);
  const v = evidenceVerdict(evidenceRecords(buf.toString('utf8'), subject), verify);
  return { checks: [{ subject, passed: v.ok, evidence_ref: v.ok ? rel : null }], sha256: v.ok ? createHash('sha256').update(buf).digest('hex') : null, reasons: v.reasons };
}

// Журнал J4 для перевірки відкритих ескалацій: читається лише достовірний. Відсутній файл, не файл, обірваний останній
// рядок, порушений ланцюг хешів/seq/витік чи зміна журналу між двома читаннями — відмова з причиною, а не порожній список.
// hooks.afterVerify — для тестів: викликається між перевіркою ланцюга й читанням файла (детермінована зміна журналу).
export function readLedgerStrict(file, hooks = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? 'ledger-missing' : 'ledger-unreadable' };
  }
  if (!st.isFile()) return { ok: false, reason: 'ledger-unreadable' };
  let v;
  let raw;
  try {
    v = verifyLedger(file);
    hooks.afterVerify?.();
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'ledger-unreadable' };
  }
  if (!v.ok) {
    const onlyPartial = v.problems.length === 1 && v.problems[0].code === 'partial-line';
    return { ok: false, reason: onlyPartial ? 'ledger-partial' : 'ledger-corrupt', problems: v.problems.slice(0, 3).map((p) => p.code) };
  }
  let entries;
  try {
    entries = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return { ok: false, reason: 'ledger-unreadable' };
  }
  // файл змінився між перевіркою і читанням (дописав інший процес) — перевірене й прочитане не збігаються
  if (entries.length !== v.entries || (entries.length ? entries[entries.length - 1].hash : v.head) !== v.head) return { ok: false, reason: 'ledger-changed-during-read' };
  return { ok: true, entries };
}

// T-0011 (M4): закріплені значення JE, які CLI отримує явно (рішення JE, не `bridge/config/**`). Значення за замовчуванням немає.
//   installationId — 32 hex (обов'язкове); ledgerFirstHash — sha256 запису seq 1 (необов'язкове); ledgerMinSeq — додатне ціле, мінімальна
//   довжина журналу (необов'язкове). Хибний формат або порожній рядок — installation-unknown, а не тихе ігнорування; регістр не нормалізується.
const SHA256 = /^[0-9a-f]{64}$/;
function pinnedProblems({ installationId, ledgerFirstHash, ledgerMinSeq }) {
  const missing = [];
  if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId)) missing.push('pinned');
  if (ledgerFirstHash !== undefined && ledgerFirstHash !== null && !(typeof ledgerFirstHash === 'string' && SHA256.test(ledgerFirstHash))) missing.push('ledger-first-hash');
  const seq = ledgerMinSeq;
  if (seq !== undefined && seq !== null && !((typeof seq === 'number' && Number.isInteger(seq) && seq >= 1) || (typeof seq === 'string' && /^[1-9][0-9]*$/.test(seq)))) missing.push('ledger-min-seq');
  return missing;
}

// T-0011 (M6, M3): пара «сховище—журнал» належить закріпленій установці. Збираються всі розбіжності, а не перша:
//   store-marker-missing | store-marker-mismatch, ledger-not-bound | ledger-binding-mismatch, ledger-first-hash-mismatch,
//   ledger-truncated-below-min-seq. Читання: store.installation() нічого не створює (Store.open).
export function checkInstallation({ store, ledgerEntries, installationId, ledgerFirstHash, ledgerMinSeq }) {
  const missing = [];
  const marker = typeof store.installation === 'function' ? store.installation() : null;
  if (!marker) missing.push('store-marker-missing');
  else if (marker.installation_id !== installationId) missing.push('store-marker-mismatch');
  const binding = ledgerBinding(ledgerEntries);
  if (!binding) missing.push('ledger-not-bound');
  else if (binding.installation_id !== installationId) missing.push('ledger-binding-mismatch');
  if (ledgerFirstHash && ledgerEntries.length && ledgerEntries[0].hash !== ledgerFirstHash) missing.push('ledger-first-hash-mismatch');
  if (ledgerMinSeq !== undefined && ledgerMinSeq !== null && ledgerEntries.length < Number(ledgerMinSeq)) missing.push('ledger-truncated-below-min-seq');
  return missing.length ? { ok: false, missing } : { ok: true, binding };
}

// T-0011 (M7 пп. 1–3, 5; рішення Р-Т11-6): кожна подія ADM у events.jsonl з `ref: j4-ledger#seq=N` має відповідати запису N НАДАНОГО журналу:
//   запис існує, а `ledger_hash` події дорівнює його hash (обов'язкове поле); вид запису відповідає виду події (escalation ↔ escalation_raised
//   з тим самим escalation_id; report_filed ↔ message_accepted kind report з тим самим msg_id; інший вид події з таким ref — kind-mismatch);
//   `installation_id` події обов'язковий, якщо запис N пізніший за запис прив'язки (нові події), і лише перевіряється, якщо передує їй
//   (події часів до adopt). Історичні події не змінюються. Подія ADM без ref на журнал J4 (done) не звіряється.
const LEDGER_REF = /^j4-ledger#seq=(\d+)$/;
const EXPECTED_RECORD = {
  escalation: (e, rec) => rec.event === 'escalation_raised' && rec.detail?.escalation_id === e.escalation_id,
  report_filed: (e, rec) => rec.event === 'message_accepted' && rec.kind === 'report' && rec.msg_id === e.msg_id,
};
function reconcileEvents({ entries, ledgerEntries, installationId, binding }) {
  const bySeq = new Map(ledgerEntries.map((x) => [x.seq, x]));
  const problems = [];
  for (const e of entries) {
    if (e.by !== 'ADM') continue;
    const m = LEDGER_REF.exec(typeof e.ref === 'string' ? e.ref : '');
    if (!m) continue;
    const n = Number(m[1]);
    const at = `event-seq-${e.seq ?? '?'}`;
    const rec = bySeq.get(n);
    if (!rec || typeof e.ledger_hash !== 'string' || rec.hash !== e.ledger_hash) {
      problems.push(`${at}:ledger-seq-${n}-mismatch`);
      continue;
    }
    if (!(EXPECTED_RECORD[e.event]?.(e, rec) ?? false)) problems.push(`${at}:ledger-seq-${n}-kind-mismatch`);
    if (e.installation_id === undefined) {
      if (n > binding.seq) problems.push(`${at}:installation-id-missing`);
    } else if (e.installation_id !== installationId) {
      problems.push(`${at}:installation-mismatch`);
    }
  }
  return problems;
}

export function closeTask({ staffRoot, taskId, subject, checksRef, store, ledgerEntries, installationId, ledgerFirstHash, ledgerMinSeq, now = Date.now() }) {
  const refuse = (code, missing = []) => ({ ok: false, code, missing });
  if (!SHA40.test(subject ?? '')) return refuse('subject-invalid');
  // обидва джерела ескалацій J4 обов'язкові: без них перевірка «немає відкритої ескалації JE» мовчки б пропускалась
  if (!store || typeof store.list !== 'function' || typeof store.readJson !== 'function') return refuse('escalation-source-unknown', ['store']);
  if (!Array.isArray(ledgerEntries)) return refuse('escalation-source-unknown', ['ledgerEntries']);
  let entries;
  try {
    entries = readTaskEvents(staffRoot, taskId).entries;
  } catch (e) {
    if (e instanceof TaskEventsError) return refuse(e.code);
    throw e;
  }
  // T-0011 (M11): ідентичність пари — ДО ідемпотентності: повтор на чужій парі чи без закріпленого значення — теж відмова, а не `already`
  const unknown = pinnedProblems({ installationId, ledgerFirstHash, ledgerMinSeq });
  if (unknown.length) return refuse('installation-unknown', unknown);
  const ident = checkInstallation({ store, ledgerEntries, installationId, ledgerFirstHash, ledgerMinSeq });
  if (!ident.ok) return refuse('installation-mismatch', ident.missing);
  const done = entries.filter((e) => e.event === 'state_changed' && e.state === 'done');
  if (done.some((e) => e.subject === subject)) return { ok: true, already: true, entry: done.find((e) => e.subject === subject) };
  if (done.length) return refuse('done-exists-other-subject');

  const gate = orderGate(staffRoot, taskId);
  if (!gate) return refuse('order-missing');
  if (gate.error) return refuse(gate.error);

  // T-0011 (M7): події ADM ↔ журнал J4 — до перевірки відкритих ескалацій, щоб підміна події не маскувалась під «невідому ескалацію»
  const eventProblems = reconcileEvents({ entries, ledgerEntries, installationId, binding: ident.binding });
  if (eventProblems.length) return refuse('ledger-events-mismatch', eventProblems);

  let esc;
  try {
    esc = openEscalations({ store, ledgerEntries, taskId, entries });
  } catch (e) {
    // сховище J4 не читається (EIO, зіпсований чи не-об'єктний файл ескалації…): «не вдалося прочитати» ≠ «ескалацій немає»
    // (F-T9-19). Помилки самої програми (TypeError тощо) не маскуються під відмову.
    if (e instanceof SyntaxError || typeof e?.code === 'string') return refuse('escalation-source-unreadable', ['store-unreadable']);
    throw e;
  }
  if (esc.storeOnly.length) return refuse('installation-mismatch', ['store-ledger-escalation-unknown', ...esc.storeOnly.map((x) => `escalation:${x}`)]);
  if (esc.open.length) return refuse('open-escalation', esc.open.map((x) => `escalation:${x}`));

  const ev = evidenceFromEvents(staffRoot, taskId);
  const { checks, sha256, reasons = [] } = checksFrom(staffRoot, subject, checksRef, gate.verify);
  const r = requestDone({ by: 'ADM', subject, checks, reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: gate.keyDecision, reviewKind: gate.reviewKind, requiredRoles: gate.requiredRoles });
  // T-0012: причини з розбору доказів — лише доповнення до кодів бар'єра (діагностика, не окремий механізм приймання)
  if (!r.allowed) return refuse('barrier-not-passed', [...r.missing, ...reasons]);

  try {
    const res = appendAdmEvent(staffRoot, taskId, {
      event: 'state_changed', state: 'done', subject, ref: checks[0].evidence_ref, evidence_sha256: sha256,
      note: `j4 close: acceptanceReady ready:true; requestDone(ADM) allowed:true; review_kind ${gate.reviewKind}; ролі ${gate.requiredRoles.map(([b, x]) => `${b}/${x}`).join(', ')}${gate.keyDecision ? ', JE/key_decision' : ''}`,
    }, { key: `done:${subject}`, now, allowDone: true });
    return { ok: true, already: res.duplicate, entry: res.entry };
  } catch (e) {
    if (e instanceof TaskEventsError) return refuse(e.code);
    throw e;
  }
}
