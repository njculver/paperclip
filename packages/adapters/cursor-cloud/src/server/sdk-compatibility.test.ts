import { Agent } from "@cursor/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testEnvironment } from "./test.js";

describe("Cursor SDK compatibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains the cloud execution entrypoints", () => {
    expect(Agent.create).toBeTypeOf("function");
    expect(Agent.resume).toBeTypeOf("function");
    expect(Agent.getRun).toBeTypeOf("function");
  });

  it.each([200, 401])("validates authentication through the real SDK with HTTP %s", async (status) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(
      status === 200
        ? { apiKeyName: "test-key", userEmail: "test@example.com", createdAt: "2026-01-01T00:00:00Z" }
        : { error: "Invalid API key" },
    ), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "cursor_cloud",
      config: {
        env: { CURSOR_API_KEY: "cursor-test-key" },
        repoUrl: "https://github.com/example/repo.git",
      },
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.status).toBe(status === 200 ? "pass" : "fail");
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: status === 200 ? "cursor_cloud_auth_ok" : "cursor_cloud_auth_failed",
      level: status === 200 ? "info" : "error",
    }));
    if (status === 200) {
      expect(result.checks).toContainEqual(expect.objectContaining({
        detail: "Authenticated as test@example.com.",
      }));
    }
  });
});
