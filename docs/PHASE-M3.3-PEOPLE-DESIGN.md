# Phase M3.3 — People & Leadership (deterministic extraction)

Status: IMPLEMENTED + TESTED (fixture-derived evidence only; no per-MFB code, no AI, no OCR, no browser automation, no schema change).

## Objective

Extract people and leadership roles from institution websites deterministically, keep every claim traceable to its source, and expose it through the existing repository/API architecture. Claims land `UNVERIFIED` until a human decides.

## What was reused

| Concern | Reused artefact | Change |
| --- | --- | --- |
| Evidence ledger | `data_assertions` + `source_snapshots` + `sources` | none (append-only) |
| Conflicts | `data_conflicts` (`OPEN`/`RESOLVED`/`IGNORED`) | none |
| Audit | `audit_logs` | one new action `PEOPLE_CONFLICT_DETECTED` |
| Pipeline | `buildEngine`, `LocalSqliteEvidenceWriter`, `runDataApiPass`, validator contract | new `PEOPLE` capability branch |
| Read model | `InstitutionRepository` (`local`/D1 + static snapshot) | 3 new members |
| HTTP | `lib/api/handler.ts` + envelope contract | 2 new routes |

## Capability registration

- `CAPABILITY_KINDS` gains `PEOPLE`; `CAPABILITY_TO_LINK_TYPE` maps it to `OTHER` in `official_links` (the schema is not extended).
- `CAPABILITY_FETCH_INTERVAL_MINUTES.PEOPLE = 10080` (weekly) — leadership pages change slowly.
- `PEOPLE_PARSER_ID = "people-html-v1"`, `PEOPLE_JSON_PARSER_ID = "people-json-v1"`.
- `lib/ingestion/dataapi.ts` routes `capability: "PEOPLE"` to the JSON extractor; discovery config needs only `{"capability":"PEOPLE","known_url":"..."}`.

## Extraction behaviour (`lib/ingestion/people.ts`)

HTML passes, in order, over each leadership section (heading must match an English or Nepali section hint):

1. **Table rows** — the cell containing a role keyword is the designation column, the other name-like cells are people. `0.60`.
2. **Cards / profile blocks** — a container whose class hints card/profile/member/team yields exactly one name run. `0.55`. Image `alt`/URLs are never treated as names.
3. **Bold/strong runs** outside tables, lists and cards. `0.55`.
4. **List items** — `Name - Role` or plain name. `0.50`.
5. **Free paragraph lead** `Name, <role>` — `0.40`, evidence only. The engine's `>= 0.5` assertion floor means unstructured prose never becomes a claim.
6. **JSON / Data-API** — role-keyed containers (`chairman`, `ceo`, `board`, …) map to role families; nested member arrays inherit the container role; a flat array without a role defaults to `PEOPLE_BOARD` at `0.55`, keyed containers at `0.60`.

Role families: `PEOPLE_CHAIR`, `PEOPLE_CEO`, `PEOPLE_DIRECTOR`, `PEOPLE_BOARD` → `people_chair`, `people_ceo`, `people_director`, `people_board` (lower-cased by the engine).

**Dedupe is per person, per page.** A person listed three ways on one page yields one claim, and an explicit role beats one merely inherited from the section heading. This prevents a single page from manufacturing a role self-conflict; genuine multi-role data comes from different sources and is merged by the projection.

**Rejected as people**: emails, phone numbers, URLs, `N/A`, `TBD`, image filenames, and header rows.

## Review and conflict lifecycle (`lib/ingestion/review.ts`)

- `reviewAssertion(id, verdict, reviewer, note)` — `HUMAN_VERIFIED` / `REJECTED`, before/after audit, and **no** evidence mutation. The engine's content-hash idempotency is the only writer, so a rejected claim reappears when the source changes; a human rejection is scoped to the current snapshot, which is deliberate.
- `flagPeopleConflicts()` — two disagreement modes only:
  1. **Single-valued office** — `people_chair` / `people_ceo` carry more than one distinct value. `people_director` / `people_board` are a roster, so a value count is never a conflict there.
  2. **Role disagreement** — the same person is asserted under two different role families by two *different* sources. A same-source double role is a page artifact.
  One `OPEN` row per unordered pair, crediting the first source that asserted each side, and the detector is idempotent. A pair a human already decided is never re-opened by a re-run — re-opening is a human action.
- `listOpenConflicts()` / `resolveConflict()` — queue and decision with `resolved_by` / `resolved_at` / note, plus audit.

## Read model (`lib/repository/projection.ts`)

`peopleFromAssertionRows()` is the single pure mapping from evidence rows to `PersonDto`:

- person key = institution + lower-cased name; `slug`/`id` deterministic, no random ids;
- roles from different sources merge into one person with several `positions` (title, `observed_since`, `current`);
- `REJECTED` claims leave the read model but stay in the ledger;
- `meta.verification_status` = `CONFLICT` when the person's institution+role field has an open conflict, else `HUMAN_VERIFIED` → `AUTO_VERIFIED` → `UNVERIFIED`. A role-disagreement row (`people_ceo|people_director`) maps to one conflict key per role involved.

Both adapters call it: `D1InstitutionRepository` (SQL carries provenance columns only) and the static snapshot reader.

## API

- `GET /api/institutions/:slug/leadership` — `CollectionEnvelope<PersonDto>` with pagination. No longer an empty-phase stub.
- `GET /api/people/:slug` — `ResourceEnvelope<PersonDto>`, `404` when unknown.
- `GET /api/search?q=` — a `people` group alongside `institutions`.

## Generated snapshot

