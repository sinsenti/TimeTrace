import fs from "node:fs";

const packageEntry = process.argv[2];
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { ModelRuntime } = await import(packageEntry);

const runtime = await ModelRuntime.create({ refreshOnCreate: false });

function fail(message) {
  // The parent deliberately discards stderr. Keep failures machine-readable without exposing
  // provider responses, prompts or credentials.
  process.stdout.write(JSON.stringify({ error: String(message) }));
  process.exitCode = 1;
}

function modelId(model) {
  return `${model.provider}/${model.id}`;
}

try {
  if (input.action === "models") {
    const models = await runtime.getAvailable();
    process.stdout.write(JSON.stringify({
      result: models.map((model) => ({ id: modelId(model), label: `${model.name} (${model.provider})` })),
    }));
  } else if (input.action === "complete") {
    const separator = input.model.indexOf("/");
    if (separator <= 0 || separator === input.model.length - 1) throw new Error("invalid Pi model");
    const provider = input.model.slice(0, separator);
    const id = input.model.slice(separator + 1);
    const model = runtime.getModel(provider, id);
    if (!model) throw new Error("Pi model is not available");
    const context = {
      systemPrompt: input.system || undefined,
      messages: input.messages.map((message) => {
        if (message.role === "user") return { role: "user", content: message.content, timestamp: Date.now() };
        if (message.role === "assistant") {
          const content = Array.isArray(message.content)
            ? message.content
            : (message.content ? [{ type: "text", text: message.content }] : []);
          for (const call of message.tool_calls || []) {
            content.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.args || {} });
          }
          return { role: "assistant", content, api: model.api, provider, model: id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop", timestamp: Date.now() };
        }
        return { role: "toolResult", toolCallId: message.tool_call_id, toolName: message.name,
          content: [{ type: "text", text: message.content }], isError: message.is_error, timestamp: Date.now() };
      }),
      tools: (input.tools || []).map((tool) => ({
        name: tool.name, description: tool.description || "", parameters: tool.parameters,
      })),
    };
    const response = await runtime.complete(model, context, {
      temperature: input.temperature,
      maxTokens: input.maxTokens || undefined,
      signal: AbortSignal.timeout(input.timeoutMs || 120000),
    });
    process.stdout.write(JSON.stringify({ result: response }));
  } else {
    throw new Error("unknown action");
  }
} catch (error) {
  fail(error?.message || "Pi request failed");
}
