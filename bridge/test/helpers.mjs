// Спільне для тестів: тимчасове сховище штабу з контрактом і подіями, синтетичні чернетки.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { J4 } from '../src/router.mjs';
import { Store } from '../src/store.mjs';
import { Ledger } from '../src/ledger.mjs';
import { loadConfig, BRIDGE_DIR } from '../src/policy.mjs';
import { sha256, PROTOCOL } from '../src/protocol.mjs';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
const REAL_CONTRACT = path.join(BRIDGE_DIR, '..', 'CONTRACT_v0_4.md');

export function tmpStaff() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-test-'));
  fs.copyFileSync(REAL_CONTRACT, path.join(root, 'CONTRACT_v0_4.md'));
  fs.mkdirSync(path.join(root, 'tasks', 'T-0900'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', 'T-0900', 'events.jsonl'), `${JSON.stringify({ seq: 1, event: 'task_accepted', task_id: 'T-0900', by: 'J3' })}\n`);
  return root;
}

export function contractRef(root) {
  return { version: '0.4', sha256: sha256(fs.readFileSync(path.join(root, 'CONTRACT_v0_4.md'))) };
}

export function draft(root, over = {}) {
  const { body, ...rest } = over;
  return {
    protocol: PROTOCOL,
    task_id: 'T-0900',
    task_version: 1,
    contract: contractRef(root),
    subject: { kind: 'commit', ref: SHA_A },
    from: 'J3',
    to: 'J5',
    kind: 'request',
    intent: 'question',
    decision_level: 'A',
    data_class: 'synthetic',
    in_reply_to: null,
    ...rest,
    body: { summary: 'Синтетичний запит J3 до J5', text: 'Синтетичний текст запиту.', ...(body ?? {}) },
  };
}

export function makeJ4(root, { adapters = {}, limits = {}, evidence, env = {}, hooks, approvalFile, now } = {}) {
  const config = loadConfig();
  config.limits = { ...config.limits, defaults: { ...config.limits.defaults, ...limits }, evidence: { level: evidence ?? config.limits.evidence.level } };
  return new J4({
    config,
    home: path.join(root, '.j4'),
    ledgerFile: path.join(root, 'ledger.jsonl'),
    staffRoot: root,
    adapters,
    instructionsDir: path.join(BRIDGE_DIR, 'roles'),
    approvalFile: approvalFile ?? path.join(root, 'approval.json'),
    env,
    hooks,
    now,
  });
}

// T-0011: закріплене значення установки тестового сховища (marker J4_HOME/installation.json) або undefined, якщо сховища ще немає.
// Лише для тестів: у справжній роботі значення закріплює рішення JE (G3), а не marker, прочитаний з того самого сховища.
export function pinnedId(root) {
  return Store.open(path.join(root, '.j4')).installation()?.installation_id;
}

// T-0011: створює сховище J4 і журнал, прив'язаний до його установки (як роутер), у тестовому корені; повертає закріплене значення.
export function installJ4(root) {
  const id = new Store(path.join(root, '.j4')).installation().installation_id;
  new Ledger(path.join(root, 'ledger.jsonl'), { installationId: id });
  return id;
}

export function ledgerEntries(root) {
  const f = path.join(root, 'ledger.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

export function events(root, name) {
  return ledgerEntries(root).filter((e) => e.event === name);
}

export function inbox(root, role) {
  const dir = path.join(root, '.j4', 'inbox', role);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
}

export function openEscalations(root) {
  const dir = path.join(root, '.j4', 'escalations');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((e) => e.status === 'open') : [];
}

export function counting(adapter) {
  const wrapped = { ...adapter, calls: 0 };
  wrapped.call = async (args) => {
    wrapped.calls += 1;
    return adapter.call(args);
  };
  return wrapped;
}
