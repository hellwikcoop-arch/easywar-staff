import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, validateAgentReply, canonical, bodyHash } from '../src/protocol.mjs';
import { scanText, scanObject, redact } from '../src/scanner.mjs';
import { tmpStaff, draft } from './helpers.mjs';

const root = tmpStaff();
const codes = (errs) => errs.map((e) => `${e.field}:${e.code}`);

test('коректна чернетка проходить перевірку', () => {
  assert.deepEqual(validateMessage(draft(root), { draft: true }), []);
});

test('прив\'язка до задачі, коміту й контракту обов\'язкова', () => {
  assert.ok(codes(validateMessage(draft(root, { task_id: 'X-1' }), { draft: true })).includes('task_id:invalid'));
  assert.ok(codes(validateMessage(draft(root, { subject: { kind: 'commit', ref: 'abc1234' } }), { draft: true })).includes('subject.ref:invalid'));
  assert.ok(codes(validateMessage(draft(root, { contract: { version: '0.4', sha256: 'x' } }), { draft: true })).includes('contract:invalid'));
  assert.ok(codes(validateMessage(draft(root, { subject: { kind: 'file_hash', ref: 'c'.repeat(64) } }), { draft: true })).length === 0);
});

test('лише synthetic; рівень рішення A|B|C', () => {
  assert.ok(codes(validateMessage(draft(root, { data_class: 'real' }), { draft: true })).includes('data_class:data-class'));
  assert.ok(codes(validateMessage(draft(root, { decision_level: 'D' }), { draft: true })).includes('decision_level:invalid'));
});

test('межі тіла, посилання й decision_needed', () => {
  assert.ok(codes(validateMessage(draft(root, { body: { summary: 'x'.repeat(301) } }), { draft: true })).includes('body.summary:too-long'));
  assert.ok(codes(validateMessage(draft(root, { body: { text: 'x'.repeat(8001) } }), { draft: true })).includes('body.text:too-long'));
  assert.ok(codes(validateMessage(draft(root, { body: { refs: ['../etc/passwd'] } }), { draft: true })).includes('body.refs[0]:invalid'));
  assert.ok(codes(validateMessage(draft(root, { body: { refs: ['tasks/T-0005/order.yaml@0a9feaf'] } }), { draft: true })).length === 0);
  assert.ok(codes(validateMessage(draft(root, { body: { decision_needed: [{ category: 'wish', question: '?' }] } }), { draft: true })).includes('body.decision_needed[0].category:invalid'));
});

test('повне повідомлення вимагає полів, які ставить J4', () => {
  const c = codes(validateMessage(draft(root)));
  for (const f of ['msg_id:missing', 'thread_id:missing', 'created_at:missing', 'hop:invalid']) assert.ok(c.includes(f), f);
});

test('канонічний JSON не залежить від порядку ключів', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } }), canonical({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
  assert.equal(bodyHash({ summary: 's', text: 't' }), bodyHash({ text: 't', summary: 's' }));
});

test('відповідь агента: строга схема', () => {
  assert.deepEqual(validateAgentReply({ summary: 's', text: 't', verdict: 'answer', decision_needed: [] }), []);
  assert.ok(validateAgentReply({ summary: 's', text: 't', verdict: 'answer', decision_needed: [], from: 'JE' }).some((e) => e.field === 'from'));
  assert.ok(validateAgentReply({ summary: 's', text: 't', verdict: 'merge', decision_needed: [] }).length > 0);
});

test('сканер ловить секрети й операційні шаблони', () => {
  const cases = {
    'secret.openai': 'key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX12',
    'secret.anthropic': 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV',
    'secret.github': 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'secret.private_key': '-----BEGIN OPENSSH PRIVATE KEY-----',
    'secret.assignment': 'password = hunter2hunter2hunter2',
    'ops.coordinates': 'точка 48.123456, 37.654321',
    'ops.mgrs': '37U DQ 12345 67890',
    'ops.phone_ua': '+380 67 123 45 67',
  };
  for (const [rule, text] of Object.entries(cases)) assert.ok(scanText(text).includes(rule), rule);
});

test('сканер не спрацьовує на SHA, хешах, датах і версіях', () => {
  const clean = `коміт ${'0a9feafa7025ab57cad2f335ca99c916725d1f24'} sha256 ${'f09ed2a2bca43e80bbdbb604c3d71ca8208f06b676f4b18681c14f96b06a1e8e'} 2026-10-21T20:01:00+03:00 контракт 0.4 T-0005 M-T-0005-0001`;
  assert.deepEqual(scanText(clean), []);
  assert.deepEqual(scanObject({ a: [clean] }), []);
});

test('redact прибирає секрети з тексту помилок', () => {
  const r = redact('fail Authorization: Bearer sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX12');
  assert.ok(!r.includes('sk-proj-ABCDEFGHIJ'));
});
