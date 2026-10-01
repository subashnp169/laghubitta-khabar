# Live Data Issues — MVP Release 1

- **Release commit:** `90e3a3e` (deployed, Pages build `success`)
- **Live URL:** https://subashnp169.github.io/laghubitta-khabar
- **Live state verified:** 58 people / 6 institutions / 6 sources; 50 UNVERIFIED, 8 CONFLICT
- **Sweep:** 51/51 institution pages HTTP 200, 45 honest `None published`, 0 P0 leaks
- **Collected from:** live page fetch after deployment

Priority key: **P0** publicly false/dangerous · **P1** publicly misleading · **P2** coverage ·
**P3** UX · **P4** enhancement. Only P0/P1 interrupt normal roadmap work.

---

## Open issues

### P2 — Coverage

- 45/51 institutions have no published people. Source URLs exist but were never crawled.
- Branch and Careers datasets remain empty; pages show honest `None extracted`.
- `people_branches` never appears in extracted data despite being an expected field.

## P3 — UX

- No person detail page. `/api/people/{slug}` works and every record is individually
  addressable, but the static site exposes no route for it, so people cannot be linked.
- Only the primary source URL is exposed. If a record ever becomes corroborated by a
  second source, the second source's URL will need a `source_urls` array to match
  `sources[]`.
- The leadership list shows the institution's first source URL only. With 6
  single-source institutions that is complete today, but a mixed-source institution
  would need per-row provenance.

## P4 — Enhancement

- Link people from search results once a person route exists.
- Show `since` per position once historical snapshots accumulate.

---

## Fixed in this release

| Issue | Sev | Resolution |
|---|---|---|
| Site rendered a false `Leadership (0 extracted) / None extracted` for all 51 institutions while the MVP was invisible | P0 | Institution pages now read `institutionLeadership()`; live totals match the audit exactly |
| 11 supportmicrofinance names in mathematical-bold Unicode collapsed onto one identical id/slug (10 unreachable) | P0 | Excluded from published output as not individually addressable; retained in evidence |
| 5 navigation/feature labels published as `Director` (`Currency Conversion`, `Local Bodies Outreach`, `Working Districts`, `Internal Web` x2) | P0 | Fail-closed denylist in the exporter; retained in evidence |
| `swastiklbs-website` had no canonical identity (pilot `mfi-045` = Swastik, public `mfi-045` = Nyadi) | P0 | Source excluded from public output; 16 assertions retained in evidence |
| `smoke:api` person-detail assertions were data-driven and silently skipped when `institutions[0]` had no people | P1 | Now selects an institution that actually has leadership |

---

## Fixed in post-launch P1 cycle

| Issue | Sev | Resolution |
|---|---|---|
| Source URL not exposed; readers could not follow a person back to its evidence | P1 | `SourceMeta.source_url` / `ApiMeta.source_url` added and populated from `pilot-sources.json`. Nullable by design — never a synthesised link. 8 new `smoke:api` assertions cover shape and envelope parity |
| `people_ceo` treated as a single slot, so 4 names at one institution each read as an exclusive office | P1 | `positions[].shared_by` reports how many people share a role; the UI pluralises multi-holder officer titles and shows a `N listed` note. All names still published, none dropped |
| 8 people marked `CONFLICT` when no contradiction existed | P1 | Root cause: all 64 conflict rows had `source_a_id = source_b_id` — one source disagreeing with itself. `CONFLICT` is now reserved for cross-source disagreement. 58 people, all `UNVERIFIED`, `sources.length === 1` throughout |

**Evidence behind the conflict reclassification:** 64/64 conflict rows in
`pilot-people-2026-09-27-ext-c-pass1.db` are same-source. 0 are cross-source. Each
institution's people come from exactly one source, so cross-source conflict is not
merely absent here — it is impossible with this evidence. The `CONFLICT` path itself
remains live and is exercised by forcing a key in verification.

## Still open from the original P1 list

- ~~8 promoted institutions have `officialWebsite: null`~~ — unchanged, still P2 work;
  it was mis-filed as P1 and is coverage/verification, not a live-data defect.

