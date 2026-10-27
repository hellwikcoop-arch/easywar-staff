// T-0010: стабілізація J4 Bridge після T-0009 — F-T9-19…23 (F-T9-21 лише опис) і DOC-1.
// Лише синтетичні дані, жодного виклику адаптера J4 (dispatch_attempt == 0 у кожному тесті): сценарії не проходять через
// router.process(). Сховище штабу для CLI — копія в тимчасовому каталозі (J4_STAFF_ROOT).
// Нові перевірки випробувано мутаціями (reports/T-0010/mutants.yaml); тести п. F-T9-23 описують вже наявну поведінку
// (на старому коді вони проходять), крім `ledger-changed-during-read`, який потребує хука afterVerify.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { BRIDGE_DIR } from '../src/policy.mjs';
import { readTaskEvents } from '../src/events.mjs';
import * as closeMod from '../src/close.mjs';
import { Store } from '../src/store.mjs';
import { Ledger } from '../src/ledger.mjs';
import { canonical, sha256 } from '../src/protocol.mjs';
import { tmpStaff, SHA_A, SHA_B } from './helpers.mjs';

const { closeTask, readLedgerStrict } = closeMod;
const CLI = path.join(BRIDGE_DIR, 'bin', 'j4.mjs');
const T = 'T-0900';
const CMD = "node --test 'bridge/test/*.test.mjs'";
const NOT = ['checks-not-on-subject-or-failed'];

const taskEvents = (root) => readTaskEvents(root, T).entries;
const stateChanged = (root) => taskEvents(root).filter((e) => e.event === 'state_changed');
const addEvent = (root, e) => fs.appendFileSync(path.join(root, 'tasks', T, 'events.jsonl'), `${JSON.stringify({ task_id: T, ...e })}\n`);

function writeOrder(root, { verify = null } = {}) {
  fs.writeFileSync(path.join(root, 'tasks', T, 'order.yaml'), [
    `id: ${T}`, 'data_class: synthetic', 'acceptance: {technical: J3, content: J5, key_decision: false}',
    'checks:', '  subject_kind: commit', ...(verify === null ? [] : [`  verify: ${JSON.stringify(verify)}`]), '  review_kind: code', '',
  ].join('\n'));
}

function fullAcceptance(root, subject = SHA_A) {
  addEvent(root, { event: 'review_finished', by: 'C3', subject, review_status: 'complete', verdict: 'passed', ref: 'r' });
  addEvent(root, { event: 'acceptance', by: 'J3', role: 'technical', subject, result: 'accepted', ref: 'a' });
  addEvent(root, { event: 'acceptance', by: 'J5', role: 'content', subject, result: 'accepted', ref: 'b' });
}

function writeEvidence(root, text = `checks: {subject: ${SHA_A}, result: pass}\n`) {
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'checks.yaml'), text);
  return 'reports/checks.yaml';
}

function cliEnv(root, extra = {}) {
  const env = { ...process.env, J4_STAFF_ROOT: root, J4_HOME: path.join(root, '.j4'), J4_LEDGER: path.join(root, 'ledger.jsonl'), J4_MONTHLY_BUDGET: path.join(root, 'monthly.json'), ...extra };
  for (const k of ['J4_HALT', 'J4_ALLOW_LIVE', 'J4_APPROVAL', 'J4_TASK_EVENTS']) if (!(k in extra)) delete env[k];
  return env;
}

function cli(root, args, extra) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: cliEnv(root, extra), encoding: 'utf8', timeout: 60000 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, json, stderr: r.stderr };
}

// Справжні сховище й журнал J4 у тимчасовому сховищі штабу; ledger має кілька записів, щоб було що псувати.
function base({ entries = 3 } = {}) {
  const root = tmpStaff();
  writeOrder(root);
  const ref = writeEvidence(root);
  fullAcceptance(root);
  new Store(path.join(root, '.j4'));
  const led = new Ledger(path.join(root, 'ledger.jsonl'));
  for (let n = 1; n <= entries; n += 1) led.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } });
  return { root, ref, args: ['close', '--task', T, '--subject', SHA_A, '--checks-ref', ref], ledger: path.join(root, 'ledger.jsonl'), home: path.join(root, '.j4'), led };
}

