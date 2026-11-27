"""Exit 0 if a data file differs from the committed version in anything other than its timestamps, else exit 1.

Usage: python scripts/data_changed.py data/lt.json
"""
import json, subprocess, sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/lt.json"
IGNORE = {"pub", "info", "rate"}   # change on every download; prices are compared directly
old = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True).stdout
new = open(path, encoding="utf-8").read()


def strip(s):
    return {k: v for k, v in json.loads(s).items() if k not in IGNORE} if s.strip() else None


sys.exit(0 if strip(old) != strip(new) else 1)
