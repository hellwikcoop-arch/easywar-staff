#!/usr/bin/env bash
# Запуск node --test з обліком викликів адаптера (T-0011, Р-Т11-4). Кожен прогін — у власному порожньому TMPDIR;
# після нього рахуються записи dispatch_attempt у всіх журналах, створених тестами. Використання:
#   tasks/T-0011/tools/run-counted.sh <мітка> <аргументи node --test…>
# Виводить підсумок node --test і рядок `COUNTED label=… dispatch_attempt=N files=M`. Прямі adapter.call() (gate.test.mjs) сканер не бачить.
set -u
label="${1:?мітка}"; shift
tmp="$(mktemp -d /tmp/j4-counted-XXXXXX)"
out="${tmp}.log"
TMPDIR="$tmp" node --test "$@" >"$out" 2>&1
code=$?
tail -n 12 "$out" | grep -E '^# (tests|pass|fail|cancelled|skipped|duration_ms)'
n=$(grep -rho '"dispatch_attempt"' "$tmp" 2>/dev/null | wc -l)
f=$(grep -rl '"dispatch_attempt"' "$tmp" 2>/dev/null | wc -l)
echo "COUNTED label=${label} dispatch_attempt=${n} files=${f} exit=${code} log=${out}"
rm -rf "$tmp"
exit "$code"
