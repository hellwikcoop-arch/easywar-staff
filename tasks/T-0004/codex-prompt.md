# T-0004 · Завдання для Codex (C5.1): E8 / C1c — ядро членства й машина станів вступу

**Статус:** проєкт v1 (ред. 22.10.2026 за вимогами J5 A–D) на остаточну перевірку J5 і рішення JE. Не запускати до погодження J5, злиття PR #157 і `task_accepted`.

## 1. Хто ти й межі

Ти — C5.1 (Codex) штабу EasyWAR. Начальник за цим завданням — J3 (Claude): він технічно приймає
й інтегрує код. Незалежну рецензію робить C3, змістове приймання — J5. Ти **не зливаєш** PR, не
пишеш у `main`, не створюєш підлеглих, не розширюєш обсяг і не змінюєш нічого поза чотирма
файлами з розділу 3. Сумнів щодо правила — питання J3, а не власне рішення.

- Репозиторій: `hellwikcoop-arch/EasyWAR`.
- База: `main` після злиття PR #157 (SHA назве J3 у `task_created`).
- Гілка: `codex/t-0004-c1c-membership`.
- Перед записом виконай протокол `codex-coordinator` і опублікуй claim лише на чотири файли (`AGENTS.md`, «Codex task-boundary board»).

Прочитай: `AGENTS.md`, `CLAUDE.md`, `docs/COLLECTIVES_PLAN.md` (розділ 2 — Q10в; розділ 6 —
«Вступ», К3, «Відкликання чи вихід», К4; розділ 11 — AC01, AC02, AC10, AC19, AC20),
`docs/adr/collective-pairing.md`, `src/shared-table-core.js` і `src/sensitivity-core.js` (зразок
стилю), `tests/collective-core-boundaries.test.mjs` (межі, які застосуються до твоїх файлів автоматично).

## 2. Червоні лінії

- Лише синтетичні дані (`member-synthetic-a`, `collective-synthetic-1`, `inv-synthetic-1`).
- Не змінювати: `src-tauri/**`, міграції, capabilities, CSP, `Cargo.*`, `package*.json`, `AGENTS.md`,
  legacy HTML, `docs/**`, `tests/collective-core-boundaries.test.mjs`, будь-які наявні файли.
- У ядрах немає: генерації кодів, PAKE, обчислення SAS, мережі, пошуку учасників, криптографії,
  сховищ, DOM, годинника (`Date`, `performance`, таймери), випадковості, Tauri, `eval`, динамічного
  імпорту, `node:`-імпортів. Час — параметр `now` (ціле число логічного часу). Підпис — функція-параметр `verify`.
- Нових залежностей немає. Ядра не імпортуються робочим застосунком.
- Мова: коментарі українською; назви, API, машинні коди помилок — англійською.
- Кожна функція повертає новий заморожений стан і не змінює вхідний; збережене — глибокі
  заморожені копії; ключі `__proto__`, `constructor`, `toString` у будь-яких ID не ламають стан.

## 3. Файли

| Файл | Зміст |
|---|---|
| `src/collective-core.js` | членство |
| `src/collective-pair-core.js` | машина станів вступу; може імпортувати лише `./collective-core.js` |
| `tests/collective.test.mjs` | тести членства |
| `tests/collective-pair.test.mjs` | тести Pair |

## 4. `collective-core.js` — членство

**Ролі:** `owner | admin | member`; підпис ролі (`label`) — довільний текст, який учасник задає собі сам (Q10в).

**Події журналу** (поля спільні: `event_id`, `collective_id`, `type`, `actor_member_id`, `signature`, `now`):

| `type` | Дані | Хто може | Правило |
|---|---|---|---|
| `collective_created` | `owner_member_id` | перша подія, `actor` = власник | один раз; власник має епоху 0 |
| `member_admitted` | `member_id`, `request_id`, `candidate_consent: true`, `approver_member_id` | `actor` = `approver_member_id` | лише за згодою кандидата **і** підтвердженням чинного учасника, який має **всі** епохи (JE-T2, К3, AC19). Наявність епох — функція-параметр `heldEpochs(memberId) → number[]`, порівнюється з `state.epochs` |
| `member_revoked` | `member_id` звичайного учасника | `owner` або `admin` (Q10в) | відкликання власника чи адміністратора — `owner-decision-required` |
| `member_left` | — | сам учасник, крім власника | вихід власника — `owner-decision-required` |
| `admin_granted`, `admin_revoked` | `member_id` | — | **до рішення JE-T6** — `owner-decision-required` для будь-кого; адміністратор не має прав власника автоматично |
| `role_label_set` | `label` (1–60 символів, без керівних символів) | сам учасник | |

