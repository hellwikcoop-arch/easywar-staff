# 5. Експерименти на синтетичних копіях (етап D)

Усе — на ізольованих копіях `bridge/` у тимчасових теках (`poc11`, `poc12` у робочій теці сесії) і на синтетичному сховищі
штабу `T-0900` (генерується інструментами в `tools/`). Жоден файл репозиторію `bridge/`, `CONTRACT_v0_4.md`, `.github/`,
`tasks/`, `reports/T-00xx` не змінювався; реальних `j4 close`, `done`, установок J4, планувальника, live чи платних викликів
не було. Бюджети T-0009 (194/250) і T-0010 (144/150) не витрачались: усі прогони тут — поза обліком цих задач і зафіксовані в
`calls-ledger.yaml` цієї місії.

## 5.1. Інструменти

| Файл | Що робить | Виклики адаптера |
|---|---|---|
| `tools/repro.mjs [--bridge <копія>] [--json]` | 33 сценарії S16/SC1/R11/R10/R12 через бібліотечний `closeTask`/`acceptanceReady`, S18 через CLI `j4 close`; підраховує `dispatch_attempt` у створених журналах і вимагає 0 | 0 (перевіряється) |
| `tools/repro-t0011.mjs [--bridge <копія>] [--json]` | 19 сценаріїв ідентичності I1–I19 через CLI `j4 close`/`adopt` (закріплення через `J4_INSTALLATION_ID`) | 0 |
| `tools/compat-events.mjs <oldBridge> <newBridge>` (два позиційні аргументи, C3H-16) | старий і новий бар'єр на реальних журналах `tasks/T-0002, T-0004, T-0006…T-0010/events.jsonl` (лише читання; T-0002/T-0004 додано за C3H-14) | 0 (не диспетчеризує за побудовою) |
| `poc/t0012-poc.patch`, `poc/t0011-poc.patch` | правила, прикладені до копій (не до репозиторію) | — |

`repro*.mjs` рахують `dispatch_attempt` ПІСЛЯ останнього сценарію і завершуються кодом 1, якщо він > 0 (C3H-15). У `evidence/repro-t0011-poc.json`
поле `bridge` знеособлено вручну після генерації (`<ізольована копія bridge/ з PoC>`); решта файлу — дослівний вивід (C3H-18).

## 5.2. T-0012: старий код → PoC → очікуване за специфікацією

Джерела: `evidence/repro-old.json`, `evidence/repro-poc-t0012.json` (dispatch 0 в обох).

