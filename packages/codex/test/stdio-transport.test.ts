import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { StdioCodexAppServerTransport, type CodexTransportHandlers } from "../src/index";

function fakeProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(): boolean;
    kills: number;
  };
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kills = 0;
  process.kill = () => {
    process.kills++;
    return true;
  };
  return process;
}

test("stdio transport owns spawn arguments, newline framing, stderr, exit, and close", async () => {
  const child = fakeProcess();
  const calls: unknown[][] = [];
  const spawn = ((...args: unknown[]) => {
    calls.push(args);
    return child;
  }) as never;
  const transport = new StdioCodexAppServerTransport(
    { executablePath: "/bin/codex", cwd: "/repo", listen: "ws://127.0.0.1:1234" },
    spawn
  );
  const lines: string[] = [];
  const stderr: string[] = [];
  const exits: unknown[] = [];
  const handlers: CodexTransportHandlers = {
    message: (line) => lines.push(line),
    stderr: (text) => stderr.push(text),
    exit: (code, signal) => exits.push({ code, signal })
  };
  transport.start(handlers);
  transport.start(handlers);
  assert.deepEqual(calls, [
    [
      "/bin/codex",
      ["app-server", "--listen", "ws://127.0.0.1:1234"],
      {
        cwd: "/repo",
        stdio: ["pipe", "pipe", "pipe"]
      }
    ]
  ]);
  child.stdout.write('{"id":1');
  child.stdout.write(',"result":{}}\n{"method":"ready"}\n');
  child.stderr.write("warning");
  child.emit("exit", null, "SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines, ['{"id":1,"result":{}}', '{"method":"ready"}']);
  assert.deepEqual(stderr, ["warning"]);
  assert.deepEqual(exits, [{ code: null, signal: "SIGTERM" }]);
  let written = "";
  child.stdin.on("data", (chunk) => {
    written += chunk.toString();
  });
  transport.send({ method: "ping", id: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written, '{"method":"ping","id":1}\n');
  transport.close();
  transport.close();
  assert.equal(child.kills, 1);
  assert.throws(() => transport.send({ method: "late" }), /not started/);
});

test("stdio transport uses codex and stdio defaults", () => {
  const child = fakeProcess();
  const calls: unknown[][] = [];
  const transport = new StdioCodexAppServerTransport({}, ((...args: unknown[]) => {
    calls.push(args);
    return child;
  }) as never);
  transport.start({ message() {}, stderr() {}, exit() {} });
  assert.deepEqual(calls[0]?.slice(0, 2), ["codex", ["app-server"]]);
  transport.close();
});
