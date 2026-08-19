import { readdir, mkdir, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const layouts=["hor","ver"];
await mkdir("data",{recursive:true});

for(const layout of layouts){
  const dir=`ads/${layout}`;
  let names=[];
  try{
    names=(await readdir(dir,{withFileTypes:true}))
      .filter(entry=>entry.isFile())
      .map(entry=>entry.name)
      .filter(name=>[".mp4",".jpg",".jpeg"].includes(extname(name).toLowerCase()))
      .sort((a,b)=>a.localeCompare(b,"tr"));
  }catch(error){
    if(error?.code!=="ENOENT")throw error;
  }

  const ads=names.map(name=>({
    name,
    url:`ads/${layout}/${name}`,
    layout
  }));

  const payload={ok:true,layout,count:ads.length,ads};
  await writeFile(
    `data/ads-${layout}.json`,
    `${JSON.stringify(payload,null,2)}\n`,
    "utf8"
  );
}
