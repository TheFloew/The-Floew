/* Offline, mergeable ad-reach sketch. Not a Cloudflare Worker deployment.
 * Exact for <=128 distinct keyed digests; HLL(p=14) thereafter.
 * All time buckets must use the same HMAC secret and keyId for merging.
 */
const EXACT_LIMIT=128, SPARSE_LIMIT=1024, VERSION=1, PRECISION=14;
const REGISTERS=1<<PRECISION, MAX_RANK=65-PRECISION;
const BIT64=(1n<<64n)-1n, HEX='0123456789abcdef';
function digestToHex(bytes){let out='';for(let i=0;i<16;i++)out+=HEX[bytes[i]>>4]+HEX[bytes[i]&15];return out;}
function hexToDigest(hex){if(!/^[0-9a-f]{32}$/.test(hex))throw new Error('Invalid 128-bit digest');const b=new Uint8Array(16);for(let i=0;i<16;i++)b[i]=parseInt(hex.slice(i*2,i*2+2),16);return b;}
function registerFor(hex){
  const bytes=hexToDigest(hex);let bits=0n;
  for(let i=0;i<8;i++)bits=(bits<<8n)|BigInt(bytes[i]);
  const index=Number(bits>>BigInt(64-PRECISION));let tail=(bits<<BigInt(PRECISION))&BIT64,rank=1;
  while(rank<=64-PRECISION&&(tail&(1n<<63n))===0n){rank++;tail=(tail<<1n)&BIT64;}
  return [index,rank];
}
export class ReachSketch{
  constructor(keyId){if(!keyId||typeof keyId!=='string')throw new Error('keyId required');this.keyId=keyId;this.mode='exact';this.exact=new Set();this.sparse=null;this.dense=null;}
  addDigest(digest){if(!(digest instanceof Uint8Array)||digest.length<16)throw new Error('Expected 128-bit HMAC digest');this._addHex(digestToHex(digest));return this;}
  _addHex(hex){
    if(this.mode==='exact'){this.exact.add(hex);if(this.exact.size>EXACT_LIMIT)this._promote();}
    else{const [index,rank]=registerFor(hex);this._set(index,rank);}
  }
  _promote(){
    if(this.mode!=='exact')return;
    const values=this.exact;this.mode='sparse';this.exact=null;this.sparse=new Map();
    for(const hex of values){const [index,rank]=registerFor(hex);this._set(index,rank);}
  }
  _set(index,rank){
    if(this.mode==='sparse'){
      if(rank>(this.sparse.get(index)||0))this.sparse.set(index,rank);
      if(this.sparse.size>SPARSE_LIMIT)this._densify();
    }else if(this.mode==='dense'){if(rank>this.dense[index])this.dense[index]=rank;}
    else throw new Error('Cannot set register in exact mode');
  }
  _densify(){
    if(this.mode!=='sparse')return;
    this.dense=new Uint8Array(REGISTERS);
    for(const [index,rank] of this.sparse)this.dense[index]=rank;
    this.sparse=null;this.mode='dense';
  }
  merge(other){
    if(!(other instanceof ReachSketch)||other.keyId!==this.keyId)throw new Error('Incompatible reach hash keys');
    if(other.mode==='exact'){for(const hex of other.exact)this._addHex(hex);return this;}
    this._promote();
    if(other.mode==='sparse'){for(const [index,rank] of other.sparse)this._set(index,rank);}
    else for(let index=0;index<REGISTERS;index++){const rank=other.dense[index];if(rank)this._set(index,rank);}
    return this;
  }
  estimate(){
    if(this.mode==='exact')return {count:this.exact.size,exact:true,relativeError:0};
    let zeroes=REGISTERS,sum=REGISTERS;
    const consume=rank=>{zeroes--;sum+=Math.pow(2,-rank)-1;};
    if(this.mode==='sparse')for(const rank of this.sparse.values())consume(rank);
    else for(const rank of this.dense)if(rank)consume(rank);
    const alpha=0.7213/(1+1.079/REGISTERS),raw=alpha*REGISTERS*REGISTERS/sum;
    const estimate=raw<=2.5*REGISTERS&&zeroes>0?REGISTERS*Math.log(REGISTERS/zeroes):raw;
    return {count:Math.round(estimate),exact:false,relativeError:1.04/Math.sqrt(REGISTERS)};
  }
  toBytes(){
    const type=this.mode==='exact'?0:this.mode==='sparse'?1:2;
    if(type===2){const out=new Uint8Array(3+REGISTERS);out.set([VERSION,PRECISION,type]);out.set(this.dense,3);return out;}
    const values=type===0?[...this.exact].sort():[...this.sparse].sort(([a],[b])=>a-b);
    const width=type===0?16:3,out=new Uint8Array(5+values.length*width);
    out.set([VERSION,PRECISION,type,values.length>>8,values.length&255]);let pos=5;
    for(const value of values){
      if(type===0){out.set(hexToDigest(value),pos);pos+=16;}
      else{const [index,rank]=value;out.set([index>>8,index&255,rank],pos);pos+=3;}
    }
    return out;
  }
  static fromBytes(data,keyId){
    if(!data||!(data instanceof Uint8Array)||data.length<3)throw new Error('Invalid reach sketch');
    if(data[0]!==VERSION||data[1]!==PRECISION)throw new Error('Unsupported reach sketch version or precision');
    const type=data[2],sketch=new ReachSketch(keyId);
    if(type===2){
      if(data.length!==3+REGISTERS)throw new Error('Invalid dense sketch length');
      sketch.mode='dense';sketch.exact=null;sketch.dense=Uint8Array.from(data.subarray(3));
      for(const rank of sketch.dense)if(rank>MAX_RANK)throw new Error('Invalid HLL register');
      return sketch;
    }
    if(type!==0&&type!==1||data.length<5)throw new Error('Invalid sketch encoding');
    const n=data[3]*256+data[4],width=type===0?16:3;
    if(data.length!==5+n*width)throw new Error('Invalid sparse/exact sketch length');
    if(type===0&&n>EXACT_LIMIT||type===1&&n>SPARSE_LIMIT)throw new Error('Oversized sketch encoding');
    if(type===1){sketch.mode='sparse';sketch.exact=null;sketch.sparse=new Map();}
    for(let i=0,pos=5;i<n;i++,pos+=width){
      if(type===0){
        const hex=digestToHex(data.subarray(pos,pos+16));
        if(sketch.exact.has(hex))throw new Error('Duplicate exact digest');
        sketch.exact.add(hex);
      }else{
        const index=data[pos]*256+data[pos+1],rank=data[pos+2];
        if(index>=REGISTERS||rank<1||rank>MAX_RANK||sketch.sparse.has(index))throw new Error('Invalid sparse register');
        sketch.sparse.set(index,rank);
      }
    }
    return sketch;
  }
}
export const REACH_SKETCH_CONFIG=Object.freeze({precision:PRECISION,exactLimit:EXACT_LIMIT,sparseLimit:SPARSE_LIMIT,denseBytes:3+REGISTERS,standardError:1.04/Math.sqrt(REGISTERS)});
