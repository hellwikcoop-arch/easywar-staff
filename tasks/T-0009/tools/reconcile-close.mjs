#!/usr/bin/env node
// Лише читання. Звіряє канонічну пару J4 (J4_HOME + J4_LEDGER) і журнал завдання перед будь-якою дією закриття
// (JE-T9-04 D-7/D-8; tasks/T-0009/runbook-close.md). Нічого не пише, не синхронізує, не запускає j4 close.
// Не є частиною bridge/ і не охоплений рецензією C3; перевірений лише синтетичними даними (reconcile-close.test.mjs).
//
// Використання:
//   node tasks/T-0009/tools/reconcile-close.mjs --print-fingerprint --ledger <J4_LEDGER>
//   node tasks/T-0009/tools/reconcile-close.mjs --task T-XXXX --home <J4_HOME> --ledger <J4_LEDGER> \
//        --events tasks/T-XXXX/events.jsonl --expect-first <sha256> --expect-head-seq <N> --expect-head-hash <sha256>
// Коди виходу: 0 — розбіжностей немає; 3 — СТОП (причини в stop[]); 2 — помилка виклику.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifyLedger } from '../../../bridge/src/ledger.mjs';

const SHA = /^[0-9a-f]{64}$/;
const TASK = /^T-\d{4}$/;

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function fingerprint(ledgerFile) {
  if (!isFile(ledgerFile)) return { ok: false, stop: ['ledger-missing'] };
  const v = verifyLedger(ledgerFile);
  if (!v.ok) return { ok: false, stop: ['ledger-corrupt'], problems: v.problems.map((p) => p.code) };
  const entries = readLines(ledgerFile);
  const head = entries[entries.length - 1] ?? null;
  return { ok: true, entries: entries.length, first_hash: entries[0]?.hash ?? null, head_seq: head?.seq ?? null, head_hash: head?.hash ?? null };
}

export function reconcile({ task, home, ledgerFile, eventsFile, expect = {} }) {
  const stop = [];
  const facts = {};
  const add = (code) => {
    if (!stop.includes(code)) stop.push(code);
  };
  if (!TASK.test(task ?? '')) return { ok: false, stop: ['task-invalid'], facts };
  if (!home || !ledgerFile || !eventsFile) return { ok: false, stop: ['paths-missing'], facts };
  // Без записаних очікувань звірка неможлива: порожнє значення не може дати «ok» (F-T9-18).
  if (!SHA.test(expect.first ?? '') || !Number.isInteger(expect.headSeq) || expect.headSeq < 1 || !SHA.test(expect.headHash ?? '')) {
    return { ok: false, stop: ['expectations-missing'], facts };
  }

  const fp = fingerprint(ledgerFile);
  if (!fp.ok) return { ok: false, stop: fp.stop, facts: { problems: fp.problems ?? [] } };
  Object.assign(facts, { ledger_entries: fp.entries, first_hash: fp.first_hash, head_seq: fp.head_seq, head_hash: fp.head_hash });
  const entries = readLines(ledgerFile);

  if (fp.first_hash !== expect.first) add('ledger-identity-mismatch');
  const atSeq = entries[expect.headSeq - 1];
  if (!atSeq || atSeq.hash !== expect.headHash) add('ledger-head-mismatch');
  facts.head_advanced = fp.head_seq !== null && fp.head_seq > expect.headSeq;

  const raised = new Map();
  const resolved = new Set();
  for (const x of entries) {
    const t = x.task_id ?? x.detail?.task_id ?? null;
    if (t !== task) continue;
    if (x.event === 'escalation_raised') raised.set(x.detail?.escalation_id, x.seq);
    if (x.event === 'escalation_resolved') resolved.add(x.detail?.escalation_id);
  }

  const escDir = path.join(home, 'escalations');
  let storeOpen = [];
  try {
    if (!fs.statSync(escDir).isDirectory()) throw new Error('not-dir');
    for (const f of fs.readdirSync(escDir).filter((n) => n.endsWith('.json'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(escDir, f), 'utf8'));
      if (rec.task_id === task && rec.status === 'open') storeOpen.push(rec.escalation_id ?? path.basename(f, '.json'));
    }
  } catch (e) {
    storeOpen = [];
    add(e instanceof SyntaxError || e.code === 'EACCES' ? 'store-unreadable' : 'home-not-j4-store');
  }

  let journalIds = new Set();
  if (!isFile(eventsFile)) add('events-missing');
  else {
    try {
      journalIds = new Set(readLines(eventsFile).filter((e) => e.event === 'escalation').map((e) => e.escalation_id));
    } catch {
      add('events-unreadable');
    }
  }

  const openLedger = [...raised.keys()].filter((id) => !resolved.has(id));
  const openAll = [...new Set([...openLedger, ...storeOpen])];
  facts.open_escalations = openAll;
  facts.unsynced_open = openAll.filter((id) => !journalIds.has(id));
  facts.journal_escalations = [...journalIds];

  if (openAll.length) add('open-escalation');
  if ([...journalIds].some((id) => !raised.has(id))) add('journal-escalation-unknown-to-ledger');
  if (storeOpen.some((id) => !raised.has(id))) add('store-ledger-mismatch');
  return { ok: stop.length === 0, stop, facts };
}

function main() {
  let o;
  try {
    ({ values: o } = parseArgs({
      options: {
        task: { type: 'string' }, home: { type: 'string' }, ledger: { type: 'string' }, events: { type: 'string' },
        'expect-first': { type: 'string' }, 'expect-head-seq': { type: 'string' }, 'expect-head-hash': { type: 'string' },
        'print-fingerprint': { type: 'boolean', default: false },
      },
    }));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  if (o['print-fingerprint']) {
    if (!o.ledger) {
      process.stderr.write('потрібен --ledger\n');
      process.exit(2);
    }
    const r = fingerprint(path.resolve(o.ledger));
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exit(r.ok ? 0 : 3);
  }
  const headSeq = o['expect-head-seq'] === undefined ? NaN : Number(o['expect-head-seq']);
  const r = reconcile({
    task: o.task,
    home: o.home ? path.resolve(o.home) : null,
    ledgerFile: o.ledger ? path.resolve(o.ledger) : null,
    eventsFile: o.events ? path.resolve(o.events) : null,
    expect: { first: o['expect-first'], headSeq, headHash: o['expect-head-hash'] },
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
  process.exit(r.ok ? 0 : 3);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
