// Ворота живих (платних) викликів. Живий адаптер працює лише якщо одночасно:
// 1) J4_ALLOW_LIVE=1 у середовищі запуску;
// 2) є чинний файл погодження JE (bridge/approvals/live.json або J4_APPROVAL) для цього адаптера й задачі;
// 3) є потрібні облікові дані в середовищі (самі значення J4 не читає в журнал і не друкує).
// У GitHub Actions додатково: job у environment j4-live з обов'язковим рецензентом JE (DESIGN.md, розділ 7).
import fs from 'node:fs';

const REQUIRED = ['approved_by', 'approved_at', 'expires_at', 'adapters', 'task_ids', 'max_calls', 'max_tokens', 'max_cost_usd', 'ref'];

export function readApproval(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, code: 'approval-missing' };
  let a;
  try {
    a = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, code: 'approval-invalid-json' };
  }
  for (const k of REQUIRED) if (a[k] === undefined || a[k] === null) return { ok: false, code: 'approval-incomplete', detail: k };
  if (a.approved_by !== 'JE') return { ok: false, code: 'approval-not-je' };
  return { ok: true, approval: a };
}

export function checkLive({ adapter, taskId, env, approvalFile, now, defaults }) {
  if (env.J4_HALT === '1') return { ok: false, code: 'halted' };
  if (env.J4_ALLOW_LIVE !== '1') return { ok: false, code: 'live-not-enabled' };
  const r = readApproval(approvalFile);
  if (!r.ok) return r;
  const a = r.approval;
  if (Date.parse(a.expires_at) <= now) return { ok: false, code: 'approval-expired' };
  if (!a.adapters.includes(adapter.name)) return { ok: false, code: 'approval-adapter', detail: adapter.name };
  if (!a.task_ids.includes(taskId)) return { ok: false, code: 'approval-task', detail: taskId };
  for (const v of adapter.requiredEnv ?? []) if (!env[v]) return { ok: false, code: 'credentials-missing', detail: v };
  const limits = {
    ...defaults,
    max_calls_per_task: Math.min(defaults.max_calls_per_task, a.max_calls),
    max_tokens_per_task: Math.min(defaults.max_tokens_per_task, a.max_tokens),
    max_cost_usd_per_task: a.max_cost_usd,
  };
  return { ok: true, approval: { ref: a.ref, approved_at: a.approved_at, expires_at: a.expires_at }, limits, price: a.price ?? null, model: a.models?.[adapter.name] ?? null };
}
