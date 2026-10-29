# PR №8 — аномальний запуск GitHub Actions: розслідування без повторного CI (J5 п. 6, 2026-10-28)

Лише читання GitHub API (`get_workflow`, `get_workflow_run`, `list_workflows`, `list_workflow_runs`, `pull_request get`) і git; жодного re-run, dispatch чи зміни гілок.

| Факт | Значення |
|---|---|
| Запуск | run 40656400988, `event: pull_request`, `conclusion: startup_failure`, 0 jobs, `display_title: (Unknown event)`, `run_number: 1`, created 2026-10-28T08:23:11Z — через 3 с після створення PR №8 (08:23:08Z) |
| «Workflow» запуску | id 399166116, `name: ""`, `path: BuildFailed`, **`state: deleted`**, створений у ту ж секунду, що й запуск. Це не файл репозиторію: `git ls-tree` на всіх гілках файла `BuildFailed` не має; у `list_workflows` лишаються лише `j4-bridge.yml` (391980257) і `j4-bridge-tests.yml` (391980926, лише гілка codex) |
| Файли workflow | `.github/**` на head `eba568d` і на базі `0f2cd0b` ідентичні (`git diff --stat 0f2cd0b eba568d -- .github` порожній); `j4-bridge.yml` розбирається як YAML; тригер `pull_request` з `paths: ['bridge/**', '.github/workflows/j4-bridge.yml']` — diff PR №8 (лише `reports/J4-HARDENING/**`) під фільтр не підпадає, тому очікувано 0 прогонів `j4-bridge` (так і є: прогону `j4-bridge` для PR №8 немає) |
| PR | draft, open, `mergeable_state: clean`, 25 файлів, 3 коміти; нових запусків після 08:23 немає (станом на 11:30 UTC), у т. ч. після push гілок `t-0012/acceptance-barrier` і `program/t-0013-15-drafts` (push CI не запускає) |

**Висновок J3 (обережний):** запис `BuildFailed`/`startup_failure` без jobs — службовий запис GitHub про невдалу оцінку workflow на події `pull_request`, а не виконання жодного job: коду не виконувалось, артефактів і логів немає (0 jobs — `get_job_logs` нічого не поверне), «workflow» уже видалено GitHub. Причину збою оцінки з API встановити не вдалося: файли workflow ті самі, що в PR №7 (де прогін пройшов нормально); відмінність PR №8 лише в тому, що жоден workflow не підпав під фільтр `paths`. Відомі з досвіду причини такого запису — тимчасовий збій GitHub Actions на боці сервісу або помилка оцінки workflow у момент створення PR; жодна з них не стосується вмісту `reports/J4-HARDENING/**`.

**Вплив на ліміти:** 0 викликів адаптера, 0 CI-прогонів (jobs не було). **Що не перевірено:** внутрішні логи GitHub (недоступні), поведінка при наступній події `pull_request` на цьому PR (навмисно не створювалась — J5 п. 6).

**Варіанти для JE (рішення не ухвалюю):** (а) лишити PR №8 чернеткою як є — аномалія без наслідків; (б) якщо потрібна чистота історії Actions — закрити PR №8 і подати пакет знову пізніше разом із рішенням щодо T-0012 (новий `pull_request` event — можливий новий запис); (в) нічого не робити до появи наступного реального прогону CI (за дозволом JE для коду T-0012), який і покаже, чи збій повторюється.