`scripts/pilot-export-people.ts` writes `src/data/people.ts` = raw people evidence rows + open people conflicts from the pilot DB, the same read-only way the other static modules are produced. The current pilot DB has **0** people assertions and **0** people conflicts: none of its 51 sources declares the `PEOPLE` capability yet, so every route honestly returns an empty collection.

## Not in this phase (deliberate)

- No per-institution code, no LLM/OCR, no Playwright, no new tables or columns.
- `people` / `positions` tables are **not** written; the read model is projected from evidence. Canonical materialisation is a later phase if the ledger proves insufficient.
- Profile-URL assertions are not persisted (no field for them without schema work); the individual profile link is covered by `official_links`/outbound-link evidence, not by a person claim.
- No People discovery heuristics beyond configured `known_url` + `page_extractor`; adding link-pattern discovery is optional follow-up.

## Real-source findings — M3.3-PILOT (controlled, 51-source universe)

`scripts/run-pilot-people.ts` runs the same fetcher/budgets/writer/extractors/validators as the Phase O pilot, narrowed to the PEOPLE capability, and reports `data/pilot/pilot-people-report.json`.

- 2 of 51 sources had a legitimately known official People URL — both **already discovered and already fetched by the existing generic discovery** in the Phase O run. No URL was invented. The other 49 are `PEOPLE = NOT_DISCOVERED`; the existing discovery mechanism has no People link pattern, so 49 sources cannot be covered without a generic discovery rule.
- `nadeplaghubitta.com/board-of-directors` — HTTP 200, JS-rendered: 122 KB of HTML but only 1 397 visible characters and no leadership heading server-side. Outcome `NO_EXTRACTABLE_PEOPLE`, 0 assertions, **0 false positives**.
- `swastiklbs.com.np/board-of-directors` — HTTP 200, server-rendered page-builder cards: 13 structural containers, 10 heading widgets, person names as `<h4>` heading widgets with the role in a sibling heading widget. Outcome: 0 real people extracted, **3 false positives** from the page's 38 navigation/footer `<li>` items. Real humans rejected the three claims; the ledger kept them and the read model published nobody.
- Real-source behaviour that held: provenance complete (0 orphans, 64-char content hash, MIME, HTTP status, source grade, run clock on every row), idempotent across 3 passes (pass 2/3 → `UNCHANGED`, 1 snapshot per source, 0 new assertions), rejection retained in the ledger and excluded from the read model, conflict detector produced 0 conflicts and re-ran idempotently.

Two generic gaps were found and deliberately **not** fixed (see the milestone report):
1. person name as a *heading widget* inside a repeated structural container (no card-ish class) — invisible to every current pass;
2. navigation/footer `<li>` leakage when a leadership section has no closing same-level heading.

## Generic extension A — page-builder rosters + navigation boundary (M3.3-GENERIC-EXT-A)

Two generic gaps were closed in `lib/ingestion/people.ts`. No institution, source id, vendor
class or site-specific selector appears anywhere in the code; both changes are driven purely by
HTML structure and the existing People vocabulary.

**1. Container roster pass** (`pickContainerRoster`, confidence 0.55, role always explicit)

```
repeated structural container
    -> heading-style element whose text is a name
    -> a sibling heading/span element whose text is a role
```

- A "heading-style element" is a real `h1..h6` **or** any element whose class carries a
  `heading`/`title` token. Page builders render a person's name in a styled `<span>`/`<div>`,
  so the class token is the generic signal.
- Ranges are resolved with a nesting-aware scan (`headingElements`). A flat regex lets an outer
  `<div>` swallow the inner heading, which is exactly the nesting a page builder produces
  (container > widget > `h4`), so nesting must be tracked.
- The role element is taken from the **innermost enclosing container that also holds a role
  element**, which keeps the name/role pairing local to one person instead of borrowing a role
  from a neighbour.
- **Strictness:** a name is only emitted when a role element is actually present, the name must
  pass `nameLike` and must not itself be a role, and **two or more** such units must exist in the
  block. One lone ambiguous heading is treated as prose and left to the other passes: missing
  people is the cheaper error.

**2. Navigation/footer boundary** (`stripNavigation`)

`<nav>`, `<footer>` and `role="navigation"` subtrees are **removed** from a leadership block
before any pass reads it, so a menu label can never become a person and legitimate leadership
`<li>` lists outside navigation are untouched.

Removal rather than truncation is evidence-driven: on the real leadership page the site menu
occupies bytes 27 688-34 584, the people markup sits at 37 201+, and the footer starts at
44 945. Cutting the block at the first `<nav>` would delete exactly the content we came for, so
the boundary is enforced by exclusion, which satisfies the safety requirement ("false people is
worse than missing people") independently of document order.

**Fixtures:** `scripts/smoke-people-generic-ext.ts` — 47 deterministic checks over
page-builder roster, menu-then-leadership-then-footer ordering, a legitimate leadership list,
navigation-only institution names, and strictness (no role element / single container /
role-only headings), plus provenance, deterministic ids and an idempotent repeat through the
real engine and `LocalSqliteEvidenceWriter`.

**Real-source result after the extension:** `swastiklbs` yields **5 correct people**
(Satya Narayan Jha = chair, Dr. Pramod Kumar Jha, Sudhansu Shekhar Jha, Jeetendra Jha,
Binodanand Jha = directors) with **0 false positives**; the three former navigation claims are
gone. `nadeplaghubitta` is unchanged and still JS-rendered with 0 assertions.

**Future candidate, not implemented:** the same page exposes a clean structured people list in
its own `og:description`. Reading OpenGraph metadata would be a *new evidence source kind* and
is deliberately out of scope for this extension.
