"""Exit 0 if data/lt.json differs from the committed version in anything other than its timestamp, else exit 1."""
import json, subprocess, sys

old = subprocess.run(["git", "show", "HEAD:data/lt.json"], capture_output=True, text=True).stdout
new = open("data/lt.json", encoding="utf-8").read()


def strip(s):
    return {k: v for k, v in json.loads(s).items() if k != "pub"} if s.strip() else None


sys.exit(0 if strip(old) != strip(new) else 1)
