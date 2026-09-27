"""Save every DesignSync get_file result found in a Claude Code session transcript.

Usage: python design/tools/extract_from_transcript.py <session.jsonl>
Handles inline results and persisted ("Full output saved to: <file>") results.
Writes under design/reference/claude-design/<path>. Prints what it saved.
"""
import base64, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "reference" / "claude-design"
SAVED_RE = re.compile(r"Full output saved to: (.+?\.txt)")

def texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from texts(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from texts(v)

def save(d, seen):
    if d.get("method") != "get_file" or "content" not in d:
        return
    if d.get("truncated"):
        print("TRUNCATED", d["path"]); return
    data = base64.b64decode(d["content"]) if d.get("isBase64") else d["content"].encode("utf-8")
    out = ROOT / d["path"]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    seen.add(d["path"])

def main(transcript):
    seen = set()
    for line in Path(transcript).read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        for t in texts(rec):
            s = t.strip()
            if s.startswith('{"method":"get_file"'):
                try:
                    save(json.loads(s), seen)
                except json.JSONDecodeError:
                    pass
            for m in SAVED_RE.finditer(t):
                p = Path(m.group(1).strip())
                if p.exists():
                    try:
                        save(json.loads(p.read_text(encoding="utf-8")), seen)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
    for p in sorted(seen):
        print("saved", p)
    print(len(seen), "files")

if __name__ == "__main__":
    main(sys.argv[1])