| Сценарій | Дефект | Старий код (факт) | PoC T-0012 (факт) | Очікуване після T-0012 (`04-spec-T-0012.md`) |
|---|---|---|---|---|
| S16-1 | F-T9-16 | `ready` | `not-ready[review-C3-incomplete]` | not-ready[review-C3-incomplete] |
| S16-2 | F-T9-16 | `ready` | `not-ready[review-C3-incomplete]` | not-ready[review-C3-incomplete] |
| S16-3 | F-T9-16 | `not-ready[review-C3-not-passed]` | `not-ready[review-C3-incomplete]` | not-ready[review-C3-incomplete] |
| S16-4 | F-T9-16 | `ready` | `not-ready[acceptance-J5-content-not-accepted]` | not-ready[acceptance-J5-content-not-accepted] |
| S16-5 | F-T9-16 | `ready` | `not-ready[acceptance-J5-content-not-accepted]` | not-ready[acceptance-J5-content-not-accepted] |
| S16-6 | F-T9-16 (контроль) | `ready` | `ready` | ready |
| S16-7 | F-T9-16 (контроль: accepted_with_restrictions, як T-0006 seq 12) | `not-ready[acceptance-J5-content-not-accepted]` | `not-ready[acceptance-J5-content-not-accepted]` | not-ready[acceptance-J5-content-not-accepted] |
| SC1-0 | SCOPE-1 (acceptance без поля scope, як T-0005…T-0010) | `ready` | `not-ready[acceptance-J5-content-scope-not-full]` | not-ready[…scope-not-full] |
| SC1-1 | SCOPE-1 | `ready` | `ready` | ready (scope: full у фікстурі; межі лише в note — див. процедуру 4.2) |
| SC1-2 | SCOPE-1 | `ready` | `not-ready[acceptance-J5-content-scope-not-full]` | not-ready[…scope-not-full] |
| SC1-2b | SCOPE-1 (scope: limited + limits) | `ready` | `not-ready[acceptance-J5-content-scope-not-full]` | not-ready[…scope-not-full] |
| SC1-3 | SCOPE-1 (варіант: scope повний) | `ready` | `ready` | ready |
| SC1-4 | SCOPE-1 (варіант: scope без відомої форми) | `ready` | `not-ready[acceptance-J5-content-scope-not-full]` | not-ready[…scope-not-full] |
| R11-1 | F-T10-11 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-latest-failed:node --test 'bridge/test/*.test.mjs']` | відмова evidence-latest-failed |
| R11-2 | F-T10-11 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-latest-failed:node --test 'bridge/test/*.test.mjs']` | відмова evidence-latest-failed |
| R11-3 | F-T10-11 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-latest-without-cmd:node --test 'bridge/test/*.test.mjs']` | відмова evidence-latest-without-cmd |
| R11-4 | F-T10-11 (контроль: збій → успіх тієї ж cmd) | `done` | `done` | done |
| R11-5 | F-T10-11 (контроль: збій іншої команди) | `done` | `done` | done |
| R11-6 | F-T10-11 (успіх варіантною, потім збій базовою) | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-latest-failed:node --test 'bridge/test/*.test.mjs']` | відмова evidence-latest-failed |
| R10-1 | F-T10-10 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-no-record-on-subject]` | відмова (запис у блоці не доказ) |
| R10-2 | F-T10-10 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-no-record-on-subject]` | відмова |
| R10-3 | F-T10-10 | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-no-record-on-subject]` | відмова |
| R10-4 | F-T10-10 (контроль: звичайний блок) | `refused:barrier-not-passed[checks-not-on-subject-or-failed]` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-no-record-on-subject]` | відмова (контроль, без змін) |
| R12-1 | F-T10-12 (порожній рядок усередині блоку) | `refused:barrier-not-passed[checks-not-on-subject-or-failed]` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-no-record-on-subject]` | відмова (без змін; потрібен тест) |
| S18-1 | F-T9-18 (контроль: правильна пара) | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | без змін (T-0011) |
| S18-2 | F-T9-18 (хибна наявна ціла пара) | `exit 0 done` | `exit 0 done` | T-0011: installation-mismatch |
| S18-3 | F-T9-18 (правильний J4_HOME, чужий журнал) | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | без змін |
| S18-4 | F-T9-18 (чужий J4_HOME, правильний журнал) | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | без змін |
| S18-5 | F-T9-18 (обрізаний журнал: лише seq 1, ескалація зникла) | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | без змін |
| S18-6 | F-T9-18 (знімок сховища до ескалації: порожній J4_HOME тієї ж форми) | `exit 0 done` | `exit 0 done` | T-0011: закривається частково (I11/I12, min-seq) |
| R11-7 | F-T10-11 (успіх, далі збій із cmd: "") | `done` | `done` | відмова evidence-latest-without-cmd (вимога 4.4; PoC ще не виконує) |
| R11-8 | F-T10-11 (verify порожній: дві cmd, остання другої — збій) | `done` | `refused:barrier-not-passed[checks-not-on-subject-or-failed,evidence-latest-failed:other]` | відмова evidence-latest-failed:other |
| R11-9 | F-T10-11 (контроль: збій базовою, далі успіх варіантною, що містить вимогу) | `done` | `done` | done |

Висновки: усі заявлені дефекти **підтверджено** на поточному коді (S16-1/2/4/5, SC1-0…2b, R11-1/2/3/6/7/8, R10-1/2/3; S18-2/6);
контролі (S16-6, S16-7, SC1-3, R11-4/5/9, R10-4, R12-1, S18-1/3/4/5) поводяться як треба і до, і після. Розбіжність PoC зі
специфікацією одна — **R11-7** (`cmd: ""` трактується як наявна команда): виправлення тривіальне (`cmd` порожній → `null`), внесене
як вимога, у PoC не вносилось, щоб патч лишився тим, що перевірявся. R11-8 показує, що «достатньо однієї команди, що пройшла»
(README) без `verify` пропускає пізній збій іншої команди — це той самий клас, що R-11.

## 5.3. T-0011: старий код → PoC → очікуване

Джерела: `evidence/repro-t0011-old.json`, `evidence/repro-t0011-poc.json`. У «старому коді» `installation-*` не існує, тож
I3/I4/I5/I9/I13/I14/I16 дають `done` — це і є F-T9-18 у різних формах; I9/I18 на старому коді падають винятком лише тому, що
інструмент викликає `store.installation()`, якого там немає (очікувано).

| Сценарій | Опис | Старий код | PoC T-0011 | Очікуване (`03-spec-T-0011.md`) |
|---|---|---|---|---|
| I1 | контроль: правильна пара + закріплений id, відкрита ескалація | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | open-escalation |
| I2 | контроль: правильна пара + закріплений id, ескалацій немає → done | `exit 0 done` | `exit 0 done` | done |
| I3 | без закріпленого значення → відмова | `exit 0 done` | `exit 3 installation-unknown[pinned]` | installation-unknown |
| I4 | закріплене значення хибного формату | `exit 0 done` | `exit 3 installation-unknown[pinned]` | installation-unknown |
| I5 | хибна наявна ціла пара (інша установка, свій marker і журнал) | `exit 0 done` | `exit 3 installation-mismatch[store-marker-mismatch,ledger-binding-mismatch]` | installation-mismatch |
| I6 | чужий J4_HOME без marker-а (лише тека escalations) | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 installation-mismatch[store-marker-missing]` | installation-mismatch[store-marker-missing] |
| I7 | правильний J4_HOME, чужий журнал | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 installation-mismatch[ledger-binding-mismatch]` | installation-mismatch[ledger-binding-mismatch] |
| I8 | чужий J4_HOME, правильний журнал | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 installation-mismatch[store-marker-mismatch]` | installation-mismatch[store-marker-mismatch] |
| I9 | закріплено чужий id (помилка в рішенні JE) для правильної пари | `exception:(intermediate value).installation is not a function` | `exit 3 installation-mismatch[store-marker-mismatch,ledger-binding-mismatch]` | installation-mismatch |
| I10 | обрізаний журнал (лишився лише запис установки), ескалація в сховищі | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 open-escalation[escalation:E-T-0900-001]` | open-escalation |
| I11 | знімок установки до ескалації: правильний marker, обрізаний журнал, порожнє сховище (вікно до синхронізації) | `exit 0 done` | `exit 0 done` | ЗАЛИШОК: done; закривається ledger_min_seq (N8) або синхронізацією (I12) |
| I12 | те саме, але ескалацію синхронізовано в events.jsonl (ref seq=N) до обрізання | `exit 3 open-escalation[escalation:E-T-0900-001]` | `exit 3 ledger-events-mismatch[event-seq-2:ledger-seq-3-mismatch]` | ledger-events-mismatch |
| I13 | подія ADM у events.jsonl посилається на seq N, але хеш не збігається (підмінений журнал тієї ж установки) | `exit 0 done` | `exit 3 ledger-events-mismatch[event-seq-2:ledger-seq-3-mismatch]` | ledger-events-mismatch |
| I14 | подія ADM з installation_id іншої установки | `exit 0 done` | `exit 3 ledger-events-mismatch[event-seq-2:installation-mismatch]` | ledger-events-mismatch (лише за G2) |
| I15 | контроль: ескалацію синхронізовано і вирішено JE → done | `exit 0 done` | `exit 0 done` | done |
| I16 | повтор після done на чужій парі → відмова, а не already | `exit 0 done | потім exit 0 done` | `exit 0 done | потім exit 3 installation-mismatch[store-marker-mismatch,ledger-binding-mismatch]` | done, потім installation-mismatch |
| I17 | повтор після done на правильній парі → already | `exit 0 done` | `exit 0 done` | done → already |
| I18 | міграція: стара установка (без marker-а, журнал без прив'язки) → close відмовляє; adopt → close працює; історія журналу збережена | `exception:(intermediate value).installation is not a function` | `до adopt: exit 3 installation-mismatch[store-marker-missing,ledger-not-bound] | adopt: exit 0 ok | історія збережена: true | після adopt: exit 0 done` | відмова → adopt ok → done; історія збережена |
| I19 | adopt повторно — already; adopt журналу, прив'язаного до іншої установки — відмова | `exit 64 j4 <send|submit|run [--once]|close|inbox|escalations|resolve|budget|acceptance|v | чужий журнал: exit 64 j4 <send|submit|run [--once]|close|inbox|escalations|resolve|budget|acceptance|v` | `exit 0 already | чужий журнал: exit 3 ledger-bound-to-other-installation` | already; чужий → ledger-bound-to-other-installation |

Залишок **I11** (знімок тієї ж установки до ескалації, несинхронізований): PoC не закриває; специфікація закриває
`ledger_min_seq` (M3, N8) і регулярною синхронізацією `--task-events`. Це задекларовано в наказі T-0011 п. 4 («вікно до першої
синхронізації описане чесно») і в `02-threats.md` T8.

## 5.4. Зворотна сумісність (T-0012, варіант B) на реальних журналах

`evidence/compat-events-t0012.txt` (перегенеровано 2026-10-28 після C3H-14): T-0006 (2 SHA) і T-0007 — `ready → not-ready[scope-not-full]`,
але обидві задачі вже мають `done`, і `closeTask` повертає `already` **до** бар'єра — поведінка `j4 close` не змінюється; T-0009/T-0010 —
`not-ready` до і після (J5 `acceptance` немає). **T-0002** (журнал до появи ADM/J4, `done` немає): 7 subject-ів; на двох — `5923b49d`,
`9ec729ee` — старий бар'єр давав `ready` лише завдяки значенням за замовчуванням (7 `review_finished` без `review_status`: seq 4, 6, 12, 17,
18, 31, 34; 5 `acceptance` без `result`: seq 7, 13, 15, 21, 22), після T-0012 — `not-ready[review-C3-incomplete, …-not-accepted]`. Це
і є поведінка, якої вимагає F-T9-16; T-0002 через `j4 close` не закривалась і закриватись не планується; якби знадобилось — лише новими
подіями (G3). **T-0004**: подій `acceptance`/`review_finished` немає — бар'єр не застосовний. Жодного запису переписувати не треба
(`04-spec-T-0012.md` §4.3).

## 5.5. Вплив на наявні тести (виміряно на копії `poc12`, лише фільтри без викликів адаптера)

| Набір | Результат на PoC | Причина |
|---|---|---|
| `t0006` «бар'єр / done лише ADM / F-1» (6 тестів) | 3 червоні | фікстури `acceptance` без `scope`; одна `review_finished` без `review_status` (рядок 224 — тепер очікувано `incomplete`) |
| `t0007 S6` | 1 червоний | фікстури без `scope` |
| `t0009 C1–C8` | 8 червоних | фікстури без `scope`; `deepEqual` на `missing`, що тепер містить і `scope-not-full`, і `evidence-*` |
| `t0010` (12) | 4 червоні (B2, C1, C2, E1), 2 пропущені під root | ті самі дві причини (`missing` із `evidence-no-record-on-subject`; `done` не записався через `scope`) |
| Разом | **16 червоних** | усі — оновлення фікстур/очікувань; жодного ослаблення (критерій C3: 0 видалених перевірок) |

T-0011 (Дизайн 1) окремо: 4 твердження за номером запису журналу (`recovery` «підробка», `t0009 E1`, `t0010 D1`, `t0007 S7`) і
закріплене значення в ≈ 31 виклику `closeTask`/CLI (`03-spec-T-0011.md` §3.6); PoC-копія `poc11` повний набір не проганялась
(повний прогін = 48 викликів; не потрібен для доказу механізмів — I1–I19 їх покривають).

## 5.6. Конфлікти T-0011 ↔ T-0012

Обидва правлять `close.mjs` (T-0012 — `evidenceRecords/evidenceVerdict/checksFrom` і рядок `refuse('barrier-not-passed')`;
T-0011 — `checkInstallation` і початок `closeTask`) і фікстури тестів `close` (`t0009`, `t0010`). Злиття текстове просте
(різні функції), але контрольні SHA різні, тож **послідовно**: T-0012 першим (менше файлів, не чіпає `store`/`ledger`/`router`),
T-0011 на його вершині (G5). Семантичних конфліктів немає: T-0012 змінює, *що* є доказом; T-0011 — *чи та це установка*.
Спільний прапорець: обидва додають елементи в `missing` — порядок елементів у `missing` зафіксувати в тестах як множину, а не список.

## 5.7. Облік викликів адаптера в цій місії

Одиниця — як у T-0009/T-0010 (`dispatch_attempt` + прямий `adapter.call()`). Усі сценарії `tools/*` — 0 (підраховано
інструментом). **Повний прогін** `node --test 'bridge/test/*.test.mjs'` на репозиторії виконано один раз на початку (контроль
бази: 103 pass / 2 skipped) — 48. Крім того, один занадто широкий фільтрований прогін на копії `poc11` (recovery/escalation/
T-0007 S1–S5) викликав stub-адаптер; лічильник `tasks/T-0009/tools/call-counter.mjs` копії не бачить (патчить лише модуль
репозиторію), тому число взяте скануванням журналів у `/tmp`: на момент виявлення — **200 `dispatch_attempt`** у всіх журналах
сесії (156 stub + 44 live-fake), з них 44 `dispatch_attempt` (+ 4 прямих, які сканер не бачить) — базовий повний прогін, решта
**200 − 44 = 156** — той фільтрований прогін і копії тестів (виправлено за наказом JE 2026-10-28; раніше помилково «≈ 152»);
повторне сканування пізніше дало 100 (78 stub + 22 live), бо тимчасові теки тестів видаляються. **Обліковуємо за максимумом: 200
dispatch + 4 прямих = 204** (`calls-ledger.yaml`). Урок, застосований далі: лише фільтри без диспетчеризації (`t0006` бар'єр,
`t0007 S6`, `t0009 C|E|H|Q2|Q3`, `t0010`) і підрахунок сканером після кожного прогону.

## 5.8. Чернетки майбутніх тестів (`07-draft-tests/`) — перевірка на копіях

| Чернетка | Старий код | PoC-копія | Червоні на PoC = вимоги специфікації, яких PoC не має |
|---|---|---|---|
| `t0012.draft.test.mjs` (41 тест: 40 після C3 раунду 1 + R11-15 за C3H-19 раунду 2) | 12 pass / 28 fail з 40 — усі заявлені дефекти підтверджені тестами | **38 / 41** (2026-10-28, на `poc12`, dispatch 0; R11-15 зелений: нерозпізнаний `result` уже нині = не pass) | SC1-6 (`scope: full` + `limits` → `scope-contradictory`, C3H-2), R11-7 (нормалізація `cmd`: `""`, пробіли → відсутній, C3H-1), R11-13 (без `verify` потрібен запис із `cmd`, C3H-8) |
| `t0011.draft.test.mjs` (36 тестів, після C3) | 10 pass / 26 fail (зелені — контролі, характеризації I11/N13-подібні) | **28 / 36** | N2/N3 (marker не-JSON/тека → `store-marker-missing`, а не виняток із кодом 1), N6/N7 (`ledger_first_hash`), N8/N9 (`ledger_min_seq`), N11 (`run --once` → код 1; PoC — 0), N13 (`kind-mismatch`, C3H-5), N14 (ескалація сховища, невідома журналу), N23 (порядок M11: `already` до звірки подій, C3H-3) |

Висновок: чернетки готові до перенесення в `bridge/test/` на кроці 1 планів; червоні на PoC — це саме перелік доробок до PoC у
реалізації (PG-1…PG-8 у `06-defects-risks.yaml`), не дефекти специфікації. Зелені на PoC після C3: N12, N17, N22, R11-14, R10-8 — нові
контролі/характеризації. `dispatch_attempt` у журналах чернеток — 0 (перевірено сканером тек `j4h-t11-*`, `j4h-t12-*`).
Запуск чернеток на репозиторійному `bridge/` — лише читання коду й тимчасові теки; `bridge/` не змінюється.
