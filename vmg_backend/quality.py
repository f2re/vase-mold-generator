"""Numerical mesh diagnostics; topology and geometry are separate tests.
No vertex welding here: the exported float32 coordinates are the truth.
BVH tests use double precision, not exact predicates. Resource-limited runs
are reported as incomplete, never as intersection-free.
"""
import math
import time
from collections import defaultdict
from .stl import bounds, cross, dot, sub, signed_volume


def topology(mesh):
    edges = defaultdict(list)
    incident = defaultdict(list)
    faces = set()
    duplicate = degenerate = 0
    n = len(mesh)
    parent = list(range(n))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    indexed = []
    for i, tri in enumerate(mesh):
        vertices = [tuple(v) for v in tri]
        indexed.append(vertices)
        key = tuple(sorted(vertices))
        if key in faces:
            duplicate += 1
        faces.add(key)
        norm = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        if len(set(vertices)) < 3 or dot(norm, norm) == 0:
            degenerate += 1
        for v in set(vertices):
            incident[v].append(i)
        for a, b in zip(vertices, vertices[1:] + vertices[:1]):
            key = (a, b) if a < b else (b, a)
            edges[key].append((i, 1 if a < b else -1))
    for faces_on_edge in edges.values():
        for f, _ in faces_on_edge[1:]:
            parent[root(f)] = root(faces_on_edge[0][0])
    boundary = sum(len(e) == 1 for e in edges.values())
    nonmanifold_edges = sum(len(e) > 2 for e in edges.values())
    orientation = sum(len(e) == 2 and e[0][1] == e[1][1] for e in edges.values())
    bad_vertices = 0
    # The link of a closed manifold vertex is one cycle, not multiple fans.
    for vertex, tris in incident.items():
        graph = defaultdict(set)
        for f in tris:
            others = [v for v in indexed[f] if v != vertex]
            if len(others) != 2:
                continue
            a, b = others
            graph[a].add(b)
            graph[b].add(a)
        if not graph:
            bad_vertices += 1
            continue
        visited = set()
        stack = [next(iter(graph))]
        while stack:
            v = stack.pop()
            if v in visited:
                continue
            visited.add(v)
            stack.extend(graph[v] - visited)
        # Open surfaces are diagnosed through edges, not counted twice here.
        if len(visited) != len(graph) or any(len(g) > 2 for g in graph.values()):
            bad_vertices += 1
    component_faces = defaultdict(list)
    for i in range(n):
        component_faces[root(i)].append(mesh[i])
    volumes = [signed_volume(f) for f in component_faces.values()]
    return dict(triangles=n, vertices=len(incident), boundaryEdges=boundary,
                nonManifoldEdges=nonmanifold_edges, nonManifoldVertices=bad_vertices,
                inconsistentEdges=orientation, duplicateFaces=duplicate,
                degenerateFaces=degenerate, components=len(volumes),
                componentVolumesMm3=volumes,
                watertight=not (boundary or nonmanifold_edges or bad_vertices or orientation or duplicate or degenerate),
                volumeMm3=abs(math.fsum(volumes)), bounds=bounds(mesh))


def _plane_segment(tri, distances, eps):
    pts = []
    for i, a in enumerate(tri):
        b = tri[(i+1) % 3]
        da, db = distances[i], distances[(i+1) % 3]
        if abs(da) <= eps:
            pts.append(a)
        if (da < -eps and db > eps) or (da > eps and db < -eps):
            t = da / (da-db)
            pts.append([a[k]+t*(b[k]-a[k]) for k in range(3)])
    return pts


def _area(poly):
    return sum(a[0]*b[1]-a[1]*b[0] for a, b in zip(poly, poly[1:]+poly[:1]))/2 if poly else 0


