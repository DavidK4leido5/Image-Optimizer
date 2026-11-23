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
    const response = await fetch(origin);

    if (response.status === 202) {
      // The preset is still building. Serve the closest ready variant, never cache it.
      const fallbackUrl = response.headers.get("X-Fallback-Url");
      if (fallbackUrl) {
        const fallback = await fetch(fallbackUrl, { method: request.method });
        if (fallback.status === 200) {
          const out = new Response(request.method === "HEAD" ? null : fallback.body, fallback);
          out.headers.set("Access-Control-Allow-Origin", "*");
          out.headers.set("Cache-Control", "no-store");
          return out;
        }
      }

      const pending = new Response(response.body, response);
      pending.headers.set("Access-Control-Allow-Origin", "*");
      return pending;
    }

    if (response.status !== 200) return response;

    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    out.headers.set("Access-Control-Allow-Origin", "*");

    if (request.method === "GET") ctx.waitUntil(cache.put(request, out.clone()));
    return out;
  },
};
