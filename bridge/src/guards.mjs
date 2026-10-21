// Ліміти й захист від циклів J4: бюджет задачі (резерв перед викликом, розрахунок після),
// раунди, хопи, глибина делегування, ping-pong і цикли очікування.

export function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export class Budget {
  constructor(store, taskId) {
    this.store = store;
    this.rel = `budget/${taskId}.json`;
    this.s = store.readJson(this.rel, { task_id: taskId, calls: 0, tokens: 0, tokens_accuracy: 'exact', cost_usd: 0, cost_accuracy: 'exact', days: {}, reserved: {} });
  }

  save() {
    this.store.writeJson(this.rel, this.s);
  }

  // Резерв перед викликом. Повертає null або код відмови.
  reserve(msgId, est, lim, now) {
    const d = today(now);
    const r = Object.values(this.s.reserved).reduce((a, x) => ({ calls: a.calls + x.calls, tokens: a.tokens + x.tokens, cost: a.cost + x.cost }), { calls: 0, tokens: 0, cost: 0 });
    if (this.s.calls + r.calls + est.calls > lim.max_calls_per_task) return 'limit-calls-task';
    if ((this.s.days[d] ?? 0) + est.calls > lim.max_calls_per_day) return 'limit-calls-day';
    if (this.s.tokens + r.tokens + est.tokens > lim.max_tokens_per_task) return 'limit-tokens-task';
    if (est.cost > 0 && this.s.cost_usd + r.cost + est.cost > lim.max_cost_usd_per_task) return 'limit-cost-task';
    this.s.reserved[msgId] = { calls: est.calls, tokens: est.tokens, cost: est.cost, at: now };
    this.save();
    return null;
  }

  // Розрахунок після виклику. actual.tokens = null, якщо провайдер не дав обліку: тоді лишається резерв (estimate).
  settle(msgId, actual, now) {
    const res = this.s.reserved[msgId] ?? { calls: 1, tokens: 0, cost: 0 };
    delete this.s.reserved[msgId];
    const d = today(now);
    this.s.calls += actual.calls ?? res.calls;
    this.s.days[d] = (this.s.days[d] ?? 0) + (actual.calls ?? res.calls);
    this.s.tokens += actual.tokens ?? res.tokens;
    if (actual.tokens === null || actual.tokens === undefined) this.s.tokens_accuracy = 'estimate';
    if (actual.cost === null || actual.cost === undefined) {
      this.s.cost_usd += res.cost;
      if (res.cost > 0) this.s.cost_accuracy = 'estimate';
    } else this.s.cost_usd += actual.cost;
    this.save();
    return this.snapshot();
  }

  // Зняти резерв без виклику (виклик не відбувся: відмова місячного бюджету).
  release(msgId) {
    delete this.s.reserved[msgId];
    this.save();
  }

  // Резерв без результату (збій після відправлення): витрата вважається здійсненою, accuracy estimate.
  consumeUnknown(msgId, now) {
    const s = this.settle(msgId, { calls: null, tokens: null, cost: null }, now);
    this.s.cost_accuracy = 'estimate';
    this.save();
    return s;
  }

  snapshot() {
    return { calls: this.s.calls, tokens: this.s.tokens, tokens_accuracy: this.s.tokens_accuracy ?? 'exact', cost_usd: Number(this.s.cost_usd.toFixed(6)), cost_accuracy: this.s.cost_accuracy };
  }
}

export class Thread {
  constructor(store, threadId, taskId) {
    this.store = store;
    this.rel = `threads/${threadId}.json`;
    this.t = store.readJson(this.rel, { thread_id: threadId, task_id: taskId, state: 'open', messages: [], waiting: {}, escalations: [] });
  }

  save() {
    this.store.writeJson(this.rel, this.t);
  }

  get state() {
    return this.t.state;
  }

  find(msgId) {
    return this.t.messages.find((m) => m.msg_id === msgId) ?? null;
  }

  // Кількість запитів (request) у причинному ланцюгу повідомлення, без кореня.
  delegationDepth(msg) {
    let depth = 0;
    let cur = msg.caused_by ? this.find(msg.caused_by) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.msg_id)) {
      seen.add(cur.msg_id);
      if (cur.kind === 'request') depth += 1;
      cur = cur.caused_by ? this.find(cur.caused_by) : null;
    }
    return msg.kind === 'request' ? Math.max(0, depth) : 0;
  }

  // Перевірки перед прийняттям повідомлення в нитку. Повертає null або {code, detail}.
  check(msg, lim) {
    if (this.t.state === 'awaiting_founder') return { code: 'thread-awaiting-founder', detail: 'нитка чекає рішення JE' };
    if (this.t.state === 'halted' || this.t.state === 'closed') return { code: `thread-${this.t.state}` };
    if (msg.task_id !== this.t.task_id) return { code: 'thread-task-mismatch' };
    if (msg.hop > lim.max_hops) return { code: 'loop-max-hops', detail: `${msg.hop} > ${lim.max_hops}` };
    const rounds = this.t.messages.filter((m) => m.kind === 'request').length + (msg.kind === 'request' ? 1 : 0);
    if (rounds > lim.max_rounds_per_thread) return { code: 'loop-max-rounds', detail: `${rounds} > ${lim.max_rounds_per_thread}` };
    if (this.t.messages.some((m) => m.from === msg.from && m.to === msg.to && m.kind === msg.kind && m.body_sha256 === msg.body_sha256)) {
      return { code: 'loop-ping-pong', detail: 'повтор того самого повідомлення в нитці' };
    }
    if (msg.kind === 'request') {
      if (this.delegationDepth(msg) > lim.max_delegation_depth) return { code: 'loop-delegation-depth', detail: `> ${lim.max_delegation_depth}` };
      // цикл очікування: from чекатиме на to; якщо to (прямо чи через ланцюг) уже чекає на from — цикл
      let cur = msg.to;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        if (cur === msg.from) return { code: 'loop-wait-cycle', detail: `${msg.from} ⇄ ${msg.to}` };
        seen.add(cur);
        cur = this.t.waiting[cur]?.on ?? null;
      }
    }
    if (msg.in_reply_to && !this.find(msg.in_reply_to)) return { code: 'reply-unknown', detail: msg.in_reply_to };
    return null;
  }

  add(msg) {
    this.t.messages.push({ msg_id: msg.msg_id, from: msg.from, to: msg.to, kind: msg.kind, hop: msg.hop, caused_by: msg.caused_by ?? null, in_reply_to: msg.in_reply_to ?? null, body_sha256: msg.body_sha256 });
    if (msg.kind === 'request') this.t.waiting[msg.from] = { on: msg.to, msg_id: msg.msg_id };
    if (msg.in_reply_to) {
      const orig = this.find(msg.in_reply_to);
      if (orig && this.t.waiting[orig.from]?.msg_id === orig.msg_id) delete this.t.waiting[orig.from];
    }
    this.save();
  }

  setState(state, escalationId = null) {
    this.t.state = state;
    if (escalationId) this.t.escalations.push(escalationId);
    this.save();
  }
}
