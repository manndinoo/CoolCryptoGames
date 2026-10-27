// OpenAI provider, kept so a utility that already holds an OpenAI key (as the
// v1 prototype did) can keep using it. Same policy and schema as Claude.
import { INSTRUCTIONS, SCHEMA, InspectionError, classifyHttpError } from './policy.mjs';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

export function createOpenAIProvider(env, fetcher = fetch) {
  const model = env.LINEWATCH_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  async function inspect({ context, request, photos }) {
    const content = [{ type: 'input_text', text: JSON.stringify(request) }];
    for (const p of photos) {
      content.push({ type: 'input_text', text: JSON.stringify({ photo_id: p.id, operator_view_label: p.view || null, taken_at: p.taken_at || null }) });
      content.push({ type: 'input_image', image_url: `data:${p.mime};base64,${p.base64}`, detail: 'high' });
    }
    let response;
    try {
      response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, store: false,
          instructions: `${INSTRUCTIONS}\n\n${context || ''}`,
          input: [{ role: 'user', content }],
          reasoning: { effort: 'medium' },
          max_output_tokens: 16000,
          text: { format: { type: 'json_schema', name: 'pole_inspection', strict: true, schema: SCHEMA } },
        }),
        signal: AbortSignal.timeout(180000),
      });
    } catch {
      throw new InspectionError('connection_failed', 'Could not reach OpenAI. It will retry automatically.', 504);
    }
    let data;
    try { data = await response.json(); } catch { throw new InspectionError('invalid_response', 'OpenAI returned an unreadable response.', 502); }
    if (!response.ok) {
      const code = data?.error?.code || data?.error?.type;
      if (['insufficient_quota', 'billing_hard_limit_reached'].includes(code)) throw classifyHttpError(402, 'OpenAI');
      throw classifyHttpError(response.status, 'OpenAI');
    }
    if (data.status !== 'completed') throw new InspectionError('incomplete_response', 'The AI report was cut off. Retry.', 502);
    const parts = (data.output || []).flatMap(o => o.content || []);
    if (parts.some(p => p.type === 'refusal')) throw new InspectionError('refused', 'The AI declined to assess these photos. A person needs to review them.', 422);
    let report;
    try { report = JSON.parse(parts.filter(p => p.type === 'output_text').map(p => p.text).join('')); } catch { throw new InspectionError('invalid_response', 'The AI report was not valid JSON. Retry.', 502); }
    return { report, model, responseId: data.id, usage: data.usage };
  }

  return { name: 'openai', label: 'OpenAI', model, inspect };
}
