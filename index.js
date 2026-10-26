import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";



import { ask, getClient, DEFAULT_MODEL } from "./ai-client/index.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const gatewayKey = process.env.OPENROUTER_API_KEY || null;

if(!gatewayKey){
    console.log("gateway_key_not_found");
    process.exit(0);
}




app.get("/ask", async (req, res) => {
  try {
    const query = req.query.query;

    if (typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({ ok: false, error: "query parameter is required" });
    }

    const result = await ask(query.trim());

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("ask route failed:", err?.message || err);

    const status =
      typeof err?.statusCode === "number" ? err.statusCode : 500;

    return res.status(status).json({
      ok: false,
      error: err?.message || "Something went wrong",
    });
  }
});


app.get("/stream", async (req, res) => {
  const query = req.query.query;

  if (typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ ok: false, error: "query parameter is required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const startedAt = performance.now();
  let firstTokenAt = null;
  let firstByteAt = null;
  let firstReasoningAt = null;
  let fullText = "";
  let usage = null;
  let finishReason = null;
  let model = null;
  let id = null;
  let serviceTier = null;
  let created = null;

  try {
    const stream = await getClient().chat.send({
      chatRequest: {
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: query.trim() }],
        stream: true,
      },
    });

    for await (const chunk of stream) {
      if (firstByteAt === null) firstByteAt = performance.now();

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (chunk.error) {
        throw new Error(chunk.error.message || "OpenRouter stream error");
      }

      if (chunk.model) model = chunk.model;
      if (chunk.id) id = chunk.id;
      if (chunk.created) created = chunk.created;
      if (choice?.finishReason) finishReason = choice.finishReason;
      if (chunk.serviceTier) serviceTier = chunk.serviceTier;
      if (chunk.usage) usage = chunk.usage;

      const content = typeof delta?.content === "string" ? delta.content : "";
      if (content) {
        if (firstTokenAt === null) firstTokenAt = performance.now();
        fullText += content;
        send("delta", { content });
      }

      const reasoning = typeof delta?.reasoning === "string" ? delta.reasoning : "";
      if (reasoning) {
        if (firstReasoningAt === null) firstReasoningAt = performance.now();
        send("reasoning", { content: reasoning });
      }
    }

    const totalMs = Math.round(performance.now() - startedAt);
    const reachAt = firstReasoningAt ?? firstByteAt;
    const completionTokens = usage?.completionTokens ?? 0;
    const tokensPerSecond =
      totalMs > 0 ? Number((completionTokens / (totalMs / 1000)).toFixed(2)) : 0;
    const avgMsPerToken =
      completionTokens > 0 ? Number((totalMs / completionTokens).toFixed(1)) : null;

    send("done", {
      response: fullText,
      ttfbMs: firstByteAt === null ? null : Math.round(firstByteAt - startedAt),
      reasoningStartMs:
        reachAt === null ? null : Math.round(reachAt - startedAt),
      ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
      totalMs,
      tokensPerSecond,
      avgMsPerToken,
      tokens: {
        prompt: usage?.promptTokens ?? 0,
        completion: completionTokens,
        total: usage?.totalTokens ?? 0,
        cached: usage?.promptTokensDetails?.cachedTokens ?? 0,
        reasoning: usage?.completionTokensDetails?.reasoningTokens ?? 0,
      },
      costUsd: usage?.cost ?? null,
      details: { model, id, created, finishReason, serviceTier },
    });
  } catch (err) {
    send("streamerror", { message: err?.message || "stream failed" });
  } finally {
    res.end();
  }
});



















app.listen(2000,()=>{
    console.log("Server started at port: 2000");
})
