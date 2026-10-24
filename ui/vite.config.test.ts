import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, assert, describe, expect, it } from "vitest";
import { build, loadConfigFromFile } from "vite";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Vite production logging", () => {
  it.each(["production", "development"])("preserves logging policy in %s builds", async (mode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-vite-config-"));
    directories.push(root);
    const entry = path.join(root, "entry.js");
    await writeFile(entry, 'console.log("logging-policy"); debugger; export const value = 42;');
    const loaded = await loadConfigFromFile(
      { command: "build", mode },
      path.resolve(import.meta.dirname, "vite.config.ts"),
    );
    assert(loaded);
    const result = await build({
      ...loaded.config,
      configFile: false,
      root,
      mode,
      plugins: [],
      logLevel: "silent",
      build: {
        ...loaded.config.build,
        write: false,
        lib: { entry, formats: ["es"], fileName: "entry" },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
      "output" in output ? output.output : [],
    );
    const code = outputs.flatMap((output) => output.type === "chunk" ? [output.code] : []).join("\n");
    expect(code).toContain("42");
    if (mode === "production") {
      expect(code).not.toContain("console.log");
      expect(code).not.toContain("debugger");
    } else {
      expect(code).toContain("console.log");
    }
  });
});
