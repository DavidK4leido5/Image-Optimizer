export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("method not allowed", { status: 405 });

    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const origin = new URL(url.pathname + url.search, env.ORIGIN);
    // Manual redirects: the origin marks a low-res fallback, and that must never be cached
    // under the requested preset URL.
    const response = await fetch(origin, { redirect: "manual" });

    if (response.status === 202) {
      const pending = new Response(response.body, response);
      pending.headers.set("Access-Control-Allow-Origin", "*");
      return pending;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) return response;

      const fallback = response.headers.get("X-Fallback") === "1";
      const image = await fetch(new URL(location, origin), { method: request.method });
      if (image.status !== 200) return image;

      const out = new Response(request.method === "HEAD" ? null : image.body, image);
      out.headers.set("Access-Control-Allow-Origin", "*");

      if (fallback) {
        out.headers.set("Cache-Control", "no-store");
      } else {
        out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
        if (request.method === "GET") ctx.waitUntil(cache.put(request, out.clone()));
      }
      return out;
    }

    if (response.status !== 200) return response;

    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    out.headers.set("Access-Control-Allow-Origin", "*");

    if (request.method === "GET") ctx.waitUntil(cache.put(request, out.clone()));
    return out;
  },
};
