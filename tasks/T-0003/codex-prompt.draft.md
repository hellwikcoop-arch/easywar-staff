# T-0003 · Завдання для Codex (C5.1): E8 / C1b — ядро операцій спільної таблиці

## 0. Статус

Проєкт. Запускати лише після рішення JE щодо варіанта (див. донесення J3) і події `task_accepted`.
У варіанті «Codex виконує C1b заново» J3 спершу закриває PR #157 без злиття. Реалізація J3 у
`claude/e8-c1b-shared-table` для Codex недоступна як зразок: Codex пише незалежно, за цією
специфікацією.

## 1. Хто ти й межі

Ти — C5.1 (Codex) штабу EasyWAR, виконавець технічного завдання. Начальник за цим завданням —
J3 (Claude); він же приймає код технічно. Незалежну рецензію робить C3, змістове приймання — J5.
Ти **не зливаєш** PR, не пишеш у `main`, не створюєш підлеглих і не змінюєш нічого поза трьома
файлами з розділу 3.

Репозиторій: `hellwikcoop-arch/EasyWAR`. База: `main` `ea03a1488b911b0bacb6a5f1322d6cc35e358c0a`.
Гілка: `codex/t-0003-c1b-shared-table`. Перед записом виконай протокол `codex-coordinator` і
опублікуй claim лише на ці три файли (`AGENTS.md`, «Codex task-boundary board»).

Прочитай перед роботою: `AGENTS.md`, `CLAUDE.md`, `docs/COLLECTIVES_PLAN.md` (розділи 5.1–5.5,
рішення К1, К5, К6 у розділі 10, критерії AC03, AC06–AC08, AC21 у розділі 11), `src/sensitivity-core.js`
(зразок стилю ядра C1), `tests/collective-core-boundaries.test.mjs`.

## 2. Червоні лінії

- Лише синтетичні дані: ID на кшталт `member-synthetic-a`, підрозділи `Підрозділ-1`.
- Жодних змін у `src-tauri/**`, міграціях, capabilities, CSP, `Cargo.*`, `package.json`,
  `package-lock.json`, `AGENTS.md`, legacy HTML (`src/air.html`, `src/rocket.html`, `src/index.html`).
- У ядрі немає мережі, сховищ, DOM, годинника (`Date`, `performance`, таймери), випадковості,
  Tauri, криптографії, `eval`, динамічного імпорту, `node:`-імпортів. Межовий тест це перевіряє.
- Нових залежностей немає. Ядро не імпортується робочим застосунком.
- Мова: коментарі українською; назви функцій, змінних, API й машинні коди помилок — англійською.

## 3. Файли

| Файл | Дія |
|---|---|
| `src/shared-table-core.js` | новий |
| `tests/shared-table.test.mjs` | новий |
| `tests/collective-core-boundaries.test.mjs` | лише додати `'src/shared-table-core.js'` у `C1_CORES` |

## 4. Специфікація

ESM, `export`, чисте ядро. Кожна функція повертає новий стан і не змінює вхідний.

**Операція** (поля COLLECTIVES_PLAN.md §5.2, інших немає): `op_id, collective_id, table_id,
schema_version, row_key, kind, values, base_version, author_member_id, device_id, signature,
client_time, key_epoch`. `kind ∈ {upsert, delete, restore}`.

**Схема таблиці:** `{ collectiveId, tableId, schemaVersion, columns: string[] }`.

| Експорт | Вимога |
|---|---|
| `OPERATION_KINDS`, `OPERATION_FIELDS`, `APPLY_STATUSES` | заморожені; статуси: `applied, duplicate, integrity_violation, conflict, rejected, quarantined` |
| `validateOperation(op, schema) → { ok, errors }` | суворо: невідоме поле, порожній обов'язковий рядок, невідомий `kind`, недопустимі цілі (`schema_version`, `base_version`, `key_epoch` — цілі ≥ 0); `upsert`/`restore`: `values` — рівно всі стовпці схеми, клітинка — `null`, рядок, скінченне число чи boolean; `delete` без `values` |
| `canonicalOperation(op)` | детермінований рядок із сортованими ключами на всіх рівнях |
| `emptyTableState({ collectiveId, tableId, schemaVersion })` | порожній стан |
| `applyOperation(state, op, { schema, writers, verify })` | порядок: форма → `op_id` уже бачений (ті самі канонічні байти → `duplicate`, інші → `integrity_violation`) → чужа таблиця → `rejected` → невідома версія схеми → `quarantined` → немає `verify` або `verify(op) !== true` → `rejected` → автор не в `writers` → `rejected` → версія. Версія рядка = кількість застосованих операцій над ним (новий рядок — `base_version: 0`). `base_version` ≠ поточній → `conflict` (зберегти операцію в конфліктах, рядок не міняти, op_id позначити баченим). Upsert у видалений рядок → `conflict`; delete неіснуючого/видаленого → `conflict`; restore на невидалений ключ → `conflict` |
| надгробок | `{ lastValues, deletedBy, deletedOpId }`; restore без обмеження за часом, зберігає, з якого надгробка відновлено |
| `applyOperations(state, ops, options)` | послідовно; `{ state, results }` |
| `openConflicts(state, rowKey?)` | нерозв'язані |
| `resolveConflict(state, conflictId, op, options)` | нова операція від поточної версії від учасника з правом запису; лише для рядка конфлікту; позначає конфлікти рядка розв'язаними; повторне розв'язання — відмова |
| `diffRows(before, after, columns)` | `{ change: added|deleted|changed|unchanged, changed, fullRow: true }` |

Захист від недовірених входів: ключі `__proto__`, `constructor`, `toString` у `row_key`/`op_id` не
мають ламати стан чи обходити перевірки (власні властивості, `hasOwnProperty`).

## 5. Тести (`node --test`, лише синтетика)

Щонайменше: К1 (повний рядок і відмови форми); новий рядок і зміна, зростання версії,
незмінність вхідного стану; S05/AC06 (дубль, у тому числі з іншим порядком ключів; цілісність);
S03/AC07 (конфлікт від однієї версії; пізніший `client_time` не перемагає; повтор конфліктної
операції — `duplicate`); К6 (розв'язання учасником з правом і відмова без права); AC03 (без права,
без перевірки, поганий підпис, `verify` повертає не `true`); чужа таблиця й карантин; S04/AC08/AC21/К5
(надгробок, відновлення через роки, зайнятий ключ); порядок повторів; `diffRows`; ключі прототипу.
Для трьох правил (версія, право запису, видалений рядок) зроби мутаційну пробу: прибрана перевірка
має провалювати тест. Проби відкотити, не комітити.

## 6. Перевірки й передача

```bash
node --test tests/shared-table.test.mjs tests/collective-core-boundaries.test.mjs
npm run test:unit
git diff --name-only origin/main...HEAD   # лише три файли
```

Відкрий PR у `main` з описом. Передай J3 за `handoff_format_for_C5.1_code` (CONTRACT_v0_4.md, розділ 20):
`task_id: T-0003`, `task_version`, `base_commit`, `branch_ref`, `head_commit`, `files_changed`,
`summary`, `verification_refs` (команди й результати на head), `limitations`,
`synthetic_materials_refs`, `report_ref`, `integration_owner: J3`.

## 7. Бюджет

До 30 викликів інструментів, 2 спроби на крок. При 70 % (21) або на останній спробі — донесення
J3 типу `deviation`. Перевищення — зупинка й запит J3.
