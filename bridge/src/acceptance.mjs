// Бар'єр приймання ADM (T-0006; перенесено за змістом з PR #3, acceptance_ready).
// Умови переходу в done — CONTRACT_v0_4.md, розділ 6: перевірки, завершена рецензія з passed,
// закриті обов'язкові зауваження, приймання кожної ролі з наказу і JE для key_decision —
// усе на ОДНОМУ subject (повний SHA). Функції лише перевіряють записи; стан не змінюють.
// Повідомлення агентів не можуть встановити done (protocol.mjs: done-forbidden).
// T-0012 (F-T9-16, SCOPE-1; наказ JE 2026-10-28, G1/G2): жодних значень за замовчуванням — зараховуються лише ЯВНІ
// `review_status: complete`, `result: accepted` і `scope: full`; приймання з межами (`scope: limited`, `limits: [...]`)
// лишається в історії, але бар'єра не відкриває; `scope: full` із непорожнім `limits` — суперечливий запис, відмова.
import fs from 'node:fs';
import path from 'node:path';

const SHA40 = /^[0-9a-f]{40}$/;
const REVIEWER = { code: 'C3', logic: 'C5.4' };

// Непорожні межі: будь-яке значення `limits`, крім відсутнього/null і порожнього масиву (рядок, число, об'єкт — теж межі; fail-closed).
function hasLimits(limits) {
  if (limits === undefined || limits === null) return false;
  return !(Array.isArray(limits) && limits.length === 0);
}

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
      // остання рецензія цього рецензента на тому самому subject
      const last = reviews.filter((r) => r.by === who && r.subject === subject).at(-1);
      if (!last) missing.push(`review-${who}-missing`);
      // T-0012 (F-T9-16): review_status має бути ЯВНО complete; відсутнє, null, partial, incomplete — рецензія не завершена
      else if (last.review_status !== 'complete') missing.push(`review-${who}-incomplete`);
      else if (last.verdict !== 'passed' || !last.evidence_ref) missing.push(`review-${who}-not-passed`);
    }
  }
  const req = [...requiredRoles];
  if (keyDecision) req.push(['JE', 'key_decision']);
  for (const [by, role] of req) {
    // діє останній запис ролі на цьому SHA; прийнятим вважається лише явне accepted (F-1, C3)
    const last = acceptances.filter((a) => a.by === by && a.role === role && a.subject === subject).at(-1);
    if (!last) missing.push(`acceptance-${by}-${role}-missing`);
    // T-0012 (F-T9-16): result має бути ЯВНО accepted (accepted_with_restrictions, accepted_scope_AB, rejected, відсутнє — ні)
    else if (last.result !== 'accepted' || !last.evidence_ref) missing.push(`acceptance-${by}-${role}-not-accepted`);
    // T-0012 (SCOPE-1, варіант B): scope має бути ЯВНО рядком full; limited, масив, число, інший регістр, відсутнє — не повне
    else if (last.scope !== 'full') missing.push(`acceptance-${by}-${role}-scope-not-full`);
    // T-0012 (G2): full із непорожніми межами — суперечливий запис; бар'єр не вгадує, що мав на увазі автор
    else if (hasLimits(last.limits)) missing.push(`acceptance-${by}-${role}-scope-contradictory`);
  }
  return { ready: missing.length === 0, missing };
}

// Збирає рецензії та приймання з tasks/<id>/events.jsonl (розділ 4). Перевірки (checks) — окремим входом:
// контракт не має для них події, їх джерело — донесення з verified і логами (розділ 13).
// T-0012 (F-T9-16): читач нічого не додає — відсутнє поле лишається відсутнім (null); тлумачення — лише в acceptanceReady.
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
      reviews.push({ by: e.by, subject: e.subject, verdict: e.verdict ?? null, review_status: e.review_status ?? null, evidence_ref: e.ref });
    }
    if (e.event === 'acceptance') {
      acceptances.push({ by: e.by, role: e.role, subject: e.subject, evidence_ref: e.ref, result: e.result ?? null, scope: e.scope ?? null, limits: e.limits ?? null });
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
