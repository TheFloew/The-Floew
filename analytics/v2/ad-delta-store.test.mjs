import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {aggregateBatch,storeBatch,queryStoredCounters} from './ad-delta-store.mjs';

const H=3600000;
function db(){const d=new DatabaseSync(':memory:');d.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'ad-hourly-deltas.sql'),'utf8'));return d;}
const event=(id,type,ad='A',at=H)=>({event_id:id,event_type:type,ad_id:ad,occurred_at:at,device_type:'mobile',orientation:'ver',local_hour:14,dwell_ms:0});
test('same batch retry cannot double count',()=>{const d=db();const input=[event('1','ad_view'),event('2','ad_complete')];assert.equal(storeBatch(d,'fixed-batch',input).inserted,1);assert.equal(storeBatch(d,'fixed-batch',input).inserted,0);assert.equal(queryStoredCounters(d)[0].views,1);d.close();});
test('duplicate event_id inside one batch is ignored',()=>{const d=db();const e=event('1','ad_view');storeBatch(d,'b1',[e,e]);assert.equal(queryStoredCounters(d)[0].views,1);d.close();});
test('twenty thousand events same facet create one stored delta',()=>{const d=db();const input=Array.from({length:20000},(_,i)=>event(`id-${i}`,'ad_view'));const r=storeBatch(d,'b2',input);assert.equal(r.groups,1);assert.equal(r.inserted,1);assert.equal(queryStoredCounters(d)[0].views,20000);d.close();});
test('different batches are additive and different ads remain separate',()=>{const d=db();storeBatch(d,'a',[event('1','ad_view'),event('2','ad_skip')]);storeBatch(d,'b',[event('3','ad_view'),event('4','ad_view','B')]);const rows=queryStoredCounters(d);assert.deepEqual(rows.map(x=>[x.ad_id,x.views,x.skips]),[['A',2,1],['B',1,0]]);d.close();});
test('hour-aligned periods use only selected buckets',()=>{const d=db();storeBatch(d,'a',[event('1','ad_view','A',H),event('2','ad_view','A',H*3)]);assert.equal(queryStoredCounters(d,{sinceHour:H*2,untilHour:H*4})[0].views,1);d.close();});
test('partial-hour windows are rejected instead of silently rounded',()=>{const d=db();assert.throws(()=>queryStoredCounters(d,{sinceHour:H+1}),/hour-aligned/);d.close();});
test('dwell average is weighted by valid event count',()=>{const d=db();let a=event('1','ad_skip');a.dwell_ms=1000;let b=event('2','ad_complete');b.dwell_ms=3000;storeBatch(d,'x',[a,b,event('3','ad_view')]);assert.equal(queryStoredCounters(d)[0].avg_dwell_ms,2000);d.close();});
test('producer does not persist event ID or visitor ID in aggregate',()=>{const result=aggregateBatch('b3',[{...event('secret-id','ad_view'),visitor_id:'visitor-private'}]);const serialized=JSON.stringify(result);assert.equal(serialized.includes('secret-id'),false);assert.equal(serialized.includes('visitor-private'),false);});
