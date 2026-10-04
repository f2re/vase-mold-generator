import {normal,projectJSON,VERSION} from './geometry.js';
export function stl(part){
  const m=part.mesh,buffer=new ArrayBuffer(84+50*m.length),view=new DataView(buffer),bytes=new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode(`Vase Mold Generator ${VERSION}; mm; ${part.id}`).slice(0,80));view.setUint32(80,m.length,true);let off=84;
  for(const t of m){const points=[normal(t),...t.map(p=>p.map((v,i)=>v-part.bounds.min[i]))];for(const q of points)for(const x of q){view.setFloat32(off,x,true);off+=4;}view.setUint16(off,0,true);off+=2;}return bytes;
}
export function fingerprint(bytes){let h=2166136261;for(const x of bytes){h^=x;h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
export function kit(model,{samples=false}={}){
  const selected=model.parts.filter(p=>samples?p.sample:p.printable);
  if(!samples&&!model.stats.allFit)throw new Error('Не все детали помещаются в заданную область печати.');
  const manifest={version:VERSION,units:'mm',parameters:model.p,notes:'STL перенесены к началу координат для печати. assemblyTranslation возвращает их в сборку. Раскладка в 3D не является раскладкой по столам.',parts:[]};
  const files=selected.map(p=>{const data=stl(p);manifest.parts.push({id:p.id,label:p.label,file:p.filename,size:p.bounds.size,assemblyTranslation:p.bounds.min,triangles:p.mesh.length,fnv1a32:fingerprint(data)});return {name:p.filename,data};});
  files.push({name:'parameters.json',data:JSON.stringify(projectJSON(model.p),null,2)},{name:'manifest.json',data:JSON.stringify(manifest,null,2)},{name:'READ_BEFORE_PRINT.txt',data:'Опытная оснастка. Физическая заливка не проверена.\nСначала напечатайте пробу защёлки. Проверьте посадку, стыки и герметичность.\nГлухое дно защёлкивается на втулке. Верхняя плашка должна быть закреплена от подъёма.\nМастер-модель и объёмы силикона не входят в рабочий комплект.\nНе используйте режим вазы в слайсере. Единицы STL: миллиметры.\nПодробный порядок двух заливок и ограничения находятся в README и docs/ENGINEERING.md проекта.\n'});
  return makeZip(files);
}
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes){
    c^=b;
    for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function u16(a,n){a.push(n&255,(n>>>8)&255)}
function u32(a,n){a.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255)}
export function makeZip(files){
  const enc=new TextEncoder(), out=[], central=[]; let offset=0;
  for(const f of files){
    const name=enc.encode(f.name); const data=f.data instanceof Uint8Array?f.data:enc.encode(String(f.data)); const crc=crc32(data);
    const local=[]; u32(local,0x04034b50);u16(local,20);u16(local,0x800);u16(local,0);u16(local,0);u16(local,0);u32(local,crc);u32(local,data.length);u32(local,data.length);u16(local,name.length);u16(local,0);
    out.push(new Uint8Array(local),name,data);
    const cen=[];u32(cen,0x02014b50);u16(cen,20);u16(cen,20);u16(cen,0x800);u16(cen,0);u16(cen,0);u16(cen,0);u32(cen,crc);u32(cen,data.length);u32(cen,data.length);u16(cen,name.length);u16(cen,0);u16(cen,0);u16(cen,0);u16(cen,0);u32(cen,0);u32(cen,offset);
    central.push(new Uint8Array(cen),name);
    offset += local.length + name.length + data.length;
  }
  const centralOffset=offset; let centralSize=0; for(const x of central) centralSize+=x.length;
  const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,files.length);u16(end,files.length);u32(end,centralSize);u32(end,centralOffset);u16(end,0);
  const total=out.reduce((s,x)=>s+x.length,0)+centralSize+end.length;
  const zip=new Uint8Array(total); let pos=0;
  for(const x of out){zip.set(x,pos);pos+=x.length} for(const x of central){zip.set(x,pos);pos+=x.length} zip.set(new Uint8Array(end),pos);
  return zip;
}
