#!/usr/bin/env python3
"""Genera los datos de calles de todos los municipios de España a partir de OpenStreetMap.

Salida:
  data/municipios.json   índice: [[id, nombre, provincia, lat, lon, nCalles], ...]
  data/m/<id>.json       calles de cada municipio (ver formato más abajo)

Uso:
  python tools/build_data.py ../osm-raw/spain-latest.osm.pbf ../osm-raw/canary-islands-latest.osm.pbf

Los .osm.pbf se descargan de https://download.geofabrik.de (europe/spain y africa/canary-islands).

Formato de data/m/<id>.json:
  {"id", "name", "prov", "center": [lat, lon], "bbox": [s, w, n, e],
   "streets": [[nombre, [tramo, tramo, ...]], ...]}
  Cada tramo es una lista plana de enteros en unidades de 1e-5 grados:
  [lat0, lon0, dlat1, dlon1, dlat2, dlon2, ...] (el primer punto absoluto, el resto en diferencias).
"""
import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time
from collections import defaultdict

import osmium
import shapely
from shapely import STRtree

# Tipos de vía que cuentan como "calle". Se excluyen autopistas, enlaces, pistas y senderos.
HIGHWAYS = {
    'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
    'living_street', 'pedestrian', 'road', 'service',
}
MIN_PLAYABLE = 40       # calles jugables necesarias para incluir un municipio
MIN_LEN_M = 90          # longitud mínima para que una calle pueda salir como pregunta
SIMPLIFY_DEG = 1e-5     # tolerancia de simplificación (~1 m)

