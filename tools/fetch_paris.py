#!/usr/bin/env python3
"""
Limites de Paris, arrondissements, et rattachement de chaque station à son
arrondissement. Écrit data/paris.json.

    python3 tools/fetch_paris.py

À lancer après build_data.py : le rattachement des stations lit data/network.json.

Sources : API Découpage administratif (Etalab) pour le contour de la commune,
Paris Open Data pour les arrondissements.
"""
import gzip, json, os, urllib.request

from build_data import encode

CITY = ("https://geo.api.gouv.fr/communes/75056"
        "?fields=nom,contour&format=geojson&geometry=contour")
DISTRICTS = ("https://opendata.paris.fr/api/explore/v2.1/catalog/datasets"
             "/arrondissements/exports/geojson")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":                      # servi en gzip
        raw = gzip.decompress(raw)
    return json.loads(raw)


def rings(geom):
    """Anneaux d'un Polygon ou MultiPolygon, en (lat, lon)."""
    parts = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [[(lat, lon) for lon, lat in ring] for poly in parts for ring in poly]


def inside(rings_, lat, lon):
    """Test d'appartenance par lancer de rayon."""
    hit = False
    for ring in rings_:
        for i in range(len(ring)):
            (ay, ax), (by, bx) = ring[i - 1], ring[i]
            if (ay > lat) != (by > lat):
                if lon < ax + (bx - ax) * (lat - ay) / (by - ay):
                    hit = not hit
    return hit


def main():
    city = fetch(CITY)
    outline = rings(city["geometry"])

    raw = fetch(DISTRICTS)["features"]
    districts = []
    for f in sorted(raw, key=lambda f: f["properties"]["c_ar"]):
        districts.append({
            "n": f["properties"]["c_ar"],
            "name": f["properties"]["l_aroff"],
            "rings": rings(f["geometry"]),
        })

    # rattachement des stations, si le réseau a déjà été construit
    where, tally = [], {}
    net_path = os.path.join(OUT, "network.json")
    if os.path.exists(net_path):
        stations = json.load(open(net_path))["stations"]
        for name, lat, lon, _ in stations:
            n = 0
            for d in districts:
                if inside(d["rings"], lat, lon):
                    n = d["n"]
                    break
            where.append(n)
            tally[n] = tally.get(n, 0) + 1
        print(f"stations rattachées : {len(where) - tally.get(0, 0)} dans Paris, "
              f"{tally.get(0, 0)} hors des limites")
        print("  par arrondissement : " +
              "  ".join(f"{n}e:{tally.get(n, 0)}" for n in range(1, 21)))
    else:
        print("data/network.json absent : rattachement des stations ignoré")

    out = {
        "rings": [encode(r) for r in outline],
        "districts": [{"n": d["n"], "name": d["name"],
                       "rings": [encode(r) for r in d["rings"]]} for d in districts],
        "stationDistrict": where,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "paris.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"contour : {len(outline)} anneau(x) · arrondissements : {len(districts)}")


if __name__ == "__main__":
    main()
