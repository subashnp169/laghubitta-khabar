// ============================================================================
// Phase 3 (M3.1) — standalone B2B API server. node:http only (no new deps).
// Read-only: serves the frozen API contract from the pure handler/repository
// over the generated modules. Binds 127.0.0.1, port from PORT env or 8787.
//   npm run api            → start on http://127.0.0.1:8787
//   PORT=9900 npm run api  → start on http://127.0.0.1:9900
// ============================================================================

import { createServer } from "node:http";
import { handleApiRequest } from "../lib/api/handler";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const out = handleApiRequest({ method: req.method ?? "GET", url });

  res.writeHead(out.status, {
    "Content-Type": out.contentType ?? "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : out.body);
  const logUrl = url.length > 80 ? `${url.slice(0, 80)}…` : url;
  console.log(`${new Date().toISOString()} ${req.method} ${logUrl} → ${out.status}`);
});

server.listen(PORT, HOST, () => {
  console.log(`laghubitta-khabar B2B API listening on http://${HOST}:${PORT} (read-only, deterministic)`);
  console.log("endpoints: /api/institutions, /api/institutions/:slug{/documents,/events,/jobs,/branches,/leadership,/financials}, /api/interest-rates, /api/search?q=");
});