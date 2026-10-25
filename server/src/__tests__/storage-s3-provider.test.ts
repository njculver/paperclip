import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createS3StorageProvider } from "../storage/s3-provider.js";

describe("S3 storage provider SDK integration", () => {
  let server: Server;
  let endpoint: string;
  const requests: Array<{ method?: string; url?: string; authorization?: string; range?: string; body: Buffer }> = [];

  beforeEach(async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "paperclip-test-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "paperclip-test-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "paperclip-test-session");
    vi.stubEnv("AWS_PROFILE", "");
    requests.length = 0;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        range: req.headers.range,
        body: Buffer.concat(chunks),
      });
      if (req.url?.includes("/missing")) {
        res.writeHead(404, { "Content-Type": "application/xml" });
        res.end("<Error><Code>NoSuchKey</Code><Message>Missing</Message></Error>");
      } else if (req.method === "GET" || req.method === "HEAD") {
        const body = req.headers.range ? "2345" : "0123456789";
        res.writeHead(req.headers.range ? 206 : 200, {
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(body),
          ETag: '"test-etag"',
          "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } else {
        res.writeHead(req.method === "DELETE" ? 204 : 200);
        res.end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
      server.closeAllConnections();
    });
  });

  function provider() {
    return createS3StorageProvider({
      bucket: "test-bucket",
      region: "us-east-1",
      endpoint,
      prefix: "/paperclip/",
      forcePathStyle: true,
    });
  }

  it("signs and serializes uploads, ranged reads, metadata and deletes with the real SDK", async () => {
    const storage = provider();
    const objectKey = "company-1/file.txt";
    const body = Buffer.from("0123456789");
    await storage.putObject({ objectKey, body, contentType: "text/plain", contentLength: body.length });
    const fetched = await storage.getObject({ objectKey, range: { start: 2, end: 5 } });
    const chunks: Buffer[] = [];
    for await (const chunk of fetched.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("2345");
    expect(fetched).toMatchObject({ contentType: "text/plain", contentLength: 4, etag: '"test-etag"' });
    expect(await storage.headObject({ objectKey })).toMatchObject({
      exists: true,
      contentLength: 10,
      lastModified: new Date("2026-01-01T00:00:00Z"),
    });
    await storage.deleteObject({ objectKey });

    expect(requests.map((req) => req.method)).toEqual(["PUT", "GET", "HEAD", "DELETE"]);
    expect(requests[0].body).toEqual(body);
    expect(requests[1].range).toBe("bytes=2-5");
    for (const req of requests) {
      expect(req.url).toContain("/test-bucket/paperclip/company-1/file.txt");
      expect(req.authorization).toContain("AWS4-HMAC-SHA256 Credential=paperclip-test-key/");
    }
  });

  it("maps real SDK missing-object responses to the storage contract", async () => {
    const storage = provider();
    await expect(storage.getObject({ objectKey: "missing" })).rejects.toMatchObject({ status: 404 });
    await expect(storage.headObject({ objectKey: "missing" })).resolves.toEqual({ exists: false });
  });
});
