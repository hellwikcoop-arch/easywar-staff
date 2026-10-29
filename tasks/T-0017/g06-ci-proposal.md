# T-0017 / G06: мінімальна пропозиція CI-перевірки `collective::` на macOS і Windows (НЕ запущено)

Підстава: рішення JE 29.10.2026 05:20Z, п. 2. Потрібні результати `cargo test collective::` на macOS і Windows
для SHA `9ea099433f83088fb97d04c6a0521e3379446fa0`. Додаткових релізів не створювати. Якщо Windows-середовища
немає, подати окрему мінімальну пропозицію CI. У J3 немає ні macOS, ні Windows, бо хмарна сесія працює на Linux.

## Чому наявний CI цього не дає

У `desktop-build.yml` джоби `macos` і `windows` на PR пропускаються (skipped). Вони запускаються лише за
`workflow_dispatch` або на тегах `v*` і роблять тільки збірку, smoke-тест і пакування, а **`cargo test` не запускають**.
Тому навіть ручний «Run workflow» G06 не доведе, зате зібрав би інсталятори, витратив хвилини macOS і нічого б не перевірив.

## Пропозиція (мінімальна)

1. Окрема гілка `claude/g06-collective-vectors` від `main` і **один новий файл** `.github/workflows/collective-vectors.yml`
   (нижче). `desktop-build.yml`, PR #180 і його head не змінюються: workflow сам робить checkout заданого SHA.
2. Тригер лише `workflow_dispatch` з входом `sha`, тож автоматичних запусків немає. Релізів і артефактів інсталяторів немає.
3. Один ручний запуск на `9ea0994…`: матриця `macos-latest`, `windows-latest`, крок — тільки
   `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::`.
4. Доказ — посилання на run і підсумки «N passed, 1 ignored» для кожної ОС. J3 записує їх у чекліст (п. 13) і в ШТАБ.
5. Після доказу workflow або видаляється, або лишається тільки ручним, як вирішить JE.

```yaml
name: collective-vectors (G06)
on:
  workflow_dispatch:
    inputs:
      sha:
        description: "Повний SHA коміту для перевірки"
        required: true
        default: "9ea099433f83088fb97d04c6a0521e3379446fa0"
permissions:
  contents: read
jobs:
  vectors:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ inputs.sha }}
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
        run: cargo test --locked --manifest-path src-tauri/Cargo.toml collective::
```

## Що потребує рішення JE

- Зміна в `.github/` (новий файл workflow) — за правилами потрібне окреме слово JE.
- Хвилини GitHub Actions: у приватному репозиторії macOS рахується з множником. Очікувано одна збірка крейта
  на кожній ОС, приблизно 10–20 хв без кешу. Платних API-викликів моделей немає.
- Альтернатива без CI: власник запускає ту саму команду на своєму Mac або Windows на `9ea0994…`, з
  `dist/index.html`-заглушкою, і надсилає підсумок.

## Не перевірено

Що tauri-build на macOS і Windows компілює крейт без sidecar-бінарника runner. На Linux у `checks` це працює
без нього. Якщо збірка вимагатиме runner, workflow впаде до тестів, і це буде видно в лозі. Тоді знадобиться
крок збірки runner, тобто більший обсяг.
