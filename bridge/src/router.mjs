// J4 — координатор без власної LLM. Приймає структуровані повідомлення, перевіряє права, ліміти й цикли,
// доставляє адресату через адаптер, обгортає відповідь агента в нове повідомлення і веде журнал доказів.
// Стани повідомлення: queued → dispatched → received → recorded → replied | delivered | held | blocked | failed | rejected.
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL, validateMessage, bodyHash, sha256, canonical } from './protocol.mjs';
import { scanObject } from './scanner.mjs';
import { Store } from './store.mjs';
import { Ledger } from './ledger.mjs';
import { checkSender, checkRoute, taskAccepted } from './policy.mjs';
import { Budget, Thread } from './guards.mjs';
import { checkLive } from './gate.mjs';
import { AdapterError, parseAgentJson, renderInput } from './adapters/common.mjs';

const RETRYABLE_PARSE = new Set(['reply-not-json', 'reply-schema']);
const pad = (n, w) => String(n).padStart(w, '0');

export class J4 {
  constructor(o) {
    this.cfg = o.config;
    this.lim = o.config.limits.defaults;
    this.evidence = o.config.limits.evidence?.level ?? 'summary';
    this.store = new Store(o.home);
    this.ledger = new Ledger(o.ledgerFile);
    this.staffRoot = o.staffRoot ?? null;
    this.contractFile = o.contractFile ?? (this.staffRoot ? path.join(this.staffRoot, 'CONTRACT_v0_4.md') : null);
    this.adapters = o.adapters ?? {};
    this.instructionsDir = o.instructionsDir ?? null;
    this.approvalFile = o.approvalFile ?? null;
    this.env = o.env ?? process.env;
    this.clock = o.now ?? (() => Date.now());
    this.hooks = o.hooks ?? {};
    this.keepSpool = o.keepSpool ?? false;
  }

  nowIso() {
    return new Date(this.clock()).toISOString();
  }

  halted() {
    return this.env.J4_HALT === '1' || (this.staffRoot && fs.existsSync(path.join(this.staffRoot, 'bridge', 'HALT')));
  }

  nextId(kind, taskId) {
    const c = this.store.readJson('counters.json', {});
    const key = `${kind}:${taskId}`;
    c[key] = (c[key] ?? 0) + 1;
    this.store.writeJson('counters.json', c);
    if (kind === 'msg') return `M-${taskId}-${pad(c[key], 4)}`;
    if (kind === 'thread') return `TH-${taskId}-${pad(c[key], 3)}`;
    return `E-${taskId}-${pad(c[key], 3)}`;
  }

  log(event, msg, detail = {}) {
    const e = { event, at: this.nowIso() };
    if (msg) {
      Object.assign(e, {
        task_id: msg.task_id, thread_id: msg.thread_id ?? null, msg_id: msg.msg_id ?? null,
        from: msg.from, to: msg.to, kind: msg.kind, decision_level: msg.decision_level ?? null,
        subject: msg.subject ?? null, contract_version: msg.contract?.version ?? null,
        body_sha256: msg.body_sha256 ?? (msg.body ? bodyHash(msg.body) : null),
      });
      if (this.evidence === 'summary' && msg.body?.summary && !scanObject(msg.body.summary).length) e.summary = msg.body.summary;
    }
    if (Object.keys(detail).length) e.detail = detail;
    return this.ledger.append(e);
  }

  msgState(id) {
    return this.store.readJson(`messages/${id}.json`);
  }

  saveMsg(m) {
    this.store.writeJson(`messages/${m.msg_id}.json`, m);
  }

  contractCheck(msg) {
    if (!this.contractFile || !fs.existsSync(this.contractFile)) return { ok: false, code: 'contract-unavailable' };
    const actual = sha256(fs.readFileSync(this.contractFile));
    if (msg.contract.sha256 !== actual) return { ok: false, code: 'contract-mismatch', detail: `очікується ${actual.slice(0, 12)}` };
    return { ok: true };
  }

