import { createInterface } from "node:readline";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { startRelayWithWorkspace } from "../../relay/test/support/relay.js";

const input = createInterface({ input: process.stdin });
const commands = input[Symbol.asyncIterator]();
const configuration = await commands.next();
if (configuration.done) throw new Error("CLI relay fixture configuration was unavailable");
const forbidden = Buffer.from(JSON.parse(configuration.value) as string);
let leaked = false;

function scanStream() {
  let suffix = Buffer.alloc(0);
  return (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = Buffer.concat([suffix, bytes]);
    if (combined.includes(forbidden)) leaked = true;
    suffix = combined.subarray(Math.max(0, combined.length - Math.max(0, forbidden.length - 1)));
  };
}

const validator = fileURLToPath(
  new URL("../../relay/test/fixtures/mock-keypackage-validator.mjs", import.meta.url)
);
let relay = await startRelayWithWorkspace({ MULTAIPLAYER_MLS_VALIDATOR_PATH: validator });
const proxy = createServer((incoming, response) => {
  incoming.on("data", scanStream());
  const target = new URL(relay.baseUrl);
  const forwarded = request(
    {
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host }
    },
    (upstream) => {
      upstream.on("data", scanStream());
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    }
  );
  forwarded.on("error", () => response.destroy());
  incoming.pipe(forwarded);
});

proxy.on("upgrade", (incoming, client, head) => {
  const target = new URL(relay.wsUrl);
  const upstream = connect(Number(target.port), target.hostname, () => {
    const headers: string[] = [];
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index]!;
      const value = name.toLowerCase() === "host" ? target.host : incoming.rawHeaders[index + 1]!;
      headers.push(`${name}: ${value}`);
    }
    upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n`);
    upstream.write(`${headers.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    client.on("data", scanStream());
    upstream.on("data", scanStream());
    client.pipe(upstream).pipe(client);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});

await new Promise<void>((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(0, "127.0.0.1", () => resolve());
});
const address = proxy.address();
if (address === null || typeof address === "string") throw new Error("CLI relay proxy did not bind TCP");
const baseUrl = `http://127.0.0.1:${address.port}`;

process.stdout.write(
  `${JSON.stringify({
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/rooms`,
    dataPath: relay.dataPath,
    tempDir: relay.tempDir
  })}\n`
);

while (true) {
  const next = await commands.next();
  if (next.done) break;
  const command = next.value;
  if (command === "restart") {
    const dataPath = relay.dataPath;
    await relay.close({ preserveData: true });
    relay = await startRelayWithWorkspace({ MULTAIPLAYER_MLS_VALIDATOR_PATH: validator }, undefined, dataPath);
    process.stdout.write('{"restarted":true}\n');
    continue;
  }
  break;
}
await relay.close({ preserveData: true });
await new Promise<void>((resolve, reject) => proxy.close((error) => (error === undefined ? resolve() : reject(error))));
if (leaked) throw new Error("Relay traffic exposed the host-local project path");
