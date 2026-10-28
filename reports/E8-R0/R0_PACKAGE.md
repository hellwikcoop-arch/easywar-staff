# E8-R0-READINESS — пакет планування EasyWAR Sync / Pair / LAN

**Виконавець:** J3 (Claude Code) · **Замовник:** JE · **Контроль:** J5
**Режим:** READ-ONLY / ANALYSIS / PLANNING · **Дата:** 29.10.2026 (сесія 28.10.2026 23:15–00:10 UTC)
**Фінальний статус:** `READY_FOR_J5_REVIEW` (докази — у розділах нижче; несанкціонованих змін і витрат не було)

Що зроблено в межах R0: лише читання двох репозиторіїв, локальні тести без мутації робочих
файлів (`node --test`, `npm run test:unit`, тимчасовий `git worktree` у scratch-теці) і цей пакет.
Не створено: коду, міграцій, PR, гілок, задач Codex, подій у `easywar-staff`. Нічого не злито.

Позначки стану (за п. 7 наказу): `CODE_EXISTS` · `TESTED` · `REVIEWED` (C3) · `ACCEPTED`
(J3 technical + J5 content) · `MERGED`. Числа викликів — `estimate`, якщо не сказано інакше.

---

## A. R0_STATUS_REPORT

### A.0. Базові факти (R0.1)

