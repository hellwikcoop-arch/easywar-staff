#!/bin/sh
# Один такт обробника J4 для запуску за розкладом (T-0009). Лише stub: змінні живого режиму
# знімаються, режим задано явно. Нічого не комітить і не пушить: події ADM лишаються в робочій
# копії tasks/*/events.jsonl, їх комітить людина або J3 після перегляду.
# Розклад цим скриптом НЕ вмикається; приклади cron/launchd — bridge/docs/DESIGN.md, розд. 17.
# Коди виходу: 0 — пройдено; 75 — інший обробник уже працює; 4 — стоп-кран; інше — помилка.
set -u
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${J4_HOME:?потрібен J4_HOME}"
: "${J4_LEDGER:?потрібен J4_LEDGER}"
unset J4_ALLOW_LIVE J4_APPROVAL OPENAI_API_KEY CODEX_API_KEY
mkdir -p "$J4_HOME"
node "$here/j4.mjs" run --once --mode stub --task-events --max-steps "${J4_TICK_MAX_STEPS:-10}" >>"$J4_HOME/tick.log" 2>&1
code=$?
printf '%s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" >>"$J4_HOME/tick.log"
exit "$code"
