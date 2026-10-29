import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST, HEAD } from "../src/app/api/[...path]/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backend service proxy", () => {
  it("reads the binding at request time and preserves its base path and query", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({ status: "ok" }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/services/first");
    await GET(new Request("https://dashboard.example/api/health?check=1"));
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/services/second/");
    await GET(new Request("https://dashboard.example/api/health?check=2"));
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://backend.internal/services/first/api/health?check=1",
    );
    expect(String(fetcher.mock.calls[1][0])).toBe(
      "https://backend.internal/services/second/api/health?check=2",
    );
  });

  it("forwards JSON snapshots and returns backend validation errors unchanged", async () => {
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/");
    let forwarded: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      forwarded = init;
      return Response.json({ detail: "Invalid date range" }, { status: 422 });
    });
    const body = JSON.stringify({ degree: 4, dataset: { mines: [] } });
    const response = await POST(
      new Request("https://dashboard.example/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    expect(forwarded?.method).toBe("POST");
    expect(new Headers(forwarded?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(new TextDecoder().decode(forwarded?.body as ArrayBuffer)).toBe(body);
    expect(forwarded?.cache).toBe("no-store");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ detail: "Invalid date range" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("preserves PDF bytes and the download filename", async () => {
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/");
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 0, 255]);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="report.pdf"',
            "Content-Encoding": "gzip",
            "Content-Length": "123",
          },
        }),
    );
    const response = await POST(
      new Request("https://dashboard.example/api/reports/pdf", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="report.pdf"',
    );
    expect(response.headers.has("Content-Encoding")).toBe(false);
    expect(response.headers.has("Content-Length")).toBe(false);
  });

  it("supports standalone local development without setting a binding", async () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("FASTAPI_URL", undefined);
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({ status: "ok" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await GET(new Request("http://localhost:3000/api/health"));
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8000/api/health",
    );
  });

  it("returns an explicit error when Vercel has no service binding", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("FASTAPI_URL", undefined);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(
      new Request("https://dashboard.example/api/health"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      detail: "Backend service binding is unavailable.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns JSON when the bound backend cannot be reached", async () => {
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Connection refused");
    });
    const response = await GET(
      new Request("https://dashboard.example/api/health"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "FastAPI backend is unavailable. Try again shortly.",
    });
  });

  it("forwards HEAD requests without a request body", async () => {
    vi.stubEnv("FASTAPI_URL", "https://backend.internal/");
    let forwarded: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      forwarded = init;
      return new Response(null, { status: 204 });
    });
    const response = await HEAD(
      new Request("https://dashboard.example/api/health", { method: "HEAD" }),
    );
    expect(forwarded?.method).toBe("HEAD");
    expect(forwarded?.body).toBeUndefined();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
