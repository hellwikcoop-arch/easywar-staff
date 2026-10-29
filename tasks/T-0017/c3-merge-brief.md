# T-0017: бриф вузької перевірки C3 коміту злиття 70bade5 (read-only)

Підстава: рішення JE 29.10.2026 13:15Z («Злиття, C3, +40 викликів»), поправка A-2, план
`tasks/T-0017/merge-main-plan.md` крок 4. Маршрут: J4 inbox, роль C3, 0 USD.

## Об'єкт

- PR EasyWAR #180, гілка `claude/e8-c2-crypto-engine`.
- Коміт злиття `70bade5e06ab781fc2906529ce415b92d2fd28b4`, батьки `9ea099433f83088fb97d04c6a0521e3379446fa0`
  (попередній head, на якому зібрано докази C3 №3 і G06 macOS) і `649b6e225835eca4a49ea22e5136094ac70eff7c` (main).
- merge-base: `a1761880a3ac1dcff4c675f9a6a0f1188dcbf116`.

## Що перевірити (лише це, повторний огляд C2 не потрібен)

1. **Розв'язання конфлікту.** У `src-tauri/src/lib.rs` злиття лише об'єднує списки модулів (`pub mod collective;` і
   `pub mod dashboard_layout;`) і не губить і не дублює нічого з жодного батька: ні модулів, ні команд E4 у
   `generate_handler!`, ні коду C2.
2. **Тотожність C2.** `git diff 9ea0994 70bade5 -- src-tauri/src/collective docs/adr/collective-crypto.md
   docs/evidence/collectives tests/collective-crypto-vectors.test.mjs tests/fixtures/collective-crypto-vectors.json`
   порожній.
3. **Вміст PR не змінився.** Diff `649b6e2..70bade5` має ті самі файли й ті самі рядки `+`/`-`, що й
   `a1761880..9ea0994` (допустимі лише зміни контексту й номерів рядків).
4. **Нічого зайвого з боку PR.** Злиття не вносить змін, яких немає ні в 9ea0994, ні в main (тобто `70bade5`
   не містить «злих» правок поза розв'язанням у `lib.rs`).

## Ліміти

- До 5 прочитаних файлів (цей бриф рахується першим) і до 10 викликів інструментів, включно з командами `git`.
- Лише читання: без змін файлів, без commit, без push, без мережі, без запуску збірки.
- Лише синтетичні дані. Не копіювати в ШТАБ сирі виводи моделі.
- Якщо ліміт вичерпано до відповіді на всі 4 пункти: `review_status: incomplete` і перелік непрочитаного.

## Формат відповіді (YAML)

```yaml
review_status: complete | incomplete
verdict: passed | failed | passed_with_conditions
subject: 70bade5e06ab781fc2906529ce415b92d2fd28b4
items:
  - id: 1..4
    result: confirmed | refuted | not_checked
    evidence: "<команда або файл:рядок, коротко>"
findings: []        # кожен: id, severity (blocker|condition|nit), опис
files_read: []
tool_calls_used: N
```

Висновок C3 стосується лише коміту злиття. Він не закриває G12, не замінює G06 і J3/J5 і не дозволяє merge #180.
