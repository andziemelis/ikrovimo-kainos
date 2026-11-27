"""One-off: describe the structure of the Polish EIPA files so the importer can be written.

Reads the download links from environment variables (GitHub secrets) and writes data/pl-schema.txt.
The links themselves are never printed or saved. Operator records are described by field names only.
"""
import gzip, json, os, sys, urllib.request
from pathlib import Path

FILES = ["EIPA_DICTIONARIES", "EIPA_POOLS", "EIPA_STATIONS", "EIPA_POINTS", "EIPA_DYNAMIC", "EIPA_OPERATORS"]
NO_VALUES = {"EIPA_OPERATORS"}          # may contain people's names/contacts: field names only
OUT = Path(__file__).resolve().parent.parent / "data" / "pl-schema.txt"
MAX = 300 * 1024 * 1024


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ev-price-map/0.1", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=180) as r:
        if not r.geturl().startswith("https://eipa.udt.gov.pl/"):
            raise RuntimeError("unexpected redirect")
        body = r.read(MAX + 1)
        enc = r.headers.get("Content-Encoding", "")
        ctype = r.headers.get("Content-Type", "")
    if len(body) > MAX:
        raise RuntimeError("too large")
    if enc == "gzip" or body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body, ctype


def short(v, n=70):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + "…"


def describe(v, path="", depth=0, lines=None, values=True, seen=None):
    lines = [] if lines is None else lines
    seen = set() if seen is None else seen
    if depth > 7:
        return lines
    if isinstance(v, dict):
        for k, x in v.items():
            p = f"{path}.{k}" if path else k
            if p in seen:
                continue
            seen.add(p)
            if isinstance(x, (dict, list)):
                lines.append(f"{'  ' * depth}{p}: {type(x).__name__}{f' [{len(x)}]' if isinstance(x, list) else ''}")
                describe(x, p, depth + 1, lines, values, seen)
            else:
                lines.append(f"{'  ' * depth}{p}: {type(x).__name__}" + (f" = {short(x)}" if values else ""))
    elif isinstance(v, list) and v:
        for item in v[:3]:
            describe(item, path + "[]", depth, lines, values, seen)
    return lines


def main():
    out = []
    for name in FILES:
        url = os.environ.get(name, "").strip()
        out.append(f"===== {name} =====")
        if not url:
            out.append("missing secret"); continue
        try:
            body, ctype = fetch(url)
        except Exception as e:
            out.append(f"download failed: {type(e).__name__}"); continue
        out.append(f"content-type: {ctype} · bytes: {len(body)}")
        try:
            data = json.loads(body)
        except Exception:
            out.append("not JSON; first 300 chars:"); out.append(body[:300].decode("utf-8", "replace")); continue
        top = data
        out.append(f"top level: {type(top).__name__}" + (f" with keys {list(top.keys())[:20]}" if isinstance(top, dict) else f" with {len(top)} items"))
        out += describe(top, values=name not in NO_VALUES)
        if name == "EIPA_DICTIONARIES":   # small and needed to decode codes: keep it whole
            Path(OUT.parent / "pl-dictionaries.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(l for l in out if l.startswith("=====") or l.startswith("top level") or "failed" in l or "missing" in l))


if __name__ == "__main__":
    main()
