/* Parametric polar boundary meshes. Millimetres; Z is up.
 * Every printable part and its preview share this exact triangle array.
 * No boolean concatenation of overlapping solids is used. */
export const VERSION = '0.3.0';
export const DEFAULTS = Object.freeze({
  masterOuterD:150, masterInnerD:100, masterHeight:270, masterBottom:10,
  siliconeOuter:10, siliconeInner:10, siliconeBottom:10, siliconeBridge:5,
  shellWall:3, coreWall:3, baseThickness:5, lidThickness:5,
  fitClearance:0.25, snapDeflection:0.3, siliconeDensity:1.1,
  printerX:180, printerY:180, printerZ:180, xyMargin:2, zMargin:10,
  autoSplit:true, segments:128
});
export const LIMITS = {
  masterOuterD:[30,700],masterInnerD:[16,660],masterHeight:[35,800],masterBottom:[2,100],
  siliconeOuter:[3,50],siliconeInner:[5,40],siliconeBottom:[3,50],siliconeBridge:[3,25],
  shellWall:[2,8],coreWall:[2,8],baseThickness:[3,15],lidThickness:[3,12],
  fitClearance:[0.15,0.6],snapDeflection:[0.1,0.45],siliconeDensity:[0.8,1.6],
  printerX:[80,1000],printerY:[80,1000],printerZ:[80,1000],xyMargin:[0,15],zMargin:[0,20],segments:[64,256]
};
export const GROUPS = ['Наружная опалубка','Основание','Внутренняя втулка','Верхняя плашка','Проба защёлки','Контрольные модели'];
export const COLORS = Object.freeze({shell:'#668195',base:'#b79b72',core:'#719063',lid:'#597d59',sample:'#a89376',master:'#46a4a2',silicone:'#d997ab'});
const TAU=Math.PI*2, EPS=1e-7;
const point=(r,a,z)=>[r*Math.cos(a),r*Math.sin(a),z];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function normal(t){const n=cross(sub(t[1],t[0]),sub(t[2],t[0]));const l=Math.hypot(...n);return l?n.map(v=>v/l):[0,0,0];}
function tri(out,a,b,c){if(Math.hypot(...cross(sub(b,a),sub(c,a)))>1e-9)out.push([a,b,c]);}
function quad(out,a,b,c,d){tri(out,a,b,c);tri(out,a,c,d);}
export function bounds(mesh){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const t of mesh)for(const p of t)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max,size:min.map((v,i)=>max[i]-v)};}
export function translate(mesh,v){return mesh.map(t=>t.map(p=>p.map((x,i)=>x+v[i])));}
export function volume(mesh){let sum=0;for(const [a,b,c]of mesh){const n=cross(b,c);sum+=a[0]*n[0]+a[1]*n[1]+a[2]*n[2];}return sum/6;}
/** Revolve a closed R-Z polygon. Input winding is normalised, pole faces are welded by coordinates. */
export function revolve(profile,n=128,a0=0,span=TAU){
  let area=0;for(let i=0;i<profile.length;i++){const a=profile[i],b=profile[(i+1)%profile.length];area+=a[0]*b[1]-b[0]*a[1];}
  const poly=area>0?profile:[...profile].reverse();
  const m=[],full=Math.abs(span-TAU)<EPS,steps=Math.max(4,Math.round(n*span/TAU));
  for(let i=0;i<steps;i++)for(let j=0;j<poly.length;j++){
    const a=a0+span*i/steps,b=a0+span*(i+1)/steps,[r0,z0]=poly[j],[r1,z1]=poly[(j+1)%poly.length];
    quad(m,point(r0,a,z0),point(r0,b,z0),point(r1,b,z1),point(r1,a,z1));
  }
  if(!full){
    const indices=triangulate(poly);
    for(const [i,j,k]of indices){tri(m,point(...[poly[i][0],a0,poly[i][1]]),point(poly[j][0],a0,poly[j][1]),point(poly[k][0],a0,poly[k][1]));tri(m,point(poly[k][0],a0+span,poly[k][1]),point(poly[j][0],a0+span,poly[j][1]),point(poly[i][0],a0+span,poly[i][1]));}
  }
  return m;
}
// Ear clipping is only used on small, simple cross sections at sector ends.
function triangulate(poly){const ids=poly.map((_,i)=>i),out=[];const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);let guard=0;
  while(ids.length>3){let found=false;for(let i=0;i<ids.length;i++){const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length];if(turn(poly[a],poly[b],poly[c])<=EPS)continue;const inside=ids.some(k=>k!==a&&k!==b&&k!==c&&turn(poly[a],poly[b],poly[k])>=-EPS&&turn(poly[b],poly[c],poly[k])>=-EPS&&turn(poly[c],poly[a],poly[k])>=-EPS);if(inside)continue;out.push([a,b,c]);ids.splice(i,1);found=true;break;}if(!found||++guard>100)throw new Error('Не удалось замкнуть торец детали.');}out.push(ids);return out;
}
const ring=(ri,ro,z0,z1,n,a=0,span=TAU)=>revolve([[ri,z0],[ro,z0],[ro,z1],[ri,z1]],n,a,span);
/** Boundary-only meshing of a polar cell solid, with optional lofted ring radii.
 * Faces between occupied cells are omitted; clips and perforated plates are one solid. */
