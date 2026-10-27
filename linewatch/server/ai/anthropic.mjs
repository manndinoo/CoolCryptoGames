// Claude provider. Sends every photo in one request with the inspection
// policy, the utility's learned context and a strict output schema.
import Anthropic from '@anthropic-ai/sdk';
import { INSTRUCTIONS, SCHEMA, InspectionError, classifyHttpError } from './policy.mjs';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export function createAnthropicProvider(env, { fetch } = {}) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 10 * 60 * 1000, ...(fetch ? { fetch } : {}) });
  const model = env.LINEWATCH_MODEL || DEFAULT_MODEL;
  const effort = env.LINEWATCH_EFFORT || 'high';

  async function inspect({ context, request, photos }) {
    const content = [{ type: 'text', text: JSON.stringify(request) }];
    for (const p of photos) {
      content.push({ type: 'text', text: JSON.stringify({ photo_id: p.id, operator_view_label: p.view || null, taken_at: p.taken_at || null }) });
      content.push({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.base64 } });
    }
    content.push({ type: 'text', text: 'Inspect this structure and return the report.' });

    let message;
    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema: SCHEMA } },
        // Policy first (never changes), then this utility's lessons and cases
        // (change only after reviews), so both stay in the prompt cache.
        system: [
          { type: 'text', text: INSTRUCTIONS },
          { type: 'text', text: context || 'No reviewer lessons or calibration cases yet.', cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) throw new InspectionError('connection_failed', 'Could not reach Claude. It will retry automatically.', 504);
      if (err instanceof Anthropic.APIError) {
        const type = err.error?.error?.type;
        if (type === 'billing_error' || /credit balance/i.test(err.message)) throw classifyHttpError(402, 'Claude');
        throw classifyHttpError(err.status ?? 500, 'Claude');
      }
      throw err;
    }

    if (message.stop_reason === 'refusal') throw new InspectionError('refused', 'The AI declined to assess these photos. A person needs to review them.', 422);
    if (message.stop_reason === 'max_tokens') throw new InspectionError('incomplete_response', 'The AI report was cut off. Retry.', 502);
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let report;
    try { report = JSON.parse(text); } catch { throw new InspectionError('invalid_response', 'The AI report was not valid JSON. Retry.', 502); }
    return { report, model: message.model, responseId: message.id, usage: message.usage };
  }

  return { name: 'anthropic', label: 'Claude', model, inspect };
}
