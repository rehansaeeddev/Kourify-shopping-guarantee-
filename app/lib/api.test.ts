import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("the API client", () => {
  beforeEach(() => {
    window.shopify = { idToken: vi.fn().mockResolvedValue("token-1") };
  });

  afterEach(() => {
    delete window.shopify;
  });

  it("sends a session token with every call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/dashboard");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/dashboard");
    expect(init.headers.Authorization).toBe("Bearer token-1");
  });

  /**
   * A fresh token per call, not a cached one. The token lives about a minute,
   * so a cached one expires in the background and fails the *next* call a
   * merchant makes rather than the one that cached it.
   */
  it("mints a new token for each call", async () => {
    // A fresh Response per call: a body can only be read once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse({})),
    );

    await api.get("/dashboard");
    await api.get("/settings");

    expect(window.shopify?.idToken).toHaveBeenCalledTimes(2);
  });

  it("retries once when the backend says the session token was stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "expired" },
          {
            status: 401,
            headers: { "X-Shopify-Retry-Invalid-Session-Request": "1" },
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/dashboard")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /** The retry is bounded: a backend stuck on "retry" must not spin the tab. */
  it("gives up after one retry", async () => {
    const stale = () =>
      jsonResponse(
        { error: "expired" },
        {
          status: 401,
          headers: { "X-Shopify-Retry-Invalid-Session-Request": "1" },
        },
      );
    const fetchMock = vi.fn().mockImplementation(async () => stale());
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/dashboard")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the backend's own message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: "This order is already protected." },
            { status: 422 },
          ),
        ),
    );

    await expect(api.post("/orders/offer", {})).rejects.toMatchObject({
      status: 422,
      message: "This order is already protected.",
    });
  });

  it("falls back to the status when the body carries no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );

    await expect(api.get("/dashboard")).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502)",
    });
  });

  it("returns nothing for a 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(api.delete("/translations/fr")).resolves.toBeUndefined();
  });

  /**
   * Outside the Shopify admin there is no App Bridge and nothing here can
   * work, so it fails with a sentence rather than a TypeError on undefined.
   */
  it("explains itself when App Bridge is absent", async () => {
    delete window.shopify;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/dashboard")).rejects.toMatchObject({
      status: 401,
      message: "This page must be opened from the Shopify admin.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("downloads", () => {
  beforeEach(() => {
    window.shopify = { idToken: vi.fn().mockResolvedValue("token-1") };
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
    URL.revokeObjectURL = vi.fn();
  });

  /*
   * The endpoint sits behind the same session token as everything else, and a
   * plain <a href> sends no Authorization header — this is why the CSV button
   * is not a link.
   */
  it("carries the session token and hands the browser a file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Order,Status\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await api.download("/claims/export?tab=high_risk", "claims.csv");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer token-1",
    );
    expect(click).toHaveBeenCalledOnce();
    // The anchor is cleaned up, so a page of exports leaves nothing behind.
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("throws rather than downloading an error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await expect(
      api.download("/claims/export", "claims.csv"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(click).not.toHaveBeenCalled();
  });
});
