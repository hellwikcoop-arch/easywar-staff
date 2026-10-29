# Протокол J4 Bridge — `j4.msg/0.1`

Статус: проєкт T-0005, затверджує JE. Нормативна перевірка — `bridge/src/protocol.mjs`,
машинна схема — `bridge/schema/message.schema.json`.

## 1. Повідомлення

Відправник подає **чернетку**. Поля `msg_id`, `thread_id` (для нової нитки), `hop`, `caused_by`,
`created_at` і `body_sha256` ставить J4. Повідомлення, що їх породив адаптер (відповідь J5), J4 складає
сам: відправник — роль адаптера, а не те, що написано у відповіді.

| Поле | Хто ставить | Значення |
|---|---|---|
| `protocol` | відправник | `j4.msg/0.1` |
| `msg_id` | J4 | `M-T-0005-0001`: задача + номер у задачі |
| `thread_id` | J4 / відправник | `TH-T-0005-001`; для `in_reply_to` береться з оригіналу |
| `in_reply_to` | відправник | `msg_id`, на яке це відповідь; має існувати |
| `caused_by` | J4 | повідомлення, обробка якого породила це (ланцюг делегування) |
| `task_id`, `task_version` | відправник | прив'язка до наказу (`T-0000`, версія ≥ 1) |
| `contract.version`, `contract.sha256` | відправник | версія контракту й sha256 файла; J4 звіряє з фактичним файлом у easywar-staff і відхиляє розбіжність (`contract-mismatch`) |
| `subject.kind`, `subject.ref` | відправник | `commit` (повний SHA, 40 hex), `file_hash` (sha256), `doc_version` — розділ 5 контракту |
| `from`, `to` | відправник / J4 | ролі з `bridge/config/roles.json` |
| `kind` | відправник | `request`, `response`, `report`, `ack`, `handoff`, `review`, `escalation`, `command`, `decision` |
| `intent` | відправник | `question`, `proposal`, `review_request`, `acceptance_request`, `status`, `task`, `answer`, `other` |
| `decision_level` | відправник | `A` / `B` / `C` (розділ 2). `C` до адресата не йде — ескалація JE |
| `data_class` | відправник | лише `synthetic` (розділ 9) |
| `hop` | J4 | довжина причинного ланцюга від повідомлення людини чи J3 |
| `body.summary` | відправник | ≤ 300 символів; на рівні доказів `summary` потрапляє в журнал |
| `body.text` | відправник | ≤ 8000 символів; у журнал не потрапляє ніколи, лише хеш |
| `body.refs` | відправник | ≤ 20 шляхів у репозиторії, `шлях[@sha]`, без `..` |
| `body.decision_needed` | відправник / агент | `[{category, question}]`; непорожній список = рівень C |
| `body.task_state` | відправник | стан задачі за розділом 6 (`queued`…`failed`); значення `done` відхиляється (`done-forbidden`): `done` ставить лише ADM через бар'єр приймання (`bridge/src/acceptance.mjs`) |
| `body.verdict` | агент | для відповідей: `answer`, `accepted`, `changes_requested`, `question`, `cannot_answer` |
| `body_sha256` | J4 | sha256 канонічного JSON тіла |

Канонічний JSON: ключі за абеткою, без пробілів (`canonical()`); на ньому тримаються всі хеші.

## 2. Відповідь агента (`j4_reply`)

Агент (J5, C5.1-R) повертає лише JSON за строгою схемою `AGENT_REPLY_SCHEMA`:
`summary`, `text`, `verdict`, `decision_needed`. Додаткові поля відхиляються (`reply-schema`), зокрема
спроби агента вказати `from`, `to` чи інший `task_id`. Невалідна відповідь зараховується як спроба й
повторюється один раз; далі — ескалація.

## 3. Стани повідомлення

```text
чернетка ──submit──► queued ──deliver──► dispatched ──► received ──► recorded ──► replied
   │                   │                     │              │
   │                   │                     └─(збій)──► відновлення: received зі спулу або
   │                   │                                  dispatch_outcome_unknown → queued / blocked
   │                   └─(deposit: inbox, JE)──► delivered
   ├─(рівень C / decision_needed)──► held ──JE release──► queued
   └─(відмова)──► message_rejected (у журналі лише код і хеш)
blocked: ліміт, спроби або ворота живого виклику → ескалація JE
```

## 4. Події журналу

| Подія | Коли |
|---|---|
| `message_accepted` | чернетку прийнято в нитку |
| `message_rejected` | відмова: код, хеш тіла, без тексту |
| `message_delivered` | доставлено у вхідну скриньку (J3, C3) або JE |
| `dispatch_attempt` | виклик адаптера, номер спроби, `prompt_sha256` |
| `dispatch_failed` | помилка адаптера; чи буде повтор |
| `dispatch_blocked` | ліміт або ворота живого виклику |
| `dispatch_outcome_unknown` | після збою: виклик міг відбутися, спроба й резерв зараховані |
| `reply_received` | відповідь агента: адаптер, режим, `model_id` від провайдера, `request_id`, облік, `raw_sha256` |
| `reply_blocked` | відповідь заблокував сканер; лише коди правил |
| `escalation_raised` / `escalation_resolved` | рівень C, ліміти, цикли, ворота; рішення JE |
| `budget_threshold` | живий виклик перетнув місячний поріг: `warning_35`, `critical_45`, `stop_50` (T-0006) |
| `recovered`, `ledger_repaired`, `lock_recovered`, `halted` | відновлення й стоп-кран |

Кожен запис містить `seq`, `prev` (хеш попереднього) і `hash` — ланцюг, який перевіряє `j4 verify`.

## 5. Що ніколи не потрапляє в журнал

- `body.text`, інструкції ролі, зібраний промпт, сира відповідь провайдера — лише sha256;
- секрети, ключі, заголовки авторизації; журнал відмовляється записати рядок, у якому спрацював сканер;
- тексти рішень JE (`note`) — лише хеш;
- питання з `decision_needed` у записі ескалації — лише хеші (питання бачить JE у локальному стані J4).

## 6. Сумісність із контрактом

Повідомлення J4 — транспорт для горизонтальних запитів J3↔J5 (розділ 1), донесень (розділ 5) і
передачі коду C5.1 (розділ 20). Наказ (розділ 3), донесення (розділ 5) і `events.jsonl` (розділ 4)
лишаються джерелами обстановки; журнал J4 — доказ доставки й обліку викликів, а не карта стану.
