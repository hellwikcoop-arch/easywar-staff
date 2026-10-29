// Лічильник викликів адаптера J4 для обліку T-0009 (JE-T9-01, п. 2 і 5). Працює ПОЗА кодом bridge/ і нічого в ньому не змінює.
//
//   J4_CALL_COUNT_FILE=<файл> NODE_OPTIONS="--import <шлях>/tasks/T-0009/tools/call-counter.mjs" \
//     node --test 'bridge/test/*.test.mjs'
//   node tasks/T-0009/tools/call-counter.mjs --summary <файл>
//
// «Виклик» = успішно записана в журнал J4 подія dispatch_attempt — так само, як adapterCalls() у тестах і кроки budget.
// Пишуть і процеси тестів, і CLI-діти (вони успадковують NODE_OPTIONS). У файл іде лише pid, режим (stub/live) і ім'я
// адаптера; без J4_CALL_COUNT_FILE модуль нічого не робить. Запис, що не вдався, лічильник не ламає, але недорахунок
// можливий — тому перед використанням число звіряють із очікуваним (див. reports/T-0009/calls-ledger.yaml).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const counterFile = process.env.J4_CALL_COUNT_FILE;
if (counterFile) {
  const { Ledger } = await import('../../../bridge/src/ledger.mjs');
  const original = Ledger.prototype.appendUnlocked;
  Ledger.prototype.appendUnlocked = function patched(entry) {
    const rec = original.call(this, entry);
    if (rec?.event === 'dispatch_attempt') {
      try {
        fs.appendFileSync(counterFile, `${JSON.stringify({ pid: process.pid, mode: rec.detail?.mode ?? null, adapter: rec.detail?.adapter ?? null })}\n`);
      } catch {
        // облік не повинен ламати прогін
      }
    }
    return rec;
  };
}

const isMain = process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain && process.argv[2] === '--summary') {
  const f = process.argv[3];
  const rows = f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const tally = (k) => rows.reduce((a, r) => ({ ...a, [r[k] ?? 'null']: (a[r[k] ?? 'null'] ?? 0) + 1 }), {});
  process.stdout.write(`${JSON.stringify({ total: rows.length, by_mode: tally('mode'), by_adapter: tally('adapter'), processes: new Set(rows.map((r) => r.pid)).size })}\n`);
}