**Неврегульовані дії не дозволяються:** будь-яка дія з ролями, якої немає в таблиці, повертає
`owner-decision-required` (fail-closed). Правила JE-T6 (`j5-brief.md`, розділ B), якщо JE їх
затвердить, J3 внесе в цей розділ до запуску.

**Учасник без усіх епох ключів** (уточнення J5, A): лишається учасником; читає дані лише тих
епох, ключі яких має; не може підтверджувати вступ (`approver-missing-epochs`) і передавати
ключі; ядро **ніколи** не запитує й не видає відсутні ключі автоматично. Експорт
`memberCapabilities(state, memberId, { heldEpochs }) → { isMember, heldEpochs, missingEpochs,
canApproveJoin, canUseCurrentEpoch }` — лише опис, без дій.

`member_revoked` і `member_left` вимагають нової епохи: `state.epochs` отримує нову епоху, а
`epochRecipients(state, epoch)` повертає лише чинних учасників (AC10, логіка; розсилку ключів робить C2).

**Експорти:**

| Експорт | Вимога |
|---|---|
| `ROLE_KINDS`, `EVENT_TYPES` | заморожені |
| `membershipState(events, { verify, heldEpochs })` | згортання в заданому порядку; повтор `event_id` з тими самими канонічними байтами — пропуск, з іншими — `integrity_violation` у `state.rejected`; без `verify` або з `verify !== true` (у т. ч. виняток) — подія відкинута; невалідна подія — у `state.rejected` з машинним кодом (`bad-signature`, `not-allowed`, `approver-missing-epochs`, `no-candidate-consent`, `not-a-member`, `owner-protected`, `invalid-event`, …), стан учасників не змінюється |
| `isMember(state, id)`, `roleOf(state, id)`, `canApprove(state, id, { heldEpochs })`, `memberCapabilities(...)` | `canApprove` — чинний учасник із усіма епохами |
| `canRevoke(state, actorId, targetId)` | owner/admin; не власника |
| `epochRecipients(state, epoch)` | чинні учасники для епохи |
| `adminWarnings(state)` | `['single-admin']`, якщо власник + адміністратори < 2 (К4, AC20) |
| `historyStatusByTable(tables)` | `tables: [{ tableId, keysComplete, historyComplete }]` → `{ [tableId]: 'complete' | 'pending' }` і загальне `pending`, якщо є хоч одна `pending` |

## 5. `collective-pair-core.js` — машина станів вступу

Стани запиту (ADR): `DRAFT → ACTIVE → JOIN_REQUESTED → SAS_VERIFIED → APPROVED_BOTH →
MEMBERSHIP_RECORDED → KEYS_DISTRIBUTED → HISTORY_VERIFIED → COMPLETE`; гілки `EXPIRED`, `REVOKED`,
`REJECTED`, `RATE_LIMITED`, `WAITING_FOR_APPROVAL`, `PENDING_HISTORY`, `ERROR_RETRYABLE`.
`DRAFT` і `ACTIVE` — стани запрошення; запрошення також може бути `EXPIRED`, `REVOKED` або
`RATE_LIMITED`. **Нового стану `EXHAUSTED` не вводити** (вимога J5, C: до затвердження контракту).
Витрачене запрошення лишається `ACTIVE`, а лічильник `joinsUsed` (зростає при
`membership_recorded`) блокує нові заявки: `join_requested` при `joinsUsed ≥ maxJoins` →
`{ ok: false, code: 'invitation-exhausted' }`. Особисте — `maxJoins = 1`.

