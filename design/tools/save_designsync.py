"""Save a DesignSync get_file result (persisted JSON) to design/reference/claude-design/<path>.

Usage: python design/tools/save_designsync.py <persisted-result.txt>
Handles base64 (isBase64) and text content; refuses truncated files.
"""
import base64, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "reference" / "claude-design"

def main(src):
    d = json.loads(Path(src).read_text(encoding="utf-8"))
    if d.get("truncated"):
        sys.exit(f"TRUNCATED: {d['path']}")
    out = ROOT / d["path"]
    out.parent.mkdir(parents=True, exist_ok=True)
    data = base64.b64decode(d["content"]) if d.get("isBase64") else d["content"].encode("utf-8")
    out.write_bytes(data)
    print(f"saved {d['path']} ({len(data)} bytes)")

if __name__ == "__main__":
    for a in sys.argv[1:]:
        main(a)