const src = (root) => ({ store: new Store(path.join(root, '.j4')), ledgerEntries: new Ledger(path.join(root, 'ledger.jsonl')).readAll().entries });

// Знімок дерева: шлях, тип і sha256 вмісту. Порівняння до/після показує, що нічого не створено й не змінено.
function tree(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) {
        out.push(`d ${rel}`);
        walk(p);
      } else {
        out.push(`f ${rel} ${st.size} ${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);
      }
    }
  };
  walk(dir);
  return out;
}

const fileHash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const noDispatch = (t) => assert.equal(fs.readFileSync(t.ledger, 'utf8').split('\n').filter((l) => l.includes('"dispatch_attempt"')).length, 0, 'жодного виклику адаптера');

// ---------- A. F-T9-19: помилки читання не ховаються ----------

test('T-0010 A1: Store.list не ковтає помилки читання; відсутня тека — порожній список', () => {
  const t = base();
  const store = new Store(t.home);
  assert.deepEqual(store.list('no-such-dir'), [], 'відсутня тека — це порожньо');
  assert.deepEqual(store.list('escalations'), []);
  // тека escalations підмінена файлом: раніше list() повертав [] і ескалації «зникали»
  fs.rmSync(path.join(t.home, 'escalations'), { recursive: true });
  fs.writeFileSync(path.join(t.home, 'escalations'), 'це файл');
  assert.throws(() => store.list('escalations'), (e) => e.code === 'ENOTDIR');
  // і сама тека-«кільце» (ELOOP) — не порожньо
  fs.rmSync(path.join(t.home, 'escalations'));
  fs.symlinkSync(path.join(t.home, 'escalations'), path.join(t.home, 'escalations'));
  assert.throws(() => store.list('escalations'), (e) => e.code === 'ELOOP');
});

test('T-0010 A2: inspectJ4Home розрізняє «не сховище» і «нечитне сховище» (F-T9-19)', () => {
  const inspect = closeMod.inspectJ4Home;
  assert.equal(typeof inspect, 'function', 'inspectJ4Home експортується з close.mjs');
  const t = base();
  assert.deepEqual(inspect(t.home), { ok: true });
  assert.deepEqual(inspect(path.join(t.root, 'ghost')), { ok: false, reason: 'home-not-j4-store' });
  const plain = path.join(t.root, 'plain');
  fs.mkdirSync(plain);
  assert.deepEqual(inspect(plain), { ok: false, reason: 'home-not-j4-store' });
  const asFile = path.join(t.root, 'esc-file');
  fs.mkdirSync(asFile);
  fs.writeFileSync(path.join(asFile, 'escalations'), 'файл');
  assert.deepEqual(inspect(asFile), { ok: false, reason: 'home-not-j4-store' });
  // тека є, але вміст не читається (EACCES): зсередини root цього не відтворити, тому через підставну fs
  const real = fs;
  const denied = { statSync: (p) => real.statSync(p), readdirSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
  assert.deepEqual(inspect(t.home, denied), { ok: false, reason: 'home-unreadable' });
  // stat падає не через «немає такого»: ELOOP — теж нечитне, а не «не сховище»
  const loop = path.join(t.root, 'loop-home');
  fs.mkdirSync(loop);
  fs.symlinkSync(path.join(loop, 'escalations'), path.join(loop, 'escalations'));
  assert.deepEqual(inspect(loop), { ok: false, reason: 'home-unreadable' });
});

test('T-0010 A3: closeTask не падає винятком, коли сховище J4 нечитне, а відмовляє (escalation-source-unreadable)', () => {
  const t = base();
  const ledgerEntries = new Ledger(t.ledger).readAll().entries;
  const throwing = { list: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); }, readJson: () => null };
  const r = closeTask({ staffRoot: t.root, taskId: T, subject: SHA_A, checksRef: t.ref, store: throwing, ledgerEntries });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'escalation-source-unreadable');
  assert.deepEqual(r.missing, ['store-unreadable']);
  assert.equal(stateChanged(t.root).length, 0);
  // файл ескалації зіпсовано: чужа/нечитна ескалація не може бути «порожньо»
  fs.writeFileSync(path.join(t.home, 'escalations', 'E-X.json'), '{не json');
  const r2 = closeTask({ staffRoot: t.root, taskId: T, subject: SHA_A, checksRef: t.ref, ...src(t.root) });
  assert.equal(r2.code, 'escalation-source-unreadable');
  assert.deepEqual(r2.missing, ['store-unreadable']);
  // CLI: те саме — код 3 і ні done, ні виклику адаптера
  const c = cli(t.root, t.args);
  assert.equal(c.code, 3, c.stderr);
  assert.equal(c.json.code, 'escalation-source-unreadable');
  assert.deepEqual(c.json.missing, ['store-unreadable']);
  assert.equal(stateChanged(t.root).length, 0);
  noDispatch(t);
});

test('T-0010 A4: J4_HOME без читного вмісту (не root) — CLI відмовляє home-unreadable', (ctx) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    ctx.skip('root читає будь-яку теку; випадок покрито A2 через підставну fs');
    return;
  }
  const t = base();
  fs.chmodSync(path.join(t.home, 'escalations'), 0o000);
  try {
    const c = cli(t.root, t.args);
    assert.equal(c.code, 3, c.stderr);
    assert.equal(c.json.code, 'escalation-source-unreadable');
    assert.deepEqual(c.json.missing, ['home-unreadable']);
    assert.equal(stateChanged(t.root).length, 0);
  } finally {
    fs.chmodSync(path.join(t.home, 'escalations'), 0o700);
  }
});

// ---------- B. F-T9-20: close відкриває сховище лише на читання ----------

test('T-0010 B1: Store.open — лише читання: нічого не створює, запис і замок відхиляє', () => {
  assert.equal(typeof Store.open, 'function', 'Store.open є');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-ro-'));
  fs.mkdirSync(path.join(dir, 'escalations'));
  fs.writeFileSync(path.join(dir, 'escalations', 'E-1.json'), JSON.stringify({ escalation_id: 'E-1', task_id: T, status: 'open' }));
  const before = tree(dir);
  const ro = Store.open(dir);
  assert.deepEqual(ro.list('escalations'), ['E-1.json']);
  assert.equal(ro.readJson('escalations/E-1.json').status, 'open');
  assert.equal(ro.readJson('escalations/none.json'), null);
  assert.deepEqual(ro.list('queue'), [], 'відсутня підтека — порожньо, але не створюється');
  for (const attempt of [
    () => ro.writeJson('escalations/E-2.json', {}),
    () => ro.remove('escalations/E-1.json'),
    () => ro.acquireLock(1000),
    () => ro.releaseLock(),
    () => ro.locked('x', () => 1),
  ]) assert.throws(attempt, (e) => e.code === 'store-read-only');
  assert.deepEqual(tree(dir), before, 'дерево не змінилося');
  // звичайний конструктор, як і раніше, створює підтеки
  const rw = new Store(path.join(dir, 'rw'));
  assert.equal(fs.existsSync(path.join(rw.home, 'queue')), true);
});

test('T-0010 B2: j4 close не створює і не змінює жодного файла в J4_HOME (чужа тека, повний домашній каталог, повтор, відмова)', () => {
  // чужа тека лише з підтекою escalations: раніше new Store створював ще 6 підтек
  const t = base();
  const alien = path.join(t.root, 'alien-home');
  fs.mkdirSync(path.join(alien, 'escalations'), { recursive: true });
  const beforeAlien = tree(alien);
  const r = cli(t.root, t.args, { J4_HOME: alien });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.entry.state, 'done');
  assert.deepEqual(tree(alien), beforeAlien, 'у чужій теці нічого не створено');

  // справжній J4_HOME: успішний close, повтор (already) і відмова не змінюють дерева
  const t2 = base();
  const before2 = tree(t2.home);
  const ok = cli(t2.root, t2.args);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(tree(t2.home), before2);
  const again = cli(t2.root, t2.args);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.json.already, true);
  assert.deepEqual(tree(t2.home), before2);

  const t3 = base();
  const before3 = tree(t3.home);
  const refused = cli(t3.root, ['close', '--task', T, '--subject', SHA_A, '--checks-ref', 'reports/none.yaml']);
  assert.equal(refused.code, 3);
  assert.deepEqual(tree(t3.home), before3);
  noDispatch(t3);
});

// ---------- C. F-T9-22: суворий розбір запису доказу ----------

function evidenceResult(text, { verify = [CMD], subject = SHA_A } = {}) {
  const root = tmpStaff();
  fullAcceptance(root);
  writeOrder(root, { verify });
  const ref = writeEvidence(root, text);
  return closeTask({ staffRoot: root, taskId: T, subject, checksRef: ref, ...src(root) });
}

const rec = (result, extra = '') => `- {cmd: "${CMD}", subject: ${SHA_A}, result: "${result}"${extra}}\n`;

test('T-0010 C1: F-T9-22 — форми, що раніше проходили евристику, більше не є доказом перевірок', () => {
  const bad = {
    'SHA лише в note': `- {cmd: "${CMD}", note: "${SHA_A}", result: "76/76 pass"}\n`,
    'SHA у рядку без поля subject': `note: ${SHA_A} result: pass\n`,
    'cmd в одинарних лапках зі SHA': `- {cmd: 'echo ${SHA_A}', result: pass}\n`,
    'рядок-коментар із доказом': `# ${rec('76/76 pass')}`,
    'never passed': rec('never passed'),
    'pass: false': rec('pass: false'),
    '0 of 76 pass': rec('0 of 76 pass'),
    '75/76 pass без слова fail': rec('75/76 pass'),
    'pass 0 fail 0': rec('pass 0 fail 0'),
    'subject в іншому ключі': `- {cmd: "${CMD}", target: ${SHA_A}, result: "76/76 pass"}\n`,
    'подвоєний subject': `- {cmd: "${CMD}", subject: ${SHA_B}, subject: ${SHA_A}, result: "76/76 pass"}\n`,
    'сторонній ключ статусу': rec('76/76 pass', ', status: failed'),
    'ключ fail': `- {fail: 3, cmd: "${CMD}", subject: ${SHA_A}, result: pass}\n`,
    'текст після запису': `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass"} ще щось\n`,
    'кома в кінці': `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass",}\n`,
    'незакриті лапки': `- {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 pass}\n`,
    'вкладений список': `- {cmd: "${CMD}", subject: ${SHA_A}, result: [pass]}\n`,
    'блокова форма': `subject: ${SHA_A}\nresult: pass\n`,
    'subject — не повний SHA': `- {cmd: "${CMD}", subject: ${SHA_A.slice(0, 12)}, result: "76/76 pass"}\n`,
    'subject іншого коміту': `- {cmd: "${CMD}", subject: ${SHA_B}, result: "76/76 pass"}\n`,
    'є fail': rec('75/76 pass, 1 fail'),
    'not passed': rec('not passed'),
    '0 passed': rec('0 passed'),
    '0/76 pass': rec('0/76 pass'),
    '0/0 pass': rec('0/0 pass'),
    '076/76 pass': rec('076/76 pass'),
    'pass: 0': rec('pass: 0'),
    'tests 0 pass 0 fail 0': rec('tests 0 pass 0 fail 0'),
    'pass і error': rec('pass, error 2'),
    'pass, not ok': rec('pass, not ok 3'),
    'pass, never': rec('pass, never completed'),
    'pass, ok: false': rec('pass, ok: false'),
    'двокрапка в простому скалярі': rec('76/76 pass', ', by: J3: x'),
    'аліас YAML у значенні': rec('76/76 pass', ', by: *x'),
    'cmd відсутній, а verify є': `- {subject: ${SHA_A}, result: "76/76 pass"}\n`,
    'інша команда': `- {cmd: "інша команда", subject: ${SHA_A}, result: "76/76 pass"}\n`,
    'команда лише в note': `- {note: "${CMD}", subject: ${SHA_A}, result: "76/76 pass"}\n`,
  };
  for (const [name, text] of Object.entries(bad)) {
    const r = evidenceResult(text, { verify: name === 'cmd в одинарних лапках зі SHA' ? [] : [CMD] });
    assert.equal(r.ok, false, name);
    assert.deepEqual(r.missing, NOT, name);
  }
});

