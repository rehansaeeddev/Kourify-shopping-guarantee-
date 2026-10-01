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

/**
 * How long to wait for App Bridge to mint a token before giving up.
 *
 * Generous: it normally answers in well under a second, and a merchant on a
 * slow connection should not be told the admin is broken because of it.
 */
const TOKEN_TIMEOUT_MS = 8000;

async function sessionToken(): Promise<string> {
  if (!window.shopify?.idToken) {
    // Only possible outside the Shopify admin, where nothing here can work.
    throw new ApiError(401, "This page must be opened from the Shopify admin.");
  }

  /*
   * Bounded, because idToken() has no timeout of its own. When App Bridge is
   * wedged — the frame never finishes its handshake with the admin — that
   * promise simply never settles. Every page here awaits it before its first
   * request, so the page renders nothing at all: no spinner ever finishes, no
   * error boundary ever fires, and there is nothing on screen to retry from.
   * A blank page that says why beats a blank page that doesn't.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      window.shopify.idToken(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ApiError(
                408,
                "Shopify took too long to authorise this page. Reload to try again.",
              ),
            ),
          TOKEN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    // Whichever side won, the tab should not be kept awake by the loser.
    clearTimeout(timer);
  }
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

/**
 * Fetches a file the backend streams, and hands the browser the download.
 *
 * A plain <a href> cannot do this: the endpoint is behind the same session
 * token every other call carries, and a link sends no Authorization header —
 * the merchant would get a 401 page instead of their spreadsheet.
 */
async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${await sessionToken()}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Download failed (${response.status})`);
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  // Revoked on the next tick rather than immediately: the click is handled
  // asynchronously, and freeing the blob first cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  download,
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
