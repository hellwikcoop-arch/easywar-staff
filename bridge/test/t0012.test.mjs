// T-0012: бар'єр приймання без значень за замовчуванням (F-T9-16), межі приймання (SCOPE-1, варіант B + scope-contradictory),
// бар'єр доказів (R-11 / F-T10-11), теги/якорі перед блоковим скаляром (R-10 / F-T10-10), порожній рядок у блоці (R-12 / F-T10-12).
// Тести написані ДО змін (наказ JE 2026-10-28, tasks/T-0012): на базі 0f2cd0b (bridge/ == 96ff45a) червоні — дефекти підтверджені;
// після реалізації — зелені. Сховище штабу — тимчасова синтетична тека з задачею T-0900; адаптер не викликається (dispatch_attempt 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTask } from '../src/close.mjs';
import { acceptanceReady, evidenceFromEvents } from '../src/acceptance.mjs';
import { Store } from '../src/store.mjs';
import { Ledger } from '../src/ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONTRACT = path.join(REPO, 'CONTRACT_v0_4.md');

const T = 'T-0900';
const SHA_A = 'a'.repeat(40);
const CMD = "node --test 'bridge/test/*.test.mjs'";
const CMD2 = 'node script/check.mjs';

function staff(verify = [CMD]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-t0012-'));
  fs.copyFileSync(CONTRACT, path.join(root, 'CONTRACT_v0_4.md'));
  fs.mkdirSync(path.join(root, 'tasks', T), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ seq: 1, event: 'task_accepted', task_id: T, by: 'J3' })}\n`);
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), ['id: T-0900', 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}', 'checks:', '  subject_kind: commit', `  verify: ${JSON.stringify(verify)}`, '  review_kind: code', ''].join('\n'));
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  new Store(path.join(root, '.j4'));
  new Ledger(path.join(root, 'ledger.jsonl')).append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 1 } });
  return root;
}
const add = (root, e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);
const rec = (result, cmd = CMD) => `- {cmd: ${JSON.stringify(cmd)}, subject: ${SHA_A}, result: ${JSON.stringify(result)}}\n`;
const evidence = (root, text) => { fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), text); return 'reports/checks.yaml'; };
const review = (root, extra = {}) => add(root, { event: 'review_finished', by: 'C3', subject: SHA_A, review_status: 'complete', verdict: 'passed', ref: 'r', ...extra });
const accept = (root, by, role, extra = {}) => add(root, { event: 'acceptance', by, role, subject: SHA_A, result: 'accepted', scope: 'full', ref: `a-${by}`, ...extra });
const full = (root) => { review(root); accept(root, 'J3', 'technical'); accept(root, 'J5', 'content'); };
const src = (root) => ({ store: Store.open(path.join(root, '.j4')), ledgerEntries: new Ledger(path.join(root, 'ledger.jsonl')).readAll().entries });
const close = (root, ref) => closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, ...src(root) });
const barrier = (root) => { const ev = evidenceFromEvents(root, T); return acceptanceReady({ subject: SHA_A, checks: [{ subject: SHA_A, passed: true, evidence_ref: 'x' }], reviews: ev.reviews, acceptances: ev.acceptances }); };
const events = (root) => fs.readFileSync(path.join(root, 'tasks', T, 'events.jsonl'), 'utf8');
// C3H-10: відмова = ok:false, код, причина І незмінний журнал задачі (done не записано)
const refusedWith = (r, reason, root = null, before = null) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, 'barrier-not-passed'); assert.ok(r.missing.some((m) => m === reason || m.startsWith(reason)), `очікувано ${reason} у ${JSON.stringify(r.missing)}`); if (root) assert.equal(events(root), before, 'events.jsonl не мав змінитися'); };
const closeRefused = (root, ref, reason) => { const before = events(root); refusedWith(close(root, ref), reason, root, before); };

// ---- F-T9-16: без значень за замовчуванням ----
test('T-0012 F16-1: review_finished + passed без review_status → review-C3-incomplete', () => { const r = staff(); review(r, { review_status: undefined }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); const b = barrier(r); assert.equal(b.ready, false); assert.deepEqual(b.missing, ['review-C3-incomplete']); });
test('T-0012 F16-2: review_status: null явно → incomplete', () => { const r = staff(); review(r, { review_status: null }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); assert.deepEqual(barrier(r).missing, ['review-C3-incomplete']); });
test('T-0012 F16-3: review_status: partial → incomplete (як і раніше не зараховано)', () => { const r = staff(); review(r, { review_status: 'partial' }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); assert.equal(barrier(r).ready, false); });
test('T-0012 F16-4: complete + passed + ref → зараховано (контроль)', () => { const r = staff(); full(r); assert.deepEqual(barrier(r), { ready: true, missing: [] }); });
test('T-0012 F16-5: complete + passed без ref → not-passed', () => { const r = staff(); review(r, { ref: undefined }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content'); assert.deepEqual(barrier(r).missing, ['review-C3-not-passed']); });
test('T-0012 F16-6: acceptance без result → not-accepted', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: undefined }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-not-accepted']); });
test('T-0012 F16-7: acceptance result: null → not-accepted', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: null }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-not-accepted']); });
test('T-0012 F16-8: accepted_with_restrictions (T-0006 seq 12) → not-accepted (без змін)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { result: 'accepted_with_restrictions' }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-not-accepted']); });

// ---- SCOPE-1, варіант B: scope: full обов'язковий ----
test('T-0012 SC1-0: acceptance без scope (форма T-0005…T-0010) → scope-not-full', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: undefined }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-scope-not-full']); });
test('T-0012 SC1-1: scope: limited + limits → scope-not-full', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: 'limited', limits: ['C не прийнято'] }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-scope-not-full']); });
test('T-0012 SC1-2: scope як масив, число, Full з великої → не full', () => { for (const scope of [['full'], 42, 'Full', null]) { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-scope-not-full'], JSON.stringify(scope)); } });
test('T-0012 SC1-3: scope: full у review_finished не замінює scope у acceptance', () => { const r = staff(); review(r, { scope: 'full' }); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: undefined }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-scope-not-full']); });
test('T-0012 SC1-4: пізніший повний прийом після обмеженого відкриває бар\'єр; зворотний порядок — закриває (F-1)', () => {
  const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { scope: 'limited' }); assert.equal(barrier(r).ready, false);
  accept(r, 'J5', 'content'); assert.equal(barrier(r).ready, true);
  accept(r, 'J5', 'content', { scope: 'limited', limits: ['C'] }); assert.equal(barrier(r).ready, false);
});
test('T-0012 SC1-6: scope: full із непорожнім limits — суперечливий запис → scope-contradictory (C3H-2, рішення G2)', () => { const r = staff(); review(r); accept(r, 'J3', 'technical'); accept(r, 'J5', 'content', { limits: ['C не прийнято'] }); assert.deepEqual(barrier(r).missing, ['acceptance-J5-content-scope-contradictory']); });
test('T-0012 SC1-5: обидві ролі й JE (key_decision) потребують scope: full', () => { const r = staff(); full(r); add(r, { event: 'acceptance', by: 'JE', role: 'key_decision', subject: SHA_A, result: 'accepted', ref: 'je' }); const ev = evidenceFromEvents(r, T); const b = acceptanceReady({ subject: SHA_A, checks: [{ subject: SHA_A, passed: true, evidence_ref: 'x' }], reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: true }); assert.deepEqual(b.missing, ['acceptance-JE-key_decision-scope-not-full']); });

// ---- P1 / R-11: бар'єр доказів ----
test('T-0012 R11-1: успіх, далі збій варіантною cmd (прапорець) → відмова з причиною', () => { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', `${CMD} --test-name-pattern x`)), `evidence-latest-failed:${CMD}`); });
test('T-0012 R11-2: успіх, далі збій cmd з пробілом наприкінці → відмова', () => { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', `${CMD} `)), 'evidence-latest-failed:'); });
test('T-0012 R11-3: успіх, далі збій без cmd → відмова (запис без cmd стосується всіх вимог)', () => { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + `- {subject: ${SHA_A}, result: "75/76 pass, 1 fail"}\n`), `evidence-latest-without-cmd:${CMD}`); });
test('T-0012 R11-4: збій, далі успіх тієї ж cmd (повтор) → done (контроль)', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, rec('75/76 pass, 1 fail') + rec('76/76 pass'))).ok, true); });
test('T-0012 R11-5: збій іншої команди, не з verify → done (контроль)', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, rec('76/76 pass') + rec('0/3 pass, 3 fail', CMD2))).ok, true); });
test('T-0012 R11-6: успіх варіантною, далі збій базовою → відмова', () => { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass', `${CMD} --x`) + rec('75/76 pass, 1 fail')), 'evidence-latest-failed:'); });
test('T-0012 R11-7: успіх, далі збій із cmd: "" або cmd лише з пробілів → відмова (порожній після trim = відсутній; C3H-1)', () => { for (const c of ['', '   ', '\t']) { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', c)), 'evidence-latest-without-cmd:'); } });
test('T-0012 R11-13: без verify єдиний запис без cmd із pass не є доказом (C3H-8)', () => { const r = staff([]); full(r); closeRefused(r, evidence(r, `- {subject: ${SHA_A}, result: "76/76 pass"}\n`), 'evidence-no-cmd-record'); });
test('T-0012 R11-14 (залишок, характеризація C3H-1): збій cmd в інших лапках — «інша команда», успіх лишається → done', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, rec('76/76 pass') + rec('75/76 pass, 1 fail', 'node --test "bridge/test/*.test.mjs"'))).ok, true); });
test('T-0012 R11-15 (C3H-19): успіх, далі запис із нерозпізнаним result («unknown») → трактується як збій, відмова', () => { const r = staff(); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + rec('unknown — див. лог')), `evidence-latest-failed:${CMD}`); });
test('T-0012 R11-8: verify порожній — остання запис будь-якої команди провальний → відмова', () => { const r = staff([]); full(r); closeRefused(r, evidence(r, rec('76/76 pass') + rec('10/10 pass', CMD2) + rec('9/10 pass, 1 fail', CMD2)), `evidence-latest-failed:${CMD2}`); });
test('T-0012 R11-9: збій базовою, далі успіх варіантною, що містить вимогу → done (контроль)', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, rec('75/76 pass, 1 fail') + rec('76/76 pass', `${CMD} --test-reporter spec`))).ok, true); });
test('T-0012 R11-10: дві вимоги verify — друга провалена варіантною → відмова саме за другою; обидві пройшли → done', () => {
  const r = staff([CMD, CMD2]); full(r);
  closeRefused(r, evidence(r, rec('76/76 pass') + rec('3/3 pass', CMD2) + rec('2/3 pass, 1 fail', `${CMD2} --verbose`)), `evidence-latest-failed:${CMD2}`);
  const r2 = staff([CMD, CMD2]); full(r2); assert.equal(close(r2, evidence(r2, rec('76/76 pass') + rec('3/3 pass', CMD2))).ok, true);
});
test('T-0012 R11-11: вимога без жодного запису → evidence-missing', () => { const r = staff([CMD, CMD2]); full(r); closeRefused(r, evidence(r, rec('76/76 pass')), `evidence-missing:${CMD2}`); });
test('T-0012 R11-12: жодного запису на subject → evidence-no-record-on-subject', () => { const r = staff(); full(r); closeRefused(r, evidence(r, `- {cmd: "${CMD}", subject: ${'b'.repeat(40)}, result: "76/76 pass"}\n`), 'evidence-no-record-on-subject'); });

// ---- R-10: заголовок блокового скаляра з тегом або якорем ----
for (const [id, header] of [['R10-1', 'note: !!str |'], ['R10-2', 'note: &a |'], ['R10-3', 'note: !!str >-'], ['R10-4', 'note: |'], ['R10-5', '- !custom |2']]) {
  test(`T-0012 ${id}: «запис» усередині блоку «${header}» не є доказом`, () => { const r = staff(); full(r); closeRefused(r, evidence(r, `${header}\n  ${rec('76/76 pass').trim()}\n`), 'evidence-no-record-on-subject'); });
}
test('T-0012 R10-6: тег без індикатора блоку (note: !!str текст) блок не відкриває — наступний запис діє', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, `note: !!str текст\n${rec('76/76 pass')}`)).ok, true); });
test('T-0012 R10-8 (C3H-13, контроль): рядок `note: ->` відкриває «блок», але запис на тому ж відступі після нього діє', () => { const r = staff(); full(r); assert.equal(close(r, evidence(r, `note: ->\n${rec('76/76 pass')}`)).ok, true); });
test('T-0012 R10-7: тег у значенні запису ({note: !!str x}) → не доказ (без змін)', () => { const r = staff(); full(r); closeRefused(r, evidence(r, `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass", note: !!str x}\n`), 'evidence-no-record-on-subject'); });