**Config** (обов'язковий, без значень за замовчуванням — JE-07): `{ maxAttempts, maxActiveRequests,
profileHasPassword }`. Без config або з `profileHasPassword !== true` — `config-required` /
`profile-without-password` (P09).

**Експорти:**

| Експорт | Вимога |
|---|---|
| `PAIR_STATES`, `PAIR_EVENTS`, `INVITATION_MODES` (`personal`, `group`) | заморожені |
| `createInvitation({ invitationId, collectiveId, inviterId, mode, maxJoins, expiresAt, now }, config)` | `DRAFT`; `personal` — `maxJoins` = 1 |
| `pairTransition(state, event, ctx)` | `ctx: { config, membership, heldEpochs }`; повертає `{ ok, state, code }`; недозволений перехід — `{ ok: false, code: 'invalid-transition' }` без змін |

**Події:** `activate`; `join_requested { requestId, candidateId, now }` (лише `ACTIVE`, `now <
expiresAt`, ліміти; той самий `requestId` з тими самими даними — ідемпотентно, з іншими —
`request-id-conflict`); `sas_result { requestId, match }` (результат звірки приходить ззовні;
`false` → `REJECTED`, спроба рахується; спроби ≥ `maxAttempts` → запрошення `RATE_LIMITED`);
`candidate_confirmed { requestId }`; `approver_confirmed { requestId, approverId }` (лише
`canApprove`; порядок двох підтверджень довільний; обидва → `APPROVED_BOTH`);
`approver_unavailable { requestId }` → `WAITING_FOR_APPROVAL`, з якого `approver_confirmed`
продовжує; `membership_recorded { requestId }` (лише з `APPROVED_BOTH`); `keys_distributed
{ requestId, complete }` (`true` → `KEYS_DISTRIBUTED`, `false` → `PENDING_HISTORY`);
`history_verified { requestId, byTable }` (усі `complete` → `HISTORY_VERIFIED`, інакше
`PENDING_HISTORY` з переліком таблиць); `complete { requestId }` (лише з `HISTORY_VERIFIED`);
`retryable_error { requestId }` → `ERROR_RETRYABLE` із запам'ятаним попереднім станом, `retry`
повертає до нього; `expire { now }` (якщо `now ≥ expiresAt`: запрошення `EXPIRED`, незавершені
запити до `MEMBERSHIP_RECORDED` → `EXPIRED`); `revoke` (запрошення `REVOKED`, незавершені запити
до `MEMBERSHIP_RECORDED` → `REVOKED`). Запити після `MEMBERSHIP_RECORDED` відкликання запрошення
не скасовує: членство вже записане.

Код, SAS і ключі не генеруються й не зберігаються. Групове запрошення — окремий запит і окремі
підтвердження на кожен вступ; автоприйняття немає.

## 6. Тести (`node --test`, лише синтетика)

Членство: AC01 (кілька колективів одного профілю без витоку повноважень — два незалежні стани),
AC02 (згода обох; підроблений підпис і підроблений `member_id`; відкликання; вихід), AC19
(підтверджувач без усіх епох — відмова; `memberCapabilities` не дає підтверджувати й не видає ключів), AC10 (відкликаний не в одержувачах нової епохи), AC20
(попередження), захист власника й `owner-decision-required` для всіх неврегульованих дій з ролями, повтор і цілісність `event_id`, незмінність стану, ключі прототипу.

Pair: P01 (особисте: повний шлях до `COMPLETE`; друга заявка — `invitation-exhausted`, запрошення лишається `ACTIVE`), P02 (групове на 20: 20
окремих вступів, 21-й — відмова), P03 (прострочення, ліміт спроб, `RATE_LIMITED`), P04 (повтор
події не переприв'язує; `request-id-conflict`), P05 (запрошувач недоступний — `WAITING_FOR_APPROVAL`,
без ключів), P06 (SAS не збігся — `REJECTED`), P07 (той самий `requestId` двічі — ідемпотентно), P08
(неповні ключі чи історія — `PENDING_HISTORY`, не `COMPLETE`), P09 (профіль без пароля), `COMPLETE`
недосяжний обхідними шляхами (перебір усіх подій із кожного стану: недозволене — `invalid-transition`),
config без значень — відмова.

Окремо (C3 F-15): тест, що `C1_CORES` з `tests/collective-core-boundaries.test.mjs` містить обидва
нові файли.

Мутаційні проби на 3 правила (згода обох, епохи підтверджувача, `COMPLETE` лише з
`HISTORY_VERIFIED`): прибрана перевірка має провалювати тест. Проби відкотити, не комітити.

## 7. Перевірки й передача

```bash
node --test tests/collective.test.mjs tests/collective-pair.test.mjs tests/collective-core-boundaries.test.mjs
npm run test:unit
git diff --name-only origin/main...HEAD   # рівно чотири файли
```

Відкрий PR у `main` (не зливати). Передай J3 за `handoff_format_for_C5.1_code` (CONTRACT_v0_4.md,
розділ 20): `task_id: T-0004`, `task_version`, `base_commit`, `branch_ref`, `head_commit`,
`files_changed`, `summary`, `verification_refs` (команди й результати на head), `limitations`,
`synthetic_materials_refs`, `report_ref`, `integration_owner: J3`.

## 8. Бюджет

До 25 викликів інструментів; 2 спроби на крок. При 70 % (18) або на останній спробі — донесення
J3 типу `deviation`. Вичерпано — зупинка й запит J3; новий бюджет не створюється.
