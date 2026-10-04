/* Browser import/transform only. Topology and CSG are validated again locally by Python. */
import {bounds} from './geometry.js';
export const MAX_STL_BYTES=15*1024*1024;
export const MAX_STL_TRIANGLES=100000;
export function parseSTL(input){
  const buffer=input instanceof ArrayBuffer?input:input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength);
  if(buffer.byteLength>MAX_STL_BYTES)throw new Error('STL больше 15 МиБ. Упростите сетку перед загрузкой.');
  const data=new DataView(buffer),mesh=[];
  const n=buffer.byteLength>=84?data.getUint32(80,true):0;
  if(buffer.byteLength>=84&&84+50*n===buffer.byteLength){
    if(!n||n>MAX_STL_TRIANGLES)throw new Error('Допустимо до 100 000 треугольников.');
    for(let i=0;i<n;i++){const tri=[];for(let j=0;j<3;j++){const p=[];for(let k=0;k<3;k++)p.push(data.getFloat32(84+50*i+12+j*12+k*4,true));tri.push(p);}mesh.push(tri);}
  }else{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    if(!text.trimStart().toLowerCase().startsWith('solid'))throw new Error('STL не распознан или обрезан.');
    const cleaned=text.replace(/^\s*(?:end)?solid[^\r\n]*(?:\r?\n|$)/gim,'');
    const num='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
    const vec=`(${num})\\s+(${num})\\s+(${num})`;
    const re=new RegExp(`facet\\s+normal\\s+${vec}\\s+outer\\s+loop\\s+vertex\\s+${vec}\\s+vertex\\s+${vec}\\s+vertex\\s+${vec}\\s+endloop\\s+endfacet`,'gi');
    let match,pos=0;
    while((match=re.exec(cleaned))){
      if(cleaned.slice(pos,match.index).trim())throw new Error('Повреждён синтаксис ASCII STL.');
      const v=match.slice(4).map(Number);mesh.push([v.slice(0,3),v.slice(3,6),v.slice(6,9)]);pos=re.lastIndex;
      if(mesh.length>MAX_STL_TRIANGLES)throw new Error('В STL больше 100 000 треугольников.');
    }
    if(cleaned.slice(pos).trim()||mesh.length<1)throw new Error('ASCII STL обрезан или не содержит граней.');
  }
  for(const t of mesh)for(const v of t)if(!v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e7))throw new Error('В STL некорректные координаты.');
  if(mesh.length<4)throw new Error('В STL меньше четырёх граней.');
  return mesh;
}
export function transformSTL(mesh,p){
  const factor=({mm:1,cm:10,inch:25.4})[p.units]*p.scale;
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Задайте положительный масштаб.');
  const angles=[p.rx,p.ry,p.rz].map(x=>x*Math.PI/180),c=angles.map(Math.cos),s=angles.map(Math.sin);
  let out=mesh.map(t=>t.map(v=>{
    let [x,y,z]=v.map(x=>x*factor);
    [y,z]=[y*c[0]-z*s[0],y*s[0]+z*c[0]];[x,z]=[x*c[1]+z*s[1],-x*s[1]+z*c[1]];[x,y]=[x*c[2]-y*s[2],x*s[2]+y*c[2]];
    return [x,y,z];
  }));
  const b=bounds(out),shift=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,b.min[2]];
  out=out.map(t=>t.map(v=>v.map((x,i)=>Math.round((x-shift[i])*1e5)/1e5)));
  const size=bounds(out).size;
  if(size.some(x=>!Number.isFinite(x)||x<.1||x>800))throw new Error('Проверьте единицы и масштаб: размеры должны быть от 0,1 до 800 мм.');
  return out;
}
export function toBase64(buffer){let text='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
export function fromBase64(text){if(typeof text!=='string'||text.length>22*1024*1024)throw new Error('Файл проекта слишком большой.');const bin=atob(text);return Uint8Array.from(bin,c=>c.charCodeAt(0)).buffer;}
