"""One local CAD worker, bounded queue, cancellation and short-lived results."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import secrets
import threading
import time
from .generator import generate, parameters

class BusyError(ValueError):
    pass

@dataclass
class Job:
    id: str
    status: str = 'queued'
    stage: str = 'В очереди'
    percent: int = 0
    result: dict = None
    error: str = None
    created: float = field(default_factory=time.monotonic)
    cancel: threading.Event = field(default_factory=threading.Event)

class Jobs:
    def __init__(self):
        self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='vmg-cad')
        self.lock=threading.RLock();self.jobs={}

    def submit(self,data,params):
        params=parameters(params)
        with self.lock:
            if sum(j.status in ('queued','running') for j in self.jobs.values())>=2:
                raise BusyError('В очереди уже два задания. Отмените предыдущее или дождитесь результата.')
            finished=[j for j in self.jobs.values() if j.status not in ('queued','running')]
            for j in sorted(finished,key=lambda j:j.created)[:-2]:self.jobs.pop(j.id,None)
            job=Job(secrets.token_hex(16));self.jobs[job.id]=job
        self.pool.submit(self.run,job,data,params)
        return job.id

    def run(self,job,data,params):
        try:
            if job.cancel.is_set():raise ValueError('Расчёт отменён.')
            job.status='running'
            def progress(text,percent):
                with self.lock:job.stage=text;job.percent=percent
            result=generate(data,params,progress=progress,cancelled=job.cancel.is_set)
            with self.lock:
                if job.cancel.is_set():job.status='cancelled';job.stage='Расчёт отменён.'
                else:job.result=result;job.status='done';job.percent=100;job.stage='Готово'
        except Exception as error:
            with self.lock:
                job.status='cancelled' if job.cancel.is_set() else 'error';job.error=str(error)[:1500];job.stage=job.error

    def get(self,id):
        with self.lock:
            j=self.jobs.get(id)
            if j and time.monotonic()-j.created>1800 and j.status not in ('running','queued'):
                self.jobs.pop(id,None);j=None
            return j

    def shutdown(self):
        for j in list(self.jobs.values()):j.cancel.set()
        self.pool.shutdown(wait=True,cancel_futures=True)
