# 1. Архітектура J4 Bridge — поточна і цільова (етап A)

Місія J4 AUTONOMY HARDENING, 2026-10-27. База аудиту: гілка `t-0010/stabilization`, вершина `0f2cd0b819f25d386311a9f16e3c78b6e923903f`
(PR №7, чернетка), код `bridge/` ідентичний контрольному SHA T-0010 `96ff45a2feafcf0964eda290a2eacca52d3ab2e3`; базова гілка
`t-0009/j4-automation` = `efe03c959107856f2536771ae5c023f1e007e7be` (PR №6, чернетка). CI T-0010: run `40537188604`, success
(105 тестів: 103 pass, 2 skipped під root — A4, A5; на CI під не-root усі 105). Контракт: `CONTRACT_v0_4.md` розд. 4, 6, 8, 9а.
Аудит — лише читання коду й синтетичні копії; жоден файл `bridge/`, `CONTRACT_v0_4.md`, `.github/` не змінювався.

## 1.1. Компоненти і їх відповідальність (факт за кодом)

| Файл | Роль | Джерело істини, яким володіє | Пише |
|---|---|---|---|
| `bridge/src/protocol.mjs` | форма повідомлення `j4.msg/0.1`, канонічний JSON, `sha256`; `body.task_state: done` відхиляється (`done-forbidden`) | — | — |
| `bridge/src/policy.mjs` | права ролей (`roles.json`), ребра маршрутизації (`routes.json`), `taskAccepted()` читає `tasks/<id>/events.jsonl` | конфігурація `bridge/config/**` (захищена) | — |
| `bridge/src/guards.mjs` | бюджет задачі (`budget/<task>.json`: резерв → розрахунок), нитки, цикли, хопи, глибина делегування | стан у `J4_HOME/budget`, `J4_HOME/threads` | `J4_HOME` |
| `bridge/src/gate.mjs` | ворота живих викликів: `J4_ALLOW_LIVE`, файл погодження JE, ціна, стеля виходу, облікові дані | файл погодження (`bridge/approvals/live.json`) | — |
| `bridge/src/monthly.mjs` | місячна стеля $50 (D-19) | `J4_HOME/budget/monthly.json` | `J4_HOME` |
| `bridge/src/scanner.mjs` | страхувальний сканер секретів і опер. даних | — | — |
| `bridge/src/store.mjs` | локальний стан J4 (`queue`, `messages`, `spool`, `threads`, `inbox`, `escalations`, `budget`), атомарні записи, замки; `Store.open` — лише читання (T-0010) | **сховище J4 = `J4_HOME`**; ознака сховища слабка (одна підтека `escalations`) | `J4_HOME` |
| `bridge/src/ledger.mjs` | журнал доказів J4: JSONL, ланцюг хешів `prev → hash`, `seq`, без текстів; `verifyLedger` | **журнал J4 = `J4_LEDGER`** | `J4_LEDGER` |
| `bridge/src/router.mjs` | клас `J4`: `submit` → перевірки → `queued`/`held`; `process` під замком → `deliver` → адаптер → `finalize` → `submitReply`; `escalate`/`resolve`; `recover`; `syncTaskEvents` | стан повідомлень і ескалацій у `J4_HOME`; докази — у журналі | `J4_HOME`, `J4_LEDGER`, (з `--task-events`) `tasks/<id>/events.jsonl` |
| `bridge/src/events.mjs` | події ADM у `events.jsonl`: лише `report_filed`, `escalation`, `state_changed=done` (через `closeTask`); один рядок O_APPEND під замком; ключ `j4_key` | **журнал дій задачі** (єдиний журнал дій за контрактом 9а.3) | `tasks/<id>/events.jsonl` |
| `bridge/src/acceptance.mjs` | бар'єр приймання: `acceptanceReady`, `evidenceFromEvents`, `requestDone` (лише ADM) — **захищений файл** | — (читає `events.jsonl`) | — |
| `bridge/src/close.mjs` | `j4 close`: наказ (`orderGate`), докази `checks` (суворий розбір), три джерела ескалацій, `readLedgerStrict`, `inspectJ4Home`, запис `done` | — | `events.jsonl` (лише `done`) |
| `bridge/bin/j4.mjs` | CLI: `send`, `submit`, `run [--once]`, `close`, `inbox`, `escalations`, `resolve --human`, `budget`, `acceptance`, `verify`; `J4_STAFF_ROOT` лише для копій; стоп-кран `bridge/HALT`, `J4_HALT` | — | — |
| `bridge/bin/j4-tick.sh` | один такт за розкладом: `run --once --mode stub --task-events`; знімає змінні live | — | `tick.log` |
| `.github/workflows/j4-bridge.yml` | `test` на PR (`bridge/**`), `route-stub`/`route-live` лише `workflow_dispatch`; live — environment `j4-live` з рецензентом JE | — | артефакт журналу |

## 1.2. Карта потоку `task → J4 → J3 → перевірки → C3 → J5 → JE → рішення ADM`

