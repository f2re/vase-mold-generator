"""Strict binary/ASCII STL import. User text is never evaluated as CAD code."""
import math
import re
import struct
from collections import defaultdict

MAX_BYTES = 15 * 1024 * 1024
MAX_TRIANGLES = 100_000

class ModelError(ValueError):
    pass

def sub(a, b):
    return [a[i] - b[i] for i in range(3)]

def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

def dot(a,b):
    return sum(x*y for x,y in zip(a,b))

def bounds(mesh):
    low = [min(v[i] for t in mesh for v in t) for i in range(3)]
    high = [max(v[i] for t in mesh for v in t) for i in range(3)]
    return {'min': low, 'max': high, 'size': [high[i]-low[i] for i in range(3)]}

def signed_volume(mesh):
    origin = mesh[0][0]
    return math.fsum(dot(sub(a,origin), cross(sub(b,origin), sub(c,origin))) for a,b,c in mesh) / 6

def parse(data, *, max_bytes=MAX_BYTES, max_triangles=MAX_TRIANGLES):
    if not isinstance(data, bytes) or len(data) > max_bytes:
        raise ModelError('STL слишком большой: максимум 15 МиБ.')
    if len(data) < 15:
        raise ModelError('STL пустой или обрезан.')
    count = struct.unpack_from('<I',data,80)[0] if len(data)>=84 else 0
    triangles = []
    if len(data)>=84 and 84+50*count == len(data):
        if not 1 <= count <= max_triangles:
            raise ModelError(f'Допустимо до {max_triangles:,} треугольников.')
        for off in range(84,len(data),50):
            values=struct.unpack_from('<9f',data,off+12)
            triangles.append([list(values[i:i+3]) for i in (0,3,6)])
    else:
        try:
            text=data.decode('utf-8-sig')
        except UnicodeError as error:
            raise ModelError('Размер двоичного STL не соответствует числу треугольников.') from error
        if not text.lstrip().lower().startswith('solid'):
            raise ModelError('Не распознан STL. Поддерживаются ASCII и binary STL.')
        # Only facet grammar, whitespace and solid labels are accepted.
        number=r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
        vec=rf'({number})\s+({number})\s+({number})'
        facet=re.compile(rf'facet\s+normal\s+{vec}\s+outer\s+loop\s+vertex\s+{vec}\s+vertex\s+{vec}\s+vertex\s+{vec}\s+endloop\s+endfacet',re.I)
        text=re.sub(r'^\s*(?:end)?solid[^\r\n]*(?:\r?\n|$)','',text,flags=re.M|re.I)
        pos=0
        for match in facet.finditer(text):
            if text[pos:match.start()].strip():
                raise ModelError('Повреждён синтаксис ASCII STL.')
            values=list(map(float,match.groups()[3:]))
            triangles.append([values[i:i+3] for i in (0,3,6)])
            if len(triangles)>max_triangles:
                raise ModelError(f'Слишком много треугольников: предел {max_triangles}.')
            pos=match.end()
        if text[pos:].strip() or not triangles:
            raise ModelError('ASCII STL обрезан или содержит некорректные грани.')
    if not all(math.isfinite(x) and abs(x)<=1e7 for t in triangles for v in t for x in v):
        raise ModelError('STL содержит NaN, бесконечность или чрезмерные координаты.')
    return triangles

def clean(mesh):
    """Weld to 1e-5 input units; drop zero-area/duplicate faces, report every change."""
    result=[]; seen=set(); removed=0
    for t in mesh:
        t=[tuple(round(v,5) for v in p) for p in t]
        if len(set(t))<3 or dot(cross(sub(t[1],t[0]),sub(t[2],t[0])),cross(sub(t[1],t[0]),sub(t[2],t[0])))<1e-18:
            removed+=1;continue
        key=tuple(sorted(t))
        if key in seen:
            removed+=1;continue
        seen.add(key);result.append([list(v) for v in t])
    if len(result)<4:
        raise ModelError('После проверки осталось меньше четырёх невырожденных граней.')
    return result,removed

