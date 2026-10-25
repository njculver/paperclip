import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport } from "./test-embedded-postgres.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// Instrument only the isolated child, never the test runner's process API.
const startupProbe = String.raw`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
const children = [];
const originalSpawn = childProcess.spawn;
const originalExecSync = childProcess.execSync;
childProcess.execSync = (command, ...args) => {
  if (command !== "locale -a") return originalExecSync(command, ...args);
  if (process.argv[3] === "true") throw new Error("locale command unavailable");
  return "C\nPOSIX\n";
};
childProcess.spawn = (command, args, options) => {
  children.push({
    command: path.basename(command),
    locale: options?.env?.LC_MESSAGES,
    inherited: options?.env?.PAPERCLIP_POSTGRES_ENV_REGRESSION,
    pathInherited: options?.env?.PATH === process.env.PATH,
  });
  return originalSpawn(command, args, options);
};
syncBuiltinESMExports();
const { default: EmbeddedPostgres } = await import(pathToFileURL(process.argv[1]).href);
const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address();
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
const database = new EmbeddedPostgres({
  databaseDir: process.argv[2], port, user: "paperclip", password: "paperclip",
  persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog() {}, onError(message) { console.error(message); },
});
try {
  await database.initialise();
  await database.start();
  const client = database.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    const { rows: [row] } = await client.query("select current_setting('server_version_num')::int as version");
    console.log(JSON.stringify({ version: row.version, children }));
  } finally {
    await client.end();
  }
} finally {
  await database.stop();
}
`;

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;
if (!support.supported) {
  console.warn(`Skipping embedded Postgres upgrade tests: ${support.reason}`);
}

describeEmbeddedPostgres("upstream embedded Postgres compatibility", () => {
  it.each([false, true])(
    "starts PostgreSQL 18.4 with portable locale and inherited environment (locale unavailable: %s)",
    async (localeUnavailable) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-pg-upgrade-"));
      try {
        const { stdout } = await execFileAsync(process.execPath, [
          "--input-type=module", "-e", startupProbe,
          require.resolve("embedded-postgres"), root, String(localeUnavailable),
        ], {
          env: { ...process.env, PAPERCLIP_POSTGRES_ENV_REGRESSION: "inherited" },
          timeout: 25_000,
        });
        const result: {
          version: number;
          children: Array<{ command: string; locale: string; inherited: string; pathInherited: boolean }>;
        } = JSON.parse(stdout);
        expect(result.version).toBe(180004);
        const children = result.children.filter(({ command }) => /^(initdb|postgres)(\.exe)?$/.test(command));
        expect(children.some(({ command }) => command.startsWith("initdb"))).toBe(true);
        expect(children.some(({ command }) => command.startsWith("postgres"))).toBe(true);
        for (const child of children) {
          expect(child.locale).toBe("C");
          expect(child.inherited).toBe("inherited");
          expect(child.pathInherited).toBe(true);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
