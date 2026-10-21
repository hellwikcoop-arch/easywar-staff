// Адаптери агентів, що запускаються командним рядком: Claude Code (claude -p) і Codex (codex exec).
// Обидва live: працюють лише через ворота gate.mjs. У v0.1 не запускалися; прапорці CLI звірено з
// довідниками на 21.10.2026 і потрібно підтвердити практичною перевіркою (розділ 9, п. 5 контракту).
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdapterError } from './common.mjs';
import { AGENT_REPLY_SCHEMA } from '../protocol.mjs';

export function claudeArgs({ instructions, readOnly = true }) {
  const a = ['-p', '--output-format', 'json', '--max-turns', '3', '--append-system-prompt', instructions];
  a.push('--allowedTools', readOnly ? 'Read,Grep,Glob' : 'Read,Grep,Glob,Edit,Write');
  return a;
}

export function codexArgs({ workdir, sandbox, schemaFile, outFile }) {
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new AdapterError('sandbox-denied', { detail: sandbox });
  return ['exec', '--json', '-s', sandbox, '-C', workdir, '--output-schema', schemaFile, '-o', outFile, '-'];
}

function run(spawnImpl, cmd, args, { input, cwd, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const ch = spawnImpl(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => {
      ch.kill('SIGTERM');
      reject(new AdapterError('timeout', { transient: true }));
    }, timeoutMs);
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { errOut += d; });
    ch.on('error', (e) => { clearTimeout(timer); reject(new AdapterError('spawn', { detail: e.code ?? '' })); });
    ch.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new AdapterError(`exit-${code}`, { transient: false, detail: errOut.slice(-300) }));
      else resolve(out);
    });
    ch.stdin.end(input);
  });
}

export function claudeAdapter({ spawnImpl = nodeSpawn, workdir, readOnly = true, env = process.env, timeoutMs = 120000 } = {}) {
  return {
    name: 'claude',
    mode: 'sync',
    live: true,
    requiredEnv: ['ANTHROPIC_API_KEY'],
    async call({ instructions, input }) {
      const out = await run(spawnImpl, 'claude', claudeArgs({ instructions, readOnly }), { input, cwd: workdir, timeoutMs, env });
      let j;
      try {
        j = JSON.parse(out);
      } catch {
        throw new AdapterError('cli-output-not-json');
      }
      if (j.is_error) throw new AdapterError('cli-error', { detail: j.subtype ?? '' });
      return {
        rawText: j.result ?? '',
        meta: {
          model_id: null, // claude -p не гарантує ідентифікатор моделі у виводі; ADM підтверджує окремо (розділ 7)
          request_id: j.session_id ?? null,
          usage: { input_tokens: j.usage?.input_tokens ?? null, output_tokens: j.usage?.output_tokens ?? null },
          cost_usd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
        },
      };
    },
  };
}

export function codexAdapter({ spawnImpl = nodeSpawn, workdir, sandbox = 'read-only', env = process.env, timeoutMs = 600000 } = {}) {
  return {
    name: 'codex',
    mode: 'sync',
    live: true,
    requiredEnv: ['CODEX_API_KEY'],
    async call({ instructions, input }) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j4-codex-'));
      const schemaFile = path.join(tmp, 'schema.json');
      const outFile = path.join(tmp, 'last.txt');
      fs.writeFileSync(schemaFile, JSON.stringify(AGENT_REPLY_SCHEMA));
      try {
        await run(spawnImpl, 'codex', codexArgs({ workdir, sandbox, schemaFile, outFile }), { input: `${instructions}\n\n${input}`, cwd: workdir, timeoutMs, env });
        const rawText = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
        return { rawText, meta: { model_id: null, request_id: null, usage: { input_tokens: null, output_tokens: null } } };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}
