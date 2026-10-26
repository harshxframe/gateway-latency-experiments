import { performance } from "node:perf_hooks";
import { OpenRouter } from "@openrouter/sdk";

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

let client;

export function getClient() {
  if (client) return client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set. Add it to your .env as OPENROUTER_API_KEY=..."
    );
  }

  client = new OpenRouter({
    apiKey,
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { httpReferer: process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    ...(process.env.OPENROUTER_APP_TITLE
      ? { appTitle: process.env.OPENROUTER_APP_TITLE }
      : {}),
  });

  return client;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Send a query to OpenRouter and get back the reply plus latency,
 * token usage and cost.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {string} [options.system] system message
 * @param {number} [options.temperature]
 * @param {number} [options.maxTokens]
 */
export async function ask(query, options = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("query must be a non-empty string");
  }

  const {
    model = DEFAULT_MODEL,
    system,
    temperature,
    maxTokens,
  } = options;

  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: query.trim() });

  const startedAt = performance.now();

  const completion = await getClient().chat.send({
    chatRequest: {
      model,
      messages,
      stream: false,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
  });

  if (completion instanceof ReadableStream) {
    throw new Error("Expected a non-streaming response");
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const choice = completion.choices?.[0];
  const usage = completion.usage;

  return {
    response: extractText(choice?.message?.content),
    latencyMs,
    tokens: {
      prompt: usage?.promptTokens ?? 0,
      completion: usage?.completionTokens ?? 0,
      total: usage?.totalTokens ?? 0,
    },
    costUsd: usage?.cost ?? null,
    details: {
      model: completion.model,
      id: completion.id,
      created: completion.created,
      finishReason: choice?.finishReason ?? null,
      serviceTier: completion.serviceTier ?? null,
    },
  };
}

export default ask;
