// Локальний стан J4 (J4_HOME). Не комітиться: черга, стан повідомлень, спул тіл і сирих відповідей.
// Усі записи атомарні (tmp + rename), щоб збій не лишав напівзаписаних файлів.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(home) {
    this.home = path.resolve(home);
    for (const d of ['queue', 'messages', 'spool', 'threads', 'inbox', 'escalations', 'budget']) {
      fs.mkdirSync(path.join(this.home, d), { recursive: true, mode: 0o700 });
    }
  }

  p(...parts) {
    return path.join(this.home, ...parts);
  }

  locked(name, fn) {
    return withFileLock(this.p(`${name}.lock`), fn);
  }

  writeJson(rel, obj) {
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

  list(dir) {
    try {
      return fs.readdirSync(this.p(dir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }

  remove(rel) {
    fs.rmSync(this.p(rel), { force: true });
  }

  // Ексклюзивний замок обробника. Застарілий замок (мертвий процес або старший за staleMs) перехоплюється.
  acquireLock(staleMs, now = Date.now()) {
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