PROVINCIAS = {
    '01': 'Araba/Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila',
    '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres',
    '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña',
    '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
    '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida', '26': 'La Rioja',
    '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia', '31': 'Navarra', '32': 'Ourense',
    '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra', '37': 'Salamanca',
    '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia', '41': 'Sevilla', '42': 'Soria',
    '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid',
    '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def ine_code(tags):
    """Código INE de 5 cifras. Las freguesias portuguesas del borde del extracto también traen un
    ref:ine (de 6 cifras), así que solo se acepta ine:municipio o el ref:ine español de 11 cifras."""
    v = (tags.get('ine:municipio') or '').strip()
    if not v:
        r = (tags.get('ref:ine') or '').strip()
        v = r if len(r) == 11 else ''
    if len(v) >= 5 and v[:5].isdigit() and v[:2] in PROVINCIAS:
        return v[:5]
    return None


def filter_file(src, dst):
    """Copia a `dst` las calles con nombre y los límites municipales (con sus nodos).

    Devuelve {id de relación: {'name', 'ine', 'ways': [ids de vías miembro]}} de los municipios
    españoles (admin_level=8 con código INE; así quedan fuera los de Francia, Portugal y Andorra
    que entran en el margen del extracto)."""
    ways = osmium.filter.KeyFilter('highway')
    ways.enable_for(osmium.osm.WAY)
    rels = osmium.filter.TagFilter(('boundary', 'administrative'))
    rels.enable_for(osmium.osm.RELATION)
    n, munis = 0, {}
    with osmium.BackReferenceWriter(dst, ref_src=src, overwrite=True) as writer:
        for o in osmium.FileProcessor(src, osmium.osm.WAY | osmium.osm.RELATION).with_filter(ways).with_filter(rels):
            if o.is_way():
                if 'name' in o.tags and o.tags['highway'] in HIGHWAYS:
                    writer.add_way(o)
                    n += 1
            elif o.tags.get('admin_level') == '8' and (code := ine_code(o.tags)):
                munis[o.id] = {'name': o.tags.get('name', ''), 'ine': code,
                               'ways': [m.ref for m in o.members if m.type == 'w']}
                writer.add_relation(o)
    log(f'  {n} tramos de calle con nombre, {len(munis)} municipios')
    return munis


def read_boundaries(path, rels):
    """Construye la geometría de cada municipio de `rels`. Devuelve una lista de dicts con 'geom'."""
    wkb = osmium.geom.WKBFactory()
    munis = []
    areas = osmium.filter.TagFilter(('boundary', 'administrative'))
    for o in osmium.FileProcessor(path).with_areas(areas):
        if not o.is_area() or o.from_way() or o.orig_id() not in rels:
            continue
        try:
            geom = shapely.from_wkb(wkb.create_multipolygon(o))
        except Exception:
            continue
        if not geom.is_empty:
            munis.append({**rels[o.orig_id()], 'osm': o.orig_id(), 'geom': geom})

    # Límites que no cierran (p. ej. Ceuta, cortado por el borde del extracto): se aproximan
    # con los polígonos que sí cierran o, si no hay ninguno, con la envolvente convexa.
    missing = {rid: r for rid, r in rels.items() if rid not in {m['osm'] for m in munis}}
    if missing:
        need = {w for r in missing.values() for w in r['ways']}
        lines = {}
        for w in osmium.FileProcessor(path, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if w.is_way() and w.id in need:
                pts = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
                if len(pts) >= 2:
                    lines[w.id] = shapely.LineString(pts)
        for rid, r in missing.items():
            ls = [lines[w] for w in r['ways'] if w in lines]
            if not ls:
                continue
            geom = shapely.union_all(shapely.get_parts(shapely.polygonize(ls)))
            if geom.is_empty or geom.area < shapely.MultiLineString(ls).convex_hull.area * 0.5:
                geom = shapely.MultiLineString(ls).convex_hull
            if geom.geom_type in ('Polygon', 'MultiPolygon'):
                munis.append({**r, 'osm': rid, 'geom': geom, 'approx': True})
                log(f"  límite aproximado: {r['name']} ({r['ine']})")
    return munis


def encode_way(coords):
    """coords: lista de (lat, lon) -> lista plana delta-codificada en unidades de 1e-5."""
    out, plat, plon = [], 0, 0
    for i, (lat, lon) in enumerate(coords):
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        if i and ilat == plat and ilon == plon:
            continue
        out += [ilat - plat, ilon - plon]
        plat, plon = ilat, ilon
    return out


def length_m(coords):
    total = 0.0
    for (a, b), (c, d) in zip(coords, coords[1:]):
        x = math.radians(d - b) * math.cos(math.radians((a + c) / 2))
        y = math.radians(c - a)
        total += math.hypot(x, y) * 6371000
    return total


def process(path, results):
    log(f'Procesando {path}')
    tmp = tempfile.mkdtemp(prefix='calles-')
    filtered = os.path.join(tmp, 'filtered.osm.pbf')
    try:
        log('  filtrando calles y límites…')
        rels = filter_file(path, filtered)
        log('  construyendo límites municipales…')
        munis = read_boundaries(filtered, rels)
        log(f'  {len(munis)} límites municipales')
        if not munis:
            return
        tree = STRtree([m['geom'] for m in munis])
        for m in munis:
            shapely.prepare(m['geom'])

        # calles por municipio: idx -> nombre -> [tramos]
        streets = defaultdict(lambda: defaultdict(list))
        log('  asignando calles a municipios…')
        n = 0
        for w in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not w.is_way():
                continue
            name = w.tags.get('name')
            if not name or w.tags.get('highway') not in HIGHWAYS:
                continue
            try:
                coords = [(nd.lat, nd.lon) for nd in w.nodes]
            except osmium.InvalidLocationError:
                continue
            if len(coords) < 2:
                continue
            line = shapely.LineString([(lon, lat) for lat, lon in coords])
            mid = line.interpolate(0.5, normalized=True)
            hits = tree.query(mid, predicate='within')
            if not len(hits):
                continue
            simple = line.simplify(SIMPLIFY_DEG, preserve_topology=False)
            coords = [(lat, lon) for lon, lat in simple.coords]
            # si cae en varios (solo pasa con límites aproximados), gana el límite exacto
            idx = min((int(h) for h in hits), key=lambda h: munis[h].get('approx', False))
            streets[idx][name.strip()].append(coords)
            n += 1
            if n % 500000 == 0:
                log(f'    {n} tramos')
        log(f'  {n} tramos asignados')

        for idx, by_name in streets.items():
            m = munis[idx]
            mid = m['ine']
            playable = sum(1 for ways in by_name.values() if sum(length_m(c) for c in ways) > MIN_LEN_M)
            if playable < MIN_PLAYABLE:
                continue
            minx, miny, maxx, maxy = m['geom'].bounds
            # centro: centroide ponderado de las calles (cae en el casco urbano, no en el término municipal)
            la = lo = k = 0
            for ways in by_name.values():
                for c in ways:
                    for p in c:
                        la += p[0]; lo += p[1]; k += 1
            results[mid] = {
                'id': mid,
                'name': m['name'],
                'prov': PROVINCIAS[mid[:2]],
                'center': [round(la / k, 5), round(lo / k, 5)],
                'bbox': [round(miny, 5), round(minx, 5), round(maxy, 5), round(maxx, 5)],
                'playable': playable,
                'streets': sorted(
                    ([nm, [encode_way(c) for c in ways]] for nm, ways in by_name.items()),
                    key=lambda s: s[0]),
            }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pbf', nargs='+', help='extractos .osm.pbf')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'data'))
    args = ap.parse_args()

    results = {}
    for p in args.pbf:
        process(p, results)

    out = os.path.abspath(args.out)
    mdir = os.path.join(out, 'm')
    if os.path.isdir(mdir):
        shutil.rmtree(mdir)
    os.makedirs(mdir)
    index, total = [], 0
    for r in sorted(results.values(), key=lambda r: r['name']):
        body = {k: r[k] for k in ('id', 'name', 'prov', 'center', 'bbox', 'streets')}
        with open(os.path.join(mdir, f"{r['id']}.json"), 'w', encoding='utf-8') as f:
            json.dump(body, f, ensure_ascii=False, separators=(',', ':'))
        total += os.path.getsize(f.name)
        index.append([r['id'], r['name'], r['prov'], *r['center'], len(r['streets'])])
    with open(os.path.join(out, 'municipios.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    log(f'{len(index)} municipios escritos en {out} ({total / 1e6:.1f} MB)')


if __name__ == '__main__':
    sys.exit(main())