def info(mesh):
    edges=defaultdict(lambda:[0,0,[]]);parents=list(range(len(mesh)))
    def root(x):
        while parents[x]!=x:
            parents[x]=parents[parents[x]];x=parents[x]
        return x
    for index,t in enumerate(mesh):
        keys=[tuple(round(x,5) for x in p) for p in t]
        for a,b in zip(keys,keys[1:]+keys[:1]):
            key=(a,b) if a<b else (b,a)
            value=edges[key];value[0]+=1;value[1]+=1 if a<b else -1
            if value[2]:
                parents[root(index)]=root(value[2][0])
            else:
                value[2].append(index)
    opened=sum(n!=2 for n,_,__ in edges.values())
    winding=sum(n==2 and w!=0 for n,w,_ in edges.values())
    vol=signed_volume(mesh)
    return {'triangles':len(mesh),'bounds':bounds(mesh),'openEdges':opened,'inconsistentEdges':winding,
            'components':len({root(i) for i in range(len(mesh))}), 'watertight':opened==0 and winding==0,
            'volumeMm3':abs(vol),'orientation':1 if vol>0 else -1}

def transform(mesh,p):
    units={'mm':1,'cm':10,'inch':25.4}[p['units']]
    scale=units*p['scale']; angles=[math.radians(p[k]) for k in ('rx','ry','rz')]
    sin=list(map(math.sin,angles));cos=list(map(math.cos,angles))
    out=[]
    for triangle in mesh:
        tri=[]
        for v in triangle:
            x,y,z=[i*scale for i in v]
            y,z=y*cos[0]-z*sin[0],y*sin[0]+z*cos[0]
            x,z=x*cos[1]+z*sin[1],-x*sin[1]+z*cos[1]
            x,y=x*cos[2]-y*sin[2],x*sin[2]+y*cos[2]
            tri.append([x,y,z])
        out.append(tri)
    b=bounds(out);shift=[(b['min'][0]+b['max'][0])/2,(b['min'][1]+b['max'][1])/2,b['min'][2]]
    out=[[[round(v[i]-shift[i],5) for i in range(3)] for v in t] for t in out]
    b=bounds(out)
    if min(b['size'])<.1 or max(b['size'])>800:
        raise ModelError('После масштаба габариты должны быть от 0,1 до 800 мм. Проверьте единицы STL.')
    return out

def write_binary(mesh):
    data=bytearray(b'VMG sanitized STL; millimetres'.ljust(80,b' '));data.extend(struct.pack('<I',len(mesh)))
    for a,b,c in mesh:
        n=cross(sub(b,a),sub(c,a));length=math.sqrt(dot(n,n));n=[x/length for x in n] if length else [0,0,0]
        data.extend(struct.pack('<12fH',*n,*a,*b,*c,0))
    return bytes(data)

def hull_xy(mesh):
    points=sorted({(v[0],v[1]) for t in mesh for v in t})
    def side(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def half(seq):
        out=[]
        for p in seq:
            while len(out)>1 and side(out[-2],out[-1],p)<=0:out.pop()
            out.append(p)
        return out
    return half(points)[:-1]+half(reversed(points))[:-1]

def ray_hits(mesh,x,y,axis=2):
    axes=[i for i in range(3) if i!=axis];u,v=axes;hits=[]
    for a,b,c in mesh:
        den=(b[v]-c[v])*(a[u]-c[u])+(c[u]-b[u])*(a[v]-c[v])
        if abs(den)<1e-12:continue
        w1=((b[v]-c[v])*(x-c[u])+(c[u]-b[u])*(y-c[v]))/den
        w2=((c[v]-a[v])*(x-c[u])+(a[u]-c[u])*(y-c[v]))/den;w3=1-w1-w2
        if min(w1,w2,w3)>=-1e-7:
            hits.append(w1*a[axis]+w2*b[axis]+w3*c[axis])
    values=[]
    for h in sorted(hits):
        if not values or h-values[-1]>1e-4:values.append(h)
    return values

def draft_report(mesh,axis,split):
    if len(mesh)>20_000:
        return {'tested':0,'suspect':None,'message':'Поднутрения не оценены: для сеток >20 000 граней лучевой тест пропускается.'}
    b=bounds(mesh);uv=[i for i in range(3) if i!=axis];tested=0;suspect=0
    for i in range(11):
        for j in range(11):
            xy=[b['min'][uv[k]]+b['size'][uv[k]]*(n+.5)/11 for k,n in enumerate((i,j))]
            hits=ray_hits(mesh,*xy,axis=axis)
            if len(hits)<2:continue
            tested+=1
            if len(hits)>2 or not hits[0]-1e-4<=split<=hits[-1]+1e-4:suspect+=1
    return {'tested':tested,'suspect':suspect,'message':f'Лучевой тест 11 × 11: подозрительных сечений {suspect} из {tested}. Это не полный анализ поднутрений.'}
