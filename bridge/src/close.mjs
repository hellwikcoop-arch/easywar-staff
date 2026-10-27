// Завершення задачі через ADM (T-0009): `j4 close --task T-XXXX --subject <SHA> --checks-ref <файл>`.
// Перехід у done — лише після бар'єра CONTRACT_v0_4.md, розд. 6, на ОДНОМУ subject (acceptance.mjs, без змін).
// Що перевіряється:
//   - перевірки (checks): звичайний файл у сховищі штабу (не симлінк, realpath усередині сховища) із записом на одному
//     рядку у вигляді плоского YAML-відображення `{cmd: …, subject: <повний SHA>, result: "N/N pass …", by: …}` (T-0010,
//     F-T9-22: суворий розбір без залежностей; SHA лише в полі `subject`; `result` починається з `pass`/`N/N pass`, без
//     fail/error — `fail 0` / `0 fail` / `errors: 0` дозволені); якщо наказ має `verify: ["…", …]`, кожна його команда
//     — у полі `cmd` такого ж запису; нечитаний `verify` — відмова. sha256 файлу доказів пишеться в подію done;
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
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requestDone, evidenceFromEvents } from './acceptance.mjs';
import { verifyLedger } from './ledger.mjs';
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
function openEscalations({ store, ledgerEntries, taskId, entries }) {
  const open = new Set();
  const status = new Map();
  if (store) {
    for (const f of store.list('escalations')) {
      const e = store.readJson(`escalations/${f}`);
      if (e?.task_id !== taskId) continue;
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
  // ескалація, записана в журнал задачі, але невідома жодному джерелу J4 (інший J4_HOME) — консервативно відкрита
  entries.forEach((e, i) => {
    if (e.event !== 'escalation') return;
    const id = e.escalation_id ?? null;
    if (!id) open.add(e.seq === undefined ? `entry ${i + 1}` : `seq ${e.seq}`);
    else if (!status.has(id) && !raised.has(id)) open.add(id);
  });
  return [...open];
}

// Доказ перевірок (T-0010, F-T9-22) — запис на ОДНОМУ рядку у вигляді плоского YAML-відображення, як у reports/T-0007/001.yaml:
//   `- {cmd: "…", subject: <повний SHA>, result: "76/76 pass, fail 0", by: J3, calls: 44}`
// (допустимі префікси `- ` і `ключ: `, коментар `# …` після запису). Розбір суворий і без залежностей:
//   - дозволені лише ключі cmd, subject, result, by, calls, at; будь-який інший ключ, подвоєний ключ, вкладена структура,
//     незакриті лапки, зайвий текст чи кома після запису — це не доказ;
//   - SHA має бути значенням поля `subject` (повний, без регістрових розбіжностей), а не згадкою в note чи cmd;
//   - `result` починається з `pass`/`passed` або `N/N pass` (N > 0, обидва числа рівні); далі — лише `, … ; … ( …`, без fail/error
//     (звичайний підсумок `fail 0`, `0 fail`, `errors: 0` дозволений), без not/never/false;
//   - команди `verify` наказу мають бути підрядками поля `cmd` записів, що пройшли; хоча б один запис має пройти.
// Файл — звичайний, не симлінк, realpath усередині сховища.
const EVIDENCE_KEYS = new Set(['cmd', 'subject', 'result', 'by', 'calls', 'at']);

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
    const m = item.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s+(\S[\s\S]*?)\s*$/);
    if (!m || map.has(m[1])) return null;
    const v = flowScalar(m[2]);
    if (v === null) return null;
    map.set(m[1], v);
  }
  return map;
}

// Рядок файла доказів → Map із полями запису або null, якщо рядок не є записом доказу за граматикою вище.
function evidenceRecord(rawLine) {
  const line = stripComment(rawLine).trim();
  const m = line.match(/^(?:-[ \t]+|[A-Za-z_][A-Za-z0-9_]*:[ \t]+)?(\{.*\})$/s);
  if (!m) return null;
  const map = parseFlowMap(m[1]);
  if (!map || !map.has('subject') || !map.has('result')) return null;
  for (const k of map.keys()) if (!EVIDENCE_KEYS.has(k)) return null;
  return map;
}

function resultIsPass(res) {
  const m = res.trim().match(/^(?:(\d+)[ \t]*\/[ \t]*(\d+)[ \t]+)?pass(?:ed)?(?![A-Za-z0-9_])([\s\S]*)$/i);
  if (!m) return false; // «0 of 76 pass», «never passed», «not passed», «0 passed», «tests 0 pass 0 fail 0»
  if (m[1] !== undefined && !(m[1] === m[2] && Number(m[1]) > 0)) return false; // порожній чи неповний відбір: «0/76 pass», «75/76 pass»
  if (!/^[ \t]*(?:$|[,;(])/.test(m[3])) return false; // «pass: false», «pass: 0», «pass 0 fail 0»
  // «fail 0», «0 fail», «errors: 0» — звичайний підсумок успішного прогону, провалом не вважається
  const cleaned = m[3].replace(/\b(fail\w*|errors?)[ :=]*0\b/gi, '').replace(/\b0[ ]+(fail\w*|errors?)\b/gi, '');
  return !/\b(fail\w*|errors?|not|never|false)\b/i.test(cleaned);
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
  const passing = [];
  for (const line of buf.toString('utf8').split('\n')) {
    const r = evidenceRecord(line);
    if (r && r.get('subject') === subject && resultIsPass(r.get('result'))) passing.push(r);
  }
  const ok = passing.length > 0 && verify.every((cmd) => passing.some((r) => (r.get('cmd') ?? '').includes(cmd)));
  return { checks: [{ subject, passed: ok, evidence_ref: ok ? rel : null }], sha256: ok ? createHash('sha256').update(buf).digest('hex') : null };
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

export function closeTask({ staffRoot, taskId, subject, checksRef, store, ledgerEntries, now = Date.now() }) {
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
  const done = entries.filter((e) => e.event === 'state_changed' && e.state === 'done');
  if (done.some((e) => e.subject === subject)) return { ok: true, already: true, entry: done.find((e) => e.subject === subject) };
  if (done.length) return refuse('done-exists-other-subject');

  const gate = orderGate(staffRoot, taskId);
  if (!gate) return refuse('order-missing');
  if (gate.error) return refuse(gate.error);

  let esc;
  try {
    esc = openEscalations({ store, ledgerEntries, taskId, entries });
  } catch {
    // сховище J4 не читається (EIO, зіпсований файл ескалації…): «не вдалося прочитати» ≠ «ескалацій немає» (F-T9-19)
    return refuse('escalation-source-unreadable', ['store-unreadable']);
  }
  if (esc.length) return refuse('open-escalation', esc.map((x) => `escalation:${x}`));

  const ev = evidenceFromEvents(staffRoot, taskId);
  const { checks, sha256 } = checksFrom(staffRoot, subject, checksRef, gate.verify);
  const r = requestDone({ by: 'ADM', subject, checks, reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: gate.keyDecision, reviewKind: gate.reviewKind, requiredRoles: gate.requiredRoles });
  if (!r.allowed) return refuse('barrier-not-passed', r.missing);

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