test('T-0010 C2: F-T9-22 — справжні форми запису (reports/T-0007…T-0009) і прості форми приймаються', () => {
  const good = {
    'формат reports/T-0009/003.yaml': `  - {cmd: "${CMD}", subject: ${SHA_A}, result: "93/93 pass, fail 0 (68 базових + 8 T-0007 + 17 T-0009)", by: J3, calls: "44 dispatch + 4 прямих (derived)"}\n`,
    'лічильник dispatch': rec('16/16 pass, fail 0; лічильник dispatch 0', ', by: J3, calls: 0'),
    'subject у лапках': `- {cmd: "${CMD}", subject: "${SHA_A}", result: "76/76 pass"}\n`,
    'одинарні лапки': `- {cmd: '${CMD.replace(/'/g, "''")}', subject: '${SHA_A}', result: 'Passed'}\n`,
    'коментар після запису': `${rec('76/76 pass').trimEnd()} # прогін J3\n`,
    'відступ і CRLF': `    - {cmd: "${CMD}", subject: ${SHA_A}, result: "76/76 PASS"}\r\n`,
    'cmd довший за verify': `- {cmd: "${CMD} --test-name-pattern failover", subject: ${SHA_A}, result: "76/76 pass"}\n`,
    'збій раніше й успіх пізніше': `${rec('75/76 pass, 1 fail')}${rec('76/76 pass')}`,
    'порожні рядки між записами': `\n${rec('76/76 pass')}\n`,
  };
  for (const [name, text] of Object.entries(good)) {
    const r = evidenceResult(text);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
  }
  // прості форми без cmd — коли наказ не вимагає verify
  assert.equal(evidenceResult(`{subject: ${SHA_A}, result: pass}\n`, { verify: null }).ok, true);
  assert.equal(evidenceResult(`checks: {subject: ${SHA_A}, result: pass}\n`, { verify: [] }).ok, true);
  // команда зі знаком # усередині лапок — це команда, а не коментар
  assert.equal(evidenceResult(`- {cmd: "echo B # x", subject: ${SHA_A}, result: pass}\n`, { verify: ['echo B # x'] }).ok, true);
  // доказ записується з sha256 файлу
  const root = tmpStaff();
  fullAcceptance(root);
  writeOrder(root, { verify: [CMD] });
  const text = rec('76/76 pass, fail 0', ', by: J3');
  const ref = writeEvidence(root, text);
  const r = closeTask({ staffRoot: root, taskId: T, subject: SHA_A, checksRef: ref, ...src(root) });
  assert.equal(r.ok, true);
  assert.equal(r.entry.evidence_sha256, createHash('sha256').update(text).digest('hex'));
});

