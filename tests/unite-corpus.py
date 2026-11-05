"""Read-only binary STL topology inventory for the local Unite benchmark.

Requires NumPy only; never imports application geometry code or writes an STL.
The manifest records hashes so every later benchmark can verify its input.
"""
from __future__ import annotations
import argparse
import hashlib
import heapq
import json
from pathlib import Path
import sys
import time
import numpy as np


def inventory(path: Path) -> dict:
    started = time.perf_counter()
    size = path.stat().st_size
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    result = {"name": path.name, "bytes": size, "sha256": digest.hexdigest()}
    if size < 84:
        return {**result, "valid": False, "error": "Empty or truncated STL"}
    with path.open("rb") as stream:
        stream.seek(80)
        count = int.from_bytes(stream.read(4), "little")
    if count * 50 + 84 != size:
        return {**result, "valid": False, "error": "Not an exact binary STL layout", "declaredTriangles": count}
    dtype = np.dtype([("normal", "<f4", (3,)), ("points", "<f4", (3, 3)), ("attribute", "<u2")])
    source = np.memmap(path, dtype=dtype, mode="r", offset=84, shape=count)
    points = np.array(source["points"], dtype=np.float32).reshape(-1, 3)
    points[points == 0] = 0  # -0 and +0 are the same position.
    finite = np.isfinite(points).all()
    if not finite:
        return {**result, "valid": False, "error": "Nonfinite positions", "triangles": count}
    vertices, inverse = np.unique(points, axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3).astype(np.uint32)
    canonical = np.sort(faces, axis=1)
    unique_faces = np.unique(canonical, axis=0)
    duplicates = count - len(unique_faces)
    directed_edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    sorted_edges = np.sort(directed_edges, axis=1)
    edges, edge_inverse, incidences = np.unique(sorted_edges, axis=0, return_inverse=True, return_counts=True)
    signed_incidence = np.bincount(edge_inverse, weights=np.where(directed_edges[:, 0] < directed_edges[:, 1], 1, -1))
    parent = np.arange(len(vertices), dtype=np.uint32)
    weight = np.ones(len(vertices), dtype=np.uint32)

    def root(x):
        x = int(x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = int(parent[x])
        return x

    for edge in edges:
        a, b = root(edge[0]), root(edge[1])
        if a != b:
            if weight[a] < weight[b]:
                a, b = b, a
            parent[b] = a
            weight[a] += weight[b]
    face_roots = np.fromiter((root(x) for x in faces[:, 0]), dtype=np.uint32, count=count)
    component_ids, component_faces = np.unique(face_roots, return_counts=True)
    # Analyze topology after exact duplicate removal as well as raw input.
    clean_edges = np.sort(np.concatenate([unique_faces[:, [0, 1]], unique_faces[:, [1, 2]], unique_faces[:, [2, 0]]]), axis=1)
    clean_edges, clean_incidence = np.unique(clean_edges, axis=0, return_counts=True)
    component_bad = set(root(a) for a in clean_edges[clean_incidence != 2, 0])
    triangle_points = points.reshape(-1, 3, 3).astype(np.float64)
    normals = np.cross(triangle_points[:, 1] - triangle_points[:, 0], triangle_points[:, 2] - triangle_points[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    source_normals = np.array(source["normal"], dtype=np.float64)
    agreement = np.einsum("ij,ij->i", normals, source_normals)
    result.update({
        "valid": True, "triangles": count, "uniqueTriangles": len(unique_faces),
        "exactDuplicateTriangles": duplicates, "vertices": len(vertices),
        "degenerateTriangles": int(np.count_nonzero(lengths == 0)),
        "bounds": {"min": vertices.min(axis=0).tolist(), "max": vertices.max(axis=0).tolist()},
        "rawBoundaryEdges": int(np.count_nonzero(incidences == 1)),
        "rawNonmanifoldEdges": int(np.count_nonzero(incidences > 2)),
        "rawInconsistentWindingEdges": int(np.count_nonzero((incidences == 2) & (signed_incidence != 0))),
        "deduplicatedBoundaryEdges": int(np.count_nonzero(clean_incidence == 1)),
        "deduplicatedNonmanifoldEdges": int(np.count_nonzero(clean_incidence > 2)),
        "connectedComponents": len(component_ids),
        "closedComponentsAfterDeduplication": len(component_ids) - len(component_bad),
        "largestComponentsByTriangles": sorted(component_faces.tolist(), reverse=True)[:32],
        "damagedComponentsByTriangles": sorted([int(n) for component, n in zip(component_ids, component_faces) if int(component) in component_bad], reverse=True),
        "closedComponentsByTriangles": sorted([int(n) for component, n in zip(component_ids, component_faces) if int(component) not in component_bad], reverse=True),
        "sourceNormalsOpposeWinding": int(np.count_nonzero(agreement < 0)),
        "sourceNormalsZeroOrOrthogonal": int(np.count_nonzero(agreement == 0)),
        "surfaceArea": float(lengths.sum() / 2),
        "signedVolumeFromStoredWinding": float(np.einsum("ij,ij->i", triangle_points[:, 0], np.cross(triangle_points[:, 1], triangle_points[:, 2])).sum() / 6),
        "inventoryMs": (time.perf_counter() - started) * 1000,
    })
    return result


def read_triangles(path: Path) -> np.ndarray:
    with path.open("rb") as stream:
        stream.seek(80)
        count = int.from_bytes(stream.read(4), "little")
    dtype = np.dtype([("normal", "<f4", (3,)), ("points", "<f4", (3, 3)), ("attribute", "<u2")])
    return np.array(np.memmap(path, dtype=dtype, mode="r", offset=84, shape=count)["points"], dtype=np.float64)


def surface_comparison(source: Path, output: Path, samples: int = 128, source_closed_nonzero: bool = False) -> dict:
    """Sample one-sided boundary displacement against a double BVH oracle.

    Output vertices and triangle centroids must lie on the original triangle
    surface. Interior source faces are intentionally not a reverse target.
    This measures displacement; it does not certify all topology or occupancy.
    """
    triangles = read_triangles(source)
    out = read_triangles(output)
    lo, hi = triangles.min(axis=1), triangles.max(axis=1)
    centers = (lo + hi) / 2
    order = np.arange(len(triangles), dtype=np.int32)
    nodes = []

    def build(first, last):
        ids = order[first:last]
        minimum, maximum = lo[ids].min(axis=0), hi[ids].max(axis=0)
        node = len(nodes)
        nodes.append([minimum, maximum, first, last, -1, -1])
        if last - first > 48:
            axis = int(np.argmax(centers[ids].max(axis=0) - centers[ids].min(axis=0)))
            middle = (first + last) // 2
            order[first:last] = ids[np.argpartition(centers[ids, axis], middle - first)]
            nodes[node][4] = build(first, middle)
            nodes[node][5] = build(middle, last)
        return node

    build(0, len(triangles))

    def bounds_distance(point, node):
        d = np.maximum(np.maximum(node[0] - point, point - node[1]), 0)
        return float(d @ d)

    def triangle_distance(point, tri):
        a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
        ab, ac, ap = b - a, c - a, point - a
        dot = lambda x, y: np.einsum("ij,ij->i", x, y)
        d00, d01, d11 = dot(ab, ab), dot(ab, ac), dot(ac, ac)
        d20, d21 = dot(ap, ab), dot(ap, ac)
        denominator = d00 * d11 - d01 * d01
        safe = np.where(denominator != 0, denominator, 1)
        v, w = (d11 * d20 - d01 * d21) / safe, (d00 * d21 - d01 * d20) / safe
        n = np.cross(ab, ac)
        length = dot(n, n)
        plane = dot(ap, n) ** 2 / np.where(length != 0, length, 1)
        distance = np.where((denominator > 0) & (v >= 0) & (w >= 0) & (v + w <= 1), plane, np.inf)
        for start, end in [(a, b), (b, c), (c, a)]:
            edge, delta = end - start, point - start
            t = np.clip(dot(delta, edge) / np.maximum(dot(edge, edge), 1e-300), 0, 1)
            d = delta - edge * t[:, None]
            distance = np.minimum(distance, dot(d, d))
        return float(distance.min())

    def nearest(point):
        best = float("inf")
        queue = [(bounds_distance(point, nodes[0]), 0)]
        while queue:
            distance, index = heapq.heappop(queue)
            if distance > best:
                break
            node = nodes[index]
            if node[4] == -1:
                best = min(best, triangle_distance(point, triangles[order[node[2]:node[3]]]))
            else:
                for child in node[4:6]:
                    d = bounds_distance(point, nodes[child])
                    if d <= best:
                        heapq.heappush(queue, (d, child))
        return best ** .5

    ids = np.linspace(0, len(out) - 1, min(samples, len(out)), dtype=np.int64)
    points = np.concatenate([out[ids].mean(axis=1), out[ids, 0]])
    errors = np.array([nearest(p) for p in points])
    extent = float(np.max(hi.max(axis=0) - lo.min(axis=0)))
    result = {"samples": len(points), "maxOutputToSourceDistance": float(errors.max()), "p95OutputToSourceDistance": float(np.quantile(errors, .95)), "rmsOutputToSourceDistance": float(np.sqrt(np.mean(errors ** 2))), "sourceExtent": extent, "relativeMaxDistance": float(errors.max() / max(extent, 1e-30)), "method": "Independent Float64 triangle BVH nearest distance at deterministic output vertices and face centroids; one-sided sampled displacement only, no complete topology or occupancy certificate"}
    if source_closed_nonzero:
        # This oracle applies only to independently inventoried, coherently
        # wound, closed one-component source files. Global winding reversal
        # changes every sign and leaves signed nonzero occupancy unchanged.
        direction = np.array([1., 2 ** .5 / 3, 3 ** .5 / 5])
        direction /= np.linalg.norm(direction)
        probe_epsilon = max(extent * 2e-7, 1e-12)

        def contains(point):
            stack, hits = [0], []
            while stack:
                node = nodes[stack.pop()]
                t0, t1 = (node[0] - point) / direction, (node[1] - point) / direction
                enter, leave = np.minimum(t0, t1).max(), np.maximum(t0, t1).min()
                if leave < max(enter, 0):
                    continue
                if node[4] != -1:
                    stack.extend(node[4:6])
                    continue
                tri = triangles[order[node[2]:node[3]]]
                a, e1, e2 = tri[:, 0], tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
                h = np.cross(direction, e2)
                det = np.einsum("ij,ij->i", e1, h)
                safe = np.where(det != 0, det, 1)
                s = point - a
                u = np.einsum("ij,ij->i", s, h) / safe
                q = np.cross(s, e1)
                v = q @ direction / safe
                t = np.einsum("ij,ij->i", e2, q) / safe
                valid = (det != 0) & (u >= -1e-12) & (v >= -1e-12) & (u + v <= 1 + 1e-12) & (t > 1e-12)
                hits.extend(zip(t[valid].tolist(), np.sign(-det[valid]).tolist()))
            hits.sort()
            degree, at, sign = 0, float("-inf"), 0
            for t, crossing in hits:
                if t - at > max(extent * 1e-10, 1e-14):
                    degree += int(np.sign(sign))
                    at, sign = t, crossing
                else:
                    sign += crossing
            degree += int(np.sign(sign))
            return degree != 0

        mismatches, checked = [], 0
        for face in out[ids]:
            normal = np.cross(face[1] - face[0], face[2] - face[0])
            length = np.linalg.norm(normal)
            if not length:
                continue
            center, offset = face.mean(axis=0), normal / length * probe_epsilon
            inside, outside = contains(center - offset), contains(center + offset)
            checked += 1
            if not inside or outside:
                mismatches.append({"point": center.tolist(), "minusInside": inside, "plusInside": outside})
        result["closedSourceBoundaryOracle"] = {"checked": checked, "mismatches": len(mismatches), "examples": mismatches[:8], "probeEpsilon": probe_epsilon, "method": "Independent Float64 oblique BVH signed-nonzero ray crossings on a verified closed, coherent one-component source; source normals unused, global winding sign immaterial. At each sampled output face the minus-normal side must be filled and plus-normal side empty."}
    return result


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--compare-source", type=Path)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--single-closed-source", action="store_true")
    args = parser.parse_args()
    if args.compare_source:
        result = {"topology": inventory(args.directory), "accuracy": surface_comparison(args.compare_source, args.directory, args.samples, args.single_closed_source)}
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            print(json.dumps(result, ensure_ascii=False))
        return
    files = []
    for path in sorted(args.directory.rglob("*.stl"), key=lambda p: p.name.lower()):
        if "".join(path.stem.lower().split()) in {"part1", "part2", "part3"}:
            continue  # Explicitly excluded by the owner of this regression corpus.
        result = inventory(path)
        files.append(result)
        print(json.dumps({key: result[key] for key in ["name", "bytes", "valid", "triangles", "connectedComponents", "inventoryMs"] if key in result}, ensure_ascii=False), flush=True)
    report = {"sourceDirectory": str(args.directory), "sourcePolicy": "Read-only originals; exact SHA-256 verified before and after Unite benchmarks. Part 1, 2 and 3 are excluded at the user request. Originals are never rewritten or committed.", "repairPolicy": {"relativeSurfaceTolerance": 0.0001, "thinMaterialDefects": "Material defects thinner than tolerance may be removed, including films and needles whose lateral contour extends farther than tolerance."}, "vertexEquivalence": "Exact Float32 coordinates; signed zero canonicalized", "files": files}
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
