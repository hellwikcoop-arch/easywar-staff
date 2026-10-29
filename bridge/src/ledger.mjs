// Журнал доказів J4: JSONL лише на додавання, з ланцюгом хешів (кожен запис містить хеш попереднього).
// Містить конверти, хеші тіл і промптів, облік і рішення маршрутизатора; без текстів промптів і сирих відповідей.
import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256 } from './protocol.mjs';
import { scanObject } from './scanner.mjs';
import { withFileLock, INSTALLATION_ID } from './store.mjs';

const GENESIS = '0'.repeat(64);

export class Ledger {
  // T-0011 (M2): installationId — новий журнал прив'язується до установки першим записом `installation` (seq 1). Наявний журнал,
  // що має хоч один повний запис, не змінюється: його прив'язка — лише через adopt(). Журнал, у якому є лише обірваний перший рядок
  // (збій під час запису seq 1), починається заново: рядок відкидається, його розмір і sha256 фіксуються в записі installation.
  constructor(file, { installationId = null } = {}) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    if (installationId) this.bindIfEmpty(installationId);
  }

  bindIfEmpty(installationId) {
    withFileLock(`${this.file}.lock`, () => {
      let state;
      try {
        state = this.readAll();
      } catch {
        return; // пошкоджений журнал (не JSON) прив'язувати не можна: його відмову покажуть readLedgerStrict і перший запис
      }
      if (state.entries.length) return;
      const detail = { installation_id: installationId };
      if (state.partial !== null) {
        detail.dropped_bytes = Buffer.byteLength(state.partial);
        detail.dropped_sha256 = sha256(state.partial);
        fs.writeFileSync(this.file, '');
      }
      this.appendUnlocked({ event: 'installation', at: new Date().toISOString(), detail });
    });
  }

  // T-0011 (M10): міграція наявного журналу без втрати історії. Порожній журнал отримує `installation` (seq 1); непорожній без
  // прив'язки — `installation_adopted` у голову (історія не переписується). Усе під замком журналу. Обірваний рядок — відмова
  // (ledger-partial-line, файл не змінюється). Повертає { status: 'adopted' | 'already' | 'other', record?, binding? }.
  adopt(installationId, now) {
    return withFileLock(`${this.file}.lock`, () => {
      const { entries, partial } = this.readAll();
      if (partial !== null) {
        const e = new Error('ledger-partial-line');
        e.code = 'ledger-partial-line';
        throw e;
      }
      const binding = ledgerBinding(entries);
      if (binding) return { status: binding.installation_id === installationId ? 'already' : 'other', binding };
      if (!entries.length) return { status: 'adopted', record: this.appendUnlocked({ event: 'installation', at: now, detail: { installation_id: installationId } }) };
      return { status: 'adopted', record: this.appendUnlocked({ event: 'installation_adopted', at: now, detail: { installation_id: installationId, first_hash: entries[0].hash, adopted_at_seq: entries.length } }) };
    });
  }

  readAll() {
    const raw = fs.readFileSync(this.file, 'utf8');
    if (!raw) return { entries: [], partial: null };
    const lines = raw.split('\n');
    const last = lines.pop(); // після останнього \n лишається '' або обірваний рядок
    const entries = lines.filter(Boolean).map((l) => JSON.parse(l));
    return { entries, partial: last ? last : null };
  }

  // Обірваний останній рядок (збій під час запису) відкидається й фіксується подією.
  repairIfNeeded(now) {
    return withFileLock(`${this.file}.lock`, () => this.repairUnlocked(now));
  }

  repairUnlocked(now) {
    const { entries, partial } = this.readAll();
    if (partial === null) return null;
    const kept = entries.map((e) => JSON.stringify(e)).join('\n');
    // атомарно: тимчасовий файл, fsync, rename (F-7, C3)
    const tmp = `${this.file}.repair-${process.pid}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, kept ? `${kept}\n` : '');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
    return this.appendUnlocked({ event: 'ledger_repaired', at: now, detail: { dropped_bytes: Buffer.byteLength(partial), dropped_sha256: sha256(partial) } });
  }

  append(entry) {
    return withFileLock(`${this.file}.lock`, () => this.appendUnlocked(entry));
  }

  appendUnlocked(entry) {
    const leaks = scanObject(entry);
    if (leaks.length) {
      const e = new Error('ledger-leak');
      e.code = 'ledger-leak';
      e.leaks = leaks;
      throw e;
    }
    const { entries, partial } = this.readAll();
    if (partial !== null) {
      const e = new Error('ledger-partial-line');
      e.code = 'ledger-partial-line';
      throw e;
    }
    const prev = entries.length ? entries[entries.length - 1].hash : GENESIS;
    const body = { ...entry, seq: entries.length + 1, prev };
    const rec = { ...body, hash: sha256(canonical(body)) };
    const fd = fs.openSync(this.file, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(rec)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return rec;
  }
}

// Перевірка цілісності: послідовність seq, зв'язок prev, хеш кожного запису, відсутність витоків.
export function verifyLedger(file) {
  const problems = [];
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  if (lines[lines.length - 1] !== '') problems.push({ code: 'partial-line', line: lines.length });
  let prev = GENESIS;
  let n = 0;
  lines.slice(0, -1).forEach((line, i) => {
    if (!line) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      problems.push({ code: 'bad-json', line: i + 1 });
      return;
    }
    n += 1;
    const { hash, ...body } = rec;
    if (rec.seq !== n) problems.push({ code: 'seq', line: i + 1, expected: n, got: rec.seq });
    if (rec.prev !== prev) problems.push({ code: 'chain', line: i + 1 });
    if (sha256(canonical(body)) !== hash) problems.push({ code: 'hash', line: i + 1 });
    for (const leak of scanObject(body)) problems.push({ code: 'leak', line: i + 1, rule: leak.rule, field: leak.field });
    prev = hash;
  });
  return { ok: problems.length === 0, entries: n, head: prev, problems };
}

// T-0011 (M2): установка, до якої прив'язаний журнал, і seq запису прив'язки: { installation_id, seq } або null.
//   - seq 1 `installation` з id у 32 hex → прив'язка (seq 1); пізніший `installation_adopted` ІНШОЇ установки робить прив'язку
//     суперечливою (null);
//   - інакше перший запис — стара історія: прив'язка лише через `installation_adopted`, чий first_hash дорівнює фактичному хешу
//     seq 1 (запис, перенесений в інший журнал, не спрацює); два різні id серед таких записів — суперечність (null).
// Прив'язка без ключа не доводить автора запису (F-9): вона робить помилковий вибір пари і спрощену підміну помітними (DESIGN §20).
export function ledgerBinding(entries) {
  const first = entries[0];
  if (!first) return null;
  const adopted = entries.filter((e) => e.event === 'installation_adopted' && typeof e.detail?.installation_id === 'string' && INSTALLATION_ID.test(e.detail.installation_id));
  if (first.event === 'installation') {
    const id = first.detail?.installation_id;
    if (typeof id !== 'string' || !INSTALLATION_ID.test(id)) return null;
    return adopted.some((e) => e.detail.installation_id !== id) ? null : { installation_id: id, seq: first.seq };
  }
  const own = adopted.filter((e) => e.detail.first_hash === first.hash);
  if (!own.length || own.some((e) => e.detail.installation_id !== own[0].detail.installation_id)) return null;
  return { installation_id: own[0].detail.installation_id, seq: own[0].seq };
}
