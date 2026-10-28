# Граф залежностей програми «EASYWAR AUTONOMOUS DEVELOPMENT PROGRAM» (JE 2026-10-28 08:11)

Підготував J3 2026-10-28. Стан гілок звірено `git ls-tree` по всіх гілках origin (T-0008 історично пропущений і не використовується;
T-0013…T-0015 вільні в усіх гілках: `main`, `orders/T-0010-12`, `t-0010/stabilization`, `plan/j4-autonomy-hardening`, інші).
PR №6 (t-0009/j4-automation) і №7 (t-0010/stabilization) — чернетки, не злиті; №8 — лише `reports/J4-HARDENING/**` (HALT через аномальний запуск CI).
Підготовка наказу ≠ дозвіл на виконання. Автор наказу — J5; тут лише проєкти J3.

```text
T-0012 бар'єр приймання (acceptance.mjs, close.mjs; контракт §4, §6 п.4)      ← реалізовано, контрольний SHA dc78287, чекає C3/J5/JE
   │  спільний файл close.mjs → послідовно, не паралельно
   ▼
T-0011 ідентичність установки (ledger.mjs, close.mjs, bin/j4.mjs, router seq 1; контракт §4, 9а.3)   ← лише після остаточного приймання T-0012 JE
   │                                   │
   │ (installation_id в подіях ADM,    │ (ledger.mjs, bin/j4.mjs стабільні)
   │  звірка ledger_hash)              │
   ▼                                   ▼
T-0013 оркестрація агентів            T-0015 відновлення, моніторинг, ресурси
(router.mjs, events.mjs, adapters,    (guards.mjs, monthly.mjs, ledger.mjs (лише читання/repair),
 bin/j4.mjs: orchestrate; контракт §17) bin/j4.mjs: status/budget; j4-tick.sh)
   │        ╲   спільний файл bin/j4.mjs → або послідовно, або розділити команди в окремі модулі (пропозиція: bridge/src/cli/*.mjs)
   │         ╲
   ▼          ▼
T-0014 end-to-end автономний цикл (лише тести/фікстури/документація + CI stub за дозволом; код мосту не змінює)
```

| Задача | Файли, які змінює | Залежить від | Конфлікти файлів | Бюджет |
|---|---|---|---|---|
| T-0012 | acceptance.mjs, close.mjs, тести, CONTRACT §4/§6 п.4 | — | close.mjs ↔ T-0011 | 150 (76 використано) |
| T-0011 | ledger.mjs, close.mjs, bin/j4.mjs, router.mjs (seq 1 `installation`), events.mjs (`installation_id`), CONTRACT §4/9а.3 | T-0012 (остаточне приймання JE) | close.mjs ↔ T-0012; bin/j4.mjs, router.mjs ↔ T-0013; ledger.mjs, bin/j4.mjs ↔ T-0015 | 180 (затверджено) |
| T-0013 | router.mjs, events.mjs, adapters/*, policy.mjs (без config), bin/j4.mjs, CONTRACT §17 (поправка — рішення JE) | T-0011, T-0012 | bin/j4.mjs ↔ T-0015; router.mjs ↔ T-0011 | не затверджено (прогноз ~200 stub) |
| T-0014 | bridge/test/e2e/*, фікстури, docs, .github (лише за дозволом) | T-0011, T-0012, T-0013; T-0015 — бажано | — (не змінює src) | не затверджено (прогноз ~150: 2 повні прогони + 1 e2e-цикл) |
| T-0015 | guards.mjs, monthly.mjs, ledger.mjs (repair/читання), bin/j4.mjs (`status`), j4-tick.sh, docs | T-0011 | bin/j4.mjs ↔ T-0013; ledger.mjs ↔ T-0011 | не затверджено (прогноз ~120 stub) |

Правило програми «не редагувати один файл паралельно»: T-0013 і T-0015 можна вести паралельно лише якщо `bin/j4.mjs` чіпає одна з них
(пропозиція: T-0013 виносить нові команди в `bridge/src/cli/orchestrate.mjs`, T-0015 — у `bridge/src/cli/status.mjs`; `bin/j4.mjs`
змінює лише T-0015 одним рядком реєстрації команд, або порядок T-0013 → T-0015). Інакше — послідовно: T-0013, потім T-0015, потім T-0014.

Критичний шлях: T-0012 (приймання) → T-0011 → T-0013 → T-0014. T-0015 — поза критичним шляхом після T-0011.
Жодних викликів адаптерів на T-0013…T-0015 до окремих наказів (програма п. 5).