// ---- R-12: порожній рядок усередині блоку ----
test('T-0012 R12-1: порожній рядок усередині блокового скаляра не закриває блок; запис після dedent — діє', () => {
  const r = staff(); full(r);
  closeRefused(r, evidence(r, `note: |\n  текст\n\n  ${rec('76/76 pass').trim()}\n`), 'evidence-no-record-on-subject');
  const r2 = staff(); full(r2); assert.equal(close(r2, evidence(r2, `note: |\n  текст\n\n${rec('76/76 pass')}`)).ok, true);
});

// ---- Зворотна сумісність ----
test('T-0012 COMPAT-1: задача з наявним done на subject → already до бар\'єра, старі acceptance без scope не заважають', () => {
  const r = staff(); review(r); accept(r, 'J3', 'technical', { scope: undefined }); accept(r, 'J5', 'content', { scope: undefined });
  add(r, { seq: 9, event: 'state_changed', state: 'done', by: 'ADM', subject: SHA_A, ref: 'reports/checks.yaml' });
  const res = close(r, evidence(r, rec('76/76 pass'))); assert.equal(res.ok, true); assert.equal(res.already, true);
});
test('T-0012 COMPAT-2: справжній файл доказів reports/T-0010/003.yaml розбирається як раніше (жодного evidence-* у missing)', () => {
  const real = path.join(REPO, 'reports', 'T-0010', '003.yaml');
  if (!fs.existsSync(real)) return;
  const r = staff(); fs.mkdirSync(path.join(r, 'reports', 'T-0010'), { recursive: true }); fs.copyFileSync(real, path.join(r, 'reports', 'T-0010', '003.yaml'));
  const res = closeTask({ staffRoot: r, taskId: T, subject: '96ff45a2feafcf0964eda290a2eacca52d3ab2e3', checksRef: 'reports/T-0010/003.yaml', ...src(r) });
  assert.equal(res.ok, false); // рецензій і приймань на цьому SHA у синтетичному журналі немає
  assert.ok(!res.missing.includes('checks-not-on-subject-or-failed') && !res.missing.some((m) => m.startsWith('evidence-')), JSON.stringify(res.missing));
});
