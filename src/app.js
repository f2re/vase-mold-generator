import {DEFAULTS, LIMITS, GROUPS, validate, generate, projectJSON, parseProject} from './geometry.js';
import {Viewer} from './viewer.js';
import {stl, kit} from './export.js';

const $ = id => document.getElementById(id);
const number = (v, digits = 1) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: digits}).format(v);
const fields = {
  masterFields: [['masterOuterD','Наружный Ø'],['masterInnerD','Внутренний Ø'],['masterHeight','Высота'],['masterBottom','Толщина дна']],
  siliconeFields: [['siliconeOuter','Снаружи'],['siliconeInner','Внутри'],['siliconeBottom','Под втулкой'],['siliconeBridge','Над кромкой']],
  printerFields: [['printerX','X'],['printerY','Y'],['printerZ','Z']],
  toolFields: [['shellWall','Стенка кожуха'],['coreWall','Стенка втулки'],['baseThickness','Основание'],['lidThickness','Верхняя плашка'],['fitClearance','Зазор посадки',.05],['snapDeflection','Выступ защёлки',.05]],
  advancedFields: [['xyMargin','Поле по X / Y'],['zMargin','Поле сверху'],['siliconeDensity','Плотность',.01,'г/мл'],['segments','Сегменты',8,'шт.']]
};
const fieldLabels = {};
for (const [target, entries] of Object.entries(fields)) {
  for (const [key, label, step = .5, unit = 'мм'] of entries) {
    fieldLabels[key] = label;
    const box = document.createElement('div'); box.className = 'field';
    const caption = document.createElement('label'); caption.htmlFor = key; caption.textContent = label;
    const wrap = document.createElement('div'); wrap.className = 'input-wrap';
    const input = document.createElement('input');
    Object.assign(input, {id:key, name:key, type:'number', min:LIMITS[key][0], max:LIMITS[key][1], step, value:DEFAULTS[key], inputMode:'decimal'});
    input.setAttribute('aria-invalid', 'false'); input.setAttribute('aria-describedby', `${key}-error`);
    const suffix = document.createElement('span'); suffix.className = 'unit'; suffix.textContent = unit;
    const error = document.createElement('p'); error.id = `${key}-error`; error.className = 'field-error'; error.hidden = true;
    wrap.append(input, suffix); box.append(caption, wrap, error); $(target).append(box);
  }
}
let model = null, ready = false, revision = 0, debounce, watchdog, worker = null, milliseconds = 0, toastTimer;
let viewer;
try {
  viewer = new Viewer($('view3d'), {onSelect: () => {renderParts(); renderSelection();}, onMode: syncView});
  $('rendererState').textContent = viewer.backend;
} catch (error) {
  $('previewOverlay').textContent = `3D-просмотр недоступен: ${error.message}. Расчёт и STL работают через список деталей.`;
  // Preserve generation and export on browsers with no graphics context.
  viewer = {backend:'Недоступен', parts:[], reference:{master:false,silicone:false,sample:false}, hidden:new Set(), selected:null, isolated:null, mode:'explode', stage:'all', explode:.58, slice:0,
    setModel(m){this.parts=m.parts;}, visible(p){return !this.hidden.has(p.id);}, fit(){}, invalidate(){}, setMode(m){this.mode=m;syncView();}, setStage(s){this.stage=s;},
    setVisible(id,v){v?this.hidden.delete(id):this.hidden.add(id);}, setReference(k,v){this.reference[k]=v;}, select(id){this.selected=id;renderParts();renderSelection();},
    isolate(id){this.isolated=id;}, showAll(){this.hidden.clear();this.isolated=null;}, camera(){}, destroy(){}, async snapshot(){throw new Error('Снимок недоступен без Canvas.');}};
  $('rendererState').textContent = viewer.backend;
}
$('view3d').addEventListener('viewerror', event => toast(event.detail));

