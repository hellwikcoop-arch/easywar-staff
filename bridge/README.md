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

## Тести

```sh
node --test 'bridge/test/*.test.mjs'
```

Потрібен Node.js ≥ 22. Залежностей немає.

## Стоп-кран

`J4_HALT=1` у середовищі або файл `bridge/HALT` у репозиторії: J4 нічого не приймає й не відправляє.
