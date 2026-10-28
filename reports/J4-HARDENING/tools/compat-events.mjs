// Порівняння бар'єра приймання (старий bridge → новий) на РЕАЛЬНИХ журналах tasks/*/events.jsonl (лише читання, 0 викликів адаптера).
// Виклик: node compat-events.mjs <oldBridge> <newBridge>  (два позиційні аргументи; C3H-16). T-0002/T-0004 додано за C3H-14.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const [,, oldBridge, newBridge] = process.argv;
if (!oldBridge || !newBridge) { console.error('usage: node compat-events.mjs <oldBridge> <newBridge>'); process.exit(2); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const o = await import(pathToFileURL(path.join(oldBridge, 'src', 'acceptance.mjs')));
const n = await import(pathToFileURL(path.join(newBridge, 'src', 'acceptance.mjs')));
const cases = [
  ['T-0002', null, false], ['T-0004', null, false],   // null — усі subject-и з повним SHA у журналі
  ['T-0006', '359178c7', false], ['T-0006', '1144aea3', false], ['T-0007', '071bf148', false],
  ['T-0009', '67eb3310db5f69f2451ce748d72722c614409425', false], ['T-0010', '96ff45a2feafcf0964eda290a2eacca52d3ab2e3', false],
];
import fs from 'node:fs';
for (const [task, pref] of cases) {
  const ev = JSON.parse('[' + fs.readFileSync(path.join(REPO, 'tasks', task, 'events.jsonl'), 'utf8').trim().split('\n').join(',') + ']');
  const subjects = [...new Set(ev.map((e) => e.subject).filter((s) => s && /^[0-9a-f]{40}$/.test(s)))];
  const picked = pref ? subjects.filter((s) => s.startsWith(pref)) : subjects;
  if (!picked.length) { console.log(`${task} —         subject-ів із повним SHA: 0 (${ev.filter((e) => e.event === 'acceptance' || e.event === 'review_finished').length} подій приймання/рецензії) — бар'єр не застосовний`); continue; }
  for (const subj of picked) {
    const run = (m) => { const e = m.evidenceFromEvents(REPO, task); const r = m.acceptanceReady({ subject: subj, checks: [{ subject: subj, passed: true, evidence_ref: 'x' }], reviews: e.reviews, acceptances: e.acceptances }); return r.ready ? 'ready' : `not-ready[${r.missing.join(',')}]`; };
    console.log(`${task} ${subj.slice(0, 8)}  old: ${run(o)}\n${' '.repeat(17)}new: ${run(n)}`);
  }
}
