"""Run with python -m unittest discover -s tests -p test_*.py -v."""
import base64
import hashlib
import http.client
import json
import math
from pathlib import Path
import struct
import threading
import unittest
from vmg_backend.stl import parse,clean,info,transform,write_binary,bounds,ray_hits,ModelError
from vmg_backend.generator import generate,parameters,prepare,openscad_path
from serve import Server

ROOT=Path(__file__).resolve().parents[1]

def example(name='capsule'):
    return (ROOT/'examples'/f'{name}.stl').read_bytes()

class STLTests(unittest.TestCase):
    def test_binary(self):
        m=parse(example());self.assertGreater(len(m),10);self.assertTrue(info(clean(m)[0])['watertight'])
    def test_binary_solid_header(self):
        data=bytearray(example());data[:5]=b'solid';self.assertEqual(len(parse(bytes(data))),len(parse(example())))
    def test_ascii(self):
        m=parse(example())[:4]
        text='solid test\n'+''.join('facet normal 0 0 0\nouter loop\n'+''.join('vertex '+' '.join(map(str,v))+'\n' for v in t)+'endloop\nendfacet\n' for t in m)+'endsolid test\n'
        self.assertEqual(parse(text.encode()),m)
    def test_truncated(self):
        for data in [b'',example()[:-1],b'solid x\nfacet normal nan 0 0\nendsolid x']:
            with self.assertRaises(ModelError):parse(data)
    def test_nonfinite(self):
        data=bytearray(example());struct.pack_into('<f',data,96,float('nan'))
        with self.assertRaises(ModelError):parse(bytes(data))
    def test_duplicates_reported(self):
        m=parse(example());c,n=clean(m+[m[0]])
        self.assertEqual(n,1);self.assertEqual(len(c),len(m));self.assertTrue(info(c)['watertight'])
    def test_open_mesh_negative_rejected(self):
        data=write_binary(parse(example())[1:])
        with self.assertRaisesRegex(ModelError,'замкнутая'):prepare(data,{'kind':'negative'})
        _,_,report,warnings=prepare(data,{'kind':'box'});self.assertFalse(report['watertight']);self.assertTrue(warnings)
    def test_winding_repair(self):
        data=write_binary([[c,b,a] for a,b,c in parse(example())]);_,_,report,notes=prepare(data,{})
        self.assertEqual(report['orientation'],1);self.assertTrue(any('Ориентация' in n for n in notes))
    def test_settings_validation(self):
        for p in [{'kind':'../../script'},{'units':'inch); import("/etc/passwd")'},{'scale':float('nan')},{'scale':True},{'vents':[1]},{'sprueX':3},{'splitPercent':101},{'keyDiameter':8,'padding':8}]:
            with self.assertRaises(ModelError):parameters(p)
    def test_rotation_and_scale(self):
        p=parameters({'scale':.5,'ry':90});m=transform(parse(example()),p);size=bounds(m)['size'];self.assertAlmostEqual(size[0],25.942215,places=4)
    def test_ray_point(self):
        m=transform(parse(example()),parameters({}));self.assertEqual(len(ray_hits(m,0,0)),2);self.assertEqual(ray_hits(m,999,0),[])

