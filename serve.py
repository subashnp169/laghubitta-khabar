import http.server, os, sys, posixpath, urllib.parse
from http.server import SimpleHTTPRequestHandler

class NextHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urllib.parse.urlparse(path).path
        if path.endswith('/'):
            path += 'index.html'
        elif not os.path.splitext(path)[1]:
            html = path + '.html'
            if os.path.exists(self.directory + html):
                path = html
        return super().translate_path(path)

port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
httpd = http.server.HTTPServer(('127.0.0.1', port), NextHandler)
print(f"Serving at http://127.0.0.1:{port}")
httpd.serve_forever()
