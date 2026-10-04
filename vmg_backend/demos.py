"""Generate only bundled, authored demo geometry; never accepts a user script."""
from pathlib import Path
import os
import subprocess
import tempfile
from .generator import openscad_path
from .stl import ModelError
ROOT=Path(__file__).resolve().parents[1]
NAMES=('medallion','capsule','ring')
def demo(name):
    if name not in NAMES:raise ModelError('Неизвестный пример.')
    engine=openscad_path()
    if not engine:raise ModelError('Для подготовки примеров из Git-копии установите OpenSCAD. Свой STL можно просмотреть без него.')
    with tempfile.TemporaryDirectory(prefix='vmg-demo-') as directory:
        out=Path(directory)/'demo.stl'
        try:
            result=subprocess.run([engine,'--export-format','binstl','-D',f'example="{name}"','-o',str(out),str(ROOT/'examples/examples.scad')],capture_output=True,timeout=15,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
        except (OSError,subprocess.TimeoutExpired) as error:
            raise ModelError('Не удалось подготовить пример за 15 секунд. Загрузите свой STL или повторите запрос.') from error
        if result.returncode or not out.exists():raise ModelError('Не удалось создать пример OpenSCAD.')
        return out.read_bytes()
