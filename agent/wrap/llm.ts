import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.ts';
import { model as traceModel, traced } from '../telemetry.ts';

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.llm.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  if (!client) client = new Anthropic({ apiKey: config.llm.anthropicKey });
  return client;
}

type Reply = { text: string; model: string; inputTokens: number; outputTokens: number; stopReason: string | null };

/**
 * One call. Deployed, through the Astro AI gateway's Chat Completions, as the
 * Slack assistant talks; on a laptop, which has no gateway, to Anthropic.
 */
async function complete(model: string, system: string, user: string, maxTokens: number): Promise<Reply> {
  const { gateway } = config.llm;
  if (gateway.url) {
    const res = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${gateway.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI gateway answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: body.model ?? model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      stopReason: body.choices?.[0]?.finish_reason ?? null,
    };
  }
  const reply = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: reply.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n'),
    model: reply.model,
    inputTokens: reply.usage.input_tokens,
    outputTokens: reply.usage.output_tokens,
    stopReason: reply.stop_reason,
  };
}

/** Pull the first JSON object out of a reply, tolerating fenced code blocks. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model reply');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * One structured call. Retries once with the parse error appended, which is
 * enough to recover the occasional trailing-comma or prose-preamble reply.
 * Each call is one trace, `trace.name`, with a generation per attempt.
 */
export function generate<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** `wrap day 2026-10-22`, and what groups it with its other versions, `day:2026-10-22`. */
  trace: { name: string; session: string };
}): Promise<{ value: T; model: string }> {
  return traced(opts.trace.name, opts.trace.session, () => askForJson(opts));
}

async function askForJson<T>(opts: Parameters<typeof generate<T>>[0]): Promise<{ value: T; model: string }> {
  const model = config.llm.gateway.url ? config.llm.gateway.model : config.llm.model;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nYour previous reply could not be parsed (${
            lastError instanceof Error ? lastError.message : String(lastError)
          }). Reply with the JSON object only — no prose, no code fence.`;

    // A wrap is a small JSON object, but "small" stopped being true once the
    // bullets became sentences: at 2048 the reply was cut off mid-string and
    // surfaced only as unparseable JSON. Leave real headroom.
    const maxTokens = opts.maxTokens ?? 8192;
    const res = await traceModel({ model, system: opts.system, user, maxTokens }, () =>
      complete(model, opts.system, user, maxTokens),
    );
    const text = res.text;

    try {
      return { value: opts.schema.parse(extractJson(text)), model };
    } catch (err) {
      lastError = err;
      // Without the reply itself, "no JSON object in model reply" is
      // unactionable — it hides a truncated response, a refusal, and a stray
      // preamble behind one message.
      console.warn(
        `[llm] attempt ${attempt + 1} unusable ` +
          `(stop_reason=${res.stopReason}, output_tokens=${res.outputTokens}): ` +
          `${err instanceof Error ? err.message : String(err)}\n` +
          `[llm] reply began: ${JSON.stringify(text.slice(0, 300))}`,
      );
    }
  }

  throw new Error(
    `model did not return usable JSON: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
