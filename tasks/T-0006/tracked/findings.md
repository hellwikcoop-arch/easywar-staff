# T-0006 — відстежувані зауваження (рішення J5, 22.10.2026)

Не блокують T-0006. Джерело — `reports/T-0006/c3-reviews.yaml`. Закриваються лише повторною рецензією C3 на версії з виправленням.

| ID | Важливість | Суть | Місце | Як перевірити |
|---|---|---|---|---|
| F-8 | low | Збій між поданням відповіді й оновленням оригіналу дає хибну ескалацію JE (loop-ping-pong); подвійної доставки немає | `bridge/src/router.mjs` submitReply/recover | hook кидає після submit у submitReply → process() → немає хибної ескалації |
| F-14 | low | `claude -p` отримує системний промпт через argv (видно в списку процесів); `AdapterError.detail` у журнал не потрапляє (C3, seq 3) | `bridge/src/adapters/cli.mjs` | instructions через stdin або файл; перевірити argv |
| F-15 | low | Вікно гонки під час відкату помилкового rename при перехопленні мертвого замка (три конкуренти) | `bridge/src/store.mjs` withFileLock | детермінована проба з підміною fs (C3, seq 3) |
| F-16 | low | Нескінченний цикл без тайм-ауту, якщо шлях замка — каталог або нечитаний файл | `bridge/src/store.mjs` withFileLock, гілки `continue` | `mkdir x.lock`; withFileLock(..., {timeoutMs:200}) має повернути lock-timeout |