Позначення: ДІ — джерело істини; ПЗ — хто має право запису; ІД — перевірка ідентичності автора; SHA — контроль `subject`; ПП — поведінка після перезапуску/збою.

| № | Перехід | ДІ | ПЗ (факт) | ІД (факт) | SHA | ПП | Знахідка |
|---|---|---|---|---|---|---|---|
| 1 | наказ → задача (`task_created`, `task_accepted`) | `tasks/<id>/order.yaml`, `events.jsonl` | requester/assignee вручну (git) | **немає**: поле `by` не автентифікується (F-9) | `base_sha` у наказі | git | `taskAccepted()` читає лише факт події; `task_id` в події звіряється |
| 2 | J3 → J4 (`j4 send`/`submit`, origin `agent_cli`) | чернетка + журнал J4 | J3 через CLI | `checkSender`: роль за `from` і `origin`; `from: JE` з `agent_cli` відхиляється; хто фактично запустив CLI — не перевіряється | `subject.ref` повний SHA; `contract.sha256` звіряється з файлом | `message_accepted` → `queued`; стан у `messages/` | рівень C і `decision_needed` → `held` + ескалація |
| 3 | J4 → J5 (адаптер `openai`, у stub — `stub`) | журнал: `dispatch_attempt`, `reply_received` (хеші), спул (тимчасово) | тільки J4 | роль відповіді = адаптер, не текст (D-11) | `subject` копіюється у відповідь | `dispatched` без спулу → `dispatch_outcome_unknown`, спроба зарахована; зі спулом → `finalize` без повторного виклику | live лише через `checkLive`; stub не є відповіддю J5 (README) |
| 4 | J5 → J3 (відповідь → `inbox/J3`) | `inbox/J3/*.json`, журнал `message_delivered` | J4 (deposit) | — | те саме | ідемпотентно за `ledgerHas` | J3 читає вручну (`j4 inbox`); ручна ланка M-1 |
| 5 | перевірки (`checks`) | **файл доказів у сховищі штабу** (`reports/T-XXXX/NNN.yaml`), наказ `checks.verify` | J3 (git) | **немає** (F-9) | запис `{cmd, subject: <SHA>, result}`; суворий розбір (T-0010) | git | **F-T10-11/R-11, R-10, R-12** (цей пакет, T-0012 P1) |
| 6 | J3 → C3 (рецензія) → `review_requested`/`review_finished` | `events.jsonl`, `reports/T-XXXX/c3-reviews.yaml` | J3 записує від імені C3 (ручна ланка M-2) | **немає**; незалежність C3 — організаційна (`checkIndependence` є лише для C5.1-R) | `subject` у події | git | **F-T9-16**: `review_status` відсутнє → `complete` за замовчуванням |
| 7 | J3 → приймання technical (`acceptance`) | `events.jsonl` | J3 | немає (F-9) | `subject` | git | **F-T9-16**: `result` відсутнє → `accepted`; **SCOPE-1**: межі приймання бар'єру невідомі |
| 8 | J5 → приймання content (`acceptance`) | `events.jsonl` | фактично J3 записує висновок J5 (ручна ланка) | немає | `subject` | git | те саме; J5 свідомо не створює `acceptance` (T-0009, T-0010) |
| 9 | ескалації → JE → рішення (`resolve --human`, `command`, `decision`) | сховище `escalations/*.json`; журнал `escalation_raised/resolved`; `events.jsonl` `escalation`/`command` | `resolve` — лише `human_cli`; `command` — вручну | **`--human` не доказ особи** (F-3) | — | `resolve` змінює файл ескалації атомарно; стан нитки `awaiting_founder → open/halted` | три джерела ескалацій не звіряються між собою за **установкою** (F-T9-18) |
| 10 | ADM `j4 close` → `done` | `events.jsonl` (`state_changed`, `by: ADM`, `evidence_sha256`) | ADM = той, хто запускає CLI із правом запису в репозиторій | **немає**: будь-хто з правом запису може як запустити `close`, так і вписати `done` вручну (межа рівня C) | бар'єр на ОДНОМУ SHA; `done-exists-other-subject`; гонка — `done-exists` під замком | ідемпотентно (`already`) лише за читних джерел (F-T9-21, опис) | **F-T9-18**: пара `J4_HOME`/`J4_LEDGER` не прив'язана до установки; F-T9-15: бар'єр поза замком |
| 11 | J4 → `events.jsonl` (`syncTaskEvents`) | журнал J4 → події ADM з `ref: j4-ledger#seq=N`, `ledger_file`, `ledger_hash`, `j4_key` | ADM (увімкнено лише `--task-events`) | — | `subject` з повідомлення | повтор без дублікатів за `j4_key`; збій → `task_event_failed`, код 6 | звірка `ref/ledger_hash` ↔ журнал при `close` **не виконується** (В-B з `reports/T-0009/005.yaml`) |

### Висновки по карті

