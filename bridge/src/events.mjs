// Журнал дій задачі tasks/<id>/events.jsonl (CONTRACT_v0_4.md, розд. 4; A-T5-04) — запис від імені ADM (T-0009).
// J4 додає лише власні події ADM: report_filed і escalation з посиланням на запис журналу J4, а також
// state_changed=done — лише через closeTask() після бар'єра приймання. Приймання, рецензії, команди й рішення JE,
// поправки, task_created / task_accepted автоматично не створюються ніколи: їх автори — ролі, а не ADM.
// Запис — дописування ОДНОГО рядка (O_APPEND) під файловим замком, без заміни файлу: чужі (ручні) дописи не губляться
// (C3 F-T9-1). Перед записом перевіряється, що файл не змінився відтоді, як його прочитано (розмір); якщо змінився —
// перечитування (до 5 спроб, інакше events-busy). Лишкове вікно — мікросекунди між перевіркою розміру й write: ручний `>>`
// у ньому не губиться, але може дати дублікат seq (ручні записи seq вибирає людина). seq — наступний за максимальним,
// дублікати відсікаються ключем j4_key. Файл, що не закінчується переносом рядка, або з нечитаним/не-об'єктним
// рядком не «лікується»: це файл репозиторію, тож запис відхиляється з помилкою, а людина розбирається;
// обірваний запис (збій посеред write) так само зупиняє наступні записи (events-corrupt).
import fs from 'node:fs';
import path from 'node:path';
import { scanObject } from './scanner.mjs';
import { withFileLock } from './store.mjs';

export const ADM_EVENTS = new Set(['report_filed', 'escalation', 'state_changed']);
const TASK_ID = /^T-\d{4}$/;
const SHA40 = /^[0-9a-f]{40}$/;

export class TaskEventsError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function taskEventsFile(staffRoot, taskId) {
  if (!TASK_ID.test(taskId ?? '')) throw new TaskEventsError('task-id-invalid', String(taskId).slice(0, 20));
  return path.join(staffRoot, 'tasks', taskId, 'events.jsonl');
}

// Читання з перевіркою: кожен рядок — JSON-об'єкт, файл закінчується \n. Інакше events-corrupt. bytes — розмір файлу в байтах.
export function readTaskEvents(staffRoot, taskId) {
  const file = taskEventsFile(staffRoot, taskId);
  if (!fs.existsSync(path.dirname(file))) throw new TaskEventsError('task-unknown', taskId);
  if (!fs.existsSync(file)) return { file, raw: '', bytes: 0, entries: [] };
  const buf = fs.readFileSync(file);
  const raw = buf.toString('utf8');
  if (raw && !raw.endsWith('\n')) throw new TaskEventsError('events-corrupt', 'partial-line');
  const entries = [];
  raw.split('\n').forEach((line, i) => {
    if (!line) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      throw new TaskEventsError('events-corrupt', `line ${i + 1}`);
    }
    if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new TaskEventsError('events-corrupt', `line ${i + 1} not-object`);
    entries.push(e);
  });
  return { file, raw, bytes: buf.length, entries };
}

// Додає подію ADM. Повертає { ok, duplicate, entry }. allowDone — лише для closeTask(). hooks.afterRead — лише для тестів.
export function appendAdmEvent(staffRoot, taskId, event, { key, now = Date.now(), allowDone = false, hooks = {} } = {}) {
  if (!ADM_EVENTS.has(event?.event)) throw new TaskEventsError('event-not-allowed', String(event?.event).slice(0, 40));
  if (event.event === 'state_changed' && !(allowDone && event.state === 'done')) throw new TaskEventsError('state-change-not-allowed');
  if (event.by !== undefined && event.by !== 'ADM') throw new TaskEventsError('by-not-adm');
  if (!key || typeof key !== 'string' || key.length > 120) throw new TaskEventsError('key-required');
  if (event.subject !== undefined && event.subject !== null && !SHA40.test(event.subject)) throw new TaskEventsError('subject-invalid');
  // done без контрольного SHA неможливий: подію не можна прив'язати до бар'єра
  if (event.event === 'state_changed' && !SHA40.test(event.subject ?? '')) throw new TaskEventsError('subject-invalid');
  const file = taskEventsFile(staffRoot, taskId);
  // задача має існувати до замка: каталогів задач ADM не створює
  if (!fs.existsSync(path.dirname(file))) throw new TaskEventsError('task-unknown', taskId);
  return withFileLock(`${file}.lock`, () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { bytes, entries } = readTaskEvents(staffRoot, taskId);
      const dup = entries.find((e) => e.j4_key === key);
      if (dup) return { ok: true, duplicate: true, entry: dup };
      // другий done не створюється навіть при гонці двох close з різними subject
      if (event.event === 'state_changed' && entries.some((e) => e.event === 'state_changed' && e.state === 'done')) throw new TaskEventsError('done-exists');
      const seq = entries.reduce((m, e) => (Number.isInteger(e.seq) && e.seq > m ? e.seq : m), 0) + 1;
      // службові поля — після event: подія від викликача не може підмінити seq, task_id, автора, час і ключ
      const entry = { ...event, seq, task_id: taskId, by: 'ADM', at: new Date(now).toISOString(), j4_key: key };
      if (scanObject(entry).length) throw new TaskEventsError('scanner-block');
      const fd = fs.openSync(file, 'a');
      try {
        hooks.afterRead?.(attempt);
        if (fs.fstatSync(fd).size !== bytes) continue; // файл змінили після читання — перечитати
        fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
        fs.fsyncSync(fd);
        return { ok: true, duplicate: false, entry };
      } finally {
        fs.closeSync(fd);
      }
    }
    throw new TaskEventsError('events-busy');
  });
}