@unittest.skipUnless(openscad_path(),'OpenSCAD must be installed for CSG tests')
class CSGTests(unittest.TestCase):
    def test_box_hull_and_control_silicone(self):
        m=generate(example('medallion'),{})
        self.assertEqual(m['stats']['printCount'],3);self.assertTrue(m['stats']['allFit']);self.assertGreater(m['stats']['totalMl'],1)
        for p in m['parts']:
            if p['printable']:self.assertTrue(p['quality']['watertight']);self.assertEqual(p['quality']['components'],1)
    def test_rectangle(self):
        m=generate(example('medallion'),{'footprint':'rectangle'})
        self.assertEqual(m['stats']['printCount'],3);self.assertGreater(m['stats']['totalMl'],47)
    def test_negative_topology_keys_channels(self):
        m=generate(example(),{'kind':'negative','vents':[[5,0]]})
        self.assertEqual(m['stats']['printCount'],2);self.assertEqual(len(m['split']['channels']),2)
        for p in m['parts'][:2]:self.assertTrue(p['quality']['watertight']);self.assertEqual(p['quality']['components'],1)
        self.assertGreater(m['parts'][0]['bounds']['size'][0],m['parts'][1]['bounds']['size'][0])
    def test_split_axes(self):
        for axis in ('y','z'):
            m=generate(example(),{'kind':'negative','splitAxis':axis})
            self.assertEqual(m['split']['axis'],'xyz'.index(axis));self.assertEqual(m['stats']['printCount'],2)
    def test_regeneration(self):
        a=generate(example(),{'kind':'negative','scale':.5});b=generate(example(),{'kind':'negative','scale':.7})
        self.assertNotEqual(a['parts'][0]['bounds']['size'],b['parts'][0]['bounds']['size'])
    def test_missed_channel(self):
        with self.assertRaisesRegex(ModelError,'не попадает'):generate(example(),{'kind':'negative','sprueX':500,'sprueY':500})
    def test_possible_undercuts(self):
        m=generate(example('ring'),{'kind':'negative','splitAxis':'x'})
        self.assertGreater(m['split']['draft']['suspect'],0)
    def test_high_box_tiers_and_oversize_base(self):
        m=generate(example(),{'scale':5,'printerZ':120})
        self.assertGreater(m['stats']['printCount'],3)
    def test_cancel_before_csg(self):
        with self.assertRaisesRegex(ModelError,'отменён'):generate(example(),{},cancelled=lambda:True)
    def test_time_limit(self):
        with self.assertRaisesRegex(ModelError,'лимит'):generate(example(),{},timeout=.001)
    def test_disconnected_negative_rejected(self):
        mesh=parse(example());other=[[[v[0]+100,*v[1:]] for v in t] for t in mesh]
        with self.assertRaisesRegex(ModelError,'одну связанную'):generate(write_binary(mesh+other),{'kind':'negative'})

class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=Server(('127.0.0.1',0));cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.port=cls.server.server_port
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join(3)
    def request(self,path='/',method='GET',body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5);c.request(method,path,body,headers or {});r=c.getresponse();data=r.read();c.close();return r.status,data
    def test_static(self):
        s,b=self.request();self.assertEqual(s,200);self.assertIn('Загрузить STL'.encode(),b)
    def test_health(self):
        s,b=self.request('/api/status');self.assertEqual(s,200);self.assertEqual(json.loads(b)['version'],'0.3.0')
    def test_host(self):self.assertEqual(self.request(headers={'Host':'evil.example'})[0],403)
    def test_origin(self):self.assertEqual(self.request('/api/status',headers={'Origin':'https://evil.example'})[0],403)
    def test_no_token(self):self.assertEqual(self.request('/api/jobs','POST','{}',{'Content-Type':'application/json'})[0],403)
    def test_wrong_token(self):self.assertEqual(self.request('/api/jobs','POST','{}',{'Content-Type':'application/json','X-VMG-Token':'x'})[0],403)
    def test_hidden_files_and_head(self):
        for p in ['/.git/config','/../serve.py','/%2e%2e/serve.py','/vmg_backend/stl.py','/scripts/install-skills.py']:
            self.assertEqual(self.request(p)[0],404)
        self.assertEqual(self.request('/.git/config','HEAD')[0],404)
    def test_bad_json(self):
        self.assertEqual(self.request('/api/jobs','POST','{"stl":NaN}',{'Content-Type':'application/json','X-VMG-Token':self.server.token})[0],400)
    def test_huge_content_length(self):
        self.assertEqual(self.request('/api/jobs','POST',b'',{'Content-Type':'application/json','X-VMG-Token':self.server.token,'Content-Length':str(30*1024*1024)})[0],400)
    def test_unknown_job(self):self.assertEqual(self.request('/api/jobs/unknown',headers={'X-VMG-Token':self.server.token})[0],404)

if __name__=='__main__':unittest.main()
