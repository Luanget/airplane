"""Serve only the public PWA on loopback. No directory listing or secret files."""
import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
SHELL = {item[2:] for item in re.findall(r"'(\./[^']+)'", (ROOT / 'sw.js').read_text().split('const assets')[0])}
PUBLIC = SHELL | {'sw.js'}


class StaticApp(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript',
                      '.webmanifest': 'application/manifest+json'}

    def send_head(self):
        path = urlsplit(self.path).path
        if path in ('/', '/health/', '/assistant/'):
            path += 'index.html'
        if path[1:] not in PUBLIC:
            self.send_error(404)
            return None
        self.path = path
        return super().send_head()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    port = parser.parse_args().port
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(StaticApp, directory=ROOT))
    print(f'Airplane: http://127.0.0.1:{port}/', flush=True)
    server.serve_forever()