  // Приймає чернетку повідомлення. origin: human_cli | agent_cli | adapter.
  submit(draft, { origin, causedBy = null } = {}) {
    const reject = (code, detail = '', extra = {}) => {
      // у журнал іде лише безпечна частина відхиленої чернетки: перевірені ідентифікатори й хеш тіла
      const safe = {
        task_id: /^T-\d{4}$/.test(draft?.task_id ?? '') ? draft.task_id : null,
        from: this.cfg.roles[draft?.from] ? draft.from : null,
        to: this.cfg.roles[draft?.to] ? draft.to : null,
        kind: typeof draft?.kind === 'string' && /^[a-z_]{1,20}$/.test(draft.kind) ? draft.kind : null,
        body_sha256: bodyHash(draft?.body ?? null),
      };
      this.ledger.append({ event: 'message_rejected', at: this.nowIso(), ...safe, detail: { code, detail: scanObject(String(detail)).length ? '[redacted]' : String(detail).slice(0, 200), origin, ...extra } });
      return { ok: false, code, detail };
    };
    if (this.halted()) return reject('halted');
    const errors = validateMessage(draft, { limits: this.lim, draft: true });
    if (errors.length) return reject('invalid', errors.map((x) => `${x.field}:${x.code}`).join(','));
    const cc = this.contractCheck(draft);
    if (!cc.ok) return reject(cc.code, cc.detail);
    const sc = checkSender(this.cfg, draft, origin);
    if (!sc.ok) return reject(sc.code, sc.detail);
    const rc = checkRoute(this.cfg, draft);
    if (!rc.ok) return reject(rc.code, rc.detail);
    if (rc.route.requires_task_accepted && !taskAccepted(this.staffRoot, draft.task_id)) return reject('task-not-accepted', draft.task_id);
    const leaks = scanObject(draft.body);
    if (leaks.length) {
      const res = reject('scanner-block', '', { rules: [...new Set(leaks.map((l) => l.rule))] });
      if (origin === 'adapter') this.escalate({ ...draft, msg_id: null, thread_id: draft.thread_id ?? null }, 'red_line_risk', ['secrets'], 'відповідь агента містила заблокований вміст');
      return res;
    }

    // нитка
    let threadId = draft.thread_id ?? null;
    let parent = null;
    if (draft.in_reply_to) {
      parent = this.msgState(draft.in_reply_to);
      if (!parent) return reject('reply-unknown', draft.in_reply_to);
      threadId = parent.thread_id;
    }
    const cause = causedBy ? this.msgState(causedBy) : null;
    if (!threadId) {
      const open = this.store.list('threads').map((f) => this.store.readJson(`threads/${f}`)).filter((t) => t.task_id === draft.task_id && t.state !== 'closed');
      if (open.length >= this.lim.max_open_threads_per_task) return reject('limit-open-threads', `${open.length}`);
      threadId = this.nextId('thread', draft.task_id);
    } else if (!this.store.exists(`threads/${threadId}.json`)) return reject('thread-unknown', threadId);
    const thread = new Thread(this.store, threadId, draft.task_id);

    const msg = {
      ...draft,
      protocol: PROTOCOL,
      thread_id: threadId,
      hop: cause ? (cause.hop ?? 0) + 1 : 0,
      caused_by: causedBy,
      created_at: this.nowIso(),
      body_sha256: bodyHash(draft.body),
    };
    const loop = thread.check(msg, this.lim);
    if (loop) {
      const res = reject(loop.code, loop.detail, { thread_id: threadId });
      if (loop.code.startsWith('loop-')) this.escalate({ ...msg, msg_id: null }, loop.code, ['other'], 'захист від циклу зупинив нитку', thread);
      return res;
    }
    msg.msg_id = this.nextId('msg', draft.task_id);
    const full = validateMessage(msg, { limits: this.lim });
    if (full.length) return reject('invalid', full.map((x) => `${x.field}:${x.code}`).join(','));
    thread.add(msg);
    this.log('message_accepted', msg, { origin, hop: msg.hop, caused_by: causedBy, in_reply_to: msg.in_reply_to ?? null });

    // рівень C: до адресата не йде, тримається до рішення JE
    const needsC = msg.to !== 'JE' && (msg.decision_level === 'C' || (msg.body.decision_needed ?? []).length > 0);
    if (needsC) {
      this.saveMsg({ ...msg, status: 'held', attempts: 0, extra_attempts: 0 });
      const cats = (msg.body.decision_needed ?? []).map((d) => d.category);
      this.escalate(msg, 'decision_level_c', cats.length ? cats : ['other'], 'повідомлення потребує рішення JE', thread);
      return { ok: true, msg_id: msg.msg_id, thread_id: threadId, status: 'held' };
    }
    this.saveMsg({ ...msg, status: 'queued', attempts: 0, extra_attempts: 0 });
    return { ok: true, msg_id: msg.msg_id, thread_id: threadId, status: 'queued' };
  }

