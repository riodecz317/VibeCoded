/**
 * Cloudflare Worker — Anthropic API proxy for payslip-extractor
 *
 * Deploy:
 *   1. https://workers.cloudflare.com → Create Worker
 *   2. Paste this entire file → Save & Deploy
 *   3. Copy the worker URL (https://xxxx.workers.dev)
 *   4. Paste into PROXY_URL in payslip-extractor.html
 *
 * Test after deploy: open the worker URL in a browser tab —
 * you should see: {"status":"ok","service":"payslip-proxy"}
 */

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    // ── Health check: open worker URL in a browser to verify deploy ────
    if (request.method === "GET") {
      return withCors(JSON.stringify({
        status: "ok",
        service: "payslip-proxy",
        time: new Date().toISOString(),
      }), 200, origin, { "Content-Type": "application/json" });
    }

    // ── CORS preflight ──────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return withCors(null, 204, origin);
    }

    if (request.method !== "POST") {
      return withCors(JSON.stringify({ error: "Method not allowed" }), 405, origin);
    }

    // ── API key from header ─────────────────────────────────────────────
    const apiKey = request.headers.get("X-Api-Key") || "";
    if (!apiKey.startsWith("sk-ant-")) {
      return withCors(JSON.stringify({
        error: "Missing or invalid API key (X-Api-Key header)"
      }), 401, origin, { "Content-Type": "application/json" });
    }

    // ── Forward to Anthropic ────────────────────────────────────────────
    try {
      const body = await request.text();
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
      const responseBody = await upstream.text();
      return withCors(responseBody, upstream.status, origin, {
        "Content-Type": "application/json",
      });
    } catch (err) {
      return withCors(JSON.stringify({
        error: "Upstream request failed",
        detail: err.message,
      }), 502, origin, { "Content-Type": "application/json" });
    }
  }
};

// ── CORS: echo back whatever origin called us ────────────────────────────
// Safe here because the proxy holds no secrets — the API key comes from
// the caller's own request. Locking origin adds friction without security.
function withCors(body, status, origin, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin":  origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
      "Access-Control-Max-Age":       "86400",
      "Vary":                         "Origin",
      ...extra,
    },
  });
}