// ---------- D. F-T9-23: прогалини тестів ----------

test('T-0010 D1: ledger-changed-during-read ловиться детерміновано (хук afterVerify між перевіркою і читанням)', () => {
  const mk = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-lrd-'));
    const file = path.join(dir, 'ledger.jsonl');
    const led = new Ledger(file);
    for (let n = 1; n <= 3; n += 1) led.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n } });
    return { file, led };
  };
  const changed = { ok: false, reason: 'ledger-changed-during-read' };
  // контроль: без зміни журнал читається, хук викликається рівно один раз
  const c = mk();
  let calls = 0;
  const ok = readLedgerStrict(c.file, { afterVerify: () => { calls += 1; } });
  assert.equal(ok.ok, true);
  assert.equal(ok.entries.length, 3);
  assert.equal(calls, 1, 'хук викликано рівно раз, між перевіркою і читанням');
  // (1) між перевіркою й читанням дописали запис
  const a = mk();
  assert.deepEqual(readLedgerStrict(a.file, { afterVerify: () => a.led.append({ event: 'late', at: '2026-10-27T00:00:01.000Z', detail: {} }) }), changed);
  // (2) файл спорожнено: голова збігається з початковою, відрізняється лише кількість
  const b = mk();
  assert.deepEqual(readLedgerStrict(b.file, { afterVerify: () => fs.writeFileSync(b.file, '') }), changed);
  // (3) та сама кількість записів, інша голова
  const d = mk();
  assert.deepEqual(readLedgerStrict(d.file, {
    afterVerify: () => {
      const lines = fs.readFileSync(d.file, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(d.file, `${lines.slice(0, 2).join('\n')}\n`);
      d.led.append({ event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { n: 99 } });
    },
  }), changed);
});

