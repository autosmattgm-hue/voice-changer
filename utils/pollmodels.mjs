import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(".env", "utf8");
const key = (envText.match(/^POLLINATIONS_API_KEY=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
const out = process.argv[2] || "logs/_models.txt";
const lines = ["KEY len=" + key.length];

const base = "https://gen.pollinations.ai";
const headers = { Authorization: "Bearer " + key, Accept: "application/json" };

// 1) list models
try {
  const r = await fetch(base + "/v1/models", { headers });
  const j = await r.json();
  const models = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  lines.push("MODELS HTTP " + r.status + " count=" + models.length);
  const ids = models.map((m) => m.id || m.name).filter(Boolean).sort();
  lines.push("ALL IDS:\n" + ids.join("\n"));
  const chatty = models.filter((m) => {
    const ep = m.supported_endpoints || m.supportedEndpoints || [];
    return Array.isArray(ep) && ep.some((e) => /chat/i.test(String(e)));
  });
  lines.push("\nCHAT-CAPABLE (" + chatty.length + "):\n" + chatty.map((m) => m.id + "  ep=" + JSON.stringify(m.supported_endpoints || m.supportedEndpoints)).join("\n"));
} catch (e) {
  lines.push("MODELS ERR " + e.message);
}

writeFileSync(out, lines.join("\n"), "utf8");
console.log("wrote " + out);
