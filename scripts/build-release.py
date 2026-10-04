#!/usr/bin/env python3
"""Build a source bundle, actual example tooling and a checksum manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from vmg_backend import VERSION
from vmg_backend.generator import generate
from vmg_backend.export import kit
from vmg_backend.demos import NAMES,demo

parser=argparse.ArgumentParser();parser.add_argument('--output',default='dist');parser.add_argument('--screenshots',default='artifacts/stl');args=parser.parse_args()
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
for name in NAMES:
    path=ROOT/'examples'/f'{name}.stl'
    if not path.exists():path.write_bytes(demo(name))
for name,kind in [('medallion','box'),('capsule','negative')]:
    print('Генерация примера:',name,kind,flush=True)
    model=generate((ROOT/'examples'/f'{name}.stl').read_bytes(),{'kind':kind})
    (out/f'example-{name}-{kind}-STL.zip').write_bytes(kit(model))
images=Path(args.screenshots)
for source,target in [('stl-box.png','preview-stl-box.png'),('stl-negative.png','preview-stl-negative.png')]:
    if not (images/source).exists():raise SystemExit('Нет настоящего снимка интерфейса: '+str(images/source))
    shutil.copyfile(images/source,out/target)
source_zip=out/f'vase-mold-generator-{VERSION}.zip'
ignored={'.git','.agent-skills','__pycache__','artifacts','output','dist','node_modules'}
with zipfile.ZipFile(source_zip,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for path in sorted(ROOT.rglob('*')):
        rel=path.relative_to(ROOT)
        if path.is_file() and not any(x in ignored for x in rel.parts) and not path.is_relative_to(out) and path.suffix not in ('.pyc','.log'):
            z.write(path,Path(f'vase-mold-generator-{VERSION}')/rel)
notes='''# Опалубка 0.3.1 — детализация и проверка геометрии

Три профиля хордовой аппроксимации (0,10 / 0,03 / 0,01 мм), своё отклонение и
ручные сегменты вазы. Исходный STL не сглаживается и не упрощается скрыто.

Усилены проверки топологии и численных пересечений. Незавершённая проверка
не означает успех: выдача CSG блокируется. Видны число граней и качество сетки.
Добавлены рёбра просмотра и сравнение аналитического/сеточного объёма вазы.

Исправлены атомарный импорт JSON, скрытые ошибочные параметры другого режима,
Escape при выборе канала, двойная отправка и поздние результаты. Исходный
STL-проект можно сохранять до CAD-расчёта.

Запуск: Python 3.9+, для CSG установленный OpenSCAD. Нет дополнительных
Python-библиотек, Docker и облака. Аудит и условия проверок — docs/AUDIT-0.3.1.md.

Не выполнена физическая печать и заливка. Численная проверка не доказывает
извлекаемость, отсутствие всех касаний в предельных конфигурациях или прочность.
'''
(out/'RELEASE_NOTES.md').write_text(notes,encoding='utf-8')
checks=[]
for path in sorted(out.iterdir()):
    if path.is_file() and path.name!='SHA256SUMS':checks.append(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name)
(out/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
print('Пакет:',source_zip,flush=True)
