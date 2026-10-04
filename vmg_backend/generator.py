"""CSG tooling generation using the installed OpenSCAD CLI (2021.01 or newer).
Only validated numeric parameters and a fixed, sanitized STL filename enter CAD.
"""
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from . import VERSION
from .stl import ModelError, parse, clean, info, bounds, signed_volume, transform, write_binary, hull_xy, ray_hits, draft_report

DEFAULTS = dict(kind='box',footprint='hull',units='mm',scale=1,rx=0,ry=0,rz=0,
    clearance=10,wall=3,base=4,headroom=8,padding=10,splitAxis='x',splitPercent=50,
    keyDiameter=5,keyLength=3,keyClearance=.25,sprueDiameter=8,ventDiameter=2,
    sprueX=None,sprueY=None,vents=[],printerX=180,printerY=180,printerZ=180,xyMargin=2,zMargin=5)
RANGES = dict(scale=(.001,1000),rx=(-360,360),ry=(-360,360),rz=(-360,360),clearance=(3,60),
    wall=(2,10),base=(3,15),headroom=(3,60),padding=(8,60),splitPercent=(10,90),
    keyDiameter=(3,8),keyLength=(2,5),keyClearance=(.1,.6),sprueDiameter=(2,25),ventDiameter=(1,6),
    printerX=(80,1000),printerY=(80,1000),printerZ=(80,1000),xyMargin=(0,15),zMargin=(0,20))

def parameters(raw):
    if not isinstance(raw,dict):raise ModelError('Параметры должны быть объектом.')
    p={**DEFAULTS,**{k:v for k,v in raw.items() if k in DEFAULTS}}
    for k,(lo,hi) in RANGES.items():
        v=p[k]
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not lo<=v<=hi:
            raise ModelError(f'{k}: допустимо от {lo} до {hi}.')
    for k,values in [('kind',('box','negative')),('footprint',('hull','rectangle')),('units',('mm','cm','inch')),('splitAxis',('x','y','z'))]:
        if p[k] not in values:raise ModelError(f'Некорректное значение {k}.')
    if (p['sprueX'] is None)!=(p['sprueY'] is None):raise ModelError('Задайте обе координаты литника.')
    if p['sprueX'] is not None:point([p['sprueX'],p['sprueY']])
    if not isinstance(p['vents'],list) or len(p['vents'])>8:raise ModelError('Допустимо до 8 отдушин.')
    p['vents']=[point(v) for v in p['vents']]
    if p['keyDiameter']+2>p['padding']:raise ModelError('Увеличьте припуск формы: штифты не помещаются в поле разъёма.')
    return p

def point(v):
    if not isinstance(v,(list,tuple)) or len(v)!=2 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or abs(x)>1000 for x in v):
        raise ModelError('Координаты канала должны быть двумя конечными числами в миллиметрах.')
    return list(v)

def openscad_path():
    override=os.environ.get('VMG_OPENSCAD')
    candidates=[override] if override else [shutil.which('openscad'),'/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',str(Path.home()/'Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'),r'C:\Program Files\OpenSCAD\openscad.exe']
    return next((str(Path(p)) for p in candidates if p and Path(p).is_file()),None)