test('T-0010 D2: J4_HOME/escalations — файл; рядок `null` у журналі; витік у записі журналу: CLI відмовляє, нічого не пише', () => {
  const refused = (t, reasonCode, missing, extra) => {
    const before = tree(t.home);
    const r = cli(t.root, t.args, extra);
    assert.equal(r.code, 3, `${missing}: ${r.stderr}`);
    assert.equal(r.json.code, reasonCode);
    assert.deepEqual(r.json.missing, [missing]);
    assert.equal(stateChanged(t.root).length, 0, `${missing}: done не записано`);
    assert.deepEqual(tree(t.home), before);
    noDispatch(t);
    return r;
  };
  // J4_HOME/escalations — звичайний файл
  const t1 = base();
  fs.rmSync(path.join(t1.home, 'escalations'), { recursive: true });
  fs.writeFileSync(path.join(t1.home, 'escalations'), 'це файл');
  refused(t1, 'escalation-source-unreadable', 'home-not-j4-store');

  // рядок JSON `null` посеред журналу — не падіння з TypeError, а відмова
  const t2 = base();
  const lines = fs.readFileSync(t2.ledger, 'utf8').split('\n');
  lines.splice(1, 0, 'null');
  fs.writeFileSync(t2.ledger, lines.join('\n'));
  refused(t2, 'escalation-source-unreadable', 'ledger-unreadable');

  // запис журналу з правильним ланцюгом хешів, але з витоком (синтетичний ключ, зібраний під час виконання)
  const t3 = base();
  const entries = new Ledger(t3.ledger).readAll().entries;
  const body = { event: 'test_entry', at: '2026-10-27T00:00:00.000Z', detail: { note: `${'AKIA'}${'ABCDEFGHIJKLMNOP'}` }, seq: entries.length + 1, prev: entries[entries.length - 1].hash };
  fs.appendFileSync(t3.ledger, `${JSON.stringify({ ...body, hash: sha256(canonical(body)) })}\n`);
  const r3 = refused(t3, 'escalation-source-unreadable', 'ledger-corrupt');
  assert.ok(r3.json.problems.includes('leak'), JSON.stringify(r3.json.problems));
});

