#!/usr/bin/env python3
"""Build reproducible, original STL demos from examples/examples.scad."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vmg_backend.demos import demo,NAMES,ROOT
for name in NAMES:
    target=ROOT/'examples'/f'{name}.stl';target.write_bytes(demo(name));print(target.name)
