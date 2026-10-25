import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ORG_CHART_STYLES,
  renderOrgChartPng,
  type OrgNode,
} from "../routes/org-chart-svg.js";

describe("org-chart PNG exports", () => {
  const tree: OrgNode[] = [{
    id: "ceo",
    name: "CEO & Founder",
    role: "ceo",
    status: "idle",
    reports: [{
      id: "engineer",
      name: "Engineer",
      role: "engineer",
      status: "running",
      reports: [],
    }],
  }];

  it.each(ORG_CHART_STYLES)("rasterizes %s charts at the export dimensions", async (style) => {
    const png = await renderOrgChartPng(tree, style, {
      companyName: "Research & Development",
      stats: "2 agents",
    });

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await sharp(png).metadata()).toMatchObject({
      format: "png",
      width: 1280,
      height: 640,
    });
    const { info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1280);
    expect(info.height).toBe(640);
  });
});
