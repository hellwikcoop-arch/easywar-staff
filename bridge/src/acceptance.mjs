// Бар'єр приймання ADM (T-0006; перенесено за змістом з PR #3, acceptance_ready).
// Умови переходу в done — CONTRACT_v0_4.md, розділ 6: перевірки, завершена рецензія з passed,
// закриті обов'язкові зауваження, приймання кожної ролі з наказу і JE для key_decision —
// усе на ОДНОМУ subject (повний SHA). Функції лише перевіряють записи; стан не змінюють.
// Повідомлення агентів не можуть встановити done (protocol.mjs: done-forbidden).
import fs from 'node:fs';
import path from 'node:path';

const SHA40 = /^[0-9a-f]{40}$/;
const REVIEWER = { code: 'C3', logic: 'C5.4' };

export function acceptanceReady({ subject, checks = [], reviews = [], acceptances = [], openMandatoryFindings = 0, keyDecision = false, reviewKind = 'code', requiredRoles = [['J3', 'technical'], ['J5', 'content']] }) {
  const missing = [];
  if (!SHA40.test(subject ?? '')) return { ready: false, missing: ['subject-invalid'] };
  if (!Number.isInteger(openMandatoryFindings) || openMandatoryFindings !== 0) missing.push('open-mandatory-findings');
  if (!checks.length) missing.push('checks-missing');
  else if (!checks.every((c) => c.subject === subject && c.passed === true && c.evidence_ref)) missing.push('checks-not-on-subject-or-failed');
  if (reviewKind !== 'none') {
    const who = REVIEWER[reviewKind];
    if (!who) missing.push('review-kind-invalid');
    else {
      // остання завершена рецензія цього рецензента на тому самому subject
      const last = reviews.filter((r) => r.by === who && r.subject === subject).at(-1);
      if (!last) missing.push(`review-${who}-missing`);
      else if (last.review_status !== 'complete' || last.verdict !== 'passed' || !last.evidence_ref) missing.push(`review-${who}-not-passed`);
    }
  }
  const req = [...requiredRoles];
  if (keyDecision) req.push(['JE', 'key_decision']);
  for (const [by, role] of req) {
    // діє останній запис ролі на цьому SHA; прийнятим вважається лише явне accepted (F-1, C3)
    const last = acceptances.filter((a) => a.by === by && a.role === role && a.subject === subject).at(-1);
    if (!last) missing.push(`acceptance-${by}-${role}-missing`);
    else if (last.result !== 'accepted' || !last.evidence_ref) missing.push(`acceptance-${by}-${role}-not-accepted`);
  }
  return { ready: missing.length === 0, missing };
}

// Збирає рецензії та приймання з tasks/<id>/events.jsonl (розділ 4). Перевірки (checks) — окремим входом:
// контракт не має для них події, їх джерело — донесення з verified і логами (розділ 13).
export function evidenceFromEvents(staffRoot, taskId) {
  const f = path.join(staffRoot, 'tasks', taskId, 'events.jsonl');
  const reviews = [];
  const acceptances = [];
  if (!fs.existsSync(f)) return { reviews, acceptances, found: false };
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.task_id !== taskId) continue;
    if (e.event === 'review_finished') {
      reviews.push({ by: e.by, subject: e.subject, verdict: e.verdict, review_status: e.review_status ?? (e.verdict ? 'complete' : null), evidence_ref: e.ref });
    }
    if (e.event === 'acceptance') {
      acceptances.push({ by: e.by, role: e.role, subject: e.subject, evidence_ref: e.ref, result: e.result ?? 'accepted' });
    }
  }
  return { reviews, acceptances, found: true };
}

// Запит на done: дозволений лише ADM і лише коли бар'єр пройдено.
export function requestDone({ by, ...gate }) {
  if (by !== 'ADM') return { allowed: false, missing: ['done-only-adm'] };
  const r = acceptanceReady(gate);
  return { allowed: r.ready, missing: r.missing };
}
