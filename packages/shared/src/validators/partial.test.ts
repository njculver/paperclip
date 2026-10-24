import { describe, expect, it } from "vitest";
import { z } from "zod";
import { partialWithoutDefaults } from "./partial.js";
import { builtInAgentProvisionSchema, createAgentSchema, updateAgentSchema } from "./agent.js";
import { updateCompanySchema } from "./company.js";
import { workspaceFileListQuerySchema, workspaceFileResourceQuerySchema } from "./workspace-file-resource.js";
import {
  createToolMcpGatewaySchema,
  createToolMcpGatewayTokenSchema,
  toolRedactedValueSummarySchema,
} from "./tool-access.js";

describe("partialWithoutDefaults", () => {
  const schema = partialWithoutDefaults(z.object({
    enabled: z.boolean().default(true),
    count: z.number().min(1).default(10),
    nested: z.object({ enabled: z.boolean().default(true) }).prefault({}),
    optionalDefault: z.string().default("default").optional(),
  }).strict());

  it("does not populate omitted or explicitly undefined fields", () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ enabled: undefined })).toEqual({ enabled: undefined });
    expect(schema.parse({ count: 2 })).toEqual({ count: 2 });
  });

  it("still validates provided values and applies nested defaults", () => {
    expect(schema.parse({ enabled: false, nested: {} })).toEqual({
      enabled: false,
      nested: { enabled: true },
    });
    expect(schema.safeParse({ count: 0 }).success).toBe(false);
    expect(schema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("remains composable and representable in OpenAPI", () => {
    expect(schema.omit({ count: true }).extend({ name: z.string() }).parse({ name: "Patch" }))
      .toEqual({ name: "Patch" });
    const jsonSchema = z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" });
    expect(jsonSchema.required ?? []).toEqual([]);
    expect(jsonSchema.properties?.enabled).toMatchObject({ type: "boolean" });
    expect(jsonSchema.properties?.enabled).not.toHaveProperty("default");
  });

  it("keeps real mutation schemas sparse, including defaulted optional references", () => {
    expect(updateAgentSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(updateCompanySchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(builtInAgentProvisionSchema.parse({})).toEqual({});
  });

  it("preserves legacy UUID-shaped identifiers without relaxing their structure", () => {
    const legacyId = "11111111-1111-1111-1111-111111111111";
    expect(createAgentSchema.parse({ name: "Agent", reportsTo: legacyId }).reportsTo).toBe(legacyId);
    expect(createAgentSchema.safeParse({ name: "Agent", reportsTo: "not-an-id" }).success).toBe(false);
  });

  it("leaves omitted workspace selectors absent", () => {
    expect(workspaceFileResourceQuerySchema.parse({ path: "README.md" })).not.toHaveProperty("workspace");
    expect(workspaceFileListQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
  });

  it("does not populate formerly optional tool-access defaults", () => {
    const gateway = { name: "Gateway", profileId: "11111111-1111-1111-1111-111111111111" };
    expect(createToolMcpGatewaySchema.parse(gateway)).toEqual(gateway);
    const token = { name: "Token", clientLabel: "Client", ownerNote: "Development" };
    expect(createToolMcpGatewayTokenSchema.parse(token)).toEqual(token);
    const summary = { summary: "Redacted" };
    expect(toolRedactedValueSummarySchema.parse(summary)).toEqual(summary);
  });
});
