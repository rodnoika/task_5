export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function proxy(request: Request): Promise<Response> {
  const backend =
    process.env.FASTAPI_URL ??
    (process.env.VERCEL ? undefined : "http://127.0.0.1:8000");

  if (!backend)
    return Response.json(
      { detail: "Backend service binding is unavailable." },
      { status: 503 },
    );

  try {
    const incoming = new URL(request.url);
    const target = new URL(
      incoming.pathname.slice(1) + incoming.search,
      backend.replace(/\/?$/, "/"),
    );
    const headers = new Headers();
    for (const name of ["accept", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      signal: request.signal,
      cache: "no-store",
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "content-disposition", "allow"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { detail: "FastAPI backend is unavailable. Try again shortly." },
      { status: 502 },
    );
  }
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
  proxy as HEAD,
};
