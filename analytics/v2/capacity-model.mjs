/**
 * Flöw Analytics v2 stage 7 | Hypothetical Cloudflare Paid usage model.
 * Source rates verified against Cloudflare docs on 2026-11-20.
 * This is NOT a quote; excludes CPU, object operations, SQL, catalog,
 * replay/dedup compute, metadata, storage growth variance, other Workers
 * and currency/tax. Costs in USD, decimal GB, 30-day months.
 *
 * Usage: node analytics/v2/capacity-model.mjs
 *   [dailyVisitors] [eventsPerVisitor] [bytesPerEvent] [telemetryReqPerVisitor]
 *   [monthsOfArchive] [compressionRatio]
 */
export function estimate(params = {}) {
  const {
    dailyVisitors=500_000, eventsPerVisitor=20, bytesPerEvent=500,
    telemetryRequestsPerVisitor=1, monthsOfArchive=12,
    compressionRatio=0.30, daysPerMonth=30
  }=params;
  for (const [key,value] of Object.entries({dailyVisitors,eventsPerVisitor,bytesPerEvent,telemetryRequestsPerVisitor,monthsOfArchive,compressionRatio,daysPerMonth}))
    if (!Number.isFinite(value) || value<=0) throw new Error('Expected positive finite '+key);
  if (compressionRatio>1) throw new Error('compressionRatio should be <=1');
  const eventsMonthly=dailyVisitors*eventsPerVisitor*daysPerMonth;
  const eventGB=eventsMonthly*bytesPerEvent/1e9; // *uncompressed* event payload volume
  const compressedGB=eventGB*compressionRatio;
  const basinTransformUSD=Math.max(0,eventGB-50)*0.04; // 50 GB included
  const basinSinkUSD=Math.max(0,eventGB-50)*0.06; // 50 GB included, Parquet/Iceberg
  const workersTelemetryRequests=dailyVisitors*telemetryRequestsPerVisitor*daysPerMonth;
  // This assumes the account's 10M included Worker requests are unused by other Workers.
  const workersExtraUSD=Math.max(0,workersTelemetryRequests-10_000_000)/1e6*0.30;
  const r2StoredGB=compressedGB*monthsOfArchive;
  const r2StorageUSD=Math.max(0,r2StoredGB-10)*0.015; // snapshot after N months, not cumulative bill
  const baseWorkersPaidUSD=5;
  const modeledMonthlyAtMonthN=basinTransformUSD+basinSinkUSD+workersExtraUSD+r2StorageUSD+baseWorkersPaidUSD;
  return {
    assumptions:{dailyVisitors,eventsPerVisitor,bytesPerEvent,telemetryRequestsPerVisitor,monthsOfArchive,compressionRatio,daysPerMonth},
    volumes:{eventsDaily:dailyVisitors*eventsPerVisitor,eventsMonthly,eventGB,compressedGB,
      workersTelemetryRequests,r2StoredGB},
    costsUSD:{baseWorkersPaidUSD,basinTransformUSD,basinSinkUSD,workersExtraUSD,r2StorageUSD,
      modeledMonthlyAtMonthN},
    excluded:['R2 Class A/B operations','Basin Catalog metadata/compaction',
      'Basin SQL or external query compute','rollup/dedup processing and event lag handling',
      'worker CPU','any other Workers requests or services',
      'storage billing rounding and retention variance','tax/FX']
  };
}
const isCLI=typeof process!=='undefined' && process.argv[1] &&
  import.meta.url===new URL('file://'+process.argv[1]).href;
if(isCLI){
  const args=process.argv.slice(2).map(Number);
  const names=['dailyVisitors','eventsPerVisitor','bytesPerEvent','telemetryRequestsPerVisitor','monthsOfArchive','compressionRatio'];
  const config=Object.fromEntries(args.map((v,i)=>[names[i],v]));
  console.log(JSON.stringify(estimate(config),null,2));
}
