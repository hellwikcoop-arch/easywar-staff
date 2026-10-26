#!/usr/bin/env node
// CLI J4 Bridge v0.1. Приклади: bridge/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { J4 } from '../src/router.mjs';
import { loadConfig, BRIDGE_DIR } from '../src/policy.mjs';
import { verifyLedger, Ledger } from '../src/ledger.mjs';
import { sha256, PROTOCOL } from '../src/protocol.mjs';
import { stubAdapter } from '../src/adapters/stub.mjs';
import { MonthlyBudget } from '../src/monthly.mjs';
import { acceptanceReady, evidenceFromEvents } from '../src/acceptance.mjs';
import { openaiAdapter } from '../src/adapters/openai.mjs';
import { codexAdapter } from '../src/adapters/cli.mjs';
import { closeTask } from '../src/close.mjs';
import { Store } from '../src/store.mjs';

// Корінь сховища штабу. J4_STAFF_ROOT — лише для тестів на копії сховища; стоп-кран bridge/HALT
// канонічного сховища діє й тоді (див. haltedCanonical).
const CANON_ROOT = path.resolve(BRIDGE_DIR, '..');
const STAFF_ROOT = process.env.J4_STAFF_ROOT ? path.resolve(process.env.J4_STAFF_ROOT) : CANON_ROOT;
const CONTRACT = 'CONTRACT_v0_4.md';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: 'string' }, ledger: { type: 'string' }, mode: { type: 'string', default: 'stub' },
    from: { type: 'string' }, to: { type: 'string' }, task: { type: 'string' }, 'task-version': { type: 'string', default: '1' },
    subject: { type: 'string' }, 'subject-kind': { type: 'string', default: 'commit' }, kind: { type: 'string', default: 'request' },
    intent: { type: 'string' }, level: { type: 'string', default: 'A' }, summary: { type: 'string' }, 'text-file': { type: 'string' },
    refs: { type: 'string' }, thread: { type: 'string' }, 'reply-to': { type: 'string' }, human: { type: 'boolean', default: false },
    role: { type: 'string' }, id: { type: 'string' }, decision: { type: 'string' }, note: { type: 'string', default: '' },
    approval: { type: 'string' }, once: { type: 'boolean', default: false }, 'max-steps': { type: 'string' }, 'task-events': { type: 'boolean', default: false }, workdir: { type: 'string' }, file: { type: 'string' }, 'checks-ref': { type: 'string' }, 'key-decision': { type: 'boolean', default: false },
  },
});

const cmd = positionals[0];
const home = o.home ?? process.env.J4_HOME ?? path.join(STAFF_ROOT, '.j4');
const ledgerFile = o.ledger ?? process.env.J4_LEDGER ?? path.join(STAFF_ROOT, 'bridge', 'ledger', 'ledger.jsonl');

function adaptersFor(mode) {
  if (mode === 'stub') return { J5: stubAdapter({ role: 'J5' }), 'C5.1-R': stubAdapter({ role: 'C5.1-R' }) };
  if (mode === 'live') {
    return {
      J5: openaiAdapter(),
      'C5.1-R': codexAdapter({ workdir: o.workdir ?? STAFF_ROOT, sandbox: 'read-only' }),
    };
  }
  throw new Error(`невідомий режим ${mode}`);
}

function j4() {
  return new J4({
    config: loadConfig(), home, ledgerFile, staffRoot: STAFF_ROOT,
    adapters: adaptersFor(o.mode), instructionsDir: path.join(BRIDGE_DIR, 'roles'),
    approvalFile: o.approval ?? process.env.J4_APPROVAL ?? path.join(BRIDGE_DIR, 'approvals', 'live.json'),
    monthlyFile: process.env.J4_MONTHLY_BUDGET,
    env: haltedCanonical() ? { ...process.env, J4_HALT: '1' } : process.env,
    taskEvents: o['task-events'] || process.env.J4_TASK_EVENTS === '1',
  });
}

function haltedCanonical() {
  return STAFF_ROOT !== CANON_ROOT && fs.existsSync(path.join(CANON_ROOT, 'bridge', 'HALT'));
}

function out(x) {
  process.stdout.write(`${JSON.stringify(x, null, 2)}\n`);
}

