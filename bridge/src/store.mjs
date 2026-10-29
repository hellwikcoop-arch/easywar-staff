// Локальний стан J4 (J4_HOME). Не комітиться: черга, стан повідомлень, спул тіл і сирих відповідей.
// Усі записи атомарні (tmp + rename), щоб збій не лишав напівзаписаних файлів.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { scanObject } from './scanner.mjs';

// T-0011: ідентифікатор установки J4 — 32 hex, локальний випадковий, у J4_HOME/installation.json. Нікуди не передається і не є
// installation_id лічильника встановлень EasyWAR (AGENTS.md, Q13): це різні речі з однаковою назвою поля.
export const INSTALLATION_ID = /^[0-9a-f]{32}$/;
export const MARKER_FORMAT = 'j4.installation/1';

// T-0011 (C3T11, перевірка сканером): випадковий id не має збігатися з правилами сканера журналу (напр. ops.phone_ua: хвіст `380` + 9 цифр,
// ≈ 4·10⁻⁶ на id), інакше запис прив'язки в журнал назавжди відмовляв би `ledger-leak`. Id, який сканер відхиляє, відкидається й генерується
// знову; `rand` підміняється лише в тестах.
export function newInstallationId(rand = randomBytes) {
  for (let i = 0; i < 64; i += 1) {
    const id = rand(16).toString('hex');
    if (!scanObject({ installation_id: id }).length) return id;
  }
  throw Object.assign(new Error('installation-id-generation-failed'), { code: 'installation-id-generation-failed' });
}

export class Store {
  // create: false — сховище лише для читання (Store.open): підтек і marker-а не створює, запис і замки відхиляє (T-0010, F-T9-20).
  constructor(home, { create = true } = {}) {
    this.home = path.resolve(home);
    this.readOnly = !create;
    if (create) {
      for (const d of ['queue', 'messages', 'spool', 'threads', 'inbox', 'escalations', 'budget']) {
        fs.mkdirSync(path.join(this.home, d), { recursive: true, mode: 0o700 });
      }
      this.ensureMarker();
    }
  }

