# Laghubitta Khabar — AI Above the Evidence Layer (Frozen rule)

Status: **Accepted / Frozen.** This ADR does not introduce a new rule; it
consolidates the one rule the project has repeated in seven places and gives it a
single home, an owner, and enforcement points. Where this document and a
scattered mention disagree, this document wins and the scattered mention should
be corrected to point here.

Owner logic: **Future / Architecture.** Scope: the whole pipeline — ingestion,
extraction, classification, deduplication, comparison, alerting and the public
product.

## 1. Context

The product is an **MFB knowledge graph + evidence layer + intelligence
interface** (`docs/ARCHITECTURE.md` §Product definition). Its moat is that every
published fact traces to a retrievable source. An "intelligence interface" that
could emit a fact no source asserted would dissolve that moat in one screen, so
the boundary between "AI assists" and "AI decides" has to be explicit and stable.

Today the rule is stated, in near-identical wording, in seven documents:

| Where | Wording |
|---|---|
| `docs/architecture/DOMAIN-MODEL.md` §9 | "AI may assist extraction, classification, deduplication and document parsing. AI is never the source of truth. Every AI-derived value is still an assertion with a source, a confidence, and a verification state." |
| `docs/ARCHITECTURE.md` §Data flow | "Verification / Review is a human-in-the-loop gate; AI never publishes a fact directly." |
| `docs/FROZEN-SPEC.md` rule 10 | "AI-generated facts never enter production without human validation. AI discovers, extracts, classifies, suggests, compares, flags. It never directly publishes a fact." |
| `docs/DATABASE-SPEC.md` rule 9 | "AI is never the authority." |
| `docs/DATA-GOVERNANCE.md` commandment 9 | "No AI-generated fact enters production without validation." |
| `docs/PHASE-2-DESIGN.md` §3 | "M2.3 AI intelligence — explicitly gated … AI OFF." |
| `docs/architecture/REPOSITORY-CONTRACT.md` | "No operation exposes `data_assertions`. The evidence layer is invisible to the read plane." |

Seven copies of one rule is seven places for it to drift. This ADR makes the rule
atomic.

## 2. Decision

**AI sits above the evidence layer. It reads the evidence and proposes; it never
writes a published fact.** Concretely:

- The **evidence layer** is the durable store of *claims plus their provenance*:
  `sources` → `source_snapshots` → `documents` → `data_assertions`, each
  assertion carrying a `source_id`, a confidence, and a `verification_status`
  (`src/lib/constants/evidence.ts`). Everything the public sees is a projection
  of this layer, through the repository read plane only — never a direct query,
  never an AI-generated row.
- An AI output is **an input to the evidence layer, not an entry in it.** AI may
  propose or annotate an assertion; the assertion only becomes publishable when
  it carries a source and reaches an allowed verification state.
- The three states below are **distinct and never collapsed**
  (`docs/architecture/DOMAIN-MODEL.md` §9): `machine-extracted`,
  `human-reviewed`, `officially verified`. An AI-extracted value is
  `AUTO_VERIFIED` or `UNVERIFIED`; it is never silently promoted to
  `HUMAN_VERIFIED` or `VERIFIED`.

## 3. What AI may and may not do

**AI may (all operate on already-captured evidence):**

- Discover and fetch candidate documents the crawler already retrieved.
- Extract fields from a source PDF/page and attach them as a claim with the
  source, snapshot and observed date.
- Classify documents, events, source type, and language.
- Deduplicate and cluster near-identical records, flagging the pair rather than
  merging it.
- Compare values and **flag** disagreement for the conflict queue.
- Summarise or label evidence **for the review surface** (operator-facing), never
  as a published fact in its own words.

**AI may not (the boundary):**

- Invent, infer, or "fill in" a value no source asserted.
- Publish, overwrite or delete an assertion. The only writer is the reviewed
  ingestion/verification path (`data_assertions` is written by the evidence
  layer, never by an AI call).
- Promote a claim's verification state, or resolve a conflict by choosing a side
  (`docs/DATA-GOVERNANCE.md`: "Conflicts surface, never hide").
- Enter a financial number without source + period + unit (rule 11/commandment
  10) or a person beyond published Tier-1/Tier-2 roles.
- Be the opacity that lets a fact's provenance disappear: an AI-derived value is
  still an assertion with a source, a confidence and a state.

## 4. The gate

Per `docs/PHASE-2-DESIGN.md` §3, AI intelligence (M2.3) is **OFF** and stays off
until **both** prerequisites exist:

1. The far-data of `UNVERIFIED` assertions has passed a human review, and
2. a review/verification workflow bucket exists to catch what the machine
   proposes.

Until then, no AI producer is wired into a publish path. The Phase 2 deliverables
are deterministic (`docs/PHASE-2-DESIGN.md` §Status: Compare and Alerts are
"deterministic? yes"). **Alerts are rows of facts with evidence links** — no
free-text or AI summary (`docs/PHASE-2-DESIGN.md` §2).

## 5. Enforcement

The rule is upheld where the architecture already makes it structural:

- **Read plane cannot see claims.** No repository operation exposes
  `data_assertions`; the evidence layer is invisible to the read plane
  (`docs/architecture/REPOSITORY-CONTRACT.md`). There is no public door an AI row
  could walk through.
- **One verification vocabulary.** Statuses are the frozen constants in
  `src/lib/constants/evidence.ts`; the display layer maps them in
  `src/util/evidence.ts`. A new state cannot be invented by a producer.
- **Deterministic generators.** `lib/alerts.ts` is a pure domain module
  ("no infra imports, no randomness, no AI"); every generated module under
  `src/data/` is built by a script from evidence, not authored. A future AI
  assist must extend those scripts, not replace the modules.
- **Publication requires evidence.** Identity/data-truth guards
  (`npm run check:identity`, `npm run check:datatruth`, run in `prebuild`) fail
  the build if a published string or count lacks a source; an AI-sourced value
  without a `source_id` fails the same checks.

## 6. Consequences

- Any proposal to add AI must state which of the §3 "may" verbs it performs and
  prove it does not perform a "may not". That is the review question, every time.
- "AI-assisted" is never a reason to relax a sourcing rule; it is a reason to
  attach more provenance, not less.
- When the §4 gate opens, the first AI producer must land as a reviewer-facing
  proposal with a source, a confidence and an `UNVERIFIED`/`AUTO_VERIFIED` state —
  the same shape as every other assertion. Trusting the model is out of scope;
  trusting the evidence layer is the whole product.

## 7. References

- `docs/architecture/DOMAIN-MODEL.md` §9 (AI boundary)
- `docs/ARCHITECTURE.md` (evidence layer, data flow)
- `docs/FROZEN-SPEC.md` rules 10, 21
- `docs/DATABASE-SPEC.md` rules 9, 10
- `docs/DATA-GOVERNANCE.md` commandments 9, 10, and "Evidence → Claim"
- `docs/PHASE-2-DESIGN.md` §2, §3
- `docs/architecture/REPOSITORY-CONTRACT.md` (read-plane boundary)
- `src/lib/constants/evidence.ts`, `src/util/evidence.ts` (status vocabulary)
- `lib/alerts.ts` (deterministic, no AI)
