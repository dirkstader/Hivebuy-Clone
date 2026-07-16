import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// The API uses Bearer tokens, never cookies/localStorage (blocked in the target runtime —
// see README). The token lives only in memory here, mirroring the in-memory-only user state
// in auth-context.tsx: a full page reload clears both, which is intentional.
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // FormData (file uploads) must go through as-is — the browser sets its own multipart
  // Content-Type with the boundary; JSON-encoding or overriding it here would break the upload.
  const isFormData = data instanceof FormData;
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(data && !isFormData ? { "Content-Type": "application/json" } : {}),
    },
    body: isFormData ? data : data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: authHeaders() });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
