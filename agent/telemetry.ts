/**
 * Traces for the Astropods Traces page.
 *
 * Deployed, the platform sets OTEL_EXPORTER_OTLP_ENDPOINT to a collector
 * beside the agent, which forwards spans to the account's Langfuse. Two
 * pipelines send there:
 *
 *   Slack     The assistant is a Mastra agent served by @astropods/adapter-mastra,
 *             which traces each turn (agent, model, tool and step spans) itself.
 *   Wrap      Writing a wrap or a reflection reply calls the Anthropic SDK
 *             directly, so model() below wraps each call in a span named with
 *             the GenAI conventions Langfuse prices.
 *
 * Outbound HTTP is deliberately not instrumented: Capcom found every fetch
 * became its own trace, with no user and no cost, burying the real runs.
 *
 * Unset, as locally, the tracer is OpenTelemetry's no-op and nothing is sent.
 */

import { getOrCreateAstroTracerProvider } from '@astropods/adapter-core';
import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { config } from './config.ts';
import { maybeMember } from './users.ts';

const NAME = 'daily-plate';

function tracer() {
  return (getOrCreateAstroTracerProvider() ?? trace).getTracer(NAME);
}

/** Runs `fn` inside a span, recording a throw as the span's error. */
async function within<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * One piece of work, as one row on the Traces page: `wrap day 2026-10-22`.
 * `session` groups the rows about one thing, such as every version of a
 * day's wrap.
 */
export function traced<T>(name: string, session: string, fn: () => Promise<T>): Promise<T> {
  return within(
    name,
    {
      'langfuse.trace.name': name,
      'langfuse.session.id': session,
      'langfuse.user.id': maybeMember()?.login || 'anonymous',
    },
    () => fn(),
  );
}

export type Generation = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

/** One model call, as a priced generation under whatever span is active. */
export function model(
  request: { model: string; system: string; user: string; maxTokens: number },
  call: () => Promise<Generation>,
): Promise<Generation> {
  return within(
    'anthropic.messages',
    {
      'langfuse.observation.type': 'generation',
      'gen_ai.system': 'anthropic',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': request.model,
      'gen_ai.request.max_tokens': request.maxTokens,
      'langfuse.observation.input': JSON.stringify([
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ]),
    },
    async (span) => {
      const result = await call();
      span.setAttributes({
        'gen_ai.response.model': result.model,
        'gen_ai.usage.input_tokens': result.inputTokens,
        'gen_ai.usage.output_tokens': result.outputTokens,
        'gen_ai.response.finish_reasons': [result.stopReason ?? ''],
        'langfuse.observation.output': result.text,
      });
      return result;
    },
  );
}
