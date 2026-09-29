// Live proof: run the generic external branch-table adapter against the real
// NRB BFI list. Inspection only; writes nothing.
import { parseExternalBranchTable, mapExternalHeader } from "../lib/ingestion/branch-external";

const UA = "laghubitta-khabar-m3.4-adapter-check/1.0";
const url = "https://www.nrb.org.np/bank-list/";

async function main(): Promise<void> {
  let html = "";
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      html = await res.text();
      console.log(`fetch: status=${res.status} bytes=${html.length}`);
      break;
    } catch (e) {
      console.log(`fetch attempt ${i + 1} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!html) throw new Error("could not fetch");

  console.log("\n--- header -> field mapping actually observed ---");
  for (const h of ["S.N.", "Code", "Address", "District", "Branch Name", "Open Date"]) {
    console.log(`  ${JSON.stringify(h).padEnd(16)} -> ${String(mapExternalHeader(h))}`);
  }

  const t = parseExternalBranchTable(html);
  console.log("\n--- parse result ---");
  console.log(`  header row      : ${t.header_row.join(" | ")}`);
  console.log(`  columns mapped  : ${t.columns.filter((c) => c.field).length}/${t.columns.length}`);
  console.log(`  unmapped headers: ${JSON.stringify(t.unmapped_headers)}`);
  console.log(`  data rows       : ${t.data_row_count}`);
  console.log(`  records parsed  : ${t.records.length}`);
  console.log(`  rows refused    : ${t.rejected.length}`);
  if (t.rejected.length > 0) console.log(`  refuse sample   : ${t.rejected[0].reason} | ${t.rejected[0].sample}`);

  console.log("\n--- first 5 records ---");
  for (const r of t.records.slice(0, 5)) {
    console.log(
      `  code=${String(r.external_code).padEnd(9)} name=${r.branch_name.padEnd(28)} district=${String(r.district).padEnd(14)} opened=${r.open_date} addr=${String(r.address).slice(0, 34)}`,
    );
  }
  console.log("\n--- last 3 records ---");
  for (const r of t.records.slice(-3)) {
    console.log(`  code=${String(r.external_code).padEnd(9)} name=${r.branch_name.padEnd(28)} district=${String(r.district).padEnd(14)} opened=${r.open_date}`);
  }

  const withDistrict = t.records.filter((r) => r.district).length;
  const withOpened = t.records.filter((r) => r.open_date).length;
  const withAddr = t.records.filter((r) => r.address).length;
  console.log("\n--- field fill rate ---");
  console.log(`  district : ${withDistrict}/${t.records.length}`);
  console.log(`  address  : ${withAddr}/${t.records.length}`);
  console.log(`  openDate : ${withOpened}/${t.records.length}`);
  const codes = new Set(t.records.map((r) => r.external_code));
  console.log(`  distinct external codes: ${codes.size}`);
  const names = t.records.map((r) => r.branch_name.toLowerCase().trim());
  const dupNames = names.length - new Set(names).size;
  console.log(`  duplicate branch names  : ${dupNames}`);
  const dates = t.records.map((r) => r.open_date).filter(Boolean).sort();
  console.log(`  open date range         : ${dates[0]} .. ${dates[dates.length - 1]}`);
}

main().catch((e) => {
  console.error("adapter check failed:", e);
  process.exit(1);
});