1. **Два журнали, одне право запису.** Усі переходи 1, 5–8, 10 тримаються на праві запису в репозиторій; J4 перевіряє узгодженість, а не особу. Це задекларована межа рівня C (F-9, F-3) і не змінюється в T-0011/T-0012 (G4 T-0011).
2. **Єдине місце, де код може зупинити `done`, — `closeTask`.** Усі заявлені дефекти (F-T9-16, SCOPE-1, F-T10-11, R-10, F-T9-18) — це прогалини саме в цьому бар'єрі або в його джерелах, тому обидва завдання правлять лише його вхід (`acceptance.mjs`, `close.mjs`, `store.mjs`, `ledger.mjs`), а не маршрутизацію.
3. **Відновлення після збою** в `router.mjs` (`recover`) і `ledger.mjs` (`repairIfNeeded`) коректне для черги; для `close` відновлення не потрібне — він або пише один рядок, або нічого.
4. **Три джерела ескалацій** (сховище, журнал J4, `events.jsonl`) об'єднуються як множина «відкритих», але жодне з них не несе ознаки, якій установці належить. Звідси F-T9-18 (відтворено, `05-experiments.md`, S18-2/S18-6).

## 1.3. Класифікація знахідок аудиту

| Id | Тип | Критичність | Підтверджено | Де |
|---|---|---|---|---|
| F-T9-16 | дефект бар'єра (значення за замовчуванням) | висока (формальна неповнота пропускає `done`) | так, S16-1/2/4/5 | `acceptance.mjs:55,58` |
| SCOPE-1 | дефект моделі запису (межі приймання невидимі бар'єру) | висока | так, SC1-0…SC1-4 | `acceptance.mjs:34`; `events.jsonl` T-0006 seq 12 |
| F-T10-11 / R-11 | дефект розбору доказів (варіантна `cmd`, запис без `cmd`) | середня (потребує автора доказів із правом запису) | так, R11-1/2/3/6 | `close.mjs passingCommands/checksFrom` |
| F-T10-10 / R-10 | дефект розбору (тег/якір перед `|`/`>`) | низька (нетиповий YAML) | так, R10-1/2/3 | `close.mjs passingCommands` |
| F-T10-12 / R-12 | прогалина тестів і README | низька | частково: R12-1 показує, що поведінка правильна, тесту немає | `t0010.test.mjs`, `README.md` |
| F-T9-18 | дефект ідентичності джерел | висока у вікні до синхронізації | так, S18-2, S18-6 | `close.mjs`, `bin/j4.mjs close` |
| F-T9-15 | теоретичний ризик (вікно мілісекунд) | низька | не відтворювали | `close.mjs closeTask` |
| F-9, F-3 | межа довіри рівня C | — | за визначенням | весь контур |
| ДОД-1 (новий) | `j4 acceptance` (CLI) при `--checks-ref` вважає докази пройденими без розбору файла (`passed: true`) — це лише довідкова команда, `done` вона не пише | інформаційний | читання `bin/j4.mjs case 'acceptance'` | `bin/j4.mjs` |
| ДОД-2 (новий) | `taskAccepted()` і `evidenceFromEvents()` читають `events.jsonl` поблажливо (нечитний рядок пропускається), тоді як `readTaskEvents()` вважає його `events-corrupt`; `closeTask` використовує обидва шляхи | теоретичний ризик (розбіжність читачів одного файла) | читання коду | `policy.mjs`, `acceptance.mjs`, `events.mjs` |
| ДОД-3 (новий) | `syncTaskEvents` пише `ledger_file` лише як ім'я файла (9а.3), тож дві установки з однаковим ім'ям `ledger.jsonl` у подіях нерозрізнювані без T-0011 | ризик, пов'язаний з F-T9-18 | читання коду | `router.mjs` |

## 1.4. Цільова архітектура після T-0011 і T-0012 (без зміни моделі довіри)

```text
J4_HOME/installation.json {installation_id}  ←→  J4_LEDGER seq 1 `installation` (або `installation_adopted` + first_hash)
            ↑ збіг обов'язковий ↑                              ↑ збіг обов'язковий ↑
     закріплене значення JE (рішення / --installation / J4_INSTALLATION_ID)  ─────────────┘
                                   │
   tasks/<id>/events.jsonl: події ADM {ref: j4-ledger#seq=N, ledger_hash, installation_id?} ── звірка із записом N журналу
                                   │
   бар'єр (acceptance.mjs): review_status === 'complete' ЯВНО; result === 'accepted' ЯВНО; scope === 'full' ЯВНО
   докази (close.mjs):      для кожної вимоги verify — останній дотичний запис (cmd ⊇ вимога або без cmd) має пройти;
                            теги/якорі перед | > відкривають блок; причини відмови — у missing
```

Межа довіри не змінюється: ідентичність установки захищає від **помилкового** вибору сховища та **випадкової/спрощеної** підміни
й робить навмисну підміну видимою в журналі задачі; особу автора (`by`, `--human`) вона не доводить (G4).
