"""Export a standalone, compressed Bubbles search fallback from local SQLite.

Run on the Bubbles PC:
  py export_purple_hippo_backup.py --database bubbles.db --output bubbles_backup.json.gz

This exports searchable excerpts, not a full archival copy of crawled content.
Keep the original SQLite backups separately.
"""
import argparse
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--database", default="bubbles.db")
    p.add_argument("--output", default="bubbles_backup.json.gz")
    p.add_argument("--max-text", type=int, default=1500)
    args = p.parse_args()
    source = Path(args.database)
    if not source.is_file():
        p.error(f"Database not found: {source}")
    dest = Path(args.output)
    temp = dest.with_name(dest.name + ".tmp")
    conn = sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(pages)")}
        if "url" not in columns:
            raise RuntimeError("Expected a 'pages' table with a 'url' column")
        def field(name):
            return name if name in columns else "''"
        query = f"""SELECT {field('url')} AS url, {field('title')} AS title,
                   {field('description')} AS description, {field('content')} AS content
                   FROM pages WHERE url IS NOT NULL AND url != '' ORDER BY url"""
        seen = set()
        count = 0
        with gzip.open(temp, "wt", encoding="utf-8", compresslevel=6) as out:
            out.write('{"pages":[')
            for row in conn.execute(query):
                url = str(row["url"]).replace("\\u0000", "").strip()
                if not url.startswith(("https://", "http://")) or url in seen:
                    continue
                seen.add(url)
                page = {
                    "url": url,
                    "title": str(row["title"] or "").replace("\\u0000", ""),
                    "description": str(row["description"] or "").replace("\\u0000", ""),
                    "text": str(row["content"] or "").replace("\\u0000", "")[:args.max_text],
                }
                if count:
                    out.write(",")
                json.dump(page, out, ensure_ascii=False, separators=(",", ":"))
                count += 1
            out.write(']}')
        temp.replace(dest)
        checksum = hashlib.sha256(dest.read_bytes()).hexdigest()
        print(f"Exported {count:,} unique searchable pages to {dest}")
        print(f"Compressed size: {dest.stat().st_size:,} bytes")
        print(f"SHA256: {checksum}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
