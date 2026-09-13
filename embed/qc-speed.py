#!/usr/bin/env python3
"""QuotaCards speed endpoint. Localhost only, Xray falls back to it.
GET  /speed/ping          -> 200 "ok" (latency check)
GET  /speed/down?bytes=N  -> N random bytes, cap 100MB
POST /speed/up            -> reads and discards the body, replies JSON
Stdlib only. Run under systemd as qc-speed on 127.0.0.1:8080.
"""
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIND = ("127.0.0.1", 8080)
CHUNK = bytes((i * 2654435761) & 0xFF for i in range(1 << 20))
MAX_DOWN = 100 << 20
MAX_UP = 64 << 20


class H(BaseHTTPRequestHandler):
    server_version = "qc-speed/1"

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        if p.path == "/speed/ping":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if p.path == "/speed/down":
            try:
                n = int(urllib.parse.parse_qs(p.query).get("bytes", ["8000000"])[0])
            except ValueError:
                n = 8000000
            n = max(1024, min(n, MAX_DOWN))
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(n))
            self.end_headers()
            while n > 0:
                c = CHUNK if n >= len(CHUNK) else CHUNK[:n]
                self.wfile.write(c)
                n -= len(c)
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/speed/up":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        try:
            left = min(int(self.headers.get("Content-Length", "0")), MAX_UP)
        except ValueError:
            left = 0
        got = 0
        while left > 0:
            b = self.rfile.read(min(65536, left))
            if not b:
                break
            got += len(b)
            left -= len(b)
        body = ('{"received":%d}' % got).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(BIND, H).serve_forever()