async function main() {
  switch (cmd) {
    case 'send': {
      const text = o['text-file'] ? fs.readFileSync(o['text-file'], 'utf8') : undefined;
      const draft = {
        protocol: PROTOCOL, task_id: o.task, task_version: Number(o['task-version']),
        contract: { version: '0.4', sha256: sha256(fs.readFileSync(path.join(STAFF_ROOT, CONTRACT))) },
        subject: { kind: o['subject-kind'], ref: o.subject }, from: o.from, to: o.to, kind: o.kind,
        intent: o.intent, decision_level: o.level, data_class: 'synthetic',
        thread_id: o.thread, in_reply_to: o['reply-to'] ?? null,
        body: { summary: o.summary, text, refs: o.refs ? o.refs.split(',') : undefined },
      };
      const r = j4().submit(draft, { origin: o.human ? 'human_cli' : 'agent_cli' });
      out(r);
      process.exitCode = r.ok ? 0 : 2;
      break;
    }
    case 'submit': {
      // чернетка з JSON-файла (для CI); походження — agent_cli, людський вхід не підтримується
      if (!o.file) throw new Error('потрібен --file');
      const r = j4().submit(JSON.parse(fs.readFileSync(o.file, 'utf8')), { origin: 'agent_cli' });
      out(r);
      process.exitCode = r.ok ? 0 : 2;
      break;
    }
    case 'run': {
      // --once: один прохід черги для запуску за розкладом (T-0009). Коди виходу: 0 — пройдено,
      // 75 — інший обробник тримає замок (не помилка, наступний запуск підхопить), 4 — стоп-кран, 2 — інше.
      if (o.once && o.mode !== 'stub') throw new Error('run --once дозволено лише в режимі stub');
      if (haltedCanonical()) {
        out({ ok: false, code: 'halted' });
        process.exitCode = o.once ? 4 : 2;
        break;
      }
      const maxSteps = o['max-steps'] ? Number(o['max-steps']) : 50;
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 50) throw new Error('--max-steps 1..50');
      const r = await j4().process({ maxSteps });
      out(r);
      // 6 — черга пройдена, але подію ADM у журнал задачі не записано (деталі: task_event_failed у журналі J4)
      if (r.ok) process.exitCode = o.once && r.events?.failed > 0 ? 6 : 0;
      else if (o.once && r.code === 'locked') process.exitCode = 75;
      else if (o.once && r.code === 'halted') process.exitCode = 4;
      else process.exitCode = 2;
      break;
    }
    case 'close': {
      // Завершення задачі ADM: done лише після бар'єра на одному subject (bridge/src/close.mjs).
      if (!o.task || !o.subject) throw new Error('потрібні --task і --subject');
      if (haltedCanonical() || process.env.J4_HALT === '1' || fs.existsSync(path.join(STAFF_ROOT, 'bridge', 'HALT'))) {
        out({ ok: false, code: 'halted' });
        process.exitCode = 4;
        break;
      }
      // Відкриті ескалації беруться зі сховища J4 і журналу J4: обидва місця треба вказати явно, інакше close міг би
      // не побачити ескалацію, створену в іншому J4_HOME (C3 F-T9-2).
      if (!(o.home ?? process.env.J4_HOME) || !(o.ledger ?? process.env.J4_LEDGER)) {
        out({ ok: false, code: 'escalation-source-unknown', missing: ['J4_HOME', 'J4_LEDGER'] });
        process.exitCode = 3;
        break;
      }
      let ledgerEntries = [];
      try {
        if (fs.existsSync(ledgerFile)) ledgerEntries = new Ledger(ledgerFile).readAll().entries;
      } catch {
        out({ ok: false, code: 'escalation-source-unreadable', missing: ['ledger'] });
        process.exitCode = 3;
        break;
      }
      const r = closeTask({ staffRoot: STAFF_ROOT, taskId: o.task, subject: o.subject, checksRef: o['checks-ref'], store: new Store(home), ledgerEntries });
      out(r);
      process.exitCode = r.ok ? 0 : 3;
      break;
    }
    case 'inbox': {
      const dir = path.join(home, 'inbox', o.role ?? 'J3');
      const items = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
      out(items.map((m) => ({ msg_id: m.msg_id, thread_id: m.thread_id, from: m.from, kind: m.kind, in_reply_to: m.in_reply_to, subject: m.subject, summary: m.body.summary, text: m.body.text, verdict: m.body.verdict ?? null })));
      break;
    }
    case 'escalations': {
      const dir = path.join(home, 'escalations');
      const items = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
      out(items.filter((e) => e.status === 'open'));
      break;
    }
    case 'resolve': {
      if (!o.human) throw new Error('resolve лише для JE: потрібен --human');
      out(j4().resolve(o.id, { decision: o.decision, note: o.note }, { origin: 'human_cli' }));
      break;
    }
    case 'budget': {
      const cfg = loadConfig().limits.monthly;
      out(new MonthlyBudget(process.env.J4_MONTHLY_BUDGET ?? path.join(home, 'budget', 'monthly.json'), cfg).snapshot(Date.now()));
      break;
    }
    case 'acceptance': {
      // бар'єр приймання ADM на одному SHA: рецензії й приймання з events.jsonl задачі; перевірки — --checks-ref
      const ev = evidenceFromEvents(STAFF_ROOT, o.task);
      const checks = o['checks-ref'] ? [{ subject: o.subject, passed: true, evidence_ref: o['checks-ref'] }] : [];
      const r = acceptanceReady({ subject: o.subject, checks, reviews: ev.reviews, acceptances: ev.acceptances, keyDecision: o['key-decision'] });
      out(r);
      process.exitCode = r.ready ? 0 : 3;
      break;
    }
    case 'verify': {
      const r = verifyLedger(ledgerFile);
      out(r);
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    default:
      process.stderr.write('j4 <send|submit|run [--once]|close|inbox|escalations|resolve|budget|acceptance|verify> [опції]; див. bridge/README.md\n');
      process.exitCode = 64;
  }
}

main().catch((e) => {
  process.stderr.write(`j4: ${e.code ?? e.message}\n`);
  process.exitCode = 1;
});
