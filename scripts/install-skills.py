#!/usr/bin/env python3
"""Download pinned upstream instructions; never execute their CLI, scripts or hooks."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def git(*args, cwd=None):
    return subprocess.check_output(['git','-c',f'core.hooksPath={os.devnull}',*args],cwd=cwd,text=True).strip()

def main():
    parser=argparse.ArgumentParser(description='Установка закреплённых дизайн-скиллов')
    parser.add_argument('--check',action='store_true',help='Проверить lock-файл без сети и изменений')
    args=parser.parse_args()
    lock=json.loads((ROOT/'skills.lock.json').read_text())
    for item in lock['repositories']:
        if not re.fullmatch(r'[0-9a-f]{40}',item['sha']):raise ValueError('Нужен полный commit SHA')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',item['repository']):raise ValueError('Некорректный репозиторий')
        if not re.fullmatch(r'[a-z0-9-]+',item['name']):raise ValueError('Некорректное имя')
        if '..' in Path(item['skill']).parts or Path(item['skill']).is_absolute():raise ValueError('Небезопасный путь')
        if args.check:
            print(f"OK {item['name']} {item['sha']}")
            continue
        checkout=ROOT/'.agent-skills'/item['name']
        checkout.mkdir(parents=True,exist_ok=True)
        if not (checkout/'.git').exists():git('init',str(checkout))
        git('fetch','--depth=1',f"https://github.com/{item['repository']}.git",item['sha'],cwd=checkout)
        git('checkout','--detach','FETCH_HEAD',cwd=checkout)
        if git('rev-parse','HEAD',cwd=checkout)!=item['sha']:raise RuntimeError('SHA не совпадает')
        source=checkout/item['skill']
        if not (source/'SKILL.md').is_file():
            print(f"Инструкции сохранены: {checkout/item['reading']}. Готовый SKILL.md отсутствует; ссылка не создана.")
            continue
        link=ROOT/'.agents'/'skills'/f"upstream-{item['name']}"
        link.parent.mkdir(parents=True,exist_ok=True)
        if link.is_symlink():link.unlink()
        elif link.exists():raise RuntimeError(f'Не буду заменять существующую папку {link}')
        try:link.symlink_to(os.path.relpath(source,link.parent),target_is_directory=True)
        except OSError as error:
            print(f'Ссылка не создана ({error}); читайте {source} напрямую.',file=sys.stderr)
        print(f"Готово: {item['name']} @ {item['sha']}")
    print('Программы и хуки upstream не запускались. Правила проекта — AGENTS.md.')

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
        print(f'Ошибка установки: {error}',file=sys.stderr)
        raise SystemExit(1)
