async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return new Error(body.detail);
    if (Array.isArray(body.detail))
      return new Error(
        body.detail
          .slice(0, 5)
          .map(
            (item: { loc?: unknown[]; msg?: string }) =>
              `${item.loc?.slice(1).join(".") ?? "Input"}: ${item.msg ?? "Invalid value"}`,
          )
          .join("; "),
      );
  } catch {}
  return new Error(
    `FastAPI request failed (HTTP ${response.status}). Start or check the backend and try again.`,
  );
}

async function send(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "FastAPI backend is unavailable. Start the backend and try again.",
    );
  }
  if (!response.ok) throw await responseError(response);
  return response;
}

export async function requestJson<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await send(path, body, signal, fetcher);
  return response.json() as Promise<T>;
}

export async function requestPdf(
  body: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const response = await send("/api/reports/pdf", body, signal, fetcher);
  if (!response.headers.get("Content-Type")?.startsWith("application/pdf"))
    throw new Error("FastAPI returned an unexpected report response.");
  return response.blob();
}
