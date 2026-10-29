# J4 Bridge v0.1

Координатор без власної LLM для обміну J3 (Claude Code) ↔ J5 (GPT) і виконавцями C5.1.
Задача T-0005. Статус: проєкт і прототип; живі (платні) виклики вимкнені до погодження JE.

- Проєкт: [docs/DESIGN.md](docs/DESIGN.md)
- Протокол: [docs/PROTOCOL.md](docs/PROTOCOL.md), схема [schema/message.schema.json](schema/message.schema.json)
- Права, маршрути, ліміти: [config/](config/)
- Правила ролей для агентів: [roles/](roles/)

## Швидкий старт (stub, без платних викликів)

```sh
export J4_HOME=$PWD/.j4 J4_LEDGER=$PWD/.j4/ledger.jsonl
node bridge/bin/j4.mjs send --from J3 --to J5 --task T-0005 --subject "$(git rev-parse HEAD)" \
  --intent question --summary "Тестове повідомлення J3→J5"
node bridge/bin/j4.mjs run
node bridge/bin/j4.mjs inbox --role J3
node bridge/bin/j4.mjs verify
```

У режимі `stub` відповідає синтетичний адаптер без LLM. У журналі він позначений `mode: stub`,
`model_id: null`; така відповідь не є відповіддю J5 і не може бути змістовим прийманням.

## Автоматизація (T-0009, stub)

```sh
bridge/bin/j4-tick.sh                       # один такт за розкладом: run --once --mode stub --task-events
node bridge/bin/j4.mjs run --once           # один прохід черги; 75 — інший обробник працює, 4 — стоп-кран, 6 — подію ADM не записано
J4_HOME=… J4_LEDGER=… node bridge/bin/j4.mjs close --task T-XXXX --subject <SHA> --checks-ref reports/T-XXXX/001.yaml   # J4_HOME (сховище J4) і J4_LEDGER (цілий журнал J4) обов'язкові й мають бути читними: інакше відмова (код 3), нічого не записується; J4_HOME відкривається лише для читання (нічого не створюється); повтор після done — already:true лише за читних джерел; доказ перевірок — запис {cmd, subject: <повний SHA>, result: "N/N pass …"} (суворий розбір, DESIGN розд. 17–18)
```

Розклад кодом не вмикається (приклади cron/launchd — [DESIGN.md](docs/DESIGN.md), розд. 17).
Події ADM пишуться в `tasks/<id>/events.jsonl` лише з `--task-events` / `J4_TASK_EVENTS=1`.

## Тести

```sh
node --test 'bridge/test/*.test.mjs'
```

Потрібен Node.js ≥ 22. Залежностей немає.

## Стоп-кран

`J4_HALT=1` у середовищі або файл `bridge/HALT` у репозиторії: J4 нічого не приймає й не відправляє.
