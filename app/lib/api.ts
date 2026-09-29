/**
 * The one way this app talks to its backend.
 *
 * Every call carries a fresh App Bridge session token. The token is short
 * lived — about a minute — so it is fetched per request rather than held:
 * a cached one would expire in the background and fail the next call a
 * merchant makes rather than the one that cached it.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The backend's own field errors, where it sent any. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function sessionToken(): Promise<string> {
  if (!window.shopify?.idToken) {
    // Only possible outside the Shopify admin, where nothing here can work.
    throw new ApiError(401, "This page must be opened from the Shopify admin.");
  }

  return window.shopify.idToken();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  /** Bounded: a backend stuck on "retry" must not spin the tab forever. */
  canRetry = true,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await sessionToken()}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    /*
     * The backend answers an expired token with this header rather than a
     * redirect, so a retry with a fresh token is all that is needed. App
     * Bridge mints a new one on the next idToken() call.
     */
    if (
      canRetry &&
      response.headers.get("X-Shopify-Retry-Invalid-Session-Request")
    ) {
      return request<T>(method, path, body, false);
    }

    const payload = await response.json().catch(() => null);

    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed (${response.status})`,
      payload,
    );
  }

  // 204 and friends carry nothing to parse.
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
