// Сканер вихідного тексту J4. Страховка, а не основний захист (розділ 9, п. 4):
// основний захист — synthetic-only, відсутність доступу J5 до файлів і allowlist каталогів.
// Будь-яке спрацювання блокує відправлення й запис тексту; у журнал іде лише код правила.

const RULES = [
  // секрети
  { id: 'secret.openai', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { id: 'secret.anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'secret.github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { id: 'secret.aws', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'secret.private_key', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { id: 'secret.jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'secret.assignment', re: /\b(?:api[_-]?key|secret|token|password|passwd|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i },
  { id: 'secret.auth_header', re: /\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9_\-./+=]{12,}/i },
  // схожі на реальні операційні дані
  { id: 'ops.coordinates', re: /[-+]?\b\d{1,2}\.\d{4,}\s*[,;\s]\s*[-+]?\d{1,3}\.\d{4,}\b/ },
  { id: 'ops.dms', re: /\b\d{1,3}°\s?\d{1,2}['′]\s?\d{1,2}(?:\.\d+)?["″]?\s?[NSEWПнПдСхЗх]/u },
  { id: 'ops.mgrs', re: /\b\d{1,2}[C-HJ-NP-X]\s?[A-HJ-NP-Z]{2}\s?\d{4,5}\s?\d{4,5}\b/ },
  { id: 'ops.phone_ua', re: /(?:\+?380|\b0)\s?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/ },
  { id: 'ops.real_data_marker', re: /\b(?:data_class|клас даних)\s*[:=]\s*(?!synthetic)\w+/i },
];

export function scanText(text) {
  if (typeof text !== 'string' || !text) return [];
  const hits = [];
  for (const r of RULES) if (r.re.test(text)) hits.push(r.id);
  return hits;
}

// Сканує всі рядкові значення об'єкта. Повертає коди правил і шляхи полів, без самих значень.
export function scanObject(obj, path = '$', out = []) {
  if (typeof obj === 'string') {
    for (const id of scanText(obj)) out.push({ rule: id, field: path });
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanObject(v, `${path}[${i}]`, out));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) scanObject(v, `${path}.${k}`, out);
  }
  return out;
}

// Прибирає з тексту помилок усе, що схоже на секрет або заголовок авторизації.
export function redact(text) {
  if (typeof text !== 'string') return text;
  let t = text;
  for (const r of RULES.filter((x) => x.id.startsWith('secret.'))) t = t.replace(new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : `${r.re.flags}g`), `[REDACTED:${r.id}]`);
  return t.slice(0, 500);
}
