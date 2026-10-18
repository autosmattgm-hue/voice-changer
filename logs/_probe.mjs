import fs from "node:fs";

const LOG = "E:/jjjjjj/logs/_poll-probe.txt";
const lines = [];
const log = (s) => { lines.push(s); fs.writeFileSync(LOG, lines.join("\n")); };

try {
  const { PollinationsService } = await import("../api/services/pollinationsService.js");
  const s = new PollinationsService();
  const tries = ["openai/gpt-5.4-nano", "openai/gpt-oss-20b", "openai/gpt-4o-mini", "mistralai/mistral-small-3.2", "google/gemini-3-flash-preview"];
  for (const m of tries) {
    try {
      const r = await s.text([{ role: "user", content: "Reply with exactly: OK " + m }], { model: m, maxTokens: 20, timeoutMs: 25000 });
      log("ALLOWED " + m + " => " + String(r.content).slice(0, 60).replace(/\n/g, " "));
    } catch (e) {
      log("DENIED/ERR " + m + " => " + (e.code || e.status || "ERR") + " " + String(e.message).slice(0, 90));
    }
  }
} catch (e) {
  log("IMPORT_FAIL " + (e && e.stack ? e.stack : e));
}
log("DONE");
process.exit(0);
