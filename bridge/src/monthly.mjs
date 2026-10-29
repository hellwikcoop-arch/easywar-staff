// Місячна стеля платних викликів ADM/J4 Bridge (T-0006, рішення JE від 22.10.2026).
// Сукупний ліміт усіх агентів: $50 на календарний місяць UTC; пороги $35 (попередження),
// $45 (критичне), $50 (блокування нових платних викликів). Змінює стелю лише JE (config/limits.json).
//
// Одиниця — цілі мікродолари USD (1e-6 USD), щоб дрібні виклики не округлювались до нуля.
// Стан зберігається у файлі між перезапусками й задачами; облік не скидається при зміні задачі.
// Перед викликом резервується верхня межа вартості; паралельні процеси з тим самим файлом
// бачать резерви одне одного (ексклюзивний файловий замок), тому сума резервів не перевищує стелю.
// Stub-виклики сюди не потрапляють: облік ведеться лише для живих (платних) адаптерів.
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './store.mjs';

export const USD = 1_000_000;
export const LEVELS = [
  { id: 'stop_50', key: 'stop_usd' },
  { id: 'critical_45', key: 'critical_usd' },
  { id: 'warning_35', key: 'warning_usd' },
];

export function monthOf(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 7);
}

export function toMicro(usd) {
  return Math.ceil(Number(usd) * USD);
}

export class MonthlyBudget {
  constructor(file, cfg) {
    this.file = path.resolve(file);
    this.cfg = cfg; // {cap_usd, warning_usd, critical_usd, stop_usd, lock_timeout_ms}
    if (!(cfg.warning_usd < cfg.critical_usd && cfg.critical_usd <= cfg.stop_usd && cfg.stop_usd <= cfg.cap_usd)) {
      throw new Error('monthly-config-invalid');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
  }

  withLock(fn) {
    try {
      return withFileLock(`${this.file}.lock`, fn, { timeoutMs: this.cfg.lock_timeout_ms ?? 5000 });
    } catch (e) {
      if (e.code === 'lock-timeout') {
        const err = new Error('monthly-lock-timeout');
        err.code = 'monthly-lock-timeout';
        throw err;
      }
      throw e;
    }
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return { months: {} };
      const err = new Error('monthly-state-corrupt');
      err.code = 'monthly-state-corrupt';
      throw err; // пошкоджений облік — відмова, а не обнулення
    }
  }

  write(s) {
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  static blank() {
    return { confirmed_micro: 0, estimated_micro: 0, reserved: {}, alerts: [] };
  }

  static total(m) {
    const r = Object.values(m.reserved).reduce((a, x) => a + x.micro, 0);
    return { spent: m.confirmed_micro + m.estimated_micro, reserved: r };
  }

  // Резерв верхньої межі перед викликом. Повертає {ok, code?, snapshot}.
  reserve(callId, upperMicro, nowMs) {
    if (!Number.isInteger(upperMicro) || upperMicro <= 0) return { ok: false, code: 'monthly-upper-bound-unknown' };
    return this.withLock(() => {
      const s = this.read();
      const month = monthOf(nowMs);
      const m = s.months[month] ?? MonthlyBudget.blank();
      const { spent, reserved } = MonthlyBudget.total(m);
      const stop = toMicro(this.cfg.stop_usd);
      if (spent >= stop) return { ok: false, code: 'monthly-stop', snapshot: this.snap(month, m) };
      if (spent + reserved + upperMicro > toMicro(this.cfg.cap_usd) || spent + reserved + upperMicro > stop) {
        return { ok: false, code: 'monthly-cap-would-exceed', snapshot: this.snap(month, m) };
      }
      m.reserved[callId] = { micro: upperMicro, at: nowMs };
      s.months[month] = m;
      this.write(s);
      return { ok: true, month, snapshot: this.snap(month, m) };
    });
  }

  // Розрахунок: actualMicro=null (вартість невідома) — зараховується весь резерв як оцінка.
  // accuracy: 'exact' (дані провайдера) | 'estimate'. Повертає нові пороги, перетнуті цим записом.
  settle(callId, actualMicro, accuracy, nowMs, month = monthOf(nowMs)) {
    return this.withLock(() => {
      const s = this.read();
      const m = s.months[month] ?? MonthlyBudget.blank();
      const res = m.reserved[callId];
      if (!res) return { crossed: [], snapshot: this.snap(month, m), settled: false };
      delete m.reserved[callId];
      let charge = res.micro;
      let acc = 'estimate';
      if (Number.isInteger(actualMicro) && actualMicro >= 0) {
        charge = Math.max(actualMicro, 0);
        acc = accuracy === 'exact' ? 'exact' : 'estimate';
      }
      if (acc === 'exact') m.confirmed_micro += charge;
      else m.estimated_micro += charge;
      const spent = m.confirmed_micro + m.estimated_micro;
      const crossed = [];
      for (const lv of [...LEVELS].reverse()) {
        if (spent >= toMicro(this.cfg[lv.key]) && !m.alerts.includes(lv.id)) {
          m.alerts.push(lv.id);
          crossed.push(lv.id);
        }
      }
      s.months[month] = m;
      this.write(s);
      return { crossed, snapshot: this.snap(month, m), settled: true, accuracy: acc };
    });
  }

  snapshot(nowMs) {
    const s = this.read();
    const month = monthOf(nowMs);
    return this.snap(month, s.months[month] ?? MonthlyBudget.blank());
  }

  snap(month, m) {
    const { spent, reserved } = MonthlyBudget.total(m);
    const level = LEVELS.find((lv) => spent >= toMicro(this.cfg[lv.key]))?.id ?? 'ok';
    return {
      month,
      confirmed_usd: m.confirmed_micro / USD,
      estimated_usd: m.estimated_micro / USD,
      reserved_usd: reserved / USD,
      spent_usd: spent / USD,
      cap_usd: this.cfg.cap_usd,
      level,
      accuracy: m.estimated_micro > 0 ? 'estimate' : 'exact',
    };
  }
}
