#!/usr/bin/env python3
"""Serve only this app's public files on loopback. No model upload or processing."""
from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        parts = Path(path).parts
        if any(p.startswith('.') for p in parts) or '..' in parts:
            self.send_error(404)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()


def main():
    parser = ArgumentParser(description='Локальный генератор опалубки')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Допустимый порт: 1024–65535.')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    except OSError as error:
        parser.exit(1, f'Не удалось открыть порт {args.port}: {error}. Выберите --port 8766.\n')
    url = f'http://127.0.0.1:{args.port}'
    print(f'Опалубка: {url}\nОстановка: Ctrl+C', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен.')
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
