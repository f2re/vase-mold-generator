"""CLI/CI export uses the same assembly meshes as the HTTP result."""
import base64
import hashlib
import io
import json
import zipfile
from .stl import write_binary
from . import VERSION

def part_stl(part):
    origin=part['bounds']['min']
    mesh=[[[v[i]-origin[i] for i in range(3)] for v in t] for t in part['mesh']]
    return write_binary(mesh)

def kit(model):
    if not model['stats']['allFit']:raise ValueError('Не все детали помещаются в заданную область печати.')
    buffer=io.BytesIO()
    manifest={'version':VERSION,'units':'mm','modelType':'stl','mode':model['mode'],'parameters':model['p'],'parts':[]}
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for part in model['parts']:
            if not part['printable']:continue
            raw=part_stl(part);z.writestr(part['filename'],raw)
            manifest['parts'].append({'id':part['id'],'label':part['label'],'file':part['filename'],'size':part['bounds']['size'],
                'assemblyTranslation':part['bounds']['min'],'triangles':len(part['mesh']),'sha256':hashlib.sha256(raw).hexdigest()})
        z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        z.writestr('READ_BEFORE_PRINT.txt','Опытная оснастка. Физическая печать и заливка не проверены.\nПроверьте извлечение, поднутрения, вентиляцию и герметизацию.\nСетки в миллиметрах. Ориентация и поддержки выбираются в слайсере.\n')
    return buffer.getvalue()
