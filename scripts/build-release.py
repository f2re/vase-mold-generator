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
notes='''# Опалубка 0.3.0 — формы по STL

ASCII/binary STL → проверка → опалубка по контуру или двухчастный жёсткий негатив.

Добавлены единицы, масштаб, повороты, разъём X/Y/Z, четыре установочных штифта,
литник и до восьми отдушин с выбором точек на реальной 3D-модели. Просмотр и STL
используют одинаковые сетки. Есть отмена, блокировка старого экспорта и JSON-проект
со встроенным исходным STL. Параметрическая ваза сохранена.

Для запуска: Python 3.9+. Для STL-расчёта: установленный OpenSCAD. Никаких Docker,
npm-зависимостей пользователя, облака или сторонних Python-библиотек.

Ограничения: до 15 МиБ / 100 000 граней, один связанный замкнутый компонент для
негатива, приближённая проверка поднутрений. Нет автоматических внутренних
сердечников, 3MF и раскладки по столам. Физическая печать и заливка не проверены.

Архивы примеров — реальный результат генератора, не доказательство извлекаемости
любой отливки. Проверьте посадки, вентиляцию, герметизацию и способ разборки.
'''
(out/'RELEASE_NOTES.md').write_text(notes,encoding='utf-8')
checks=[]
for path in sorted(out.iterdir()):
    if path.is_file() and path.name!='SHA256SUMS':checks.append(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name)
(out/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
print('Пакет:',source_zip,flush=True)
