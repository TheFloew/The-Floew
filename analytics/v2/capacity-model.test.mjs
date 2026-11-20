import test from 'node:test';
import assert from 'node:assert/strict';
import {estimate} from './capacity-model.mjs';
test('500k DAU 20 events yields 300M events monthly',()=>{
  const r=estimate();assert.equal(r.volumes.eventsDaily,10_000_000);
  assert.equal(r.volumes.eventsMonthly,300_000_000);
  assert.equal(r.volumes.eventGB,150);
  assert.equal(r.volumes.compressedGB,45);
  assert.equal(r.volumes.r2StoredGB,540);
  assert.equal(r.costsUSD.basinTransformUSD,4);
  assert.equal(r.costsUSD.basinSinkUSD,6);
  assert.equal(r.costsUSD.r2StorageUSD,7.95);
  assert.equal(r.costsUSD.workersExtraUSD,1.5);
  assert.equal(r.costsUSD.modeledMonthlyAtMonthN,24.45);
});
test('fourfold larger events quadruple data volume, not Workers requests',()=>{
  const a=estimate({bytesPerEvent:500}),b=estimate({bytesPerEvent:2000});
  assert.equal(b.volumes.eventGB,600);
  assert.equal(b.volumes.compressedGB,180);
  assert.equal(b.volumes.r2StoredGB,2160);
  assert.equal(b.costsUSD.basinTransformUSD,22);
  assert.equal(b.costsUSD.basinSinkUSD,33);
  assert.equal(b.costsUSD.r2StorageUSD,32.25);
  assert.equal(b.costsUSD.workersExtraUSD,a.costsUSD.workersExtraUSD);
  assert.equal(b.costsUSD.modeledMonthlyAtMonthN,93.75);
});
test('low traffic stays within allowances while Workers Paid base remains',()=>{
  const r=estimate({dailyVisitors:100,eventsPerVisitor:20,monthsOfArchive:1});
  assert.equal(r.costsUSD.basinTransformUSD,0);
  assert.equal(r.costsUSD.basinSinkUSD,0);
  assert.equal(r.costsUSD.r2StorageUSD,0);
  assert.equal(r.costsUSD.workersExtraUSD,0);
  assert.equal(r.costsUSD.modeledMonthlyAtMonthN,5);
});
test('no exclusion flags are hidden',()=>{
  const r=estimate();assert.ok(r.excluded.some(x=>x.includes('CPU')));
  assert.ok(r.excluded.some(x=>x.includes('R2 Class')));
});
test('invalid ranges are rejected',()=>{
  assert.throws(()=>estimate({bytesPerEvent:0}),/positive/);
  assert.throws(()=>estimate({compressionRatio:1.1}),/compressionRatio/);
});