  escalate(msg, reason, categories, note, thread = null) {
    const id = this.nextId('esc', msg.task_id);
    const questions = (msg.body?.decision_needed ?? []).map((d) => ({ category: d.category, question_sha256: sha256(d.question) }));
    const rec = {
      escalation_id: id, task_id: msg.task_id, thread_id: msg.thread_id ?? null, msg_id: msg.msg_id ?? null,
      reason, categories, note, questions, status: 'open', raised_at: this.nowIso(), to: 'JE',
    };
    this.store.writeJson(`escalations/${id}.json`, rec);
    if (thread) thread.setState('awaiting_founder', id);
    else if (msg.thread_id && this.store.exists(`threads/${msg.thread_id}.json`)) new Thread(this.store, msg.thread_id, msg.task_id).setState('awaiting_founder', id);
    this.log('escalation_raised', msg.msg_id ? msg : null, { escalation_id: id, task_id: msg.task_id, thread_id: msg.thread_id ?? null, reason, categories });
    return id;
  }

  // Рішення JE щодо ескалації. Лише з людського входу.
  resolve(escalationId, { decision, note = '' }, { origin }) {
    if (origin !== 'human_cli') return { ok: false, code: 'origin-denied' };
    if (!['release', 'reject', 'resume', 'halt', 'third_attempt'].includes(decision)) return { ok: false, code: 'invalid-decision' };
    const rec = this.store.readJson(`escalations/${escalationId}.json`);
    if (!rec) return { ok: false, code: 'escalation-unknown' };
    if (rec.status !== 'open') return { ok: false, code: 'escalation-closed' };
    if (scanObject(note).length) return { ok: false, code: 'scanner-block' };
    rec.status = 'resolved';
    rec.decision = decision;
    rec.resolved_at = this.nowIso();
    this.store.writeJson(`escalations/${escalationId}.json`, rec);
    if (rec.thread_id) {
      const th = new Thread(this.store, rec.thread_id, rec.task_id);
      th.setState(decision === 'halt' ? 'halted' : 'open');
    }
    if (rec.msg_id) {
      const m = this.msgState(rec.msg_id);
      if (m && ['held', 'blocked'].includes(m.status)) {
        if (decision === 'release' || decision === 'resume') m.status = 'queued';
        else if (decision === 'third_attempt') { m.status = 'queued'; m.extra_attempts = (m.extra_attempts ?? 0) + 1; }
        else m.status = 'rejected';
        this.saveMsg(m);
      }
    }
    this.log('escalation_resolved', null, { escalation_id: escalationId, task_id: rec.task_id, thread_id: rec.thread_id, decision, by: 'JE', note_sha256: note ? sha256(note) : null });
    return { ok: true };
  }

  queued() {
    return this.store.list('messages').map((f) => this.store.readJson(`messages/${f}`)).filter((m) => m.status === 'queued');
  }