| Що | Факт | Доказ |
|---|---|---|
| `origin/main` EasyWAR | `cf08ac449e1c66b57ba48aac11d8cdf1756170b5` (merge PR #159, 21.10.2026 22:30 UTC). Збігається з контрольним SHA J5; нових комітів у `main` після нього немає | `git fetch origin main; git log -1 origin/main` |
| CI на `main` | Desktop build run 39687002273 (push) — success; плановий run 40312098933 (26.10) — success | GitHub Actions, фільтр branch=main |
| `npm run test:unit` на `main` локально | див. A.4 (прогін у цій сесії) | лог сесії |
| Відкриті PR, дотичні до E8 | **#160** «C1d» (head `923e1bc`, база `cf08ac4`) — єдиний. #158 «Комбат» і #170 «E2 ПВК» E8 не торкаються (перетин файлів — розділ D). Dependabot #162–#169 — #165 і **#169 (`chacha20poly1305` 0.10→0.11)** змінюють `Cargo.lock` | `list_pull_requests state=open`; `git diff --name-only` |
| Гілки E8 | `claude/e8-sync-pair-mesh-h0` (H0, злито #155), `claude/e8-c1a-sensitivity` (злито #156), `claude/e8-c1b-shared-table` (злито #157), `claude/e8-c1d-sync-policy` (PR #160, ahead 2, behind 0). Гілки `codex/t-0004-c1c-membership` **немає**; `src/collective-core.js` / `src/collective-pair-core.js` немає в жодній зі 157 віддалених гілок | `git branch -r`; `git ls-tree` по всіх гілках |
| Старі гілки колективів | `claude/collectives-k1-full-row`, `-k2-auto-sync`, `-coordinates-cloud` — ahead 0 (злито раніше, лише документи) | `git rev-list --count` |
| `easywar-staff` | `main` = лише README (5f5656b, 15.10). Робочі гілки: найновіша `t-0012/acceptance-barrier` 49226f9 (28.10 23:01 UTC). Файли T-0002/T-0004 однакові в гілках `program/t-0013-15-drafts`, `orders/T-0010-12`, `t-0012/acceptance-barrier` | `git fetch --depth 50`; `git show <гілка>:tasks/T-0002/events.jsonl` |
| Журнал T-0002 | 35 подій; остання — seq 35 `acceptance_recorded` J3 technical на `923e1bc` (C1d), «чекає J5 (зміст)». Події приймання J5 для C1d **немає** | `tasks/T-0002/events.jsonl` |
| Журнал T-0004 (C1c, Codex) | 3 події: `task_created` (21.10), поправка бази на `cf08ac4` (22.10), донесення «Codex недоступний (ліміт), `task_accepted` немає, гілки/claim/PR немає» | `tasks/T-0004/events.jsonl` |
| Незавершені накази staff, дотичні до E8 | T-0002 (C1d чекає J5; C1c не почато), T-0004 (не прийнято виконавцем). T-0003 — не активовано (STATUS.md). Програма J4 (T-0009…T-0015) — окремий тред, E8 не торкається | `tasks/T-0003/STATUS.md`, `reports/T-0009/follow-up-orders.md` |
| Codex task claims | У `main` каталогу `.codex/coordination/active` немає (лише `project.yaml`, `schema_version: 2`, `task_prefix: EW`); гілок `codex/t-0004*` немає → активних claim для E8 не виявлено. Стан не змінювався | `ls .codex/coordination` |
| Бюджет T-0002 | ліміт 210 (A-1, JE-T8); використано ≈181 (estimate, звіт 017); на C1c лишається ≈29 при плані ≈41 (Codex 25 + C3 ≈10 + J3 ≈6) → **нестача ≈12, рішення JE відкрите** | `reports/T-0002/017.yaml` |
| Нестабільний Rust-тест у CI | двічі впав на кроці «Rust tests» (C1a `5923b49`, C1d run 39836049078 спроба 1); PR Rust не змінювали; перезапуск зелений; лог спроби 1 недоступний; винесено як окрема задача, рішення JE немає | `reports/T-0002/017.yaml`, коментар у PR #160 |

### A.1. Таблиця етапів

| Етап | Статус | SHA | Доказ | Тести | Блокер | Наступна дія |
|---|---|---|---|---|---|---|
| **H0** документи E8 | `MERGED` (документаційна, без приймання коду) | PR #155 → `611841c` | `docs/plans/2026-10-21-easywar-sync-pair-mesh-review.md`, `docs/adr/*` у `main` | — | — | Жодної. ADR лишаються «Запропоновано» (не рішення JE) |
| **C1a** `sensitivity-core` | `MERGED` + `ACCEPTED` (C3 passed 006; J3 007; J5 008) | PR #156 → merge `ea03a14`, head `5923b49` | `src/sensitivity-core.js`, `tests/sensitivity.test.mjs`; `events.jsonl` seq 12–16 | локально 29.10: `node --test tests/sensitivity.test.mjs tests/shared-table.test.mjs tests/collective-core-boundaries.test.mjs` → **39/39 pass** | — | Не повторювати. Ядро **не підключене** до застосунку (`grep` імпортів — 0); підключення — C3b/C5. F-7 відкладено на C3b/C5 |
| **C1b** `shared-table-core` | `MERGED` + `ACCEPTED` (C3 passed 010; J3 011; J5 012; злиття за JE-T9) | PR #157 → merge `2106f9e`, head `9ec729e` | `src/shared-table-core.js`, `tests/shared-table.test.mjs`; `tasks/T-0002/acceptance-c1b.json` | у тих самих 39/39 | — | Не повторювати. **F-15 tracked, не виправлено** (повтор від автора без права запису → `rejected/no-write-right`, а не `duplicate`; межовий тест не перевіряє існування файлів з `C1_PLANNED_CORES`) → закривається в C3b/C5 |
| **C1c** `collective-core`, `collective-pair-core` | **`CODE_ABSENT`**. Наказ T-0004 (Codex) створено J3 21.10, затверджено J5 22.10; `task_accepted` немає; Codex був недоступний (ліміт); гілки, claim і PR немає | база за наказом `cf08ac4` | `tasks/T-0004/{order.yaml,codex-prompt.md,j5-final-authorization.md,events.jsonl}` | немає | бюджет T-0002 (нестача ≈12); доступність Codex; `task_accepted` | **R1** (розділ E): запустити T-0004 як є або перепризначити J3 — рішення JE (F.1, F.2) |
| **C1d** `sync-policy-core`, `report-submission-core` | `CODE_EXISTS` · `TESTED` · `REVIEWED` (C3 passed 016, раунд 2) · J3 technical accepted (017) · **J5 content — ВІДКРИТО** · `NOT MERGED` | PR #160, head `923e1bc19d106a6f65a5a903d21c16c275abb380`, база `cf08ac4` (ahead 2, behind 0 — злиття без конфліктів) | `tests/sync-policy.test.mjs`, `tests/report-submission.test.mjs`; CI run 39836049078: checks success (після перезапуску), audit success | локально 29.10 у worktree на `923e1bc`: `node --test tests/sync-policy.test.mjs tests/report-submission.test.mjs tests/collective-core-boundaries.test.mjs` → **24/24 pass** | приймання змісту J5 на тому самому SHA (JE-T5: без J5 злиття заборонено) | **R2** (розділ E): приймання J5 → злиття J3 → рядок стану в `COLLECTIVES_PLAN.md` (гілка вже містить правку §8). F-21 (low, частково відкрито) і F-24 (бриф) — без змін коду |
| **C2a / P1** ADR криптопрофілю + перелік крейтів; мережеві межі й сховище секретів | `NOT_STARTED`. Є лише чернетка ADR `docs/adr/collective-crypto.md` (статус «чернетка до C2a», кандидати без версій, без `cargo audit`). P1: `tests/network-boundary.test.mjs` і `docs/adr/network-and-secret-boundaries.md` **не існують**; `networkPolicy`/`secretStore` у Rust немає | — | `ls` (відсутні файли); `docs/plans/2026-10-21-easywar-platform-release.md` §P1 — усі пункти `[ ]` | — | JE-15, JE-16, JE-18, JE-21 відкриті | **R3** (розділ E) |
| **C2** Rust crypto engine | `NOT_STARTED`. У `src-tauri/src` модуля `collective` немає | — | `ls src-tauri/src/collective` → відсутній | — | C2a + JE-15 (lockfile) + JE-18 | R4 після R3 |
| **C2p** PAKE/SAS | `NOT_STARTED` | — | — | — | C2, JE-07 (параметри UX) | R5 |
| **C3** міграції | `NOT_STARTED`. Наступний вільний номер — **`0017`** (останній `0016_dashboard_module_correction_status.sql`, зареєстрований у `database.rs:107`) | — | `ls src-tauri/migrations` | — | JE-14 (порядок), формати ключів з C2a | R6 |
| **C3b** store/policy/IPC | `NOT_STARTED` | — | — | — | C3, P1 | R7 |
| **C6a** LAN direct | `NOT_STARTED` | — | — | — | C3b, P1, JE-13, JE-17, JE-21, JE-11 | R8 |
| **C5** UI | `NOT_STARTED` | — | — | — | C3b (IPC) | R9 |
| **C4** Base44, **C6b/C6c**, **C8** | `NOT_STARTED`; поза першим LAN MVP за LAN-first (JE-13 ще не записано як рішення) | — | `docs/BASE44_SANDBOX.md`, проба 21.10 (ізоляцію не доведено) | — | G01–G05, JE-05/10/19/20 | не планувати до MVP |

### A.2. Висновок щодо вимоги «не повторювати C1a/C1b»

C1a і C1b присутні в `main` з усіма трьома прийманнями на тих самих SHA; тести зелені на `cf08ac4`.
Повторна реалізація не потрібна. Залишок по них — лише відкладені зауваження F-7 і F-15 (C3b/C5).

### A.3. Підтвердження початкових відомостей наказу

| Етап | Відомий стан | Підтверджено |
|---|---|---|
| H0 | PR #155 merged | так (`611841c`) |
| C1a | PR #156 merged | так (`ea03a14`), + ACCEPTED |
| C1b | PR #157 merged | так (`2106f9e`), + ACCEPTED, JE-T9 |
| C1c | потрібна перевірка | **коду немає**, наказ T-0004 не прийнято виконавцем |
| C1d | потрібна перевірка | **PR #160 відкритий**, усе крім приймання J5 виконано |
| C2a / P1 | потрібна перевірка | **не почато**, лише чернетка ADR |
| C2–C6a | реалізація не підтверджена | **підтверджено: коду немає** |

### A.4. Виконані команди (ця сесія, без мутацій)

```
git fetch origin --prune                                # EasyWAR, усі гілки
git log -1 origin/main                                  # cf08ac4
node --test tests/sensitivity.test.mjs tests/shared-table.test.mjs tests/collective-core-boundaries.test.mjs
                                                        # 39 pass, 0 fail (main)
git worktree add /tmp/claude-0/wt-c1d origin/claude/e8-c1d-sync-policy   # scratch, поза репозиторієм
node --test tests/sync-policy.test.mjs tests/report-submission.test.mjs tests/collective-core-boundaries.test.mjs
                                                        # 24 pass, 0 fail (923e1bc)
npm run test:unit                                       # main cf08ac4 — результат у розділі A.5
git clone --depth 1 https://github.com/hellwikcoop-arch/easywar-staff; git fetch --depth 50 origin '+refs/heads/*:...'
```

Не виконувалось (не потрібно для R0 і дорого): `cargo test`, `cargo clippy`, `npm run build`.
CI на `cf08ac4` і на `923e1bc` зелений (див. A.0) — це доказ замість локального прогону Rust.

### A.5. `npm run test:unit` на `main`

Прогін 29.10.2026 на `cf08ac4` у хмарній сесії: **1480 tests, 1480 pass, 0 fail** (`EXIT 0`, ≈150 с).
Збігається з CI run 39687002273.

---

## B. R0_DECISION_REGISTER

Статуси: `ACCEPTED` / `REJECTED` / `OPEN` / `CONFLICT` / `NOT_VERIFIED`. Першоджерела:
`je-order.md` = `easywar-staff:tasks/T-0002/je-order.md` (JE, 21.10.2026 18:40);
`j5-final` = `easywar-staff:tasks/T-0004/j5-final-authorization.md` (J5 за рішеннями JE, 22.10.2026;
події T-0002 seq 24–25); `review §5` = `docs/plans/2026-10-21-easywar-sync-pair-mesh-review.md`, розділ 5
(рекомендації J3 — довідка, не рішення). Жодне відкрите рішення тут не закрито.

| ID | Тема | Статус | Першоджерело, дата | Вплив на виконання |
|---|---|---|---|---|
| JE-01 | Дозвіл почати код E8 | **ACCEPTED** — лише C1a–C1d у межах T-0002 | `je-order.md`, 21.10 | C2+ потребує нового дозволу (F.4) |
| JE-T1 | Наказ T-0002 v1, `important: true` | ACCEPTED | `je-order.md` | третя спроба можлива лише рішенням JE |
| JE-02 | Вступ за коротким кодом (Pair) як рішення власника; машина станів у C1c | **ACCEPTED** (включити до C1c) | `je-order.md` §2 | **CONFLICT з документами**: `COLLECTIVES_PLAN.md` §6 і `docs/adr/collective-pairing.md` у `main` досі кажуть «JE-02 відкрито / пропозиція». Код C1c за T-0004 правильно включає Pair. Усунути в R2/R1-інтеграції правкою документів (без зміни суті) |
| JE-T2 | Схвалює вступ учасник з усіма епохами за взаємної згоди | ACCEPTED | `je-order.md` | закриває R6 з review §5; ADR pairing п. 5 узгоджений |
| JE-T3 | Клас — за смисловою роллю; невідомий = D; запропонований ≠ підтверджений | ACCEPTED | `je-order.md` | реалізовано в C1a (F-6) |
| JE-T4 | CONTRACT v0.4 чинний для T-0002; журнал у `easywar-staff` | ACCEPTED | `je-order.md` | формат чернеток R1–R10 — §3 контракту |
| JE-T5 | J3 може зливати PR після C3 + J3 + J5 на одному SHA | ACCEPTED | `je-order.md` | PR #160 без J5 не зливати |
| JE-T6 | Правила ролей (таблиця) | ACCEPTED | `j5-final` §3, 22.10 | обов'язкові для C1c; у T-0004 вже внесені |
| JE-T7 | `joinsUsed`/`maxJoins`, без стану EXHAUSTED | ACCEPTED | `j5-final` §4 | C1c |
| JE-T8 | Бюджет T-0002 190→210; Codex T-0004 = 25, 2 спроби | ACCEPTED | `j5-final` §5; подія 24 | ліміт вичерпується (≈181/210): C1c не вміщається (F.1) |
| JE-T9 | Дозвіл J3 злити PR #157 | ACCEPTED, виконано | `j5-final` §2; подія 27 | — |
| JE-03 | Автовідправка `AUTO_AFTER_LOCAL_APPROVAL` | **OPEN** | review §5 (рек.: ні у v1) | не блокує: C1d повертає `OwnerDecisionRequired`; C3b/C5 — так само |
| JE-04 | Ручне приймання / вимкнення вхідних | **OPEN** | review §5 (рек.: ні у v1) | не блокує MVP; у C1d неактивні |
| JE-05 | WAN-mesh | **OPEN** | review §5 (рек.: лабораторія, поза v1) | C8 поза MVP; `peer_wan` завжди denied (C1a) |
| JE-05а | Видалення в одержувача | **OPEN** | review §5 | C1d/C3b діють за чинним §5.3; локальна правка, якщо JE вирішить інакше |
| JE-06 | `DISABLED` і фоновий запит | **OPEN** | review §5 | відпадає при JE-04 = ні |
| JE-07 | Формат коду, SAS, TTL, спроби, `max_joins` | **OPEN** | review §5 (6 цифр / 15 хв / 24 год / 20 / 5 — пропозиція) | не блокує C1c (лише параметри, T-0004); **блокує C2p і C5** |
| JE-08 | Заявка чекає офлайн-запрошувача | **OPEN** | review §5 | C1c моделює як стан; блокує лише UX C5 |
| JE-08а | Показ вступу по таблицях | **OPEN** | review §5 | C1c має `historyStatusByTable`; блокує C5 |
| R6 | Чи може звичайний учасник схвалити вступ | **ACCEPTED через JE-T2** (підтвердити, що JE вважає R6 закритим) | `je-order.md` | — |
| JE-09 | Rendezvous через інтернет | **OPEN** | review §5 (рек.: у v1 немає) | не блокує LAN MVP |
| JE-10 | Ліміти relay/store, автозапуск | **OPEN** | review §5 | C6b/C6c поза MVP |
| JE-11 | Авторитет membership у LAN при падінні host | **OPEN** | review §5 (рек.: явний host + handover) | формально C6b; **для C6a на двох ПК потрібно хоча б зафіксувати «немає host, обмін лише прямий, журнал членства — за підписами»** (F.6) |
| JE-12 | Реальні дані | **OPEN** | review §5 (= O15) | блокує будь-яке реальне використання; MVP лише синтетика |
| JE-13 | LAN-first (C6a + C5 раніше за C4) | **OPEN** як запис рішення; наказ R0 вживає «за погодженого LAN-first» | review §5; наказ R0 п. 5 | визначає критичний шлях (розділ C). Потрібен формальний запис (F.3) |
| JE-14 | C3 після ADR C2a, а не після всього C2 | **OPEN** | review §5 | визначає, чи R6 іде паралельно з R4 (розділ C) |
| JE-15 | Перелік нових крейтів | **OPEN** | review §5; ADR crypto | **блокує C2/C2p** (`Cargo.lock` не чіпати до рішення, К9) |
| JE-16 | Відкриті поля конверта (`class_hint`, `expiry`) | **OPEN** | review §5 | зміст ADR C2a; не блокує старт R3 |
| JE-17 | Listener у головному процесі чи sidecar; mDNS чи ручна адреса | **OPEN** | review §5 | **блокує C6a** |
| JE-18 | Сховище секретів: системне чи файл з Argon2id | **OPEN** | review §5 | **блокує C2** (ключі профілю) і P1 |
| JE-19 | Store-and-forward класу D у LAN | **OPEN** | review §5 | C6c поза MVP |
| JE-20 | Чи потрібен store-and-forward у v1 | **OPEN** | review §5 (рек.: ні) | C6c поза MVP |
| JE-21 | CSP = `null` (P2-1): закрити чи письмово прийняти ризик | **OPEN** | review §5; `docs/BACKLOG.md` P2-1 | **блокує будь-який listener (C6a)**; будь-який скрипт головного вікна може викликати 99 команд |
| G01–G11 | Перевірки платформи | NOT_VERIFIED (крім часткової проби Base44 21.10) | `COLLECTIVES_PLAN.md` §9 | G06, G09, G11 — у C2/C3b/C6a; G01–G05 — лише для C4 |
| Q10а, Q12, К1–К11 | Рішення власника 20–21.10 | ACCEPTED (записані в `COLLECTIVES_PLAN.md` §10) | `MODULES_ROADMAP.md`, `COLLECTIVES_PLAN.md` | чинні для всіх етапів |
| ADR-C01…C05 | Статус «Запропоновано» | NOT_VERIFIED як рішення JE (пропозиції) | `docs/adr/README.md` | не вважати рішеннями (п. 8 наказу) |

Додаткові відкриті пункти поза нумерацією JE: бюджет C1c (A.0), нестабільний Rust-тест (A.0),
PR #169 (`chacha20poly1305` 0.11) — чи зливати до C2 (розділ D).

---

## C. R0_DEPENDENCY_GRAPH

```text
R2 (C1d: J5 → merge)      R1 (C1c, Codex T-0004 або J3)      R3 (C2a ADR + P1 ADR/код)
      │                          │                                   │ JE-15, JE-18, JE-21
      └────────────┬─────────────┘                                   ▼
                   │ (C1 повний: усі 4 ядра в main)            R4 (C2 Rust crypto)  ──► R5 (C2p PAKE/SAS; JE-07)
                   │                                                 │
                   │      JE-14 = так ──► R6 (C3 міграції 0017+) ◄───┘ (інакше R6 після R4)
                   │                          │
                   └──────────────────────────┤
                                              ▼
                                    R7 (C3b store + policy + IPC; вікно lib.rs/build.rs/capabilities)
                                              │
                        ┌─────────────────────┴──────────────────────┐
                        ▼                                            ▼
            R8 (C6a LAN direct; JE-13, JE-17, JE-21, JE-11)   R9 (C5 UI «Колективи», «Доповісти»)
                        └─────────────────────┬──────────────────────┘
                                              ▼
                                 R10 (наскрізний тест на двох ПК; JE-12 = лише синтетика)
```

**Дозволене паралельне виконання (без спільного запису):**
- R1 ∥ R2 ∥ R3 — три різні набори файлів (розділ D). R1 і R2 обидва пишуть лише рядок стану в
  `docs/COLLECTIVES_PLAN.md` §8 → R1 не чіпає docs (T-0004 так і вимагає), рядок додає J3 при інтеграції.
- R3 (документи ADR + `tests/network-boundary.test.mjs` + Rust `networkPolicy`) ∥ R1/R2.
- R6 ∥ R4 лише за JE-14 = так (формати ключів/обгорток зафіксовані в ADR C2a).
- R8 ∥ R9 після R7 (різні файли: transport/lan vs collective-ui).
- R5 ∥ R6/R7 (pairing.rs — окремий файл; але той самий `Cargo.lock` власник, що в R4).

**Критичний шлях до першого LAN MVP:** R3 → (JE-15, JE-18, JE-21) → R4 → R7 → R8 → R10.
C1 (R1, R2) не на критичному шляху, якщо завершиться до R7 (C3b імпортує логіку C1 як
спільні вектори). R5 (PAKE) можна відкласти за межі першого MVP, якщо JE дозволить
«вступ у LAN без короткого коду» для синтетичного тесту на двох ПК — це змінює ADR-C01, тому
за замовчуванням R5 входить у шлях перед R8 (Pair по LAN = C6a).

**Оцінка залишкового обсягу (припущення: один виконавець на задачу, бюджети за CONTRACT,
2 спроби, без зовнішніх очікувань; не строк, а обсяг):**

| Задача | Сеанси (estimate) | Припущення |
|---|---|---|
| R1 C1c | 1–2 | Codex 25 викликів або J3 ≈41 |
| R2 C1d приймання/злиття | ≤0.5 | лише J5 + merge + doc-рядок |
| R3 C2a + P1 | 2–3 | ADR ×2, `cargo audit` у тимчасовій гілці, `networkPolicy`, адаптер секретів; JE-21 — або CSP-правка з переліком ресурсів (велика), або письмове прийняття ризику |
| R4 C2 | 2 (+2 спроби) | крейти затверджені; test vectors |
| R5 C2p | 1–2 | PAKE-крейт у переліку JE-15 |
| R6 C3 | 1–2 | дві міграції |
| R7 C3b | 2–3 | інтеграційне вікно lib.rs/build.rs/capabilities |
| R8 C6a | 2 + ручна перевірка на 2 ПК | listener у головному процесі (JE-17), ручна адреса |
| R9 C5 | 2–3 | без C6b «Стан мережі» |
| R10 | 1–2 | Windows/macOS не в CI → ручні докази |
| **Разом** | **≈15–22 сеанси** | + час на 6 рішень JE (розділ F) і 2 ручні перевірки JE |

---

## D. R0_FILE_OWNERSHIP

Правило: один автор на файл у кожний момент; `Cargo.toml`/`Cargo.lock` — один власник; міграції і
`database.rs` — один відповідальний; `lib.rs` (`generate_handler!`), `build.rs` (`COMMANDS`),
`src-tauri/capabilities/*.json` і `tests/office-isolation.test.mjs` змінюються разом в одному
«інтеграційному вікні» (тест вимагає рівності handler == manifest; зараз 99 власних команд + `core:default` у головному вікні).

| Файл / область | R1 C1c | R2 C1d | R3 C2a+P1 | R4 C2 | R5 C2p | R6 C3 | R7 C3b | R8 C6a | R9 C5 | Інші активні роботи |
|---|---|---|---|---|---|---|---|---|---|---|
| `src/collective-core.js`, `src/collective-pair-core.js`, `tests/collective*.test.mjs` | **W** (Codex або J3) | — | — | — | — | — | R | — | R | — |
| `src/sync-policy-core.js`, `src/report-submission-core.js`, їхні тести | — | **W** (лише якщо J5 вимагатиме правок; інакше R) | — | — | — | — | R | — | R | — |
| `tests/collective-core-boundaries.test.mjs` | R (не змінювати, T-0004) | R | — | — | — | — | W (F-15, існування файлів) | — | — | — |
| `src/sensitivity-core.js`, `src/shared-table-core.js` | R | R | R | R | — | — | R (вектори) | — | R | — |
| `docs/COLLECTIVES_PLAN.md` §8 рядок стану | — (J3 після інтеграції) | **W** (вже у гілці #160) | W (§6, §9) | W | W | W | W | W | W | **PR #158 Комбат, #170 E2 — не чіпають**; H0 чіпав `MODULES_ROADMAP.md` → не торкатися в E8 |
| `docs/adr/collective-crypto.md`, `docs/adr/collective-pairing.md` (JE-02 запис) | — | — | **W** | R | R | — | — | — | — | — |
| `docs/adr/network-and-secret-boundaries.md` (новий), `tests/network-boundary.test.mjs` (новий) | — | — | **W** | R | — | — | R | R | — | план P1 `platform-release.md` — той самий власник |
| `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | — | — | **R3 лише у тимчасовій гілці без злиття** (`cargo audit`) | **W (єдиний власник)** | через R4 | — | — | лише через R4 (mDNS, якщо JE-17) | — | **Dependabot #165, #169 (`chacha20poly1305` 0.11)** змінюють lockfile → злити або закрити **до** R4; `claude/sqlite-query-indexes`, `claude/xlsx-duplicate-index` (ahead 1, без PR, застарілі) не оживляти без узгодження |
| `src-tauri/src/collective/{mod,identity,crypto,keys,protocol}.rs` | — | — | — | **W** | — | — | R | R | — | — |
| `src-tauri/src/collective/pairing.rs` | — | — | — | — | **W** | — | — | R | — | — |
| `src-tauri/migrations/0017_*.sql`, `0018_*.sql`, `src-tauri/src/database.rs`, `migrations/README.md`, `docs/DATABASE.md` | — | — | — | — | — | **W (єдиний)** | R | — | — | 0017 вільний на `cf08ac4`; перевірити ще раз перед R6 |
| `src-tauri/src/collective/{store,policy,sync,conflict}.rs` | — | — | — | — | — | — | **W** | R | — | — |
| `src-tauri/src/lib.rs` (`mod`, `generate_handler!`), `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `tests/office-isolation.test.mjs` | — | — | R3: лише `networkPolicy` без нових команд (або окреме вікно) | лише `mod collective;` у `lib.rs` | — | — | **W — інтеграційне вікно** | W — друге вікно (команди LAN) | R | `office-editor.json` — **не чіпати** (команди ключів не для редактора, G11); PR #158 їх не торкається |
| `src-tauri/tauri.conf.json` (CSP) | — | — | **W лише за JE-21 = «закрити»** | — | — | — | — | R | — | P2-1 беклог; `docs/plans/...platform-release.md` П1 вимагає перелік ресурсів legacy/WASM/3D до зміни |
| `src-tauri/src/collective/{transport,lan}.rs` | — | — | — | — | — | — | — | **W** | — | — |
| `src/collective-ui.js`, сторінки за `UNIFIED_FRONTEND.md`, `docs/USER_GUIDE.md`, `docs/UNIFIED_FRONTEND.md`, `tests/desktop-frontend.test.mjs` | — | — | — | — | — | — | — | — | **W** | **PR #158 Комбат змінює `USER_GUIDE.md`, `UNIFIED_FRONTEND.md`, `src/assistant/knowledge/index.json`; PR #170 — `UNIFIED_FRONTEND.md`** → R9 після їх злиття або з ребейзом; `node script/assistant_index.mjs` після правки USER_GUIDE |
| `AGENTS.md` | — | — | — | — | — | — | — | — | — | лише рішенням JE (JE-03 додаток Б) — поза всіма R |
| `src/air.html`, `src/rocket.html`, `src/index.html` | — | — | — | — | — | — | — | — | лише вузькі анкери (правила AGENTS) | ПВК lite ≈4.99 МБ ліміт (`tests/standalone-build.test.mjs`) — C5 код не має потрапляти в standalone-збірку |

**Перетини запису, виявлені зараз, і рішення:**
1. `Cargo.lock`: Dependabot #165/#169 ↔ R4. Рішення: JE/власник зливає або закриває #165/#169 до R4; R4 починається з актуального `main`; R3 не зливає lockfile.
2. `docs/COLLECTIVES_PLAN.md` §8: R2 (гілка #160) ↔ R1-інтеграція. Рішення: послідовно — спочатку злиття #160, потім рядок C1c.
3. `docs/USER_GUIDE.md` / `UNIFIED_FRONTEND.md` / `index.json`: R9 ↔ PR #158, #170. Рішення: R9 стартує після R7, до того часу ці PR мають бути злиті або R9 ребейзиться; регенерація індексу обов'язкова.
4. `lib.rs`/`build.rs`/`capabilities`: R7 ↔ R8 ↔ (R3, якщо `networkPolicy` потребує команди). Рішення: два послідовні вікна (R7, потім R8); R3 не додає IPC-команд.
5. C1c ↔ C1d: спільного запису немає (різні файли, межовий тест не змінюється) → паралель дозволена.
6. Codex: пише лише 4 файли T-0004, claim у `.codex/coordination/active` перед записом (board увімкнено, `task_prefix: EW`), без docs і без злиття.

---

## E. R0_TASK_DRAFTS

Повні чернетки наказів (ключі за CONTRACT v0.4 §3) — окремі файли в цій теці:
- `R1-C1c.order.draft.yaml` — членство, ролі, Pair state machine (Codex за T-0004 або J3).
- `R2-C1d.order.draft.yaml` — приймання J5, злиття PR #160, рядок стану.
- `R3-C2a-P1.order.draft.yaml` — криптографічний контракт + мережеві межі й сховище секретів.

Жодна з них не запускалась; ліміти без призначення позначено `NOT_AUTHORIZED`.

### E.4. Розбиття наступних етапів (R4–R10) — стисло

| Task | Scope (точно) | Дозволені файли | Заборонено | Вхід → вихід | Приймання / тести | Ризик і відкат | Дозволи JE | Ліміт |
|---|---|---|---|---|---|---|---|---|
| **R4 / C2** Rust crypto | ідентичність (ключ учасника + ключ пристрою), seal/open конверта (XChaCha20-Poly1305, AAD = відкриті поля), підпис операції, обгортки епох, ротація при відкликанні, anti-replay; **без IPC** | `src-tauri/src/collective/{mod,identity,crypto,keys,protocol}.rs`, `Cargo.toml`, `Cargo.lock`, `lib.rs` лише `mod collective;` | міграції, capabilities, CSP, UI, мережа, office_library.rs | ADR C2a (формати, версія протоколу, вектори) → модуль з векторами G06 | `cargo test --locked collective::`, `clippy -D warnings`, `fmt --check`, `cargo audit`; негативні: зміна байта → відмова, невідома епоха, відкликаний автор | lockfile-конфлікт — вікно злиття; відкат = revert PR, функція не підключена | JE-15, JE-16, JE-18 | NOT_AUTHORIZED (орієнтир рев'ю: 2 сеанси, 2 спроби) |
| **R5 / C2p** PAKE+SAS | PAKE за ADR-C01, SAS з транскрипту, ліміт спроб (параметри), ідемпотентний `request_id` | `src-tauri/src/collective/pairing.rs` + тести; крейт PAKE — через власника R4 | усе інше | C2 → функції для C6a | P03–P04, P06–P07, вектори | слабкий код → лише PAKE+SAS; відкат revert | JE-15 (PAKE-крейт), JE-07 | NOT_AUTHORIZED |
| **R6 / C3** міграції | `0017_collectives.sql` (колективи, учасники, пристрої, епохи, обгортки, запрошення, заявки, події членства), `0018_collective_sync.sql` (спільні таблиці, `sync_policies` з `policy_version`, операції, outbox, inbox, конфлікти, квитанції, курсори); усі таблиці з `profile_id`; **без `mesh_*`** | міграції, `database.rs`, `migrations/README.md`, `docs/DATABASE.md`, тест міграції | код C3b, IPC | формати з ADR C2a → схема | міграція з порожньої і зі синтетичної БД 0016; повторний запуск; `cargo test --locked` | append-only; відкат — резервна копія перед оновленням (`app_update.rs`) | JE-14 | NOT_AUTHORIZED |
| **R7 / C3b** store, policy, IPC | атомарна транзакція «approved-ревізія + операція + outbox + курсор»; карантин; `policy.rs` = `networkPolicy` ∘ `routeFor` ∘ `syncPolicy` ∘ членство ∘ підпис; IPC без довільних `collective_id`/шляхів/SQL; команди ключів лише головному вікну; спільні JSON-вектори з C1a/C1b/C1d; закрити F-7, F-15, F-21 | `src-tauri/src/collective/{store,policy,sync,conflict}.rs`, `lib.rs` (`generate_handler!`), `build.rs`, `capabilities/default.json`, `tests/office-isolation.test.mjs`, `tests/collective-core-boundaries.test.mjs` | `office-editor.json`, CSP, UI, LAN | C3 + P1 → IPC-контракт для C5/C6a | S05–S06, S10, M04, M07, A01–A02, AC13, AC15, G09, G11 | інтеграційне вікно — один автор; відкат revert | JE-03/04 лишаються denied; без нових JE | NOT_AUTHORIZED |
| **R8 / C6a** LAN direct + Pair по LAN | прямий `push/pull` між двома клієнтами за ручною адресою; listener у головному процесі з жорсткими лімітами (якщо JE-17 так); доставка заявки Pair; без relay/store/mDNS | `src-tauri/src/collective/{transport,lan}.rs`, друге інтеграційне вікно `lib.rs`/`build.rs`/`capabilities` | C6b/C6c, WAN, Base44 | C3b IPC + P1 `networkPolicy` → транспорт | два профілі на одній машині; **два ПК — окремий доказ у `docs/evidence/collectives/`**; сценарії відключення мережі | listener з доступом до всіх команд → P1 + JE-21 до старту; відкат — функція вимкнена за замовчуванням | JE-13, JE-17, JE-21, JE-11 (мінімум — «без host у v1») | NOT_AUTHORIZED |
| **R9 / C5** UI | «Колективи», «Створити», «Запросити», «Вступити» (SAS, стан по таблицях), «Доповісти» (було→стане, повний рядок, дублікати/конфлікти, видалення з підтвердженням), «Аудит»; без «Вхідні зміни» (JE-04) і «Стан мережі» (C6b) | `src/collective-ui.js`, сторінки за `UNIFIED_FRONTEND.md`, `docs/USER_GUIDE.md`, `docs/UNIFIED_FRONTEND.md`, `tests/desktop-frontend.test.mjs`, `src/assistant/knowledge/index.json` (регенерація) | крипто/політика (лише виклики IPC), legacy HTML поза вузькими анкерами, standalone-збірка | IPC R7 → екрани | текстові контракти; AC05; `prefers-reduced-motion`; клавіатура | конфлікт з #158/#170 у docs; відкат revert | JE-07, JE-08, JE-08а (UX) | NOT_AUTHORIZED |
| **R10** наскрізний тест на двох ПК | синтетичний колектив із 2–3 учасників, вступ по LAN, «Доповісти», конфлікт, відкликання з новою епохою; Windows + macOS | `docs/evidence/collectives/*.md` (докази), без коду | реальні дані (JE-12) | R8 + R9 → протокол перевірки | AC01–AC08, AC19–AC20, G06, G09, G11 | без CI на macOS/Windows — ручні докази; невідтворювані кроки = не прийнято | JE-12 (підтвердити «лише синтетика»), участь JE у ручній перевірці | NOT_AUTHORIZED; виконавці J3 + C3 + J5 |

---

## F. R0_JE_DECISION_PACKAGE

Рішення, потрібні для запуску наступних етапів (у порядку критичного шляху). Для кожного: рекомендований варіант (довідково, не умовчання), альтернатива, ризик, наслідок відмови.

| № | Рішення | Рекомендовано | Альтернатива | Ризик | Наслідок відмови / без рішення |
|---|---|---|---|---|---|
| **F.1** | **Бюджет і виконавець C1c (R1).** T-0002 має ≈29 викликів при потребі ≈41 | Нова поправка A-2: ліміт T-0002 → 225 (+15, покриває C3 ≈10 + J3 ≈6 для C1c) і підтвердити T-0004 для Codex (25 власних) | Перепризначити C1c на J3 новим наказом з власним лімітом (≈45) | подвійний облік; Codex estimate | C1c не стартує; C1 неповний; R7 без ядра членства |
| **F.2** | **Чи запускати Codex T-0004 зараз** (ліміт провайдера був причиною зупинки 22.10) | Так, якщо Codex доступний: handoff за §20 контракту, claim на board, лише 4 файли | J3 виконує за альтернативою F.1 | маршрут J4→Codex не перевірено наживо (stub) → передача вручну | те саме, що F.1 |
| **F.3** | **JE-13 LAN-first** записати як рішення | Так: C6a + C5 перед C4; Base44 лишається після G01–G05 | Base44-first (тоді C0/C4 входять у критичний шлях, G01–G05 не доведені) | клас D усе одно потребує LAN | критичний шлях не визначений; R8 не планується |
| **F.4** | **JE-01 розширити: дозвіл на R3 (C2a + P1) як документ + тестову гілку** | Так, без зміни `Cargo.lock` у `main` | Чекати завершення C1 | низький (документи, тести) | зупинка всього Rust-шляху |
| **F.5** | **JE-15 перелік крейтів** (подається в R3; затвердити після) | Ed25519 (`ed25519-dalek`), X25519 або HPKE, XChaCha20-Poly1305 (є), CPace/SPAKE2 для PAKE, детермінований CBOR — конкретні версії/ліцензії/аудит дасть R3 | Мінімальний набір без PAKE (вступ лише ручним звірянням відбитків) — змінює ADR-C01 | нові залежності, `cargo audit`, Windows/macOS G06 | R4/R5 не стартують; `Cargo.lock` заморожений (К9) |
| **F.6** | **JE-18 сховище секретів** | P1-ADR: файл із ключем від Argon2id пароля профілю (патерн уже є в `office_library.rs`), системне сховище — пізніше | Keychain/Credential Manager одразу (новий крейт, платформенні тести без CI) | профіль без пароля → колектив вимкнено | R4 не має куди класти ключі |
| **F.7** | **JE-21 / P2-1 CSP** | Закрити до будь-якого listener: R3 складає перелік ресурсів (legacy, WASM, worker, 3D, `frame-src`), окремий PR CSP; якщо не встигаємо — **письмове прийняття ризику JE** з терміном | Прийняти ризик письмово для LAN MVP на синтетиці, закрити в H7 | 99 команд доступні будь-якому скрипту головного вікна; listener розширює поверхню | R8 заборонено (правило P1 і review C04) |
| **F.8** | **JE-17 listener** | Головний процес з жорсткими лімітами (розмір, кількість з'єднань, лише LAN-адреси) + ручна адреса; mDNS не в MVP | Sidecar-процес (більше роботи, краща ізоляція) | firewall-запити на Windows/macOS лякають користувача | R8 не стартує |
| **F.9** | **JE-14 порядок C3** | Так: R6 після ADR C2a паралельно з R4 (скорочує шлях на 1–2 сеанси) | R6 після повного R4 | схема може змінитися після векторів C2 → друга міграція | послідовно, довше |
| **F.10** | **JE-11 мінімум для C6a** | Записати: у v1 host немає; журнал членства — підписаний і реплікований; relay/handover — C6b | Явний host уже в C6a | split-brain на 2 ПК при одночасних відкликаннях | R8 без правила авторитету = ризик розбіжності |
| **F.11** | Злити/закрити Dependabot #165, #169 (lockfile) до R4; підтвердити, що `chacha20poly1305` 0.11 — бажана база для C2 | Злити після зеленого CI | Закрити, R4 сам оновить | ламає `Cargo.lock` R4 | конфлікт lockfile при R4 |
| **F.12** | Нестабільний Rust-тест у CI (2 випадки) — окрема задача чи прийняти | Окрема мала задача J3: знайти тест, зробити детермінованим (підозра — `local_model::tests::an_idle_runner_is_unloaded`, timing) | Прийняти (rerun) | хибні червоні CI на кожному PR E8 | шум у прийманнях |
| **F.13** | **JE-12** підтвердити: R10 і все до релізу — лише синтетика | Так | — | — | без запису реальні дані формально не заборонені наказом R-серії |
| F.14 | JE-07 (формати/ліміти Pair) — потрібно до R5/R9, не зараз | Прийняти значення J3 як робочі для синтетики з правом змінити після UX-тестів | Відкласти до R9 | — | R5 без лімітів не тестується |
| F.15 | Усунути розбіжність документів щодо JE-02 (`COLLECTIVES_PLAN.md` §6, ADR pairing кажуть «відкрито», наказ T-0002 — прийнято) | Дозволити J3 правку рядків статусу в R2/R3 (без зміни суті) | Лишити до H7 | плутанина для Codex/C3 | — |

Без F.1–F.4 наступний крок лише один: приймання J5 для PR #160 (R2), яке дозволу JE не потребує.

---

## Перевірка критеріїв приймання R0 (п. 9 наказу)

- [x] Підтверджено фактичний стан C1a–C1d (A.1): C1a/C1b MERGED+ACCEPTED, C1c ABSENT, C1d у PR #160 без J5.
- [x] Критичні блокери LAN MVP: JE-15, JE-18, JE-21, JE-17, JE-13 (запис), P1 не реалізовано, бюджет C1c, PR #169 lockfile.
- [x] Реєстр рішень JE (B): 11 ACCEPTED (JE-01, 02, T1–T9), 1 CONFLICT документів (JE-02), 19 OPEN, ADR — не рішення.
- [x] Безконфліктні межі задач (D): перетини 1–6 з рішеннями.
- [x] Чернетки з тестами, залежностями й gates (E, файли R1–R3; R4–R10 у E.4).
- [x] Несанкціонованих змін або витрат не здійснено (A.4).
- [x] Однозначний список дозволів JE (F.1–F.15).

**Не перевірено в R0 і чому:** `cargo test`/`clippy`/`build` локально (замість них — зелений CI на тих самих SHA);
поведінка реального webview щодо capabilities (тест файловий, за `docs/WORKSPACE.md`); збірки macOS/Windows;
живий маршрут J4→Codex; фактичний облік викликів Codex (estimate за контрактом §19).