function polarSolid(rings,zs,n,inside,radiusAt=null){const nr=rings.length-1,nz=zs.length-1,m=[];
  const has=(r,z,a)=>r>=0&&r<nr&&z>=0&&z<nz&&inside(r,z,((a%n)+n)%n);
  const v=(r,z,a)=>point(radiusAt?radiusAt(r,z):rings[r],TAU*((a%n+n)%n)/n,zs[z]);
  for(let z=0;z<nz;z++)for(let r=0;r<nr;r++)for(let a=0;a<n;a++)if(has(r,z,a)){
    const A=v(r,z,a),B=v(r+1,z,a),C=v(r+1,z,a+1),D=v(r,z,a+1),E=v(r,z+1,a),F=v(r+1,z+1,a),G=v(r+1,z+1,a+1),H=v(r,z+1,a+1);
    if(!has(r,z-1,a))quad(m,D,C,B,A);if(!has(r,z+1,a))quad(m,E,F,G,H);
    if(!has(r-1,z,a))quad(m,D,A,E,H);if(!has(r+1,z,a))quad(m,B,C,G,F);
    if(!has(r,z,a-1))quad(m,A,B,F,E);if(!has(r,z,a+1))quad(m,C,D,H,G);
  }return m;
}
export function validate(input={}){if(!input||typeof input!=='object'||Array.isArray(input))return {p:{...DEFAULTS},errors:['Ожидается объект параметров.'],fields:{masterOuterD:'Ожидается объект параметров.'}};const p={...DEFAULTS};const errors=[],fields={};
  for(const [key,[min,max]]of Object.entries(LIMITS)){const v=Object.hasOwn(input,key)?input[key]:DEFAULTS[key];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max){fields[key]=`Допустимо от ${min} до ${max}.`;errors.push(`${key}: ${fields[key]}`);}else p[key]=v;}
  if('autoSplit'in input&&typeof input.autoSplit!=='boolean'){fields.autoSplit='Нужно логическое значение.';errors.push('Некорректный параметр разбиения.');}else p.autoSplit=input.autoSplit??DEFAULTS.autoSplit;
  const fail=(key,msg)=>{fields[key]=msg;errors.push(msg);};
  if(p.masterInnerD>=p.masterOuterD-2)fail('masterInnerD','Внутренний диаметр должен быть минимум на 2 мм меньше наружного.');
  if(p.masterBottom+p.siliconeBottom+24>=p.masterHeight)fail('masterHeight','Недостаточно высоты для дна, силикона и соединения втулки.');
  if(p.masterInnerD/2-p.siliconeInner-p.coreWall<5)fail('siliconeInner','Для полой втулки не осталось места. Уменьшите внутренний силикон или стенку втулки.');
  if(!Number.isInteger(p.segments)||p.segments%8)fail('segments','Число сегментов должно быть кратно 8.');
  return {p,errors,fields};
}
export function derive(p){const ro=p.masterOuterD/2,ri=p.masterInnerD/2,so=ro+p.siliconeOuter+p.shellWall,si=ro+p.siliconeOuter,co=ri-p.siliconeInner,ci=co-p.coreWall;
  const base=p.baseThickness,lip=base+p.masterHeight,roof=lip+p.siliconeBridge,plateTop=roof+p.lidThickness,coreBottom=base+p.masterBottom+p.siliconeBottom;
  const safe=[p.printerX-2*p.xyMargin,p.printerY-2*p.xyMargin,p.printerZ-p.zMargin];
  const sectors=p.autoSplit&&(so*2>Math.min(...safe.slice(0,2))+EPS)?4:2;
  const flatSectors=p.autoSplit&&(so*2>Math.min(...safe.slice(0,2))+EPS)?4:1;
  const shellTiers=p.autoSplit?Math.ceil((roof-base)/(safe[2]-6)):1,coreTiers=p.autoSplit?Math.ceil((plateTop-coreBottom-3)/(safe[2]-10)):1;
  return {ro,ri,so,si,co,ci,base,lip,roof,plateTop,coreBottom,safe,sectors,flatSectors,shellTiers,coreTiers};
}
function bottom(d,p){const {ci,co}=d,c=p.fitClearance,def=p.snapDeflection,rs=[0,ci-1.6,ci-c,co],zs=[0,3,8,9.5,11,13];
  const head=[ci-c,ci-c,ci-c,ci+def,ci+def,ci-c];
  return polarSolid(rs,zs,p.segments,(r,z,a)=>z===0||(r===1&&(a%(p.segments/4))<p.segments/16),(r,z)=>r===2?head[z]:rs[r]);
}
function coreProfile(d,p,L,first,last){const {ci,co}=d,c=p.fitClearance;
  const outer=[[co,0],[co,L]];
  let end;if(last){outer.push([co+3,L],[co+3,L+2.5],[ci,L+2.5]);end=[[ci,0]];}
  else{const s=ci-c;outer.push([s,L],[s,L+8],[s-1.6,L+8],[s-1.6,L-3],[ci,L-3]);end=[[ci,0]];}
  if(first){end=[[ci,10.5],[ci+p.snapDeflection+c,10.5],[ci+p.snapDeflection+c,5],[ci,5],[ci,0]];}
  return [...outer,...end];
}
function plate(d,p){const hole=d.co+p.fitClearance,a=hole+1.5,b=d.ri-1.5;if(b<=a)throw new Error('Недостаточная ширина окон верхней плашки.');
  const rs=[hole,a,b,d.si-2,d.si-p.fitClearance,d.si,d.so].filter((r,i,v)=>!i||r>v[i-1]+EPS);
  const n=p.segments,windowBand=1;
  return polarSolid(rs,[0,p.lidThickness],n,(r,z,t)=>!(r===windowBand&&(t%(n/4))>=n/16&&(t%(n/4))<3*n/16));
}
function splitPlate(d,p,count){if(count===1)return [plate(d,p)];
  // Split the same polar grid at sector boundaries, keeping windows and closing all cut faces.
  const hole=d.co+p.fitClearance,a=hole+1.5,b=d.ri-1.5,rs=[hole,a,b,d.si,d.so];const n=p.segments;
  return Array.from({length:count},(_,i)=>polarSolid(rs,[0,p.lidThickness],n,(r,z,t)=>Math.floor(t/(n/count))===i&&!(r===1&&(t%(n/4))>=n/16&&(t%(n/4))<3*n/16)));
}
export function generate(input={}){const v=validate(input);if(v.errors.length){const e=new Error(v.errors.join('\n'));e.fields=v.fields;throw e;}
  const p=v.p,d=derive(p),parts=[],warn=[];const n=p.segments;
  const add=(id,label,type,mesh,position=[0,0,0],extra={})=>{mesh=translate(mesh,position);const b=bounds(mesh),printable=!['master','silicone'].includes(type)&&!id.startsWith('test-');const fit=b.size.every((x,i)=>x<=d.safe[i]+EPS);
    parts.push({id,label,type,color:COLORS[type],mesh,bounds:b,printable,sample:id.startsWith('test-'),fits:fit,filename:`${id}.stl`,...extra});};
  const sh=(d.roof-d.base)/d.shellTiers;
  for(let t=0;t<d.shellTiers;t++)for(let s=0;s<d.sectors;s++){
    const mid=(d.si+d.so)/2,first=t===0,last=t===d.shellTiers-1,c=p.fitClearance;
    let prof=[[d.si,0],[d.so,0],[d.so,sh],[d.si,sh]];
    if(!last)prof=[[d.si,0],[d.so,0],[d.so,sh],[mid-c/2,sh],[mid-c/2,sh+6],[d.si,sh+6]];
    if(!first){prof[0]=[mid+c/2,0];prof.push([d.si,6],[mid+c/2,6]);}
    const a=s*TAU/d.sectors;
    add(`shell-${t+1}-${s+1}`,`Стенка ${t+1}.${s+1}`,'shell',revolve(prof,n,a,TAU/d.sectors),[0,0,d.base+t*sh],{tier:t,sector:s,angle:a+Math.PI/d.sectors,group:GROUPS[0],note:'Ступенчатый стык ярусов. Вертикальные стыки стянуть снаружи; все швы герметизировать.'});
  }
  for(let i=0;i<d.flatSectors;i++)add(`base-${i+1}`,d.flatSectors===1?'Основание':`Основание ${i+1}`,'base',ring(0,d.so,0,d.base,n,TAU*i/d.flatSectors,TAU/d.flatSectors),[0,0,0],{angle:TAU*(i+.5)/d.flatSectors,group:GROUPS[1],note:'Плоская опорная плита. Мастер-модель стоит настоящим дном вниз. Разъёмы герметизировать снаружи.'});
  const L=(d.plateTop-d.coreBottom-3)/d.coreTiers;
  for(let i=0;i<d.coreTiers;i++)add(`core-${i+1}`,`Втулка ${i+1} из ${d.coreTiers}`,'core',revolve(coreProfile(d,p,L,i===0,i===d.coreTiers-1),n),[0,0,d.coreBottom+3+i*L],{tier:i,group:GROUPS[2],note:i===0?'Нижняя секция с гнездом защёлок дна. Сверху внутренний соединительный поясок.':'Секция принимает поясок снизу. Верхний буртик удерживает втулку на плашке.'});
  add('core-bottom','Глухое дно с защёлками','core',bottom(d,p),[0,0,d.coreBottom],{group:GROUPS[2],note:'Четыре упругих лепестка с заходным скосом. Сквозного отверстия нет: силикон не должен затекать внутрь.'});
  add('core-cap','Крышка полости втулки','core',revolve([[0,0],[d.ci-p.fitClearance,0],[d.ci-p.fitClearance,3],[d.co+3,3],[d.co+3,6],[0,6]],n),[0,0,d.plateTop-.5],{group:GROUPS[2],note:'Съёмная крышка сверху закрывает пустую полость втулки. Это не дно вазы и не силикон.'});
  splitPlate(d,p,d.flatSectors).forEach((m,i)=>add(`plate-${i+1}`,d.flatSectors===1?'Верхняя плашка':`Верхняя плашка ${i+1}`,'lid',m,[0,0,d.roof],{angle:TAU*(i+.5)/d.flatSectors,group:GROUPS[3],note:'Широкая плашка во весь диаметр опалубки. Четыре окна: заливка через одно, остальные открытыми для воздуха. Закрепить плашку от подъёма.'}));
  add('test-socket','Проба: гнездо','sample',revolve(coreProfile(d,p,18,true,true),n),[d.so+55,0,3],{group:GROUPS[4],note:'Проверка защёлки при том же диаметре и зазоре, что у рабочей втулки.'});
  add('test-bottom','Проба: дно','sample',bottom(d,p),[d.so+55,0,0],{group:GROUPS[4],note:'Печатать вместе с пробным гнездом перед комплектом. Физическая посадка не проверена.'});
  add('master','Мастер-модель вазы','master',revolve([[0,0],[d.ro,0],[d.ro,p.masterHeight],[d.ri,p.masterHeight],[d.ri,p.masterBottom],[0,p.masterBottom]],n),[0,0,d.base],{group:GROUPS[5],note:'Контрольная модель. Не включается в архив оснастки. Можно выгрузить отдельно.'});
  add('silicone-outer','Силикон: наружный слой','silicone',ring(d.ro,d.si,d.base,d.lip,n),[0,0,0],{group:GROUPS[5],stage:1,note:'Первая заливка вокруг вазы до уровня её кромки.'});
  add('silicone-inner','Силикон: внутри и над кромкой','silicone',revolve([[0,d.base+p.masterBottom],[d.ri,d.base+p.masterBottom],[d.ri,d.lip],[d.si,d.lip],[d.si,d.roof],[d.co,d.roof],[d.co,d.coreBottom],[0,d.coreBottom]],n),[0,0,0],{group:GROUPS[5],stage:2,note:'Вторая заливка: внутреннее дно, стенки и перемычка над кромкой. Сцепление слоёв зависит от силикона.'});
  const bad=parts.filter(x=>x.printable&&!x.fits);if(bad.length)warn.push(`${bad.length} дет. не помещаются с заданными полями. Выгрузка комплекта заблокирована: увеличьте область печати или уменьшите размеры.`);
  if(d.flatSectors>1)warn.push('Основание и плашка разделены. Стыки нужны герметичные; половины не фиксируются сами.');
  if(p.fitClearance<=.2)warn.push('Малый зазор: обязательно проверьте пробную защёлку.');
  const outer=Math.PI*(d.si*d.si-d.ro*d.ro)*p.masterHeight/1000;
  const inner=(Math.PI*d.ri*d.ri*p.siliconeBottom+Math.PI*(d.ri*d.ri-d.co*d.co)*(p.masterHeight-p.masterBottom-p.siliconeBottom)+Math.PI*(d.si*d.si-d.co*d.co)*p.siliconeBridge)/1000;
  return {version:VERSION,p,d,parts,warnings:warn,stats:{outerMl:outer,innerMl:inner,totalMl:outer+inner,massG:(outer+inner)*p.siliconeDensity,printCount:parts.filter(x=>x.printable).length,allFit:bad.length===0}};
}
export function checkMesh(mesh){const edges=new Map();let degenerate=0,finite=true;const key=p=>p.map(x=>Math.round(x*1e6)).join(',');
  for(const t of mesh){if(!t.flat().every(Number.isFinite))finite=false;if(Math.hypot(...normal(t))<.5)degenerate++;for(let i=0;i<3;i++){const a=key(t[i]),b=key(t[(i+1)%3]),k=a<b?`${a}|${b}`:`${b}|${a}`,e=edges.get(k)||{n:0,w:0};e.n++;e.w+=a<b?1:-1;edges.set(k,e);}}
  const open=[...edges.values()].filter(e=>e.n!==2).length,winding=[...edges.values()].filter(e=>e.w!==0).length;
  return {finite,degenerate,open,winding,volume:volume(mesh),watertight:finite&&!degenerate&&!open&&!winding};
}
export function projectJSON(p){return {format:'vase-mold-generator',version:VERSION,units:'mm',parameters:p};}
export function parseProject(text){if(text.length>100000)throw new Error('Файл параметров слишком большой (максимум 100 КБ).');let raw;try{raw=JSON.parse(text);}catch{throw new Error('Файл не содержит корректный JSON.');}if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Ожидается объект параметров.');if(raw.format&&raw.format!=='vase-mold-generator')throw new Error('Это не проект генератора опалубки.');if(raw.units&&raw.units!=='mm')throw new Error('Проект должен хранить размеры в миллиметрах.');const source=raw.parameters??raw;if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('Параметры должны быть объектом.');const keys=Object.keys(DEFAULTS);if(!keys.some(k=>Object.hasOwn(source,k)))throw new Error('В файле нет размеров вазы.');const cleaned={};for(const k of keys)if(Object.hasOwn(source,k))cleaned[k]=source[k];const c=validate(cleaned);if(c.errors.length)throw new Error(c.errors.join(' '));return c.p;}
