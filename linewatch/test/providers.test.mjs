// Checks the exact request each AI provider sends and how it reads replies,
// using a fake HTTP layer (no network, no API key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicProvider } from '../server/ai/anthropic.mjs';
import { createOpenAIProvider } from '../server/ai/openai.mjs';

const report = { summary: 's', grade: 'monitor', confidence: 0.8, rationale: 'r', critical_gate: { hazard: '', consequence: '', why_immediate: '' }, structure_observed: '', coverage: { adequate: true, missing_views: [] }, photos: [], findings: [], additional_photos: [], field_verification: [] };
const input = { context: 'LESSONS', request: { structure_tag: 'T-1' }, photos: [{ id: 'p1', view: 'full', mime: 'image/jpeg', base64: 'AAAA' }] };

// The SDK streams; answer with a minimal server-sent-events message.
function sse(message) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ...message.content.flatMap((b, i) => [
      ['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } }],
      ['content_block_stop', { type: 'content_block_stop', index: i }],
    ]),
    ['message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

test('Claude request: model, adaptive thinking, structured output, fallbacks, images, cached context', async () => {
  let sent;
  const provider = createAnthropicProvider({ ANTHROPIC_API_KEY: 'k' }, {
    fetch: async (url, init) => { sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }; return sse({ content: [{ text: JSON.stringify(report) }], stop_reason: 'end_turn' }); },
  });
  const out = await provider.inspect(input);
  assert.deepEqual(out.report, report);
  const b = sent.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.equal(b.output_config.effort, 'high');
  assert.equal(b.fallbacks, 'default');
  assert.equal(b.stream, true);
  assert.equal(b.system[1].text, 'LESSONS');
  assert.deepEqual(b.system[1].cache_control, { type: 'ephemeral' });
  const img = b.messages[0].content.find(c => c.type === 'image');
  assert.deepEqual(img.source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  const headers = new Headers(sent.headers);
  assert.match(headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
});

test('Claude refusal and truncation become clear errors', async () => {
  for (const [stop, code] of [['refusal', 'refused'], ['max_tokens', 'incomplete_response']]) {
    const provider = createAnthropicProvider({ ANTHROPIC_API_KEY: 'k' }, { fetch: async () => sse({ content: [{ text: '{' }], stop_reason: stop }) });
    await assert.rejects(provider.inspect(input), e => e.code === code);
  }
});

test('Claude auth and billing errors are classified', async () => {
  const provider = createAnthropicProvider({ ANTHROPIC_API_KEY: 'k' }, {
    fetch: async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(provider.inspect(input), e => e.code === 'authentication_failed');
  const billing = createAnthropicProvider({ ANTHROPIC_API_KEY: 'k' }, {
    fetch: async () => new Response(JSON.stringify({ type: 'error', error: { type: 'billing_error', message: 'Your credit balance is too low' } }), { status: 400, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(billing.inspect(input), e => e.code === 'billing_required');
});

test('OpenAI request uses strict JSON schema and parses output', async () => {
  let body;
  const provider = createOpenAIProvider({ OPENAI_API_KEY: 'k' }, async (url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'r1', status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(report) }] }] }), { headers: { 'content-type': 'application/json' } });
  });
  const out = await provider.inspect(input);
  assert.deepEqual(out.report, report);
  assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /LESSONS/);
  assert.equal(body.input[0].content.find(c => c.type === 'input_image').image_url, 'data:image/jpeg;base64,AAAA');
});
