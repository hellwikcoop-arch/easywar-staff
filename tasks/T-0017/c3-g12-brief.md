# Бриф C3: незалежний огляд протоколу C2 (gate G12) — наказ T-0017

- **Що:** рецензія дизайну й реалізації криптопрофілю колективів (варіант Б: ed25519-dalek 2.2,
  x25519-dalek 2.0, HKDF-SHA256, XChaCha20-Poly1305) **не автором коду**. Read-only: без змін коду, без claim на дошці.
- **Де:** репозиторій EasyWAR, PR #180 (https://github.com/hellwikcoop-arch/EasyWAR/pull/180), гілка
  `claude/e8-c2-crypto-engine`, **head c2d8d4fc199ea520c57c0ebe78094757c24a6cbb** (база main a1761880).
  Код: `src-tauri/src/collective/{mod,codec,identity,epoch,envelope,replay,secret_store,vectors}.rs`;
  фікстура `tests/fixtures/collective-crypto-vectors.json`; node-тест `tests/collective-crypto-vectors.test.mjs`;
  ADR `docs/adr/collective-crypto.md` (розділи 2–5).
- **Чекліст:** `docs/evidence/collectives/2026-10-29-c2-g12-checklist.md` — 15 пунктів. Обов'язково:
  п. 1 і п. 7 (виправлення після зауважень 29.10: `epoch.rs::contributory`, `replay.rs::receive_inner`),
  п. 15 (зв'язування sign↔exchange: у C2 `member_id` лише з Ed25519-ключа; оцінити, чи достатньо fail-closed
  на неконтрибутивний секрет до C2p/C3b, і що саме вимагати від C2p).
- **Умова старту:** CI на c2d8d4f завершено (checks + audit success).
- **Результат:** формальний висновок у `docs/evidence/collectives/2026-10-29-c2-g12-checklist.md`
  (колонка «Висновок рецензента» + розділ «Закриття») через JE/J5; зауваження — у тред J3 або як коментарі PR #180.
  Лише синтетичні дані; реальних ключів у репозиторії немає й не має з'явитися.
- **Бюджет:** `resources.reviewer.max_read_files: 25` (наказ T-0017, гілка `e8/post-r0-decisions`; не 15 з CONTRACT); облік estimate. Цей бриф — **перший обов'язковий файл**; при вичерпанні ліміту — `review_status: incomplete` і перелік `unread`.
- **Уточнення 29.10 04:50Z (після спроби №1, `c3-review-attempt-1.md`):** знахідки U1–U3, A1–A7 спроби №1 — вхід для повторного огляду; A7 подати з переліком місць.
- **Не робити:** не зливати PR, не змінювати Cargo.lock/CSP/capabilities, не оголошувати G12 закритим без J5.
