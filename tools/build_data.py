#!/usr/bin/env python3
"""
Construit le jeu de donnees du site a partir du GTFS d'Ile-de-France Mobilites.

    python3 tools/build_data.py chemin/vers/IDFM-gtfs.zip

Produit dans data/ :
  network.json  - lignes, traces, stations, patterns (sequences d'arrets + distances)
  day-N.json    - courses du jour de semaine N (0=lundi ... 6=dimanche)

Le GTFS complet (~135 Mo) se telecharge ici :
  https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip
"""
import zipfile, csv, io, json, sys, math, collections, datetime, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
LAT0 = 48.86  # latitude de reference pour la projection metrique locale


def read(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def to_sec(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def project(lat, lon):
    """Coordonnees planes en metres, suffisamment exactes a l'echelle de Paris."""
    return (math.radians(lon) * 6371000 * math.cos(math.radians(LAT0)),
            math.radians(lat) * 6371000)


def cumulative(pts):
    """Distances cumulees le long d'une polyligne de points (lat, lon)."""
    xy = [project(la, lo) for la, lo in pts]
    cum = [0.0]
    for i in range(1, len(xy)):
        cum.append(cum[-1] + math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    return xy, cum


def snap(xy, cum, p, start_at):
    """Distance le long de la polyligne du point le plus proche de p,
    en cherchant a partir de start_at pour garder l'ordre des arrets."""
    best = (float("inf"), start_at)
    for i in range(len(xy) - 1):
        if cum[i + 1] < start_at - 150:  # tolerance de recul (boucles, terminus)
            continue
        (ax, ay), (bx, by) = xy[i], xy[i + 1]
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        t = 0.0 if seg == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / seg))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(p[0] - px, p[1] - py)
        if d < best[0]:
            best = (d, cum[i] + t * math.sqrt(seg))
    return best[1], best[0]


def encode(pts):
    """Encodage polyligne Google (precision 5) : ~6 octets par point au lieu de ~22."""
    out, plat, plon = [], 0, 0
    for lat, lon in pts:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def main(path):
    z = zipfile.ZipFile(path)

    routes = {r["route_id"]: r for r in read(z, "routes.txt") if r["route_type"] == "1"}
    order = sorted(routes.values(), key=lambda r: (len(r["route_short_name"]), r["route_short_name"]))
    line_idx = {r["route_id"]: i for i, r in enumerate(order)}
    print(f"lignes de metro : {len(routes)}")

    trips = {t["trip_id"]: t for t in read(z, "trips.txt") if t["route_id"] in routes}
    shape_ids = {t["shape_id"] for t in trips.values() if t["shape_id"]}
    print(f"courses : {len(trips)}   traces : {len(shape_ids)}")

    # --- horaires (le gros fichier : on le parcourt en flux) ---
    times = collections.defaultdict(list)
    with z.open("stop_times.txt") as f:
        rd = csv.reader(io.TextIOWrapper(f, "utf-8-sig"))
        hdr = next(rd)
        i_t, i_a, i_d, i_s, i_q = (hdr.index(c) for c in
            ("trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"))
        for r in rd:
            if r[i_t] in trips:
                times[r[i_t]].append((int(r[i_q]), to_sec(r[i_a]), to_sec(r[i_d]), r[i_s]))
    for v in times.values():
        v.sort()
    print(f"horaires charges pour {len(times)} courses")

    # --- traces ---
    shapes = collections.defaultdict(list)
    with z.open("shapes.txt") as f:
        rd = csv.reader(io.TextIOWrapper(f, "utf-8-sig"))
        hdr = next(rd)
        i_i, i_la, i_lo, i_q = (hdr.index(c) for c in
            ("shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"))
        for r in rd:
            if r[i_i] in shape_ids:
                shapes[r[i_i]].append((int(r[i_q]), float(r[i_la]), float(r[i_lo])))
    shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in shapes.items()}

    # --- arrets ---
    stops = {s["stop_id"]: s for s in read(z, "stops.txt")}

    def station_of(sid):
        """Un quai remonte a sa station mere : une seule pastille pour Chatelet."""
        s = stops.get(sid)
        if s and s.get("parent_station") in stops:
            return s["parent_station"]
        return sid

    # --- patterns : shape + sequence d'arrets, partages par des milliers de courses ---
    shape_geo = {k: cumulative(v) for k, v in shapes.items()}
    shape_idx, shape_list = {}, []
    patterns, pattern_idx = [], {}
    stations, station_idx = [], {}
    skipped = collections.Counter()
    worst = 0.0

    for tid, t in trips.items():
        seq = times.get(tid)
        if not seq or not t["shape_id"] or t["shape_id"] not in shape_geo:
            skipped["sans trace ou horaires"] += 1
            continue
        key = (t["shape_id"], tuple(s for _, _, _, s in seq))
        if key in pattern_idx:
            continue
        xy, cum = shape_geo[t["shape_id"]]
        dists, cursor, ok = [], 0.0, True
        for _, _, _, sid in seq:
            s = stops.get(sid)
            if not s:
                ok = False
                break
            d, err = snap(xy, cum, project(float(s["stop_lat"]), float(s["stop_lon"])), cursor)
            worst = max(worst, err)
            dists.append(d)
            cursor = d
        if not ok or cum[-1] <= 0:
            skipped["arret introuvable"] += 1
            continue

        if t["shape_id"] not in shape_idx:
            shape_idx[t["shape_id"]] = len(shape_list)
            shape_list.append(shapes[t["shape_id"]])

        sids = []
        for _, _, _, sid in seq:
            st = station_of(sid)
            if st not in station_idx:
                s = stops[st]
                station_idx[st] = len(stations)
                stations.append([s["stop_name"], round(float(s["stop_lat"]), 5),
                                 round(float(s["stop_lon"]), 5), set()])
            stations[station_idx[st]][3].add(line_idx[t["route_id"]])
            sids.append(station_idx[st])

        pattern_idx[key] = len(patterns)
        patterns.append([line_idx[t["route_id"]], shape_idx[t["shape_id"]],
                         int(t["direction_id"] or 0), sids,
                         [round(d, 1) for d in dists], t["trip_headsign"]])

    print(f"patterns : {len(patterns)}   stations : {len(stations)}")
    print(f"ecart max arret/trace : {worst:.0f} m" + (f"   ignores : {dict(skipped)}" if skipped else ""))

    network = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "lines": [[r["route_short_name"], "#" + r["route_color"], "#" + r["route_text_color"]] for r in order],
        "shapes": [encode(s) for s in shape_list],
        "shapeLengths": [round(cumulative(s)[1][-1], 1) for s in shape_list],
        "patterns": patterns,
        "stations": [[n, la, lo, sorted(ls)] for n, la, lo, ls in stations],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "network.json"), "w") as f:
        json.dump(network, f, separators=(",", ":"), ensure_ascii=False)

    # --- calendrier ---
    used = {t["service_id"] for t in trips.values()}
    cal = {r["service_id"]: r for r in read(z, "calendar.txt") if r["service_id"] in used}
    exc = collections.defaultdict(dict)
    for r in read(z, "calendar_dates.txt"):
        if r["service_id"] in used:
            exc[r["service_id"]][r["date"]] = r["exception_type"]

    def active(sid, date):
        ds = date.strftime("%Y%m%d")
        e = exc.get(sid, {}).get(ds)
        if e:
            return e == "1"
        c = cal.get(sid)
        return bool(c and c["start_date"] <= ds <= c["end_date"] and c[DAYS[date.weekday()]] == "1")

    # une date representative pour chaque jour de la semaine, dans la periode couverte
    today = datetime.date.today()
    sample = {}
    for i in range(21):
        d = today + datetime.timedelta(days=i)
        sample.setdefault(d.weekday(), d)

    for wd in range(7):
        date = sample[wd]
        svc = {s for s in used if active(s, date)}
        timing_idx, timings, out_trips = {}, [], []
        for tid, t in trips.items():
            if t["service_id"] not in svc:
                continue
            seq = times.get(tid)
            if not seq:
                continue
            key = (t["shape_id"], tuple(s for _, _, _, s in seq))
            pi = pattern_idx.get(key)
            if pi is None:
                continue
            t0 = seq[0][2]
            prof = tuple(x for _, a, d, _ in seq for x in (a - t0, d - t0))
            if prof not in timing_idx:
                timing_idx[prof] = len(timings)
                timings.append(list(prof))
            out_trips.append([pi, timing_idx[prof], t0])
        out_trips.sort(key=lambda x: x[2])
        with open(os.path.join(OUT, f"day-{wd}.json"), "w") as f:
            json.dump({"date": date.isoformat(), "timings": timings, "trips": out_trips},
                      f, separators=(",", ":"))
        print(f"  {DAYS[wd][:3]} ({date}) : {len(out_trips):>6} courses, {len(timings):>5} profils horaires")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
