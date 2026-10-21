"""Independent 3MF oracle: Python's ZIP/CRC and ElementTree, no application code."""
import hashlib
import json
import math
import posixpath
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET

CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
COLOR = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02'
NS = {'m': CORE}
UNITS = {'micron': .001, 'millimeter': 1, 'centimeter': 10, 'inch': 25.4, 'foot': 304.8, 'meter': 1000}
IDENTITY = [[float(i == j) for j in range(4)] for i in range(4)]
AXIS = [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]]
INVERSE_AXIS = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def pack(values, code):
    return struct.pack('<' + code * len(values), *values)


def sha(values, code):
    return hashlib.sha256(pack(values, code)).hexdigest()


def f32(values):
    return list(struct.unpack('<' + 'f' * len(values), pack(values, 'f')))


def transform(e, unit):
    a = list(map(float, e.get('transform', '1 0 0 0 1 0 0 0 1 0 0 0').split()))
    assert len(a) == 12
    m = [[a[j * 3 + i] if j < 3 else a[9 + i] * unit for j in range(4)] for i in range(3)] + [[0, 0, 0, 1]]
    return mul(mul(AXIS, m), INVERSE_AXIS)


def path(target, base=''):
    from urllib.parse import unquote
    return posixpath.normpath('/' + posixpath.join(base, unquote(target))).lstrip('/')


def inspect(filename):
    with zipfile.ZipFile(filename) as z:
        assert z.testzip() is None
        names = {n.lower(): n for n in z.namelist()}
        read = lambda name: z.read(names[name.lower()])
        rels = ET.fromstring(read('_rels/.rels'))
        target = next(e.get('Target') for e in rels if e.get('Type').endswith('/3dmodel'))
        meshes, models, combined_positions, combined_indices = [], {}, [], []

        def model(name):
            if name not in models:
                root = ET.fromstring(read(name))
                unit = UNITS[root.get('unit', 'millimeter')]
                resources = root.find('m:resources', NS)
                objects = {int(e.get('id')): e for e in resources.findall('m:object', NS)}
                groups = {}
                for e in resources:
                    if e.tag == '{' + CORE + '}basematerials':
                        groups[int(e.get('id'))] = [c.get('displaycolor').upper() for c in e]
                    if e.tag == '{' + COLOR + '}colorgroup':
                        groups[int(e.get('id'))] = [c.get('color').upper() for c in e]
                models[name] = root, unit, objects, groups
            return models[name]

        def visit(name, key, parent, trail, override=None):
            assert (name, key) not in trail
            root, unit, objects, groups = model(name)
            obj = objects[key]
            mesh = obj.find('m:mesh', NS)
            if mesh is None:
                for c in obj.findall('m:components/m:component', NS):
                    target = c.get('{' + PROD + '}path')
                    child = path(target, posixpath.dirname(name)) if target else name
                    visit(child, int(c.get('objectid')), mul(parent, transform(c, unit)), trail + [(name, key)])
                return
            p = []
            for v in mesh.findall('m:vertices/m:vertex', NS):
                p.extend([float(v.get('x')) * unit, float(v.get('z')) * unit, -float(v.get('y')) * unit])
            p = f32(p)
            indices, colors = [], {}
            for f, t in enumerate(mesh.findall('m:triangles/m:triangle', NS)):
                indices.extend(int(t.get('v' + str(i))) for i in (1, 2, 3))
                pid = t.get('pid', obj.get('pid'))
                if pid is not None:
                    index = int(t.get('p1', obj.get('pindex', '0')))
                    rgba = groups[int(pid)][index]
                    if len(rgba) == 7:
                        rgba += 'FF'
                    colors.setdefault(rgba, []).append(f)
            world = []
            for first in range(0, len(p), 3):
                v = p[first:first + 3]
                world.extend(v if parent == IDENTITY else [parent[i][0] * v[0] + parent[i][1] * v[1] + parent[i][2] * v[2] + parent[i][3] for i in range(3)])
            world = f32(world)
            a, b, c = parent[:3]
            det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
            world_ix = [indices[i + j] for i in range(0, len(indices), 3) for j in ([0, 2, 1] if det < 0 else [0, 1, 2])]
            meshes.append({'name': override or obj.get('name') or 'Object ' + str(key), 'type': obj.get('type', 'model'), 'vertices': len(p) // 3, 'triangles': len(indices) // 3,
                           'positionsSHA256': sha(p, 'f'), 'indicesSHA256': sha(indices, 'I'), 'worldPositionsSHA256': sha(world, 'f'), 'worldIndicesSHA256': sha(world_ix, 'I'),
                           'worldMatrix': [parent[i][j] for j in range(4) for i in range(4)],
                           'colors': [{'rgba': rgba, 'count': len(ids), 'sample': ids[0]} for rgba, ids in colors.items()]})
            base = len(combined_positions) // 3
            combined_positions.extend(world)
            combined_indices.extend(i + base for i in world_ix)

        name = path(target)
        root, unit, _, _ = model(name)
        for item in root.findall('m:build/m:item', NS):
            visit(name, int(item.get('objectid')), transform(item, unit), [], item.get('partnumber'))
        return {'meshes': meshes, 'buildItems': len(root.findall('m:build/m:item', NS)), 'positionsSHA256': sha(combined_positions, 'f'), 'indicesSHA256': sha(combined_indices, 'I'),
                'vertices': len(combined_positions) // 3, 'triangles': len(combined_indices) // 3}


if __name__ == '__main__':
    if sys.argv[1] == '--pack':
        entries = json.load(sys.stdin)
        with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_STORED if '--stored' in sys.argv else zipfile.ZIP_DEFLATED) as z:
            for name, text in entries.items():
                z.writestr(name, text.encode('utf-8'))
    else:
        print(json.dumps(inspect(sys.argv[1]), separators=(',', ':')))
