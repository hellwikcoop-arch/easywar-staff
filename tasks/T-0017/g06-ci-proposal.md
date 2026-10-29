# T-0017 / G06: мінімальна пропозиція CI-перевірки `collective::` лише на Windows (НЕ запущено)

**Редакція 2 (29.10.2026, після уточнення Codex, переданого JE 13:24Z).** Редакція 1 (у git-історії цього файла)
адресувала `9ea0994` і матрицю macOS + Windows. Після коміту злиття чинний subject — `70bade5`, і macOS на ньому
вже пройдено (`reports/T-0017/007.yaml`). Тому macOS-джоб прибрано, щоб не витрачати macOS-хвилини Actions.

Підстава: рішення JE 29.10.2026 05:20Z, п. 2 (G06 на macOS і Windows, без релізів; без Windows-середовища —
мінімальна пропозиція CI), рішення JE 13:15Z (A-2, новий head). У J3 Windows немає, хмарна сесія працює на Linux.

## Чому наявний CI цього не дає

У `desktop-build.yml` джоби `macos` і `windows` на PR пропускаються (skipped). Вони запускаються лише за
`workflow_dispatch` або на тегах `v*`, роблять тільки збірку, smoke-тест і пакування й **`cargo test` не запускають**.

## Пропозиція (мінімальна)

1. Окрема гілка `claude/g06-collective-vectors` від `main` і **один новий файл** `.github/workflows/collective-vectors.yml`
   (нижче). `desktop-build.yml`, PR #180 і його head не змінюються; production-коду не торкається.
2. Тригер лише `workflow_dispatch` з входом `sha`, тож автоматичних запусків немає. Релізів, артефактів і секретів немає.
3. Один ручний запуск на `70bade5e06ab781fc2906529ce415b92d2fd28b4`, лише `windows-latest`, крок — тільки
   `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::`. Workflow перевіряє, що checkout дав саме цей SHA.
4. Доказ — посилання на run і підсумок «N passed, 1 ignored». J3 записує його окремим звітом (як 007.yaml для macOS).
5. Після доказу workflow видаляється або лишається тільки ручним — як вирішить JE.

```yaml
name: collective-vectors (G06 Windows)
on:
  workflow_dispatch:
    inputs:
      sha:
        description: "Повний SHA коміту для перевірки"
        required: true
        default: "70bade5e06ab781fc2906529ce415b92d2fd28b4"
permissions:
  contents: read
jobs:
  vectors-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ inputs.sha }}
      - name: Exact SHA
        shell: bash
        run: test "$(git rev-parse HEAD)" = "${{ inputs.sha }}"
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

## Що потребує рішення JE (до нього нічого не створюється і не запускається)

- Новий файл у `.github/` — за правилами потрібне окреме слово JE.
- Хвилини Windows Actions: очікувано одна збірка крейта без кешу, приблизно 10–20 хв (у приватному репозиторії
  Windows рахується з множником 2). Платних викликів моделей немає.
- Альтернатива без CI: власник або Codex запускає ту саму команду на Windows на `70bade5…` з `dist/index.html`-заглушкою
  і надсилає підсумок.

## Не перевірено

Що tauri-build на Windows компілює крейт без sidecar-бінарника runner. На Linux у `checks` і на macOS (007.yaml)
це працює без нього. Якщо збірка на Windows вимагатиме runner, workflow впаде до тестів, і це буде видно в лозі.
Тоді знадобиться крок збірки runner, тобто більший обсяг.