  // T-0011 (M1): marker установки пишеться один раз і далі не змінюється. Створення атомарне й ексклюзивне (tmp + link: EEXIST, якщо
  // файл — або тека, або зіпсований вміст — уже є): два процеси, що стартують одночасно, отримують один і той самий ідентифікатор;
  // наявний зіпсований marker мовчки не переписується (його бачить installation() = null).
  ensureMarker() {
    const file = this.p('installation.json');
    if (fs.existsSync(file)) return;
    const body = { installation_id: newInstallationId(), created_at: new Date().toISOString(), format: MARKER_FORMAT };
    const tmp = `${file}.new-${process.pid}-${randomBytes(4).toString('hex')}`;
    // fsync до link: після втрати живлення marker не лишається порожнім (існуючий порожній файл не переписується й давав би вічну відмову)
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(body, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  // Marker установки або null: файла немає, він не читається (тека, EACCES), не JSON, не об'єкт, id не 32 hex або формат невідомий.
  // Ніколи не кидає виняток і нічого не створює: «немає marker-а» — це відмова close/run, а не збій програми.
  installation() {
    let m;
    try {
      const file = this.p('installation.json');
      if (!fs.lstatSync(file).isFile()) return null; // симлінк, тека, пристрій — не marker (C3T11-9)
      m = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) return null;
    if (typeof m.installation_id !== 'string' || !INSTALLATION_ID.test(m.installation_id) || m.format !== MARKER_FORMAT) return null;
    return m;
  }

  // Відкриває наявну теку лише для читання: нічого не створює, `j4 close` не залишає слідів у чужому J4_HOME.
  static open(home) {
    return new Store(home, { create: false });
  }

  assertWritable() {
    if (!this.readOnly) return;
    const err = new Error('store-read-only');
    err.code = 'store-read-only';
    throw err;
  }

  p(...parts) {
    return path.join(this.home, ...parts);
  }

  locked(name, fn) {
    this.assertWritable();
    return withFileLock(this.p(`${name}.lock`), fn);
  }

  writeJson(rel, obj) {
    this.assertWritable();
    const file = this.p(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  readJson(rel, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(this.p(rel), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }

  exists(rel) {
    return fs.existsSync(this.p(rel));
  }

  // Відсутня тека — порожній список; будь-яка інша помилка читання (EACCES, ENOTDIR, ELOOP, EIO) — виняток:
  // «не вдалося прочитати» не має виглядати як «ескалацій немає» (T-0010, F-T9-19).
  list(dir) {
    try {
      return fs.readdirSync(this.p(dir)).filter((f) => f.endsWith('.json')).sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  remove(rel) {
    this.assertWritable();
    fs.rmSync(this.p(rel), { force: true });
  }

  // Ексклюзивний замок обробника. Застарілий замок (мертвий процес або старший за staleMs) перехоплюється.
  acquireLock(staleMs, now = Date.now()) {
    this.assertWritable();
    const file = this.p('lock');
    const mine = { pid: process.pid, at: now };
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx', mode: 0o600 });
      return { acquired: true, recovered: null };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let held = null;
    try {
      held = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      held = null;
    }
    const alive = held && held.pid !== process.pid && pidAlive(held.pid);
    const stale = !held || !alive || now - (held.at ?? 0) > staleMs;
    if (!stale) return { acquired: false, recovered: null, held };
    fs.writeFileSync(file, JSON.stringify(mine), { mode: 0o600 });
    return { acquired: true, recovered: held };
  }

  releaseLock() {
    this.assertWritable();
    const file = this.p('lock');
    try {
      const held = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (held.pid === process.pid) fs.rmSync(file, { force: true });
    } catch {
      /* немає замка */
    }
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Короткий ексклюзивний файловий замок (F-4, F-6, F-10 — C3).
// Створення атомарне разом із вмістом: тимчасовий файл + link() (EEXIST, якщо замок є).
// Замок живого процесу не знімається ніколи, хоч би скільки він тримався. Знімається лише замок
// мертвого pid або нечитаний замок, старший за staleMs; перехоплення — через rename на унікальне ім'я
// з повторною перевіркою вмісту. Звільняє замок лише власник (збіг nonce).
export function withFileLock(lockFile, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mine = JSON.stringify({ pid: process.pid, at: Date.now(), nonce });
  const deadline = Date.now() + timeoutMs;
  const wait = () => {
    if (Date.now() > deadline) {
      const err = new Error('lock-timeout');
      err.code = 'lock-timeout';
      throw err;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
  };
  for (;;) {
    const tmp = `${lockFile}.new-${nonce}`;
    fs.writeFileSync(tmp, mine, { mode: 0o600 });
    try {
      fs.linkSync(tmp, lockFile);
      fs.rmSync(tmp, { force: true });
      break;
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if (e.code !== 'EEXIST') throw e;
    }
    let raw = null;
    let st = null;
    try {
      raw = fs.readFileSync(lockFile, 'utf8');
      st = fs.statSync(lockFile);
    } catch {
      continue; // замок щойно звільнено
    }
    let held = null;
    try {
      held = JSON.parse(raw);
    } catch {
      held = null;
    }
    const dead = held ? !pidAlive(held.pid) : Date.now() - st.mtimeMs > staleMs;
    if (!dead) {
      wait();
      continue;
    }
    const grave = `${lockFile}.stale-${nonce}`;
    try {
      fs.renameSync(lockFile, grave);
    } catch {
      continue; // інший процес уже прибрав
    }
    let taken = null;
    try {
      taken = fs.readFileSync(grave, 'utf8');
    } catch {
      taken = null;
    }
    if (taken !== raw) {
      // між перевіркою й rename замок змінився — повернути чужий свіжий замок
      try {
        fs.linkSync(grave, lockFile);
      } catch {
        /* його вже замінено іншим власником */
      }
    }
    fs.rmSync(grave, { force: true });
  }
  try {
    return fn();
  } finally {
    try {
      if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).nonce === nonce) fs.rmSync(lockFile, { force: true });
    } catch {
      /* замка вже немає */
    }
  }
}
