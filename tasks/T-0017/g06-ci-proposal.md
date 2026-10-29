# T-0017 / G06: мінімальна пропозиція CI-перевірки `collective::` лише на Windows (НЕ запущено)

**Редакція 3 (29.10.2026, після уточнення, переданого JE 13:29Z).** Редакція 2 помилково пропонувала ручний
`workflow_dispatch` з окремої незлитої гілки. За документацією GitHub `workflow_dispatch` спрацьовує лише тоді, коли
файл workflow є в default branch
(https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch),
тому так запустити не вийде. Нижче три варіанти на вибір JE.

**Редакція 2 (29.10.2026, після уточнення Codex, переданого JE 13:24Z; її механізм запуску перекрито редакцією 3).** Редакція 1 (у git-історії цього файла)
адресувала `9ea0994` і матрицю macOS + Windows. Після коміту злиття чинний subject — `70bade5`, і macOS на ньому
вже пройдено (`reports/T-0017/007.yaml`). Тому macOS-джоб прибрано, щоб не витрачати macOS-хвилини Actions.

Підстава: рішення JE 29.10.2026 05:20Z, п. 2 (G06 на macOS і Windows, без релізів; без Windows-середовища —
мінімальна пропозиція CI), рішення JE 13:15Z (A-2, новий head). У J3 Windows немає, хмарна сесія працює на Linux.

## Чому наявний CI цього не дає

У `desktop-build.yml` джоби `macos` і `windows` на PR пропускаються (skipped). Вони запускаються лише за
`workflow_dispatch` або на тегах `v*`, роблять тільки збірку, smoke-тест і пакування й **`cargo test` не запускають**.

## Варіанти (кожен — лише після рішення JE)

### В1. Подія `push` на окремій гілці, без злиття в main (рекомендація J3)

Для події `push` GitHub бере файл workflow із самого відправленого коміту, тож файл у main не потрібен.

1. Гілка `claude/g06-windows` від `main`, у ній **один новий файл** `.github/workflows/collective-vectors.yml` (нижче).
   PR не відкривається, у main нічого не зливається, PR #180 і його head не змінюються.
2. Тригер лише `push` на саму гілку `claude/g06-windows`. `desktop-build.yml` (push лише в `main`, теги, PR) і
   `runner.yml` (push лише в `main`, PR за шляхами) на цю гілку не спрацьовують — перевірено за тригерами в main.
3. Одна відправка гілки = один запуск. Checkout явного `ref: 70bade5…` (зашито у файл), крок перевірки
   `git rev-parse HEAD`, далі тільки `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::` на `windows-latest`.
4. Після доказу гілку видаляє власник або вона лишається неактивною (без нових пушів запусків немає).

Не перевірено: у цьому репозиторії такого запуску з бічної гілки ще не було; поведінку описано за документацією GitHub
для події `push`.

### В2. Малий workflow у main через окремий PR, потім `workflow_dispatch` на 70bade5

Файл (як у В1, але з `on: workflow_dispatch` і входом `sha`) зливається в main окремим PR. Злиття в main — окреме
рішення JE, і файл лишиться в main надалі (лише ручний запуск). Після злиття — один запуск із `sha` = `70bade5…`.

### В3. Без CI: локально на Windows

Власник або Codex на Windows: чистий checkout `70bade5…`, `git rev-parse HEAD`, заглушка `dist/index.html`,
`cargo test --locked --manifest-path src-tauri/Cargo.toml collective::`, надіслати підсумок і версію rustc.
`.github` не змінюється, хвилини Actions не витрачаються. Потрібен встановлений Rust (MSVC) на тому комп'ютері.

### Файл для В1

```yaml
name: collective-vectors (G06 Windows)
on:
  push:
    branches: [claude/g06-windows]
permissions:
  contents: read
env:
  SUBJECT_SHA: 70bade5e06ab781fc2906529ce415b92d2fd28b4
jobs:
  vectors-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: 70bade5e06ab781fc2906529ce415b92d2fd28b4
      - name: Exact SHA
        shell: bash
        run: test "$(git rev-parse HEAD)" = "$SUBJECT_SHA"
      - uses: dtolnay/rust-toolchain@6bed0761d98439e5a578e2877258200ad565ba87 # stable
        with:
          toolchain: stable
      # Tauri вбудовує ../dist під час компіляції; для тестів досить заглушки (як у checks).
      - name: Placeholder frontend
        shell: bash
        run: |
          mkdir -p dist
          echo '<!doctype html><title>EasyWAR</title>' > dist/index.html
      - name: collective vectors
        shell: bash
        run: |
          cargo test --locked --manifest-path src-tauri/Cargo.toml collective::
```

Доказ у будь-якому варіанті: точний SHA, ОС, rustc, підсумок «N passed, 1 ignored», exit code. J3 записує його окремим
звітом (як 007.yaml для macOS).

## Що потребує рішення JE (до нього нічого не створюється і не запускається)

- В1 і В2: новий файл у `.github/` — за правилами потрібне окреме слово JE; В2 ще й злиття в main.
- Хвилини Windows Actions: очікувано одна збірка крейта без кешу, приблизно 10–20 хв (у приватному репозиторії
  Windows рахується з множником 2). Платних викликів моделей немає.
- В3 не потребує ні `.github`, ні хвилин Actions.

## Не перевірено

Що tauri-build на Windows компілює крейт без sidecar-бінарника runner. На Linux у `checks` і на macOS (007.yaml)
це працює без нього. Якщо збірка на Windows вимагатиме runner, workflow впаде до тестів, і це буде видно в лозі.
Тоді знадобиться крок збірки runner, тобто більший обсяг.

## Примітка J3 до виконання (29.10.2026 13:49Z)

У YAML-фрагментах вище рядок `run: cargo test … collective::` у простому вигляді не є валідним YAML: двокрапка в кінці рядка робить із нього ключ. У файлі, що реально відправлено, і в цьому документі команду переведено в блок `run: |`. Виконано за В1: гілка `claude/g06-windows`, коміт 6f120493e29aa99465cf677ea8cde98ba23c2ea3, run 40885518249.