function toast(text) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false;
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 5500);
}
function readInputs() {
  const p = {};
  for (const key of Object.keys(LIMITS)) p[key] = $(key).value.trim() === '' ? NaN : $(key).valueAsNumber;
  p.autoSplit = $('autoSplit').checked; return p;
}
function setInputs(p) {
  for (const key of Object.keys(LIMITS)) $(key).value = p[key];
  $('autoSplit').checked = p.autoSplit;
  $('printerPreset').value = p.printerX === p.printerY && p.printerX === p.printerZ && [180,256].includes(p.printerX) ? String(p.printerX) : 'custom';
}
function clearErrors(errors = {}) {
  for (const key of Object.keys(LIMITS)) {
    $(key).setAttribute('aria-invalid', String(Boolean(errors[key])));
    $(`${key}-error`).textContent = errors[key] || ''; $(`${key}-error`).hidden = !errors[key];
  }
}
function message(text, error = false) {
  const node = document.createElement('p'); node.className = `message${error ? ' error' : ''}`; node.textContent = text; $('messages').append(node);
}
function gate(value) {
  ready = value;
  $('saveProject').disabled = !value;
  $('exportAll').disabled = !value || !model?.stats.allFit;
  $('exportSamples').disabled = !value;
  $('preview').setAttribute('aria-busy', String(!value));
  renderSelection();
}
function schedule(immediate = false) {
  const id = ++revision; clearTimeout(debounce); clearTimeout(watchdog); gate(false);
  const parameters = readInputs(), result = validate(parameters);
  clearErrors(result.fields); $('messages').replaceChildren();
  const invalid = Object.entries(result.fields);
  if (invalid.length) {
    $('generationState').textContent = 'Проверьте размеры'; $('generationState').className = 'error';
    $('previewOverlay').textContent = 'Размеры некорректны. Последняя модель не обновлена; экспорт заблокирован.';
    message(invalid.map(([key, text]) => `${fieldLabels[key] || key}: ${text}`).join(' '), true);
    return;
  }
  $('generationState').textContent = 'Перестроение…'; $('generationState').className = '';
  $('previewOverlay').textContent = 'Перестроение деталей…';
  debounce = setTimeout(() => compute(id, result.p), immediate ? 0 : 160);
}
function fallback(id, parameters) {
  setTimeout(() => {
    if (id !== revision) return;
    try {const t = performance.now(); accept({id, model:generate(parameters), ms:performance.now()-t});}
    catch (error) {accept({id,error:error.message,fields:error.fields});}
  }, 0);
}
function compute(id, parameters) {
  if (id !== revision) return;
  if (worker) {
    worker.postMessage({id,parameters});
    watchdog = setTimeout(() => {if (id !== revision) return; worker?.terminate();worker=null;toast('Фоновый расчёт недоступен. Продолжен расчёт на странице.');fallback(id,parameters);}, 12000);
  } else fallback(id, parameters);
}
function accept(result) {
  if (result.id !== revision) return;
  clearTimeout(watchdog);
  if (result.error) {
    gate(false); clearErrors(result.fields || {}); $('messages').replaceChildren(); message(result.error, true);
    $('generationState').textContent = 'Не удалось построить'; $('generationState').className = 'error';
    $('previewOverlay').textContent = 'Исправьте параметры и нажмите «Пересчитать». Старый STL недоступен.'; return;
  }
  model = result.model; milliseconds = result.ms;
  viewer.setModel(model); viewer.fit(); gate(true); syncView(); renderParts(); renderSelection();
  $('generationState').textContent = `Обновлено · ${number(milliseconds, 0)} мс`; $('generationState').className = '';
  $('modelCaption').textContent = `Ваза Ø${number(model.p.masterOuterD)} / Ø${number(model.p.masterInnerD)} × ${number(model.p.masterHeight)} мм`;
  $('masterDerived').textContent = `Стенка вазы ${number((model.p.masterOuterD-model.p.masterInnerD)/2)} мм; глубина ${number(model.p.masterHeight-model.p.masterBottom)} мм.`;
  $('messages').replaceChildren(); model.warnings.forEach(text => message(text));
  const stats = [['Рабочих деталей',`${model.stats.printCount} шт.`],['Силикон без запаса',`${number(model.stats.totalMl/1000,2)} л`],['Наружный Ø кожуха',`${number(model.d.so*2)} мм`],['Втулка / ярусов',`Ø${number(model.d.co*2)} / ${model.d.coreTiers}`]];
  $('summary').replaceChildren();
  for (const [label,value] of stats) {const cell=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;cell.append(small,strong);$('summary').append(cell);}
  $('fitStatus').textContent = model.stats.allFit ? `Все рабочие детали помещаются · ${model.p.printerX} × ${model.p.printerY} × ${model.p.printerZ} мм` : 'Есть детали вне области печати. Комплект STL заблокирован.';
  $('fitStatus').className = model.stats.allFit ? '' : 'not-fit';
  try {localStorage.setItem('vmg-project-v2', JSON.stringify(projectJSON(model.p)));} catch {/* Private mode must not prevent generation. */}
}
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
  worker.onmessage = ({data}) => accept(data);
  worker.onerror = event => {event.preventDefault();worker?.terminate();worker=null;clearTimeout(watchdog);fallback(revision,readInputs());};
} catch {/* A synchronous fallback supports restricted browser environments. */}

