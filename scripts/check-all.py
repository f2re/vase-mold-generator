#!/usr/bin/env python3
"""Parallel independent test processes. This script does not launch AI agents."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
commands=[('JavaScript',['npm','test']),('STL / API',[sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py','-v'])]
def run(item):
    name,command=item
    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
    return name,result
with ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(run,commands))
for name,result in results:
    print(f'=== {name} ===\n{result.stdout}\n{result.stderr}')
sys.exit(any(result.returncode for _,result in results))
