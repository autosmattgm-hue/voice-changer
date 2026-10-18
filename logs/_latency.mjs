import fs from "node:fs";

const LOG = "E:/jjjjjj/logs/_model-latency.txt";
const lines = [];
const log = (s) => { lines.push(s); fs.writeFileSync(LOG, lines.join("\n")); };

const { env } = await import("../api/config/env.js");
const url = env.nvidia.baseUrl.replace(/\/$/, "") + "/chat/completions";
const models = ["z-ai/glm-5.3-flash", "openai/gpt-oss-20b", "moonshotai/kimi-k3", "z-ai/glm-5.3"];

for (const model of models) {
  const t = Date.now();
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 45000);
    const extra = /glm-5\.3/i.test(model) ? { reasoning_effort: "low", chat_template_kwargs: { clear_thinking: true } } : (/gpt-oss/i.test(model) ? { reasoning_effort: "low" } : {});
    const r = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.nvidia.apiKey },
      body: JSON.stringify({ model, ...extra, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 40, temperature: 0.2, stream: false })
    });
    clearTimeout(to);
    const ms = Date.now() - t;
    if (!r.ok) {
      const body = (await r.text()).slice(0, 200);
      log(model + " => HTTP " + r.status + " " + ms + "ms :: " + body);
    } else {
      const p = await r.json();
      const c = p?.choices?.[0] || {};
      const content = c.message?.content || "";
      const reason = c.finish_reason || "";
      log(model + " => OK " + ms + "ms finish=" + reason + " content=\"" + String(content).slice(0, 50).replace(/\n/g, " ") + "\"");
    }
  } catch (e) {
    log(model + " => ERR " + (Date.now() - t) + "ms :: " + (e.name || "") + " " + String(e.message || e).slice(0, 120));
  }
}
log("DONE");
process.exit(0);
