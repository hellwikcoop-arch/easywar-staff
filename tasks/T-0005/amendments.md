# T-0005 — поправки до CONTRACT_v0_4.md і AGENTS.md (проєкт на затвердження JE)

Статус: **вирішено JE 22.10.2026** (наказ T-0006, `tasks/T-0006/je-order.md`); первісний статус — proposed. J3 не змінював `CONTRACT_v0_4.md` і `AGENTS.md` (наказ JE T-0005). Нижче —
формулювання для внесення після рішення JE. Формат — як у розділах 4 і 21 контракту.

```yaml
amendments:
  - id: A-T5-01
    target: "CONTRACT_v0_4.md, розділи 1, 25 (D-01)"
    title: "Позначення J4 для мосту"
    conflict: "D-01 (15.10.2026) перейменувало J4 на ADM: 'лише скрипт, без виконавців з AI'. Наказ T-0005 вводить J4 як координатор без LLM."
    options:
      a: "J4 — окрема посада-скрипт (міст) поруч з ADM; ADM лишається обліком і станом."
      b: "Міст — функція ADM; позначення J4 вживається лише для мосту як частини ADM."
    proposed_by: J3
    recommendation: b
    reason: "Один скрипт веде облік викликів, бюджет і стан; немає двох джерел обстановки (засада 5)."
    text_if_b: "Додати в таблицю розділу 1 примітку до рядка ADM: «Включає міст J4: маршрутизація повідомлень між J3, J5, C5.1 і рецензентами (bridge/). Без власної LLM.»"
    status: approved
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "A-T5-01 затверджено: ADM — роль; J4 Bridge — компонент (варіант b)"

  - id: A-T5-02
    target: "CONTRACT_v0_4.md, розділи 1, 16, 19"
    title: "Runtime J5 через OpenAI Responses API"
    change: "J5: runtime — OpenAI Responses API через J4; правила ролі — bridge/roles/J5.md (версія й sha256 у журналі J4); модель задає погодження JE, ідентифікатор фіксується з відповіді провайдера. J5 через J4 не має інструментів і доступу до репозиторію."
    reason: "Розділ 19 мав automatic_external_agent_handoff: unknown; міст робить це явним і облічуваним."
    open: "Чи лишається ChatGPT (застосунок) для діалогу JE ↔ J5 поза мостом."
    status: approved
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "J5 = ChatGPT через OpenAI Responses API; live за окремим дозволом"

  - id: A-T5-03
    target: "CONTRACT_v0_4.md, розділ 2"
    title: "Рівні повноважень для дій через міст"
    change:
      - {action: "Надіслати запит, відповідь чи донесення через J4 за маршрутами bridge/config/routes.json", J3: A, J5: A, executors: "лише маршрути своєї ролі"}
      - {action: "Живий (платний) виклик адаптера J4", J3: C, J5: C, executors: C, note: "окреме погодження JE з межами, строком і моделлю"}
      - {action: "Рішення щодо ескалації J4 (release, reject, resume, halt, third_attempt)", J3: "—", J5: "—", executors: "—", note: "лише JE"}
    status: approved_with_changes
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "рішення C утримуються до явного підтвердження JE"

  - id: A-T5-04
    target: "CONTRACT_v0_4.md, розділ 4"
    title: "Журнал J4 і events.jsonl"
    change: "Журнал J4 (ledger.jsonl з ланцюгом хешів) — доказ доставки, обліку викликів і рішень маршрутизатора. events.jsonl задачі лишається єдиним журналом дій. Після появи ADM: J4 додає в events.jsonl report_filed / escalation з посиланням ref на запис журналу J4 (файл і seq)."
    reason: "Не створювати другого джерела обстановки (засада 5)."
    status: approved
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "технічний журнал Bridge окремий від офіційного журналу задач"

  - id: A-T5-05
    target: "CONTRACT_v0_4.md, розділи 3, 7"
    title: "Одиниця max_calls і точність обліку для маршруту J4"
    change: "Для маршрутів J4 одиниця max_calls — один виклик адаптера. calls — exact; токени — exact, якщо провайдер повернув usage, інакше estimate (резерв); вартість — estimate за ціною з погодження JE або unknown. Виклик із невідомим результатом після збою зараховується як витрачений (estimate)."
    status: approved_with_changes
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "одиниці викликів, токенів, вартості й точність обліку мають бути явними"

  - id: A-T5-06
    target: "CONTRACT_v0_4.md, розділ 9"
    title: "Захист даних у мості"
    change:
      - "Агент через J4 отримує лише конверт і тіло повідомлення; файли репозиторію J5 не надсилаються."
      - "J4 відхиляє повідомлення з data_class, відмінним від synthetic, і блокує повідомлення та відповіді, де спрацював сканер (секрети, координати, MGRS, телефони)."
      - "У журнал J4 не потрапляють тексти тіл, зібрані промпти, сирі відповіді й ключі — лише хеші; рівень доказів summary або hash визначає JE."
    status: approved
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "мінімізація даних, без секретів і повних текстів у журналі"

  - id: A-T5-07
    target: "CONTRACT_v0_4.md, розділи 1, 18"
    title: "Незалежна рецензія C5.1-R"
    change: "Міжвендорна рецензія C5.1 виконується окремим запуском Codex у режимі read-only під позначенням C5.1-R; J4 перевіряє, що run_id рецензії не збігається із запуском автора, а рецензент не є автором."
    status: approved_conditionally
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "незалежність рецензента обов'язкова; C5.1-R не підміняє C3 без окремого дозволу"

  - id: A-T5-08
    target: "CONTRACT_v0_4.md, розділ 17"
    title: "Постановка задач J5 → C5.1 через J4 (наступний етап)"
    change: "J5 видає наказ C5.1 через J4 лише для задачі з task_accepted; J4 перевіряє глибину делегування 1 і ліміти. До затвердження цієї поправки J4 не передає задач від J5 до C5.1 автоматично."
    status: deferred
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "передача задач J5 → C5.1 через J4 — після окремої перевірки маршруту"
```

## Поправка до AGENTS.md (EasyWAR, база ea03a1488b911b0bacb6a5f1322d6cc35e358c0a)

```yaml
  - id: A-T5-09
    target: "AGENTS.md, новий розділ після «Codex task-boundary board»"
    title: "Staff bridge (J4)"
    status: approved
    decided_by: JE
    decided_at: 2026-10-22
    decision_ref: tasks/T-0006/je-order.md
    decision_note: "додати правила Staff Bridge до AGENTS.md"
```

Запропонований текст (англійською, як решта AGENTS.md):

```markdown
## Staff bridge (J4)
- The staff bridge (J4) lives in `easywar-staff/bridge/`, not in this repository, and is not part of the EasyWAR application.
- Messages routed through J4 carry only synthetic task material: never operational data, Signal data, credentials, tokens, tables or personal data from EasyWAR.
- A Codex run started by J4 as an independent reviewer (C5.1-R) uses the read-only sandbox and does not claim a task-boundary board slot for writing.
- Codex runs started by J4 as an executor (C5.1) follow the task-boundary board rules above and write only to their own branch; merges stay with J3 under the staff contract.
- Do not store bridge prompts, transcripts or raw model replies in this repository.
```

Обґрунтування: розділ «Product constraints» забороняє автоматичні передачі даних застосунку без рішення
власника; міст — інструмент розробки, а не функція застосунку, але працює з тими самими агентами.
Поправка фіксує, що через міст не йдуть дані EasyWAR, і узгоджує запуски Codex із наявною дошкою
меж задач.
