#!/usr/bin/env python3
"""MagReader 本地服务：静态文件 + /api/books 书架列表。
用法: python3 serve.py [端口]   默认 8666，然后浏览器打开 http://localhost:8666
把 PDF 放进 ./books/ 目录即可出现在书架中。
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))
BOOKS = os.path.join(ROOT, "books")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8666


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/books":
            books = []
            if os.path.isdir(BOOKS):
                for fn in sorted(os.listdir(BOOKS)):
                    if fn.lower().endswith(".pdf"):
                        books.append({"name": fn, "url": "/books/" + quote(fn)})
            data = json.dumps(books).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[magreader] " + fmt % args + "\n")


if __name__ == "__main__":
    os.chdir(ROOT)
    os.makedirs(BOOKS, exist_ok=True)
    print(f"MagReader  →  http://localhost:{PORT}")
    print(f"书架目录: {BOOKS}  (把 PDF 放进去刷新即可)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
