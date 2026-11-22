/* Flöra başlangıç tahmini. Yalnız başlıktan anonim, yerel hesaplama. */
(function(root){
  "use strict";
  const STOP=new Set([
    "bir","bu","şu","ve","veya","ile","için","gibi","göre","daha",
    "çok","son","dakika","yeni","ilk","tüm","her","artık","olan",
    "olarak","oldu","olacak","olduğu","olduğunu","olabilir",
    "hakkında","sonra","önce","kadar","ancak","işte","neden",
    "nasıl","hangi","kim","ne","nerede","zaman","gün","bugün",
    "yarın","dün","haber","haberi","haberleri","açıklama",
    "açıkladı","açıklandı","belli","ortaya","çıktı","geldi",
    "devam","ediyor","etti","eden","ettiği","iddia","iddiası",
    "şimdi","tarih","tarihi","olay","içinde","üzerine","büyük",
    "küçük","var","yok","the","and","for","with","from","this",
    "that","after","before","about","over","into","says","said",
    "will","are","was","were","has","have","its","you"
  ]);
  const round=value=>Math.round(value*10)/10;

  function headlineTerms(text){
    const words=String(text||"")
      .toLocaleLowerCase("tr-TR")
      .match(/[\p{L}]+/gu)||[];
    const filtered=words
      .filter(word=>word.length>=3 && word.length<=30 && !STOP.has(word))
      .slice(0,20);
    const terms=[];
    for(let i=0;i<filtered.length;i++){
      terms.push(filtered[i]);
      if(i+1<filtered.length){
        terms.push(filtered[i]+" "+filtered[i+1]);
      }
    }
    return [...new Set(terms)];
  }

  function build(rows,{minViews=3,maxTerms=1800}={}){
    const clean=(Array.isArray(rows)?rows:[])
      .filter(row=>row && String(row.title||"").trim())
      .map(row=>({
        title:String(row.title),
        views:Number(row.views),
        score:Number(row.flora)
      }))
      .filter(row=>Number.isFinite(row.views) && row.views>=minViews
        && Number.isFinite(row.score) && row.score>=0 && row.score<=100);

    let weightSum=0, scoreSum=0;
    for(const row of clean){
      const weight=Math.min(4,Math.max(1,Math.log2(row.views+1)));
      weightSum+=weight;
      scoreSum+=weight*row.score;
    }
    const baseline=weightSum?scoreSum/weightSum:0;
    const counts=new Map();
    for(const row of clean){
      const weight=Math.min(4,Math.max(1,Math.log2(row.views+1)));
      for(const term of headlineTerms(row.title)){
        const entry=counts.get(term)||{n:0,sum:0,weight:0};
        entry.n++;
        entry.sum+=weight*row.score;
        entry.weight+=weight;
        counts.set(term,entry);
      }
    }
    const terms=[...counts.entries()]
      .filter(([term,data])=>data.n>=(term.includes(" ")?2:3))
      .sort((a,b)=>b[1].n-a[1].n || a[0].localeCompare(b[0],"tr"))
      .slice(0,maxTerms)
      .map(([term,data])=>[
        term,
        round(baseline+(data.sum/data.weight-baseline)*data.n/(data.n+3)),
        data.n
      ]);
    return {
      version:1,generatedAt:Date.now(),
      sampleStories:clean.length,baseline:round(baseline),terms
    };
  }

  const indexed=new WeakMap();
  function estimate(title,model){
    if(!model || model.version!==1
      || !Number.isFinite(Number(model.baseline))
      || Number(model.sampleStories)<12
      || !Array.isArray(model.terms))return null;

    let dictionary=indexed.get(model);
    if(!dictionary){
      dictionary=new Map(model.terms
        .filter(row=>Array.isArray(row) && row.length>=3)
        .map(row=>[row[0],{score:Number(row[1]),count:Number(row[2])}]));
      indexed.set(model,dictionary);
    }
    const baseline=Number(model.baseline);
    let total=0,delta=0,matched=0;
    for(const term of headlineTerms(title)){
      const entry=dictionary.get(term);
      if(!entry || !Number.isFinite(entry.score) || entry.count<2)continue;
      const weight=(term.includes(" ")?1.8:1)
        *Math.min(1,Math.sqrt(entry.count)/3);
      delta+=(entry.score-baseline)*weight;
      total+=weight;
      matched++;
    }
    const confidence=total/(total+2);
    const score=Math.max(0,Math.min(100,
      baseline+(total?delta/total:0)*confidence));
    return {score:round(score),estimated:true,matchedTerms:matched};
  }

  root.FloewFloraPredictor=Object.freeze({headlineTerms,build,estimate});
})(typeof globalThis!=="undefined"?globalThis:this);
