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
