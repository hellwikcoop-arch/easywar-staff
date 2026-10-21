// Журнал доказів J4: JSONL лише на додавання, з ланцюгом хешів (кожен запис містить хеш попереднього).
// Містить конверти, хеші тіл і промптів, облік і рішення маршрутизатора; без текстів промптів і сирих відповідей.
import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256 } from './protocol.mjs';
import { scanObject } from './scanner.mjs';

const GENESIS = '0'.repeat(64);

export class Ledger {
  constructor(file) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
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
    const { entries, partial } = this.readAll();
    if (partial === null) return null;
    const kept = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(this.file, kept ? `${kept}\n` : '');
    return this.append({ event: 'ledger_repaired', at: now, detail: { dropped_bytes: Buffer.byteLength(partial), dropped_sha256: sha256(partial) } });
  }

  append(entry) {
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