  // Обробка черги під замком. Спочатку відновлення після можливого збою.
  async process({ maxSteps = 50 } = {}) {
    const lock = this.store.acquireLock(this.lim.lock_stale_ms, this.clock());
    if (!lock.acquired) return { ok: false, code: 'locked' };
    try {
      if (lock.recovered) this.log('lock_recovered', null, { stale_pid: lock.recovered.pid ?? null });
      await this.recover();
      if (this.halted()) {
        this.log('halted', null, {});
        return { ok: false, code: 'halted' };
      }
      let steps = 0;
      for (;;) {
        const q = this.queued();
        if (!q.length || steps >= maxSteps) break;
        steps += 1;
        await this.deliver(q[0]);
      }
      return { ok: true, steps };
    } finally {
      this.store.releaseLock();
    }
  }

  adapterFor(role) {
    if (role === 'JE') return { name: 'escalation', mode: 'deposit', live: false };
    return this.adapters[role] ?? { name: 'inbox', mode: 'deposit', live: false };
  }

  async deliver(m) {
    const ad = this.adapterFor(m.to);
    if (ad.mode === 'deposit') {
      const dir = m.to === 'JE' ? 'escalations/inbox' : `inbox/${m.to}`;
      this.store.writeJson(`${dir}/${m.msg_id}.json`, stripState(m));
      m.status = 'delivered';
      this.saveMsg(m);
      this.log('message_delivered', m, { adapter: ad.name, mode: 'deposit' });
      return;
    }

    let limits = this.lim;
    let gate = null;
    if (ad.live) {
      gate = checkLive({ adapter: ad, taskId: m.task_id, env: this.env, approvalFile: this.approvalFile, now: this.clock(), defaults: this.lim });
      if (!gate.ok) {
        m.status = 'blocked';
        this.saveMsg(m);
        this.log('dispatch_blocked', m, { adapter: ad.name, code: gate.code, detail: gate.detail ?? null });
        this.escalate(m, 'live-gate', ['new_integration'], `живий адаптер ${ad.name} не погоджено`);
        return;
      }
      limits = gate.limits;
    }

    const maxAttempts = limits.max_attempts + (m.extra_attempts ?? 0);
    if (m.attempts >= maxAttempts) {
      m.status = 'blocked';
      this.saveMsg(m);
      this.escalate(m, 'attempts-exhausted', ['third_attempt'], `використано ${m.attempts} з ${maxAttempts} спроб`);
      return;
    }

    const estTokens = limits.reserve_tokens_per_call;
    const estCost = gate?.price ? (estTokens / 1e6) * Math.max(gate.price.input_per_mtok ?? 0, gate.price.output_per_mtok ?? 0) : 0;
    const budget = new Budget(this.store, m.task_id);
    const deny = budget.reserve(m.msg_id, { calls: 1, tokens: estTokens, cost: estCost }, limits, this.clock());
    if (deny) {
      m.status = 'blocked';
      this.saveMsg(m);
      this.log('dispatch_blocked', m, { adapter: ad.name, code: deny, usage: budget.snapshot() });
      this.escalate(m, 'auto_on_limit', ['budget_over_reserve'], deny);
      return;
    }

    const instructions = this.instructionsFor(m.to);
    const input = renderInput(m);
    const promptSha = sha256(canonical({ instructions_sha256: sha256(instructions), input_sha256: sha256(input) }));
    m.attempts += 1;
    m.status = 'dispatched';
    m.dispatch = { adapter: ad.name, live: !!ad.live, prompt_sha256: promptSha, instructions_sha256: sha256(instructions), approval: gate?.approval ?? null, attempt: m.attempts };
    this.saveMsg(m); // запис до виклику: після збою відомо, що виклик міг відбутися
    this.log('dispatch_attempt', m, { adapter: ad.name, mode: ad.live ? 'live' : 'stub', attempt: m.attempts, max_attempts: maxAttempts, prompt_sha256: promptSha });

    let out;
    try {
      out = await ad.call({ message: stripState(m), instructions, input, model: gate?.model ?? null, limits });
    } catch (e) {
      if (!(e instanceof AdapterError)) throw e; // непередбачений збій процесу: стан dispatched лишається для відновлення
      budget.settle(m.msg_id, { calls: 1, tokens: null, cost: null }, this.clock());
      this.failAttempt(m, e, maxAttempts);
      return;
    }
    this.store.writeJson(`spool/${m.msg_id}.reply.json`, { rawText: out.rawText, meta: out.meta ?? {} });
    m.status = 'received';
    this.saveMsg(m);
    if (this.hooks.afterSpool) this.hooks.afterSpool(m);
    await this.finalize(m, gate);
  }