// ---------- E. F-T9-21: повтор close після done (лише опис; поведінку не змінено) ----------

test('T-0010 E1: повтор close після done — already:true лише за читних джерел; інакше відмова без запису (характеризація)', () => {
  const t = base();
  const first = cli(t.root, t.args);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(stateChanged(t.root).length, 1);
  const eventsFile = path.join(t.root, 'tasks', T, 'events.jsonl');
  const frozen = fileHash(eventsFile);

  // джерела читні: повтор нічого не пише
  const again = cli(t.root, t.args);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.json.already, true);
  assert.equal(fileHash(eventsFile), frozen, 'events.jsonl не змінився');

  // журнал J4 нечитний: повтор також відмовляє — джерела перевіряються ДО done
  const lost = cli(t.root, t.args, { J4_LEDGER: path.join(t.root, 'no-such-ledger.jsonl') });
  assert.equal(lost.code, 3);
  assert.equal(lost.json.code, 'escalation-source-unreadable');
  assert.deepEqual(lost.json.missing, ['ledger-missing']);
  // сховище J4 нечитне — те саме
  const ghost = cli(t.root, t.args, { J4_HOME: path.join(t.root, 'ghost-home') });
  assert.equal(ghost.code, 3);
  assert.deepEqual(ghost.json.missing, ['home-not-j4-store']);
  // без явних джерел — escalation-source-unknown
  const none = cli(t.root, t.args, { J4_HOME: '', J4_LEDGER: '' });
  assert.equal(none.code, 3);
  assert.equal(none.json.code, 'escalation-source-unknown');
  assert.equal(fileHash(eventsFile), frozen, 'відмови теж нічого не пишуть');

  // бібліотека: без store/ledgerEntries навіть повтор після done відмовляє (джерела обов'язкові)
  assert.deepEqual(closeTask({ staffRoot: t.root, taskId: T, subject: SHA_A, checksRef: t.ref, ledgerEntries: [] }).missing, ['store']);
  // а з обома джерелами — already:true без запису
  const lib = closeTask({ staffRoot: t.root, taskId: T, subject: SHA_A, checksRef: t.ref, ...src(t.root) });
  assert.equal(lib.ok, true);
  assert.equal(lib.already, true);
  assert.equal(fileHash(eventsFile), frozen);
  noDispatch(t);
});
