import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codexPath = process.argv[2];
if (!codexPath) throw new Error("Usage: check-latest-codex-runtime PATH_TO_CODEX");

const timeoutMs = 15_000;
const maxLineChars = 2_000_000;
const child = spawn(codexPath, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CODEX_ANALYTICS_ENABLED: "false" }
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  if (line.length > maxLineChars) {
    failAll(new Error("Codex app-server emitted an oversized JSON line"));
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    failAll(new Error("Codex app-server emitted malformed JSON"));
    return;
  }
  if ((typeof message.id === "number" || typeof message.id === "string") && !message.method) {
    pending.get(String(message.id))?.(message);
  }
});

function failAll(error) {
  for (const resolve of pending.values()) resolve({ error: { message: error.message } });
  pending.clear();
}

child.on("error", failAll);
child.on("exit", (code, signal) => {
  failAll(new Error(`Codex app-server exited before completing the contract (${code ?? signal})`));
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(String(id), (response) => {
      clearTimeout(timer);
      pending.delete(String(id));
      if (response.error) {
        reject(new Error(`${method} failed: ${response.error.message ?? "unknown app-server error"}`));
      } else {
        resolve(response.result);
      }
    });
    send({ id, method, params });
  });
}

try {
  const initialized = await request(1, "initialize", {
    clientInfo: { name: "multAIplayer-contract-check", title: "multAIplayer contract check", version: "0.1.0" },
    capabilities: { experimentalApi: true }
  });
  if (!initialized || typeof initialized !== "object") throw new Error("initialize returned no result object");
  send({ method: "initialized", params: {} });
  const models = await request(2, "model/list", { limit: 1 });
  if (!models || typeof models !== "object" || !Array.isArray(models.data)) {
    throw new Error("model/list returned an unexpected runtime shape");
  }
  console.log("Latest Codex app-server completed initialize and model/list runtime contracts.");
} catch (error) {
  if (stderr) console.error(`Codex stderr (tail):\n${stderr}`);
  throw error;
} finally {
  lines.close();
  child.stdin.end();
  child.kill("SIGTERM");
}
