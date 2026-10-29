import { describe, expect, it } from "vitest";
import { requestJson, requestPdf } from "../src/lib/api";

describe("FastAPI client boundary", () => {
  it("posts the snapshot and uses the server response without calculating locally", async () => {
    let url = "",
      method = "",
      body = "";
    const fetcher: typeof fetch = async (input, init) => {
      url = String(input);
      method = String(init?.method);
      body = String(init?.body);
      return Response.json({ flaggedMineDays: 11 });
    };
    const result = await requestJson<{ flaggedMineDays: number }>(
      "/api/analyze",
      { degree: 4 },
      undefined,
      fetcher,
    );
    expect(url).toBe("/api/analyze");
    expect(method).toBe("POST");
    expect(JSON.parse(body)).toEqual({ degree: 4 });
    expect(result.flaggedMineDays).toBe(11);
  });
  it("reads backend readiness with GET", async () => {
    let method = "";
    await requestJson("/api/health", undefined, undefined, async (_, init) => {
      method = String(init?.method);
      return Response.json({ status: "ok" });
    });
    expect(method).toBe("GET");
  });
  it("surfaces backend field validation errors", async () => {
    await expect(
      requestJson("/api/analyze", {}, undefined, async () =>
        Response.json(
          {
            detail: [
              {
                loc: ["body", "settings", "maWindow"],
                msg: "Input should be greater than or equal to 2",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    ).rejects.toThrow("maWindow");
  });
  it("explains an unavailable backend instead of exposing proxy HTML", async () => {
    await expect(
      requestJson(
        "/api/health",
        undefined,
        undefined,
        async () => new Response("<html>Proxy failed</html>", { status: 502 }),
      ),
    ).rejects.toThrow("FastAPI");
  });
  it("returns binary PDF bytes from the backend", async () => {
    const blob = await requestPdf(
      {},
      undefined,
      async () =>
        new Response("%PDF-1.4\n", {
          headers: { "Content-Type": "application/pdf" },
        }),
    );
    expect(await blob.text()).toBe("%PDF-1.4\n");
  });
  it("rejects report error responses before creating a download", async () => {
    await expect(
      requestPdf({}, undefined, async () =>
        Response.json(
          { detail: "Choose a date window containing observations." },
          { status: 422 },
        ),
      ),
    ).rejects.toThrow("observations");
  });
});
