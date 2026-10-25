import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

for (const [adapter, packageName, binName] of [
  ["claude-local", "claude-agent-acp", "claude-agent-acp"],
  ["codex-local", "codex-acp", "codex-acp"],
]) {
  test(`${packageName} negotiates the ACP v1 handshake used by acpx`, { timeout: 30_000 }, async () => {
    const packageRoot = path.join(repoRoot, "packages/adapters", adapter, "node_modules/@agentclientprotocol", packageName);
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    const home = await mkdtemp(path.join(os.tmpdir(), "paperclip-acp-handshake-"));
    await mkdir(path.join(home, ".codex"));
    await mkdir(path.join(home, ".claude"));
    const child = spawn(process.execPath, [path.join(packageRoot, manifest.bin[binName])], {
      cwd: home,
      detached: process.platform !== "win32",
      env: {
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
        CODEX_HOME: path.join(home, ".codex"),
        NO_BROWSER: "1",
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`ACP handshake timed out: ${stderr}`)), 20_000);
        child.once("error", reject);
        child.once("exit", (code, signal) => reject(new Error(`ACP exited (${code ?? signal}): ${stderr}`)));
        lines.on("line", (line) => {
          try {
            const message = JSON.parse(line);
            if (message.id === 1) resolve(message);
          } catch (err) {
            reject(new Error(`Invalid ACP stdout: ${line}`, { cause: err }));
          }
        });
        child.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientInfo: { name: "paperclip-handshake-test", version: "1.0.0" },
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
          },
        })}\n`);
      });
      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.equal(response.result.protocolVersion, 1);
      assert.equal(response.result.agentInfo.version, manifest.version);
      assert.equal(typeof response.result.agentCapabilities, "object");
      assert.ok(Array.isArray(response.result.authMethods));
    } finally {
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGTERM");
      }
      await exited;
      await rm(home, { recursive: true, force: true });
    }
  });
}
