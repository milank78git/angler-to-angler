"""Build compact, attributed river linework from OSM relation/full XML downloads."""
import argparse
import json
from pathlib import Path
from xml.etree import ElementTree


def extract(path, bounds):
    """Retain visible river polylines, including one neighbouring point at each end."""
    root = ElementTree.parse(path).getroot()
    nodes = {n.get("id"): [float(n.get("lon")), float(n.get("lat"))] for n in root.findall("node")}
    west, south, east, north = bounds
    lines = []
    for way in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        if tags.get("waterway") != "river":
            continue
        coords = [nodes[n.get("ref")] for n in way.findall("nd")]
        current = []
        for a, b in zip(coords, coords[1:]):
            if max(a[0], b[0]) < west or min(a[0], b[0]) > east or max(a[1], b[1]) < south or min(a[1], b[1]) > north:
                if len(current) > 1:
                    lines.append(current)
                current = []
                continue
            if not current:
                current.append(a)
            current.append(b)
        if len(current) > 1:
            lines.append(current)
    return [[[round(x, 5), round(y, 5)] for x, y in line] for line in lines]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("berounka", type=Path)
    parser.add_argument("sazava", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = {"attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0",
              "401001": extract(args.berounka, [14.312, 49.932, 14.407, 50.003]),
              "401009": extract(args.sazava, [14.415, 49.844, 14.557, 49.888])}
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