def engine_status():
    path=openscad_path()
    if not path:return {'available':False,'name':'OpenSCAD','version':None,'message':'Установите OpenSCAD. Параметрическая ваза и просмотр STL работают без него.'}
    try:
        result=subprocess.run([path,'--version'],capture_output=True,text=True,timeout=5,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
        version=(result.stdout+result.stderr).strip()[:120]
        return {'available':result.returncode==0,'name':'OpenSCAD','version':version}
    except (OSError,subprocess.TimeoutExpired) as exc:
        return {'available':False,'name':'OpenSCAD','version':None,'message':str(exc)[:200]}

J=lambda x:json.dumps(x,separators=(',',':'),allow_nan=False)

def cube(lo,hi):
    return f'translate({J(lo)}) cube({J([hi[i]-lo[i] for i in range(3)])});'

def cylinder_at(pos,axis,h,r,r2=None):
    rot=[[0,90,0],[-90,0,0],[0,0,0]][axis]
    return f'translate({J(pos)}) rotate({J(rot)}) cylinder(h={h},r1={r},r2={r if r2 is None else r2},$fn=32);'

def prepare(data,raw):
    p=parameters(raw);mesh=parse(data);mesh=transform(mesh,p);mesh,removed=clean(mesh);report=info(mesh)
    warnings=[]
    if removed:warnings.append(f'Удалено вырожденных или повторных граней: {removed}. Координаты сшиты с точностью 0,00001 мм.')
    if report['watertight'] and report['orientation']<0:
        mesh=[[c,b,a] for a,b,c in mesh];report=info(mesh);warnings.append('Ориентация всей замкнутой оболочки исправлена наружу.')
    if not report['watertight']:
        if p['kind']=='negative':raise ModelError(f"Для негатива нужна замкнутая ориентированная сетка. Открытых/немногообразных рёбер: {report['openEdges']}; несогласованных: {report['inconsistentEdges']}.")
        warnings.append('Исходная сетка не замкнута. Построена только опалубка по габаритам; объём силикона не рассчитан.')
    if report['components']!=1:
        if p['kind']=='negative':raise ModelError('Негатив поддерживает одну связанную оболочку. Разделите сборку/закрытые внутренние полости на отдельные задания.')
        warnings.append(f"Оболочек в STL: {report['components']}. Фиксацию всех частей и внутренних полостей нужно предусмотреть отдельно.")
    if report['watertight'] and report['volumeMm3']<.01:raise ModelError('Замкнутая сетка имеет нулевой объём.')
    return mesh,p,report,warnings

def design_box(mesh,p,report):
    b=report['bounds'];W,D,H=b['size'];gap=p['clearance'];wall=p['wall'];base=p['base'];height=H+p['headroom']
    if p['footprint']=='hull':foot=f'polygon({J(hull_xy(mesh))});'
    else:foot=f'translate([{b["min"][0]},{b["min"][1]}]) square([{W},{D}]);'
    common=f'$fn=48; module footprint(d=0) {{ offset(r=d) {{ {foot} }} }}\n'
    common+=f'module prism(d,z,h) {{ translate([0,0,z]) linear_extrude(height=h,convexity=10) footprint(d); }}\n'
    # Base outside guide: 0.25 mm radial clearance, no lip inside silicone space.
    base_code=f'union() {{ prism({gap+wall+3},0,{base}); difference() {{ prism({gap+wall+3},{base-.1},2.1); prism({gap+wall+.25},{base-.2},2.4); }} }}'
    parts=[('stl-base','Основание с наружным бортиком','base',base_code,[0,0,-height*.35], 'Основание и кожух стянуть снаружи. Швы герметизировать. Бортик задаёт положение стенок.')]
    safeZ=p['printerZ']-p['zMargin'];tiers=max(1,math.ceil(height/safeZ));span=height/tiers
    outer=1000
    for t in range(tiers):
        z=base+t*span
        for side in range(2):
            lo=[-outer,-outer,z-.1];hi=[outer,outer,z+span+.1]
            if side==0:hi[0]=0
            else:lo[0]=0
            body=f'intersection() {{ difference() {{ prism({gap+wall},{z},{span}); prism({gap},{z-.1},{span+.2}); }} {cube(lo,hi)} }}'
            parts.append((f'stl-wall-{t+1}-{side+1}',f'Стенка {t+1}.{side+1}','shell',body,[(1 if side else -1)*(W*.65+gap),0,t*span*.35], 'Две половины по X. Плоские стыки ярусов требуют наружных стяжек и герметизации.'))
    moved=[[[v[0],v[1],v[2]+base] for v in t] for t in mesh]
    if report['watertight']:
        skin=f'difference() {{ prism({gap},{base},{height}); translate([0,0,{base}]) import("model.stl",convexity=10); }}'
        parts.append(('stl-silicone','Расчётный объём силикона','silicone',skin,[0,max(W,D)+2*gap,0], 'Геометрический объём, не симуляция заливки. Дно мастера касается основания; воздух и доступ к полостям проверить отдельно.'))
    notes=['Мастер стоит на основании: силикон не формируется под его опорной поверхностью.',
           'Контур — выпуклая проекция STL на XY с отступом, не точный трёхмерный офсет.' if p['footprint']=='hull' else 'Опалубка охватывает ограничивающий прямоугольник STL, не повторяет каждый изгиб.',
           'Оснастка не проверена физической заливкой. Стыки стянуть и герметизировать; пористый мастер подготовить по инструкции силикона.']
    return common,parts,moved,notes,{'axis':0,'position':0,'draft':None}

def design_negative(mesh,p,report):
    b=report['bounds'];pad=p['padding'];lo=[v-pad for v in b['min']];hi=[v+pad for v in b['max']]
    axis='xyz'.index(p['splitAxis']);uv=[i for i in range(3) if i!=axis]
    split=b['min'][axis]+b['size'][axis]*p['splitPercent']/100
    common='$fn=40; module master() { import("model.stl",convexity=10); }\n'
    highest=max(mesh,key=lambda t:sum(v[2] for v in t))
    x,y=(p['sprueX'],p['sprueY']) if p['sprueX'] is not None else [sum(v[i] for v in highest)/3 for i in (0,1)]
    channels=[];actual=[]
    for i,xy in enumerate([[x,y],*p['vents']]):
        hits=ray_hits(mesh,*xy)
        if not hits:raise ModelError(f'Канал {i+1} не попадает в модель. Укажите точку на поверхности STL, а не в отверстии или рядом с ней.')
        r=(p['sprueDiameter'] if i==0 else p['ventDiameter'])/2
        # Keep the funnel and channel inside the block with at least 1 mm cover.
        funnel=r*1.55 if i==0 else r
        if any(xy[j]-funnel<lo[j]+1 or xy[j]+funnel>hi[j]-1 for j in range(2)):
            raise ModelError('Канал слишком близко к наружному краю. Увеличьте припуск или переместите точку.')
        z=hits[-1];channels.append(cylinder_at([*xy,z-.25],2,hi[2]-z+.6,r))
        if i==0:channels.append(cylinder_at([*xy,hi[2]-min(4,pad/2)],2,min(4,pad/2)+.2,r,funnel))
        actual.append({'x':xy[0],'y':xy[1],'z':z,'diameter':r*2,'kind':'sprue' if i==0 else 'vent'})
    common+='module channels() { union() {'+'\n'.join(channels)+'} }\n'
    keys=[];holes=[]
    # Four keyed corners lie outside the master's bounding rectangle.
    for i,(su,sv) in enumerate([(0,0),(0,1),(1,0),(1,1)]):
        pos=[0,0,0];pos[axis]=split-.15
        pos[uv[0]]= (hi[uv[0]]-pad*.5) if su else (lo[uv[0]]+pad*.5)
        pos[uv[1]]= (hi[uv[1]]-pad*.5) if sv else (lo[uv[1]]+pad*.5)
        if i==3:pos[uv[0]]-=pad*.15 # asymmetric registry
        keys.append(cylinder_at(pos,axis,p['keyLength']+.15,p['keyDiameter']/2,p['keyDiameter']/2-.35))
        holes.append(cylinder_at(pos,axis,p['keyLength']+.15+p['keyClearance'],p['keyDiameter']/2+p['keyClearance'],p['keyDiameter']/2-.35+p['keyClearance']))
    a_hi=hi.copy();a_hi[axis]=split;b_lo=lo.copy();b_lo[axis]=split
    first='difference() { union() { '+cube(lo,a_hi)+' '.join(keys)+'} master(); channels(); }'
    second='difference() { '+cube(b_lo,hi)+' master(); channels(); '+' '.join(holes)+'}'
    shift=[0,0,0];shift[axis]=b['size'][axis]*.65+pad
    parts=[('mold-a','Половина A · штифты','shell',first,[-s for s in shift],'Четыре интегрированных штифта. Для заливки половины стянуть снаружи.'),
           ('mold-b','Половина B · гнёзда','shell',second,shift,'Гнёзда с заданным радиальным зазором. Полость точно вычтена из STL; поднутрения и извлечение проверить.'),
           ('stl-channels','Литник и отдушины','channels','channels();',[0,0,0],'Контрольная геометрия сквозных каналов. Не является печатной деталью.')]
    report_pull=draft_report(mesh,axis,split)
    notes=['Жёсткий негатив: не равнозначен опалубке для силикона. Внутренние съёмные сердечники автоматически не создаются.',
           report_pull['message'], 'Даже при нуле подозрительных лучей извлечение не гарантируется. Проверьте уклоны, полости, шов, разделитель и посадку штифтов.',
           'Каналы направлены вверх по Z и входят в реальную поверхность STL. Это не расчёт движения воздуха и жидкости.']
    return common,parts,mesh,notes,{'axis':axis,'position':split,'draft':report_pull,'channels':actual}

def generate(data,raw, *, progress=lambda *args:None, cancelled=lambda:False, timeout=120, executable=None):
    start=time.monotonic();exe=executable or openscad_path()
    if not exe:raise ModelError('OpenSCAD не найден. Установите его и перезапустите сервер; либо задайте VMG_OPENSCAD.')
    progress('Проверка STL',5)
    mesh,p,report,warnings=prepare(data,raw)
    common,specs,reference,notes,split=design_box(mesh,p,report) if p['kind']=='box' else design_negative(mesh,p,report)
    parts=[];total_facets=0;silicone_ml=None
    safe=[p['printerX']-2*p['xyMargin'],p['printerY']-2*p['xyMargin'],p['printerZ']-p['zMargin']]
    palette={'shell':'#668195','base':'#b79b72','master':'#46a4a2','silicone':'#d997ab','channels':'#cd864b'}
    def add(id,label,kind,m,explode,note,quality=None):
        b=bounds(m);printable=kind in ('shell','base')
        fits=all(s<=safe[i]+1e-4 for i,s in enumerate(b['size']))
        group='Опалубка STL' if printable and p['kind']=='box' else 'Половины формы' if printable else 'Контрольные модели'
        parts.append(dict(id=id,label=label,type=kind,mesh=m,bounds=b,printable=printable,sample=False,fits=fits,
            filename=id+'.stl',color=palette[kind],explodeOffset=explode,group=group,note=note,quality=quality))
    with tempfile.TemporaryDirectory(prefix='vmg-csg-') as tmp:
        folder=Path(tmp);(folder/'model.stl').write_bytes(write_binary(mesh))
        for index,(id,label,kind,source,explode,note) in enumerate(specs):
            if cancelled():raise ModelError('Расчёт отменён.')
            progress(f'{label} · {index+1}/{len(specs)}',10+int(80*index/len(specs)))
            file=folder/(id+'.scad');file.write_text(common+'\n'+source,encoding='utf-8');out=folder/(id+'.stl')
            log=folder/(id+'.log')
            env={**os.environ,'QT_QPA_PLATFORM':'offscreen'}
            with log.open('wb') as handle:
                try:process=subprocess.Popen([exe,'--export-format','binstl','-o',out.name,file.name],cwd=folder,stdout=handle,stderr=handle,env=env)
                except OSError as error:raise ModelError('Не удалось запустить OpenSCAD: '+str(error)) from error
                try:
                    while process.poll() is None:
                        if cancelled():raise ModelError('Расчёт отменён.')
                        if time.monotonic()-start>timeout:raise ModelError(f'Превышен лимит {timeout} с. Упростите STL или используйте режим опалубки.')
                        time.sleep(.06)
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:process.wait(timeout=2)
                        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
            output=log.read_text(errors='replace')
            if process.returncode or not out.exists() or 'ERROR:' in output:
                raise ModelError('OpenSCAD не смог построить '+label+'. Проверьте самопересечения и замкнутость STL. '+output[-600:])
            if out.stat().st_size>25*1024*1024:raise ModelError('Результат слишком сложный. Упростите STL.')
            # Preserve CSG's shared vertices and thin valid faces: re-welding output
            # can collapse a legitimate sliver and open an otherwise closed boundary.
            result=parse(out.read_bytes(),max_bytes=25*1024*1024,max_triangles=300_000);quality=info(result)
            if not quality['watertight'] or quality['volumeMm3']<.001:
                raise ModelError('После булевой операции осталась некорректная сетка: '+label+'. STL не выдан.')
            if quality['orientation']<0:result=[[c,b,a] for a,b,c in result]
            if kind in ('base','shell') and quality['components']!=1:
                raise ModelError('В детали «'+label+'» образовались отдельные островки/закрытые полости. Измените разъём или используйте силиконовую опалубку.')
            total_facets+=len(result)
            if total_facets>350_000:raise ModelError('Суммарно слишком много граней. Упростите мастер-модель.')
            if kind=='silicone':silicone_ml=quality['volumeMm3']/1000
            add(id,label,kind,result,explode,note,quality)
    add('master','Мастер-модель STL','master',reference,[0,0,0],'Загруженная модель после масштаба, поворота и центрирования.',report)
    failures=[x['label'] for x in parts if x['printable'] and not x['fits']]
    if failures:warnings.append('Не помещаются в заданную область: '+', '.join(failures)+'. Уменьшите масштаб или используйте другой принтер. ZIP комплекта заблокирован.')
    b=bounds(reference)
    progress('Готово',100)
    return dict(version=VERSION,kind='stl',mode=p['kind'],p=p,d=dict(so=max(b['size'][:2])/2+p['clearance']+p['wall'],co=0),parts=parts,warnings=warnings+([split['draft']['message']] if split.get('draft') and split['draft'].get('suspect') else []),
        notes=notes,stats=dict(printCount=sum(x['printable'] for x in parts),allFit=not failures,totalMl=silicone_ml),
        source=report,split=split,elapsedMs=round((time.monotonic()-start)*1000))
