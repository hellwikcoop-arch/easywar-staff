import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [,, oldBridge, newBridge] = process.argv;
const REPO = '/home/user/easywar-staff';
const o = await import(pathToFileURL(path.join(oldBridge, 'src', 'acceptance.mjs')));
const n = await import(pathToFileURL(path.join(newBridge, 'src', 'acceptance.mjs')));
const cases = [
  ['T-0006', '359178c7', false], ['T-0006', '1144aea3', false], ['T-0007', '071bf148', false],
  ['T-0009', '67eb3310db5f69f2451ce748d72722c614409425', false], ['T-0010', '96ff45a2feafcf0964eda290a2eacca52d3ab2e3', false],
];
import fs from 'node:fs';
for (const [task, pref] of cases) {
  const ev = JSON.parse('[' + fs.readFileSync(path.join(REPO, 'tasks', task, 'events.jsonl'), 'utf8').trim().split('\n').join(',') + ']');
  const subj = [...new Set(ev.map((e) => e.subject).filter((s) => s && s.startsWith(pref)))][0];
  const run = (m) => { const e = m.evidenceFromEvents(REPO, task); const r = m.acceptanceReady({ subject: subj, checks: [{ subject: subj, passed: true, evidence_ref: 'x' }], reviews: e.reviews, acceptances: e.acceptances }); return r.ready ? 'ready' : `not-ready[${r.missing.join(',')}]`; };
  console.log(`${task} ${subj.slice(0, 8)}  old: ${run(o)}\n${' '.repeat(17)}new: ${run(n)}`);
}
