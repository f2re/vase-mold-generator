export const STL_DEFAULTS=Object.freeze({detail:'standard',chordTolerance:.03,kind:'box',footprint:'hull',units:'mm',scale:1,rx:0,ry:0,rz:0,clearance:10,wall:3,base:4,headroom:8,padding:10,splitAxis:'x',splitPercent:50,keyDiameter:5,keyLength:3,keyClearance:.25,sprueDiameter:8,ventDiameter:2,sprueX:null,sprueY:null,vents:[],printerX:180,printerY:180,printerZ:180,xyMargin:2,zMargin:5});
export const STL_RANGES=Object.freeze({scale:[.001,1000],rx:[-360,360],ry:[-360,360],rz:[-360,360],clearance:[3,60],wall:[2,10],base:[3,15],headroom:[3,60],padding:[8,60],splitPercent:[10,90],keyDiameter:[3,8],keyLength:[2,5],keyClearance:[.1,.6],sprueDiameter:[2,25],ventDiameter:[1,6],printerX:[80,1000],printerY:[80,1000],printerZ:[80,1000],xyMargin:[0,15],zMargin:[0,20],chordTolerance:[.005,.2]});
export const BOX_KEYS=['footprint','clearance','wall','base','headroom'];
export const NEGATIVE_KEYS=['padding','splitAxis','splitPercent','keyDiameter','keyLength','keyClearance','sprueDiameter','ventDiameter','sprueX','sprueY','vents'];
export function validateSTLSettings(raw,{activeOnly=false}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Параметры STL должны быть объектом.');
 const p={...STL_DEFAULTS};for(const key of Object.keys(p))if(Object.hasOwn(raw,key))p[key]=raw[key];
 if(activeOnly)for(const key of p.kind==='box'?NEGATIVE_KEYS:BOX_KEYS)p[key]=STL_DEFAULTS[key];
 const error=(key,text)=>{const e=new Error(text);e.field=key;throw e;};
 for(const [key,[lo,hi]]of Object.entries(STL_RANGES))if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<lo||p[key]>hi)error(key,`Недопустимое значение: от ${lo} до ${hi}.`);
 const choices={kind:['box','negative'],footprint:['hull','rectangle'],units:['mm','cm','inch'],splitAxis:['x','y','z'],detail:['draft','standard','fine','custom']};
 for(const [key,values]of Object.entries(choices))if(!values.includes(p[key]))error(key,`Некорректный параметр ${key}.`);
 const validPoint=v=>Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1000);
 if((p.sprueX===null)!==(p.sprueY===null)||(p.sprueX!==null&&!validPoint([p.sprueX,p.sprueY])))error('sprueX','Укажите обе координаты литника в пределах ±1000 мм либо выберите «Авто».');
 if(!Array.isArray(p.vents)||p.vents.length>8||p.vents.some(v=>!validPoint(v)))error('vents','Допустимо до восьми точек отдушин.');
 if(new Set(p.vents.map(v=>v.join(','))).size!==p.vents.length)error('vents','Повторные точки отдушин. Удалите дубли.');
 if(p.keyDiameter+2>p.padding)error('padding','Увеличьте припуск: штифты не помещаются в поле разъёма.');
 p.vents=p.vents.map(v=>[...v]);return p;
}
