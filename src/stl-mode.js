import {bounds} from './geometry.js';
import {parseSTL,transformSTL,toBase64,fromBase64,MAX_STL_BYTES} from './stl.js';
const $=id=>document.getElementById(id);
const defaults={kind:'box',footprint:'hull',units:'mm',scale:1,rx:0,ry:0,rz:0,clearance:10,wall:3,base:4,headroom:8,padding:10,splitAxis:'x',splitPercent:50,keyDiameter:5,keyLength:3,keyClearance:.25,sprueDiameter:8,ventDiameter:2,sprueX:null,sprueY:null,vents:[],printerX:180,printerY:180,printerZ:180,xyMargin:2,zMargin:5};
const fieldsets={
 stlTransform:[['scale','Масштаб',.001,1000,.001,'×'],['rx','Поворот X',-360,360,1,'°'],['ry','Поворот Y',-360,360,1,'°'],['rz','Поворот Z',-360,360,1,'°']],
 stlBoxFields:[['clearance','Боковой отступ',3,60,.5,'мм'],['headroom','Выше мастера',3,60,.5,'мм'],['wall','Стенка',2,10,.5,'мм'],['base','Основание',3,15,.5,'мм']],
 stlNegativeFields:[['padding','Припуск формы',8,60,.5,'мм'],['splitPercent','Положение разъёма',10,90,1,'%'],['sprueDiameter','Ø литника',2,25,.5,'мм'],['ventDiameter','Ø отдушин',1,6,.2,'мм']],
 stlKeyFields:[['keyDiameter','Ø штифта',3,8,.5,'мм'],['keyLength','Выступ штифта',2,5,.5,'мм'],['keyClearance','Зазор гнезда',.1,.6,.05,'мм']],
 stlPrinterFields:[['printerX','X',80,1000,1,'мм'],['printerY','Y',80,1000,1,'мм'],['printerZ','Z',80,1000,1,'мм']]
};
export class STLController{
 constructor(context){
  this.c=context;this.raw=null;this.mesh=null;this.name='';this.active=false;this.rev=0;this.job=null;this.vents=[];this.engine=null;this.token=null;this.result=null;this.pollTimer=null;this.resolvePoll=null;
  for(const [container,fields]of Object.entries(fieldsets))for(const [key,label,min,max,step,unit]of fields){
   const div=document.createElement('div');div.className='field';
   const l=document.createElement('label');l.htmlFor='stl-'+key;l.textContent=label;
   const wrap=document.createElement('div');wrap.className='input-wrap';const input=document.createElement('input');Object.assign(input,{id:'stl-'+key,type:'number',value:defaults[key],min,max,step});input.setAttribute('aria-invalid','false');input.setAttribute('aria-describedby','stl-input-hint');
   const suffix=document.createElement('span');suffix.className='unit';suffix.textContent=unit;wrap.append(input,suffix);div.append(l,wrap);$(container).append(div);
  }
  $('stlFile').onchange=async()=>{const file=$('stlFile').files[0];if(file)await this.load(file);$('stlFile').value='';};
  $('chooseSTL').onclick=()=>$('stlFile').click();
  const zone=$('stlDrop');zone.ondragover=e=>{e.preventDefault();zone.dataset.drag='true';};zone.ondragleave=()=>delete zone.dataset.drag;
  zone.ondrop=async e=>{e.preventDefault();delete zone.dataset.drag;if(e.dataTransfer.files.length!==1){this.message('Загрузите один STL за раз.','error');return;}await this.load(e.dataTransfer.files[0]);};
  document.querySelectorAll('[data-stl-example]').forEach(b=>b.onclick=async()=>{try{const r=await fetch(`examples/${b.dataset.stlExample}.stl`);if(!r.ok)throw new Error('Не удалось загрузить пример.');await this.load(new File([await r.arrayBuffer()],`${b.dataset.stlExample}.stl`));}catch(e){this.message(e.message,'error');}});
  $('stlForm').onsubmit=e=>{e.preventDefault();this.build();};
  $('stlForm').oninput=e=>{if(e.target.id==='stlRisk')return;this.dirty();};
  $('stl-kind').onchange=()=>{this.sync();this.dirty();};
  $('stl-splitAxis').onchange=()=>this.dirty();
  $('buildSTL').onclick=()=>this.build();$('cancelSTL').onclick=()=>this.cancel(true);
  $('pickSprue').onclick=()=>this.startPick('sprue');$('pickVent').onclick=()=>this.startPick('vent');
  $('autoSprue').onclick=()=>{$('stlSprueX').value='';$('stlSprueY').value='';this.dirty();};
  $('stlRisk').onchange=()=>this.c.onRisk();
  this.sync();this.health();
 }
 async health(){try{const r=await fetch('/api/status');if(!r.ok)throw new Error('Нет API');const data=await r.json();this.engine=data.engine;this.token=data.token;$('stlEngine').textContent=data.engine.available?`${data.engine.version} · локально`:data.engine.message;}
  catch{this.engine={available:false};$('stlEngine').textContent='STL-расчёт требует локального запуска: python3 serve.py. Просмотр файла доступен.';}this.buttons();}
 sync(){const negative=$('stl-kind').value==='negative';$('stlBoxOptions').hidden=negative;$('stlNegativeOptions').hidden=!negative;$('stlRiskLabel').hidden=!negative;this.drawVents();}
 options(){const p={...defaults,vents:this.vents.map(v=>[...v])};for(const fields of Object.values(fieldsets))for(const [key,label]of fields){const input=$('stl-'+key),val=input.valueAsNumber;if(!input.checkValidity()||!Number.isFinite(val)){input.setAttribute('aria-invalid','true');throw new Error(`${label}: проверьте допустимое значение.`);}input.setAttribute('aria-invalid','false');input.setAttribute('aria-describedby','stl-input-hint');p[key]=val;}
  for(const key of ['kind','footprint','units','splitAxis'])p[key]=$('stl-'+key).value;
  p.sprueX=$('stlSprueX').value===''?null:$('stlSprueX').valueAsNumber;p.sprueY=$('stlSprueY').value===''?null:$('stlSprueY').valueAsNumber;
  if((p.sprueX===null)!==(p.sprueY===null)||[p.sprueX,p.sprueY].some(x=>x!==null&&!Number.isFinite(x)))throw new Error('Укажите обе координаты литника либо выберите «Авто».');return p;
 }
 activate(){this.active=true;this.sync();this.preview();this.buttons();}
 suspend(){this.active=false;this.cancel(false);this.c.viewer.pointPicker=null;}
 message(text,kind='info'){$('stlMessage').textContent=text;$('stlMessage').className='stl-message '+kind;}
 buttons(){$('buildSTL').disabled=!this.raw||!this.engine?.available||Boolean(this.job);$('cancelSTL').hidden=!this.job;}
 async load(file){
  this.cancel(false);const loadRevision=this.rev;this.c.onDirty();
  try{
   if(!file.name.toLowerCase().endsWith('.stl'))throw new Error('Выберите файл с расширением .stl.');
   if(file.size>MAX_STL_BYTES)throw new Error('STL больше 15 МиБ. Упростите сетку.');
   this.message('Чтение STL…');await new Promise(r=>requestAnimationFrame(r));const raw=await file.arrayBuffer(),mesh=parseSTL(raw);if(loadRevision!==this.rev||!this.active)return;
   this.raw=raw;this.mesh=mesh;this.name=file.name;this.vents=[];this.result=null;
   $('stlSprueX').value='';$('stlSprueY').value='';$('stlRisk').checked=false;this.drawVents();if(this.preview())this.message('Модель загружена. Проверьте размеры и единицы, затем постройте форму.');
  }catch(e){this.message(e.message,'error');this.preview();}this.buttons();
 }
 preview(){
  if(!this.active)return;
  if(!this.mesh){this.c.onEmpty();return;}
  try{
   const p=this.options(),mesh=transformSTL(this.mesh,p),b=bounds(mesh);
   const master={id:'master',label:this.name,type:'master',mesh,bounds:b,color:'#46a4a2',group:'Контрольные модели',printable:false,fits:false,sample:false,filename:'master.stl',explodeOffset:[0,0,0],note:'Предпросмотр исходного STL. Проверка рёбер выполняется при построении.'};
   const model={kind:'stl',mode:p.kind,p,d:{so:Math.max(...b.size.slice(0,2))/2+p.clearance+p.wall,co:0},parts:[master],stats:{printCount:0,allFit:false,totalMl:null},warnings:[],split:{axis:'xyz'.indexOf(p.splitAxis),position:b.min['xyz'.indexOf(p.splitAxis)]+b.size['xyz'.indexOf(p.splitAxis)]*p.splitPercent/100}};
   $('stlFileName').textContent=this.name;$('stlDimensions').textContent=b.size.map(x=>x.toLocaleString('ru-RU',{maximumFractionDigits:2})).join(' × ')+' мм';$('stlFacets').textContent=this.mesh.length.toLocaleString('ru-RU')+' треугольников';
   this.c.onPreview(model);this.message('Размеры изменены. Нажмите «Построить форму», чтобы обновить оснастку.');return true;
  }catch(e){this.c.onDirty();this.message(e.message,'error');}
 }
 dirty(){this.cancel(false);this.result=null;$('stlRisk').checked=false;this.c.onDirty();this.c.viewer.pointPicker=null;this.preview();this.buttons();}
 async cancel(notify){
  ++this.rev;const id=this.job;this.job=null;clearTimeout(this.pollTimer);if(this.resolvePoll){this.resolvePoll();this.resolvePoll=null;}
  if(id&&this.token)fetch(`/api/jobs/${id}`,{method:'DELETE',headers:{'X-VMG-Token':this.token}}).catch(()=>{});
  this.buttons();$('stlProgress').hidden=true;if(notify){this.message('Расчёт отменён. Предыдущий результат не доступен для экспорта.');this.c.onDirty();}
 }
 async build(){
  if(!this.raw||!this.engine?.available)return;
  await this.cancel(false);const revision=this.rev;
  this.c.onDirty();this.message('Отправка в локальное CAD-ядро…');$('stlProgress').value=0;$('stlProgress').hidden=false;$('buildSTL').disabled=true;
  try{
   const p=this.options();const response=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-VMG-Token':this.token},body:JSON.stringify({stl:toBase64(this.raw),parameters:p})});const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Не удалось начать расчёт.');
   if(revision!==this.rev){fetch(`/api/jobs/${data.id}`,{method:'DELETE',headers:{'X-VMG-Token':this.token}}).catch(()=>{});return;}
   this.job=data.id;this.buttons();
   for(;;){
    const r=await fetch(`/api/jobs/${data.id}`,{headers:{'X-VMG-Token':this.token}}),state=await r.json();
    if(revision!==this.rev||!this.active)return;
    if(!r.ok)throw new Error(state.error);this.message(state.stage);this.c.onProgress?.(state.stage);$('stlProgress').value=state.percent;
    if(state.status==='done'){
     const resultResponse=await fetch(`/api/jobs/${data.id}/result`,{headers:{'X-VMG-Token':this.token}});const result=await resultResponse.json();
     if(revision!==this.rev||!this.active)return;if(!resultResponse.ok)throw new Error(result.error);
     result.sourceName=this.name;result.sourceSha256=data.sourceSha256;this.result=result;this.c.onModel(result);
     const quality=result.source;this.message(`Готово. ${result.stats.printCount} деталей. Исходная сетка: ${quality.watertight?'замкнута':'есть открытые рёбра'}, оболочек: ${quality.components}.`,'success');
     break;
    }
    if(['error','cancelled'].includes(state.status))throw new Error(state.error||state.stage);
    await new Promise(resolve=>{this.resolvePoll=resolve;this.pollTimer=setTimeout(()=>{this.resolvePoll=null;resolve();},400);});
   }
  }catch(e){if(revision===this.rev){this.message(e.message,'error');this.c.onDirty();}}
  finally{if(revision===this.rev){this.job=null;this.buttons();$('stlProgress').hidden=true;}}
 }
 startPick(kind){
  if(!this.mesh)return;
  if(kind==='vent'&&this.vents.length>=8){this.message('Допустимо до 8 отдушин.','error');return;}
  const viewer=this.c.viewer;viewer.setReference('master',true);viewer.isolate('master');viewer.setMode('assembly',{animate:false});viewer.camera('top');
  this.message(kind==='sprue'?'Нажмите на мастер-модель, чтобы задать литник. Канал будет направлен вверх по Z.':'Нажмите на мастер-модель, чтобы добавить отдушину.');
  viewer.pointPicker=hit=>{if(!hit){this.message('Точка должна лежать на модели.','error');return;}const xy=hit.slice(0,2).map(x=>Math.round(x*100)/100);viewer.pointPicker=null;
   if(kind==='sprue'){$('stlSprueX').value=xy[0];$('stlSprueY').value=xy[1];}else this.vents.push(xy);
   viewer.isolated=null;this.drawVents();this.dirty();};
 }
 drawVents(){const list=$('stlVents');list.replaceChildren();this.vents.forEach((v,i)=>{const row=document.createElement('div');row.className='vent-row';const label=document.createElement('span');label.textContent=`${i+1}. X ${v[0]} · Y ${v[1]} мм`;const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Убрать';remove.setAttribute('aria-label',`Удалить отдушину ${i+1}`);remove.onclick=()=>{this.vents.splice(i,1);this.drawVents();this.dirty();};row.append(label,remove);list.append(row);});}
 exportAllowed(){return this.result&&this.result.stats.allFit&&(this.result.mode!=='negative'||$('stlRisk').checked);}
 project(){if(!this.raw)throw new Error('Сначала загрузите STL.');return {format:'vase-mold-generator-stl',version:'0.3.0',sourceName:this.name,sourceSTL:toBase64(this.raw),parameters:this.options()};}
 async openProject(value){
  if(value.format!=='vase-mold-generator-stl'||!value.parameters||typeof value.parameters!=='object')throw new Error('Некорректный проект STL.');
  const raw=fromBase64(value.sourceSTL);parseSTL(raw);const p={...defaults,...value.parameters};
  if(!Array.isArray(p.vents)||p.vents.length>8||p.vents.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite)))throw new Error('Некорректные отдушины в проекте.');
  await this.load(new File([raw],typeof value.sourceName==='string'&&value.sourceName.endsWith('.stl')?value.sourceName:'model.stl'));
  for(const fields of Object.values(fieldsets))for(const [key]of fields)$('stl-'+key).value=p[key];
  for(const key of ['kind','footprint','units','splitAxis'])$('stl-'+key).value=p[key];
  this.vents=p.vents;$('stlSprueX').value=p.sprueX??'';$('stlSprueY').value=p.sprueY??'';this.sync();this.dirty();
 }
}