function ensureVisible(part) {
  if (!part) return;
  if (viewer.stage !== 'all') viewer.setStage('all');
  viewer.isolated=null;
  if (part.type === 'master') viewer.setReference('master',true);
  if (part.type === 'silicone') viewer.setReference('silicone',true);
  if (part.sample) viewer.setReference('sample',true);
  viewer.setVisible(part.id,true); syncView();
}
function renderParts() {
  if (!model) return;
  const focus = document.activeElement?.dataset?.partId;
  const focusCheck = document.activeElement?.dataset?.checkId;
  $('partsTree').replaceChildren();
  for (const group of GROUPS) {
    const parts = model.parts.filter(p=>p.group===group); if (!parts.length) continue;
    const section=document.createElement('section');section.className='part-group';
    const heading=document.createElement('h3');heading.textContent=group;
    const count=document.createElement('span');count.textContent=parts.length;heading.append(count);section.append(heading);
    for (const part of parts) {
      const row=document.createElement('div');row.className='part-row';row.dataset.id=part.id;row.setAttribute('aria-current',String(viewer.selected===part.id));
      const check=document.createElement('input');check.type='checkbox';check.dataset.checkId=part.id;check.checked=viewer.visible(part);check.setAttribute('aria-label',`Показать: ${part.label}`);
      check.addEventListener('change',()=>{if(check.checked)ensureVisible(part);else viewer.setVisible(part.id,false);renderParts();renderSelection();syncView();});
      const button=document.createElement('button');button.className='part-name';button.dataset.partId=part.id;
      const swatch=document.createElement('i');swatch.className='swatch';swatch.style.setProperty('--swatch',part.color);swatch.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=part.label;button.append(swatch,text);
      button.addEventListener('click',()=>{ensureVisible(part);viewer.select(part.id);});row.append(check,button);
      if(!part.fits){const mark=document.createElement('span');mark.className='part-bad';mark.textContent='Размер';mark.title='За пределами заданной области печати';row.append(mark);}
      section.append(row);
    }
    $('partsTree').append(section);
  }
  if(focusCheck) $('partsTree').querySelector(`[data-check-id="${focusCheck}"]`)?.focus({preventScroll:true});
  if(focus) $('partsTree').querySelector(`[data-part-id="${focus}"]`)?.focus({preventScroll:true});
}
function renderSelection() {
  if (!viewer) return;
  const target=$('selection'),part=model?.parts.find(p=>p.id===viewer.selected);target.replaceChildren();
  if(!part){const p=document.createElement('p');p.className='help';p.textContent='Выберите деталь, чтобы увидеть размеры и сохранить её STL.';target.append(p);return;}
  const heading=document.createElement('h3');heading.textContent=part.label;
  const dim=document.createElement('p');dim.className='dimensions';dim.textContent=part.bounds.size.map(v=>number(v,2)).join(' × ')+' мм';
  const note=document.createElement('p');note.textContent=part.note || (part.printable?'Деталь оснастки для печати.':'Контрольная модель; в рабочий ZIP не включается.');
  const actions=document.createElement('div');actions.className='selection-actions';
  const isolate=document.createElement('button');isolate.className='secondary';isolate.textContent=viewer.isolated===part.id?'Вся сборка':'Только эта';
  isolate.onclick=()=>{if(viewer.isolated===part.id)viewer.showAll();else viewer.isolate(part.id);renderParts();renderSelection();};
  const download=document.createElement('button');download.id='exportPart';download.className='secondary';download.textContent='STL детали';download.disabled=!ready;
  download.onclick=()=>{if(!ready)return;if(!part.fits)toast('Деталь не помещается в заданную область. Проверьте размер перед печатью.');saveBytes(stl(part),part.filename,'model/stl');};
  actions.append(isolate,download);target.append(heading,dim,note,actions);
}
const viewTexts = {
  assembly:['Оснастка в сборе','Детали стоят в сборочных координатах. Для просмотра внутри выберите разрез или скройте кожух.'],
  explode:['Разнесённая сборка','Разнесение меняет только просмотр. Геометрия и размеры STL остаются прежними.'],
  section:['Разрез оснастки','Визуальное сечение без закрытия торцов. Скрытая часть остаётся в STL; модель не обрезается.'],
  layout:['Все детали отдельно','Обзор деталей, не раскладка по столам. Размер каждой детали проверяется отдельно.']
};
function syncView() {
  if(!viewer)return;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===viewer.mode)));
  document.querySelectorAll('[data-stage]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.stage===viewer.stage)));
  $('explodeControl').hidden=viewer.mode!=='explode';$('sectionControl').hidden=viewer.mode!=='section';
  $('workspaceTitle').textContent=viewTexts[viewer.mode][0];$('viewNote').textContent=viewTexts[viewer.mode][1];
  $('showMaster').checked=viewer.reference.master;$('showSilicone').checked=viewer.reference.silicone;$('showSamples').checked=viewer.reference.sample;
  $('sectionValue').textContent=`${number((model?.d.so||0)*viewer.slice)} мм`;
}
const stageTexts={
  all:'Ваза стоит отверстием вверх. Снаружи — разъёмная опалубка, внутри — полая втулка с глухим защёлкивающимся дном. Широкая верхняя плашка удерживает втулку; четыре окна оставлены для заливки и воздуха.',
  outer:'Этап 1: закрепите и загерметизируйте вазу на основании, соберите кожух. Заливайте наружный кольцевой зазор до кромки вазы. Верх остаётся открытым. Выдержку перед вторым этапом назначайте по документации выбранного силикона.',
  inner:'Этап 2: сначала налейте силикон на внутреннее дно вазы. Медленно опустите втулку с небольшим наклоном, затем выровняйте. Закрепите верхнюю плашку от всплытия и доливайте через одно окно, оставляя остальные открытыми. Вокруг втулки и над кромкой формируется второй слой. Глухое дно втулки не служит воздушным каналом.',
  casting:'После отверждения извлеките плашку, втулку и мастер-модель. Для отливки гипса силиконовую форму с опорной оснасткой физически переворачивают: заливка идёт со стороны исходного наружного дна вазы. На экране сохранена исходная ориентация для сравнения деталей. Способ извлечения и фиксации сначала проверьте на пробной заливке.'
};
$('workflowText').textContent=stageTexts.all;
$('parameterForm').addEventListener('submit',event=>event.preventDefault());
$('parameterForm').addEventListener('input',event=>{if(event.target.id==='printerPreset')return;if(event.target.id.startsWith('printer'))$('printerPreset').value='custom';schedule();});
$('printerPreset').addEventListener('change',()=>{if($('printerPreset').value!=='custom'){for(const key of ['printerX','printerY','printerZ'])$(key).value=$('printerPreset').value;schedule();}});
$('reset').onclick=()=>{setInputs(DEFAULTS);schedule(true);toast('Восстановлены размеры Ø150 / Ø100 × 270 мм.');};
$('regenerate').onclick=()=>schedule(true);
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=event=>{viewer.setMode(button.dataset.mode,{animate:event.detail!==0});syncView();renderParts();});
document.querySelectorAll('[data-camera]').forEach(button=>button.onclick=()=>viewer.camera(button.dataset.camera));
$('fitView').onclick=()=>viewer.fit();
$('explodeRange').oninput=()=>{viewer.explode=+$('explodeRange').value/100;viewer.transitions=null;$('explodeValue').textContent=`${$('explodeRange').value}%`;viewer.invalidate();};
$('explodeRange').onchange=()=>viewer.fit();
$('sectionRange').oninput=()=>{viewer.slice=+$('sectionRange').value/100;syncView();viewer.invalidate();};
for(const [id,key]of [['showMaster','master'],['showSilicone','silicone'],['showSamples','sample']])$(id).onchange=()=>{viewer.setReference(key,$(id).checked);renderParts();renderSelection();};
$('transparentShell').onchange=()=>{viewer.transparent=$('transparentShell').checked;viewer.invalidate();};
$('showAllParts').onclick=()=>{viewer.setStage('all');viewer.showAll();syncView();renderParts();renderSelection();};
$('helpToggle').onclick=()=>{const show=$('workflow').hidden;$('workflow').hidden=!show;$('helpToggle').setAttribute('aria-expanded',String(show));if(show)$('workflow').scrollIntoView({block:'nearest'});};
document.querySelectorAll('[data-stage]').forEach(button=>button.onclick=()=>{viewer.setStage(button.dataset.stage);$('workflowText').textContent=stageTexts[button.dataset.stage];syncView();renderParts();renderSelection();});
function saveBytes(data,name,type='application/octet-stream') {
  const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
$('exportAll').onclick=()=>{if(!ready)return;try{saveBytes(kit(model),`opalubka_${model.p.masterOuterD}x${model.p.masterInnerD}x${model.p.masterHeight}_STL.zip`,'application/zip');toast(`${model.stats.printCount} деталей, параметры и сборочный манифест сохранены в ZIP.`);}catch(error){toast(error.message);}};
$('exportSamples').onclick=()=>{if(!ready)return;try{saveBytes(kit(model,{samples:true}),'snap_test_STL.zip','application/zip');}catch(error){toast(error.message);}};
$('saveProject').onclick=()=>{if(ready)saveBytes(JSON.stringify(projectJSON(model.p),null,2),'vase-mold-project.json','application/json');};
$('openProject').onclick=()=>$('projectFile').click();
$('projectFile').onchange=async()=>{const file=$('projectFile').files[0];if(!file)return;try{if(file.size>100000)throw new Error('Файл больше 100 КБ. Нужен JSON параметров, не STL.');const p=parseProject(await file.text());setInputs(p);schedule(true);toast('Размеры проекта загружены.');}catch(error){toast(error.message);}finally{$('projectFile').value='';}};
$('snapshot').onclick=async()=>{try{const blob=await viewer.snapshot();if(!blob)throw new Error('Не удалось получить снимок.');saveBytes(blob,'vase-mold-preview.png','image/png');}catch(error){toast(error.message);}};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('preview').requestFullscreen)await $('preview').requestFullscreen();else toast('Полноэкранный режим недоступен в этом браузере.');}catch{toast('Браузер не разрешил полноэкранный режим.');}};
let stored=null;
try{stored=localStorage.getItem('vmg-project-v2');}catch{/* Storage may be denied in a private window. */}
if(stored)try{setInputs(parseProject(stored));}catch{toast('Сохранённые параметры повреждены. Загружены исходные размеры.');}
Object.defineProperty(window,'vmg',{value:Object.freeze({get model(){return model;},get ready(){return ready;},get revision(){return revision;},get milliseconds(){return milliseconds;},viewer})});
window.addEventListener('beforeunload',()=>{worker?.terminate();viewer.destroy();});
schedule(true);
