import json
import math
from pathlib import Path
import unittest
from unittest.mock import patch
from vmg_backend.stl import info,write_binary,ModelError
from vmg_backend.quality import topology,intersections,audit,triangles_cross
from vmg_backend.resolution import segments,tolerance
from vmg_backend.generator import generate,prepare,openscad_path

ROOT=Path(__file__).resolve().parents[1]
def prism(points,height=2):
    verts=[[*p,z] for z in (0,height) for p in points];n=len(points);faces=[]
    for i in range(n):
        j=(i+1)%n;faces.extend([(i,j,j+n),(i,j+n,i+n)])
    for i in range(1,n-1):faces.extend([(0,i+1,i),(n,n+i,n+i+1)])
    return [[verts[i] for i in f]for f in faces]
def cube(w=10,d=10,h=10):return prism([(0,0),(w,0),(w,d),(0,d)],h)

def shifted(mesh,delta):return [[[v[i]+delta[i]for i in range(3)]for v in t]for t in mesh]

class TopologyTests(unittest.TestCase):
    def test_exact_volume_cube(self):
        q=audit(cube());self.assertTrue(q['geometryChecked']);self.assertEqual(q['volumeMm3'],1000)
    def test_edges_alone_miss_connected_self_intersection(self):
        bowtie=prism([(0,0),(3,3),(0,3),(2,0)])
        self.assertTrue(info(bowtie)['watertight']);self.assertEqual(info(bowtie)['components'],1)
        self.assertEqual(audit(bowtie)['selfIntersections']['status'],'intersections')
        with self.assertRaisesRegex(ModelError,'геометрическую'):prepare(write_binary(bowtie),{'kind':'negative'})
    def test_self_intersecting_master_can_only_make_box_without_volume(self):
        q=prepare(write_binary(prism([(0,0),(3,3),(0,3),(2,0)])),{'kind':'box'})
        self.assertFalse(q[2]['geometryChecked']);self.assertTrue(q[3])
    def test_vertex_touching_components_are_not_manifold(self):
        m=cube()+shifted(cube(),[10,10,10]);q=topology(m)
        self.assertEqual(q['boundaryEdges'],0);self.assertEqual(q['nonManifoldVertices'],1);self.assertFalse(q['watertight'])
    def test_duplicate_and_degenerate_faces_not_silently_accepted(self):
        m=cube();q=topology(m+[m[0],[m[0][0]]*3]);self.assertEqual(q['duplicateFaces'],1);self.assertEqual(q['degenerateFaces'],1);self.assertFalse(q['watertight'])
    def test_open_edge_and_bad_orientation(self):
        m=cube();self.assertGreater(topology(m[1:])['boundaryEdges'],0)
        m[0].reverse();self.assertGreater(topology(m)['inconsistentEdges'],0)
    def test_two_nonoverlapping_solids_report_components(self):
        q=audit(cube()+shifted(cube(),[20,0,0]));self.assertEqual(q['components'],2);self.assertEqual(q['volumeMm3'],2000);self.assertEqual(q['selfIntersections']['status'],'clear')
    def test_overlapping_closed_shells_not_reported_clear(self):
        self.assertEqual(audit(cube()+shifted(cube(),[4,0,0]))['selfIntersections']['status'],'intersections')
    def test_coplanar_adjacent_triangles_do_not_overlap(self):
        self.assertFalse(triangles_cross([[0,0,0],[1,0,0],[0,1,0]],[[1,0,0],[1,1,0],[0,1,0]]))
    def test_coplanar_overlap_detected_even_with_shared_edge(self):
        self.assertTrue(triangles_cross([[0,0,0],[1,0,0],[0,1,0]],[[0,0,0],[1,0,0],[.2,.5,0]]))
    def test_limited_check_never_claims_clear(self):
        self.assertEqual(intersections(cube(),max_pairs=0)['status'],'incomplete')
        self.assertFalse(audit(cube(),seconds=0)['geometryChecked'])
    def test_resolution_bound(self):
        for r in [.5,4,100,800]:
            for e in [.005,.01,.03,.1,.2]:self.assertLessEqual(r*(1-math.cos(math.pi/segments(r,e))),e)
    def test_resolution_invalid(self):
        for p in [{'detail':[]},{'detail':'unknown'},{'chordTolerance':True},{'chordTolerance':0}]:
            with self.assertRaises(ModelError):tolerance(p)

@unittest.skipUnless(openscad_path(),'Needs OpenSCAD')
class AccuracyTests(unittest.TestCase):
    def test_box_volume_against_independent_analytic_formula(self):
        w,d,h=40,20,10;gap=10;head=8
        exact=(w*d+2*gap*(w+d)+math.pi*gap**2)*(h+head)-w*d*h
        errors=[]
        for detail in ['draft','standard','fine']:
            model=generate(write_binary(cube(w,d,h)),{'detail':detail})
            error=abs(model['stats']['totalMl']*1000-exact);errors.append(error)
            self.assertLess(error/exact,.005)
            for p in model['parts']:
                if p['printable']:self.assertTrue(p['quality']['geometryChecked']);self.assertEqual(p['quality']['components'],1)
        self.assertGreater(errors[0],errors[-1])
    def test_quality_preserves_master_and_changes_only_added_surfaces(self):
        raw=(ROOT/'examples/capsule.stl').read_bytes()
        models=[generate(raw,{'kind':'negative','detail':d})for d in ['draft','fine']]
        self.assertEqual(models[0]['parts'][-1]['mesh'],models[1]['parts'][-1]['mesh'])
        self.assertGreater(len(models[1]['parts'][0]['mesh']),len(models[0]['parts'][0]['mesh']))
    def test_high_quality_rotated_thin_and_small_parameters(self):
        raw=write_binary(cube(12,8,2))
        m=generate(raw,{'kind':'negative','detail':'fine','rx':15,'ry':25,'rz':35,'padding':12})
        for p in m['parts'][:2]:self.assertTrue(p['quality']['geometryChecked'])
    def test_incomplete_output_quality_blocks_result(self):
        from vmg_backend import generator
        actual=generator.audit
        calls=[0]
        def limited(mesh,**kwargs):
            q=actual(mesh,**kwargs);calls[0]+=1
            if calls[0]>1:q['geometryChecked']=False
            return q
        with patch.object(generator,'audit',limited):
            with self.assertRaisesRegex(ModelError,'STL не выдан'):generate(write_binary(cube()),{})
