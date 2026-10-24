import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, assert, describe, expect, it } from "vitest";
import {
  isLocalServiceProcessInWorkspace,
  readLocalServiceProcessCwd,
} from "../services/local-service-supervisor.js";

const directories: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("local service process working-directory discovery", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects invalid process id %s", async (pid) => {
    await expect(readLocalServiceProcessCwd(pid)).resolves.toBeNull();
  });

  it.runIf(process.platform === "darwin")("finds a macOS process directory and enforces workspace containment", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-process-cwd-"));
    directories.push(root);
    const workspace = path.join(root, "workspace");
    const serviceCwd = path.join(workspace, "service with spaces");
    const otherWorkspace = path.join(root, "other-workspace");
    await fs.mkdir(serviceCwd, { recursive: true });
    await fs.mkdir(otherWorkspace);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: serviceCwd,
      stdio: "ignore",
    });
    children.push(child);
    await once(child, "spawn");
    assert(child.pid);
    const discovered = await readLocalServiceProcessCwd(child.pid);
    expect(discovered).toBe(await fs.realpath(serviceCwd));
    assert(discovered);
    await expect(isLocalServiceProcessInWorkspace(discovered, workspace)).resolves.toBe(true);
    await expect(isLocalServiceProcessInWorkspace(discovered, otherWorkspace)).resolves.toBe(false);

    const exited = once(child, "exit");
    child.kill();
    await exited;
    await expect(readLocalServiceProcessCwd(child.pid)).resolves.toBeNull();
  });
});
