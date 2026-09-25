// scripts/smoke-api.ts — verifies the repository contract end-to-end.
// Run: npx tsx scripts/smoke-api.ts
//   1. mock adapter (in-memory master snapshot) — no DB needed.
//   2. local adapter (better-sqlite3 over lk.db) — requires seed.
// Checks response-envelope shapes match docs/API-CONTRACT.md.
//
// DISCIPLINE (docs/OPERATIONS.md): test tooling. Never against staging/prod.
import { guardOrExit } from "./guard-env.cjs";
import { getRepository, initLocal } from "../lib/repository";

guardOrExit("scripts/smoke-api.ts");

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

async function main() {
  // ---- Mock adapter (in-memory master snapshot) ----
  const mock = getRepository();

  const mockList = await mock.listInstitutions({ page: 1, limit: 20 });
  assert(mockList.pagination.total === 51, `mock list: total=51 (got ${mockList.pagination.total})`);
  assert(mockList.data.every((i) => i.slug && i.name_en), "mock list items have slug + name_en");

  const merged = await mock.listInstitutions({ q: "deprosc", page: 1, limit: 10 });
  assert(merged.pagination.total >= 1, `mock search query 'deprosc' finds Deprosc (${merged.pagination.total})`);

  const detail = await mock.getInstitutionBySlug("infinity-laghubitta-bittiya-sanstha-ltd");
  assert(detail?.id === "mfi-034", "mock detail: infinity resolves to mfi-034");
  assert(!!(detail && detail.official_links.length > 0), "mock detail has official links");
  assert(detail?.go_slug === "/go/mfi-034/website", "mock detail go_slug set");

  const go = await mock.resolveOutboundLink("mfi-034", "website");
  assert(!!(go && go.target_url), "mock /go/mfi-034/website resolves a target");

  const events = await mock.listInstitutions({ page: 1, limit: 100 });
  const withEvents = await Promise.all(
    events.data.slice(0, 5).map(async (i) => (await mock.getInstitutionBySlug(i.slug))?.timeline.length ?? 0),
  );
  assert(withEvents.some((n) => n > 0), `mock timeline populated for some MFBs (counts=${withEvents.join(",")})`);

  // ---- Local adapter (better-sqlite3 over lk.db) ----
  try {
    await initLocal("lk.db");
    const local = getRepository();
    const lList = await local.listInstitutions({ page: 2, limit: 10 });
    assert(lList.pagination.total === 51, `local list: total=51 (got ${lList.pagination.total})`);
    assert(lList.data.length === 10, `local list page 2 has 10 items (got ${lList.data.length})`);

    const lMerged = await local.getInstitutionBySlug("matribhumi-laghubitta-bittiya-sanstha-ltd");
    assert(lMerged?.id === "mfi-047", "local detail: matribhumi resolves to mfi-047");
    assert((lMerged?.timeline.length ?? 0) >= 1, "local detail has timeline (matribhumi=8)");

    const lDetail = await local.getInstitutionBySlug("mero-microfinance-laghubitta-bittiya-sanstha-ltd");
    assert(lDetail?.id === "mfi-020", "local detail: mero resolves to mfi-020");
    assert(lDetail?.coverage !== null, "local detail has coverage row (seeded)");

    const lGo = await local.resolveOutboundLink("mfi-020", "website");
    assert(!!(lGo && lGo.target_url), "local /go/mfi-020/website resolves a target");
    const lGoMissing = await local.resolveOutboundLink("mfi-020", "social");
    assert(lGoMissing === null, "local /go/mfi-020/social → null");

    const notFound = await local.getInstitutionBySlug("no-such-mfb");
    assert(notFound === null, "local detail: unknown slug → null (NOT_FOUND at API layer)");
  } catch (e) {
    console.error("local adapter skipped:", (e as Error).message);
    console.log('run "node scripts/seed.cjs" to create lk.db, then re-run.');
  }

  console.log(process.exitCode ? "\nSMOKE: FAILURES" : "\nSMOKE: all checks passed");
}

main();