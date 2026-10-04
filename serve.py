#!/usr/bin/env python3
"""Loopback-only app server with an optional local OpenSCAD job API."""
import base64
import gzip
import hashlib
import hmac
import json
import mimetypes
import secrets
import threading
from argparse import ArgumentParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import webbrowser
from vmg_backend import VERSION
from vmg_backend.stl import MAX_BYTES, MAX_TRIANGLES, ModelError
from vmg_backend.generator import engine_status
from vmg_backend.jobs import Jobs, BusyError

ROOT=Path(__file__).resolve().parent
BODY_LIMIT=22*1024*1024

class Server(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address):
        super().__init__(address,Handler)
        self.token=secrets.token_urlsafe(32)
        self.jobs=Jobs()
        self.engine=engine_status()
        self.demo_cache={}
        self.demo_lock=threading.Lock()
    def server_close(self):
        self.jobs.shutdown()
        super().server_close()

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,fmt,*args):
        # Do not log source models, POST data, local paths, or session tokens.
        pass
    def common(self,status,length,content_type='application/json',extra=None):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(length))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cross-Origin-Resource-Policy','same-origin')
        for k,v in (extra or {}).items():self.send_header(k,v)
        self.end_headers()
    def send(self,value,status=200):
        body=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
        extra={}
        if len(body)>65536 and 'gzip' in self.headers.get('Accept-Encoding',''):
            body=gzip.compress(body,compresslevel=2);extra['Content-Encoding']='gzip';extra['Vary']='Accept-Encoding'
        self.common(status,len(body),extra=extra)
        if self.command!='HEAD':self.wfile.write(body)
    def origin_ok(self,token=False):
        hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in hosts:return False
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://{host}' for host in hosts}:return False
        if self.headers.get('Sec-Fetch-Site')=='cross-site':return False
        if token and not hmac.compare_digest(self.headers.get('X-VMG-Token',''),self.server.token):return False
        return True
    def do_HEAD(self):self.do_GET()
    def do_GET(self):
        if not self.origin_ok():self.send({'error':'Недопустимый Host или Origin.'},403);return
        path=unquote(urlsplit(self.path).path)
        if path=='/api/status':
            self.send({'version':VERSION,'engine':self.server.engine,'token':self.server.token,'maxBytes':MAX_BYTES,'maxTriangles':MAX_TRIANGLES});return
        if path.startswith('/api/jobs/'):
            if not self.origin_ok(token=True):self.send({'error':'Неверный токен сессии.'},403);return
            bits=path.strip('/').split('/')
            job=self.server.jobs.get(bits[2]) if len(bits) in (3,4) else None
            if not job:self.send({'error':'Задание не найдено или истекло. Постройте форму заново.'},404);return
            if len(bits)==4 and bits[3]=='result':
                if job.status!='done':self.send({'error':'Результат ещё не готов.'},409);return
                self.send(job.result);return
            if len(bits)!=3:self.send({'error':'Не найдено.'},404);return
            self.send({'id':job.id,'status':job.status,'stage':job.stage,'percent':job.percent,'error':job.error});return
        allowed=path in ('/','/index.html','/styles.css') or path.startswith(('/src/','/assets/','/examples/','/docs/'))
        local=(ROOT/('index.html' if path=='/' else path.lstrip('/'))).resolve()
        if path.startswith('/examples/') and not local.is_file():
            from vmg_backend.demos import demo,NAMES
            name=path[len('/examples/'):].removesuffix('.stl')
            if path==f'/examples/{name}.stl' and name in NAMES:
                try:
                    with self.server.demo_lock:
                        if name not in self.server.demo_cache:self.server.demo_cache[name]=demo(name)
                        body=self.server.demo_cache[name]
                    self.common(200,len(body),'model/stl')
                    if self.command!='HEAD':self.wfile.write(body)
                except (ValueError,TimeoutError) as error:self.send({'error':str(error)},503)
                return
        if not allowed or any(part.startswith('.') for part in Path(path).parts) or not local.is_relative_to(ROOT) or not local.is_file():
            self.send({'error':'Не найдено.'},404);return
        body=local.read_bytes();kind='text/javascript' if local.suffix=='.js' else mimetypes.guess_type(local.name)[0] or 'application/octet-stream'
        self.common(200,len(body),kind)
        if self.command!='HEAD':self.wfile.write(body)
    def do_POST(self):
        if not self.origin_ok(token=True):
            self.close_connection=True;self.send({'error':'Неверный токен, Host или Origin.'},403);return
        if urlsplit(self.path).path!='/api/jobs':self.close_connection=True;self.send({'error':'Не найдено.'},404);return
        try:
            if self.headers.get('Transfer-Encoding'):raise ModelError('Chunked upload не поддерживается.')
            if 'application/json' not in self.headers.get('Content-Type',''):raise ModelError('Требуется application/json.')
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=BODY_LIMIT:raise ModelError('Допустимый размер запроса — до 22 МиБ.')
            self.connection.settimeout(30)
            data=self.rfile.read(length)
            if len(data)!=length:raise ModelError('Загрузка оборвалась.')
            raw=json.loads(data,parse_constant=lambda s:(_ for _ in ()).throw(ValueError('Не допускаются NaN и Infinity.')))
            if not isinstance(raw,dict) or not isinstance(raw.get('stl'),str):raise ModelError('Ожидаются STL и параметры.')
            model=base64.b64decode(raw['stl'],validate=True)
            if not model or len(model)>MAX_BYTES:raise ModelError('Допустимый размер STL — до 15 МиБ.')
            if not self.server.engine['available']:self.send({'error':'Локальный OpenSCAD не найден. Установите его и перезапустите сервер.'},503);return
            id=self.server.jobs.submit(model,raw.get('parameters',{}))
            self.send({'id':id,'sourceSha256':hashlib.sha256(model).hexdigest()},202)
        except BusyError as error:self.send({'error':str(error)},429)
        except (ValueError,TypeError,KeyError,TimeoutError) as error:
            self.close_connection=True;self.send({'error':str(error)},400)
    def do_DELETE(self):
        if not self.origin_ok(token=True):self.send({'error':'Неверный токен.'},403);return
        path=urlsplit(self.path).path
        job=self.server.jobs.get(path.rsplit('/',1)[-1]) if path.startswith('/api/jobs/') else None
        if not job:self.send({'error':'Задание не найдено.'},404);return
        job.cancel.set();self.send({'status':'cancelling'})

def main():
    parser=ArgumentParser(description='Опалубка — локальный конструктор форм')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Допустимый порт: 1024–65535.')
    try:server=Server(('127.0.0.1',args.port))
    except OSError as error:parser.exit(1,f'Не удалось открыть порт: {error}. Выберите --port 8766.\n')
    url=f'http://127.0.0.1:{args.port}'
    print(f'Опалубка {VERSION}: {url}\nSTL-ядро: {server.engine}\nОстановка: Ctrl+C',flush=True)
    if not args.no_browser:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:print('\nОстановка…')
    finally:server.server_close()

if __name__=='__main__':main()
