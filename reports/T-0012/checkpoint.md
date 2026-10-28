# Checkpoint T-0012 (оновлюється після кожного рубежу; для продовження в новій сесії без скидання лімітів)

| Поле | Значення |
|---|---|
| Оновлено | 2026-10-28 ~23:05 UTC |
| Задача / етап | T-0012, етапи C–E завершено: C3 раунд 1 passed (0 обов'язкових; 3 необов'язкових відкладено — Р-Т12-11), технічне приймання J3 записано (seq 5). J5 — CONTENT ACCEPTED — FULL SCOPE (22:54; seq 7 report_filed; подію acceptance J5 пише лише J5 — J3 не підміняє by). Рекомендації J5: без дельта-раунду, R11-14 — ризик, ліміт 150. Чекає: остаточне JE і дозвіл на один draft PR + один CI (запит: reports/T-0012/je-final-acceptance-request.md; прогноз 76+48=124/150). Бар'єр: missing J5-acceptance і JE |
| Гілка | `t-0012/acceptance-barrier` на origin, без PR і CI (Р-Т12-3, Р-Т12-12); резервна копія `/mnt/project-files/j4-hardening/t-0012.bundle` |
| База | 0f2cd0b819f25d386311a9f16e3c78b6e923903f (t-0010/stabilization) |
| Контрольний SHA | dc7828752eab1c3e68e8d450c5d0c18293fc1b59 (останній коміт у bridge/ і CONTRACT); далі лише reports/T-0012, tasks/T-0012 |
| Перевірки | повний прогін 146: 144 pass / 0 fail / 2 skip (A4, A5 під root); t0012 41/41; мутанти 15/15 убиті; compat збігається |
| Витрати | 76/150 (HALT 144): 28 — відхилення T12-002, 48 — повний прогін T12-006; платних 0, мережі 0, CI 0 |
| Дозволено далі | ще один повний прогін (→124 ≤ 144) після виправлень за C3, якщо будуть; фільтровані прогони 0; C3/J5 за diff 0 |
| Заборонено без JE | push/PR/CI з кодом, `j4 close`/done, злиття, зміна лімітів, події acceptance від імені J5/C3/JE |
| Події T-0012 | seq 1 command JE; seq 2 task_created (J5, записав J3); seq 3 task_accepted J3; seq 4 review_finished C3 (complete/passed, записав J3, M-2); seq 5 acceptance J3 technical (accepted, scope full). Бар'єр на dc78287: `missing: [acceptance-J5-content-missing]` (+ JE key_decision). Наступні події — лише від J5 і JE (J3 їх не створює) |
| Блокери / питання JE | Р-Т12-2 (150/200), Р-Т12-4 (R11-14 залишковий ризик), PR #8 аномальний запуск CI (HALT на частині PR) |
| Далі | Дельта-раунд НЕ робити (J5 п. 3), повну регресію НЕ запускати (J5 п. 5). Пакет J5/JE подано (reports/T-0012/001.yaml, c3-review.yaml, зведений звіт у проєктних файлах). Якщо JE обере дельта-раунд: правки C3T12-1/3/5/6 → новий SHA → один повний прогін (→124/150) → дельта-C3 → нове приймання J3. Чернетки T-0013…T-0015 і граф — гілка program/t-0013-15-drafts (bundle program-t-0013-15.bundle). T-0011 — лише після остаточного приймання T-0012 JE |

## 2026-10-28 23:02 — JE-T12-02
J5 acceptance записано (seq 8), JE key_decision записано (seq 9). Дозвіл: ОДИН draft PR t-0012/acceptance-barrier → t-0010/stabilization + ОДИН CI (124/150). Після відкриття PR жодних push, повторного CI, merge, done, реального close, live. Результат CI — лише у треді/пам'яті, не в гілці.
