// Права й маршрути J4. Конфігурація: bridge/config/{roles,routes,limits}.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(dir = path.join(BRIDGE_DIR, 'config')) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { roles: read('roles.json').roles, routes: read('routes.json').routes, limits: read('limits.json') };
}

// origin — звідки J4 отримав повідомлення: human_cli (людина через CLI), agent_cli (агент J3 через CLI
// у своєму сеансі), adapter (відповідь, отримана J4 від адаптера). Роль відправника для adapter J4
// бере з того, якого адаптера він викликав, а не з тексту відповіді.
export function checkSender(cfg, msg, origin) {
  const role = cfg.roles[msg.from];
  if (!role) return { ok: false, code: 'unknown-role', detail: msg.from };
  if (!role.origin.includes(origin)) return { ok: false, code: 'origin-denied', detail: `${msg.from} не може надсилати з ${origin}` };
  if (!role.may_send.includes(msg.kind)) return { ok: false, code: 'kind-denied', detail: `${msg.from} не надсилає ${msg.kind}` };
  return { ok: true };
}

export function checkRoute(cfg, msg) {
  if (!cfg.roles[msg.to]) return { ok: false, code: 'unknown-role', detail: msg.to };
  if (msg.from === msg.to) return { ok: false, code: 'self-route', detail: msg.from };
  const r = cfg.routes.find((x) => (x.from === msg.from || x.from === '*') && (x.to === msg.to || x.to === '*') && x.kinds.includes(msg.kind));
  if (!r) return { ok: false, code: 'route-denied', detail: `${msg.from} → ${msg.to}: ${msg.kind}` };
  return { ok: true, route: r };
}

// Чи прийнято задачу (подія task_accepted у tasks/<id>/events.jsonl сховища штабу).
export function taskAccepted(staffRoot, taskId) {
  if (!staffRoot) return false;
  const f = path.join(staffRoot, 'tasks', taskId, 'events.jsonl');
  if (!fs.existsSync(f)) return false;
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).some((l) => {
    try {
      const e = JSON.parse(l);
      return e.event === 'task_accepted' && e.task_id === taskId;
    } catch {
      return false;
    }
  });
}

// Незалежність рецензента: запуск рецензії не збігається із запуском автора, і рецензент не автор.
export function checkIndependence(cfg, reviewerRole, authorRole, reviewerRunId, authorRunId) {
  const r = cfg.roles[reviewerRole];
  if (!r || r.sandbox !== 'read-only') return { ok: false, code: 'reviewer-not-readonly' };
  if (reviewerRole === authorRole) return { ok: false, code: 'self-review' };
  if (reviewerRunId && authorRunId && reviewerRunId === authorRunId) return { ok: false, code: 'same-run' };
  return { ok: true };
}