  failAttempt(m, e, maxAttempts) {
    const retry = (e.transient || RETRYABLE_PARSE.has(e.code)) && m.attempts < maxAttempts;
    this.log('dispatch_failed', m, { code: e.code, transient: !!e.transient, attempt: m.attempts, will_retry: retry });
    if (retry) {
      m.status = 'queued';
      this.saveMsg(m);
      return;
    }
    m.status = 'blocked';
    this.saveMsg(m);
    this.escalate(m, m.attempts >= maxAttempts ? 'attempts-exhausted' : `adapter-${e.code}`, [m.attempts >= maxAttempts ? 'third_attempt' : 'other'], 'доставку зупинено');
  }

  instructionsFor(role) {
    if (!this.instructionsDir) return '';
    const f = path.join(this.instructionsDir, `${role}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }

  ledgerHas(event, msgId) {
    return this.ledger.readAll().entries.some((x) => x.event === event && x.msg_id === msgId);
  }

  async finalize(m, gate = null) {
    const spool = this.store.readJson(`spool/${m.msg_id}.reply.json`);
    if (!spool) throw new Error(`spool-missing:${m.msg_id}`);
    const maxAttempts = (gate?.limits ?? this.lim).max_attempts + (m.extra_attempts ?? 0);
    const budget = new Budget(this.store, m.task_id);
    let reply;
    try {
      reply = parseAgentJson(spool.rawText);
    } catch (e) {
      if (budget.s.reserved[m.msg_id]) budget.settle(m.msg_id, { calls: 1, tokens: sumTokens(spool.meta), cost: null }, this.clock());
      this.store.remove(`spool/${m.msg_id}.reply.json`);
      this.failAttempt(m, e, maxAttempts);
      return;
    }
    const leaks = scanObject(reply);
    const tokens = sumTokens(spool.meta);
    const cost = gate?.price && spool.meta?.usage?.input_tokens != null && spool.meta?.usage?.output_tokens != null
      ? (spool.meta.usage.input_tokens * (gate.price.input_per_mtok ?? 0) + spool.meta.usage.output_tokens * (gate.price.output_per_mtok ?? 0)) / 1e6
      : (spool.meta?.cost_usd ?? (m.dispatch?.live ? null : 0));
    if (budget.s.reserved[m.msg_id]) budget.settle(m.msg_id, { calls: 1, tokens, cost }, this.clock());
    const usage = {
      calls: { value: 1, accuracy: 'exact' },
      input_tokens: { value: spool.meta?.usage?.input_tokens ?? null, accuracy: spool.meta?.usage?.input_tokens != null ? 'exact' : 'unknown' },
      output_tokens: { value: spool.meta?.usage?.output_tokens ?? null, accuracy: spool.meta?.usage?.output_tokens != null ? 'exact' : 'unknown' },
      cost_usd: { value: cost, accuracy: cost === null ? 'unknown' : (gate?.price ? 'estimate' : 'exact') },
      task_total: budget.snapshot(),
    };
    const meta = { adapter: m.dispatch?.adapter, mode: m.dispatch?.live ? 'live' : 'stub', model_id: spool.meta?.model_id ?? null, request_id: spool.meta?.request_id ?? null, raw_sha256: sha256(spool.rawText), prompt_sha256: m.dispatch?.prompt_sha256 ?? null, approval: m.dispatch?.approval ?? null };
    if (leaks.length) {
      if (!this.ledgerHas('reply_blocked', m.msg_id)) this.log('reply_blocked', m, { ...meta, usage, rules: [...new Set(leaks.map((l) => l.rule))] });
      this.store.remove(`spool/${m.msg_id}.reply.json`);
      m.status = 'failed';
      this.saveMsg(m);
      this.escalate(m, 'red_line_risk', ['secrets'], 'відповідь агента заблоковано сканером');
      return;
    }
    if (!m.pending_reply) {
      m.pending_reply = reply;
      this.saveMsg(m);
    }
    if (!this.ledgerHas('reply_received', m.msg_id)) this.log('reply_received', m, { ...meta, usage, verdict: reply.verdict });
    m.status = 'recorded';
    this.saveMsg(m);
    if (!this.keepSpool) this.store.remove(`spool/${m.msg_id}.reply.json`);
    this.submitReply(m);
  }

  submitReply(m) {
    const r = m.pending_reply;
    const draft = {
      protocol: PROTOCOL,
      task_id: m.task_id, task_version: m.task_version, contract: m.contract, subject: m.subject,
      from: m.to, to: m.from, kind: 'response', intent: 'answer', in_reply_to: m.msg_id,
      decision_level: r.decision_needed.length ? 'C' : 'A', data_class: 'synthetic',
      body: { summary: r.summary, text: r.text, verdict: r.verdict, decision_needed: r.decision_needed },
    };
    const res = this.submit(draft, { origin: 'adapter', causedBy: m.msg_id });
    m.status = res.ok ? 'replied' : 'reply-rejected';
    m.reply_msg_id = res.msg_id ?? null;
    delete m.pending_reply;
    this.saveMsg(m);
    return res;
  }

  // Відновлення після збою: обірваний журнал, виклики з невідомим результатом, неподані відповіді.
  async recover() {
    this.ledger.repairIfNeeded(this.nowIso());
    for (const f of this.store.list('messages')) {
      const m = this.store.readJson(`messages/${f}`);
      if (m.status === 'dispatched') {
        if (this.store.exists(`spool/${m.msg_id}.reply.json`)) {
          m.status = 'received';
          this.saveMsg(m);
          this.log('recovered', m, { from_status: 'dispatched', action: 'finalize-from-spool' });
        } else {
          const budget = new Budget(this.store, m.task_id);
          if (budget.s.reserved[m.msg_id]) budget.consumeUnknown(m.msg_id, this.clock());
          this.log('dispatch_outcome_unknown', m, { attempt: m.attempts, note: 'виклик міг відбутися; спроба й резерв зараховані', usage: budget.snapshot() });
          const maxAttempts = this.lim.max_attempts + (m.extra_attempts ?? 0);
          if (m.attempts < maxAttempts) {
            m.status = 'queued';
            this.saveMsg(m);
          } else {
            m.status = 'blocked';
            this.saveMsg(m);
            this.escalate(m, 'attempts-exhausted', ['third_attempt'], 'результат виклику невідомий, спроби вичерпано');
          }
          continue;
        }
      }
      if (m.status === 'received') {
        await this.finalize(m);
      } else if (m.status === 'recorded' && m.pending_reply) {
        this.log('recovered', m, { from_status: 'recorded', action: 'submit-reply' });
        this.submitReply(m);
      }
    }
  }
}

function sumTokens(meta) {
  const i = meta?.usage?.input_tokens;
  const o = meta?.usage?.output_tokens;
  return Number.isFinite(i) && Number.isFinite(o) ? i + o : null;
}

function stripState(m) {
  const { status, attempts, extra_attempts, dispatch, pending_reply, reply_msg_id, ...msg } = m;
  return msg;
}