def _coplanar_overlap(a, b, normal, eps):
    # Positive-area clipping detects overlapping coplanar triangles, even
    # when they share a vertex/edge. Ordinary common edges have zero area.
    axis = max(range(3), key=lambda i: abs(normal[i]))
    uv = [i for i in range(3) if i != axis]
    poly = [[p[i] for i in uv] for p in a]
    clip = [[p[i] for i in uv] for p in b]
    if _area(clip) < 0:
        clip.reverse()
    def side(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    for c, d in zip(clip, clip[1:]+clip[:1]):
        result = []
        for p, q in zip(poly, poly[1:]+poly[:1]):
            dp, dq = side(c, d, p), side(c, d, q)
            if dp >= 0:
                result.append(p)
            if (dp < 0) != (dq < 0):
                t = dp/(dp-dq)
                result.append([p[i]+t*(q[i]-p[i]) for i in range(2)])
        poly = result
        if len(poly) < 3:
            return False
    scale = max(math.dist(p, q) for tri in (a, b) for p, q in zip(tri, tri[1:]+tri[:1]))
    return abs(_area(poly)) > eps * max(scale, eps) * 4


def triangles_cross(a, b, eps=1e-7):
    na, nb = cross(sub(a[1], a[0]), sub(a[2], a[0])), cross(sub(b[1], b[0]), sub(b[2], b[0]))
    la, lb = math.sqrt(dot(na, na)), math.sqrt(dot(nb, nb))
    if not la or not lb:
        return False  # diagnosed separately
    na, nb = [v/la for v in na], [v/lb for v in nb]
    da, db = [dot(sub(v, b[0]), nb) for v in a], [dot(sub(v, a[0]), na) for v in b]
    if min(da) > eps or max(da) < -eps or min(db) > eps or max(db) < -eps:
        return False
    direction = cross(na, nb)
    length = math.sqrt(dot(direction, direction))
    if max(abs(d) for d in da+db) <= eps:
        return _coplanar_overlap(a, b, na, eps)
    if length < 1e-10:
        return False
    common = set(map(tuple, a)) & set(map(tuple, b))
    if len(common) == 2:
        # Noncoplanar adjacent triangles intersect only along their common edge.
        return False
    # Plane clipping must not invent a segment from near-plane vertices.
    plane_eps = max(1e-12, eps*1e-5)
    pa, pb = _plane_segment(a, da, plane_eps), _plane_segment(b, db, plane_eps)
    if not pa or not pb:
        return False
    direction = [v/length for v in direction]
    aa, bb = [dot(sub(v, a[0]), direction) for v in pa], [dot(sub(v, a[0]), direction) for v in pb]
    return min(max(aa), max(bb)) - max(min(aa), min(bb)) > eps


class _Node:
    __slots__ = ('lo', 'hi', 'ids', 'left', 'right')
    def __init__(self, ids, boxes):
        self.lo = [min(boxes[i][0][j] for i in ids) for j in range(3)]
        self.hi = [max(boxes[i][1][j] for i in ids) for j in range(3)]
        self.ids = ids
        self.left = self.right = None
        if len(ids) > 8:
            axis = max(range(3), key=lambda j: self.hi[j]-self.lo[j])
            ids.sort(key=lambda i: boxes[i][0][axis]+boxes[i][1][axis])
            mid = len(ids)//2
            self.left, self.right = _Node(ids[:mid], boxes), _Node(ids[mid:], boxes)
            self.ids = None


def intersections(mesh, *, max_pairs=500000, seconds=10, cancelled=lambda:False):
    start = time.monotonic()
    boxes = [([min(p[k] for p in t) for k in range(3)], [max(p[k] for p in t) for k in range(3)]) for t in mesh]
    root = _Node(list(range(len(mesh))), boxes)
    eps = max(1e-8, max(b-a for a, b in zip(root.lo, root.hi))*2e-7)
    pairs = 0
    examples = []
    stack = [(root, root)]
    complete = True
    def overlap(a, b):
        return all(a[0][i] <= b[1][i]+eps and b[0][i] <= a[1][i]+eps for i in range(3))
    while stack:
        if pairs >= max_pairs or time.monotonic()-start > seconds or cancelled():
            complete = False
            break
        a, b = stack.pop()
        if a is b:
            if a.ids is None:
                stack.extend([(a.left, a.left), (a.right, a.right), (a.left, a.right)])
                continue
        elif not overlap((a.lo, a.hi), (b.lo, b.hi)):
            continue
        if a.ids is None:
            stack.extend([(a.left, b), (a.right, b)])
        elif b.ids is None:
            stack.extend([(a, b.left), (a, b.right)])
        else:
            for x in a.ids:
                for y in b.ids:
                    if a is b and y <= x:
                        continue
                    if not overlap(boxes[x], boxes[y]):
                        continue
                    pairs += 1
                    if triangles_cross(mesh[x], mesh[y], eps):
                        examples.append([x, y])
                        if len(examples) >= 8:
                            return dict(status='intersections', pairsTested=pairs, examples=examples,
                                        complete=False, toleranceMm=eps, elapsedMs=round((time.monotonic()-start)*1000))
    return dict(status='intersections' if examples else 'clear' if complete else 'incomplete',
                pairsTested=pairs, examples=examples, complete=complete,
                toleranceMm=eps, elapsedMs=round((time.monotonic()-start)*1000))


def audit(mesh, **options):
    report = topology(mesh)
    # Degenerates and nonmanifold topology already disqualify a solid.
    report['selfIntersections'] = intersections(mesh, **options) if report['watertight'] else dict(status='not_checked', complete=False)
    report['geometryChecked'] = report['watertight'] and report['selfIntersections']['status'] == 'clear'
    return report
