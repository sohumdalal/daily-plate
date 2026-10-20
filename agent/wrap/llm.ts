import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.ts';

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.llm.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  if (!client) client = new Anthropic({ apiKey: config.llm.anthropicKey });
  return client;
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
 */
export async function generate<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<{ value: T; model: string }> {
  const model = config.llm.model;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nYour previous reply could not be parsed (${
            lastError instanceof Error ? lastError.message : String(lastError)
          }). Reply with the JSON object only — no prose, no code fence.`;

    const res = await anthropic().messages.create({
      model,
      // A wrap is a small JSON object, but "small" stopped being true once the
      // bullets became sentences: at 2048 the reply was cut off mid-string and
      // surfaced only as unparseable JSON. Leave real headroom.
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.system,
      messages: [{ role: 'user', content: user }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    try {
      return { value: opts.schema.parse(extractJson(text)), model };
    } catch (err) {
      lastError = err;
      // Without the reply itself, "no JSON object in model reply" is
      // unactionable — it hides a truncated response, a refusal, and a stray
      // preamble behind one message.
      console.warn(
        `[llm] attempt ${attempt + 1} unusable ` +
          `(stop_reason=${res.stop_reason}, output_tokens=${res.usage.output_tokens}): ` +
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
