"""TLS endpoint for the emulator's loopback. Forward to the disposable Auth and REST services."""
import http.client
import json
import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

stage = Path(sys.argv[1])
config = json.loads((stage / 'local.json').read_text())
class Gateway(BaseHTTPRequestHandler):
    def forward(self):
        if not self.path.startswith(('/auth/v1/', '/rest/v1/')):
            self.send_error(404)
            return
        conn = http.client.HTTPConnection('127.0.0.1', 54321, timeout=15)
        try:
            headers = {k:v for k,v in self.headers.items() if k.lower() in ('content-type','authorization','accept-language')}
            headers['apikey'] = config['ANON_KEY']
            size = int(self.headers.get('Content-Length',0))
            conn.request(self.command,self.path,self.rfile.read(size) if size else None,headers)
            response = conn.getresponse()
            body = response.read()
            # The mobile buyer loses only the acknowledgement. PostgreSQL has already committed the sale.
            if self.path == '/rest/v1/rpc/angler_market_buy' and response.status == 200:
                try:
                    (stage / 'lose-next-purchase-receipt').unlink()
                except FileNotFoundError:
                    pass
                else:
                    self.send_error(503, 'Receipt unavailable')
                    return
            self.send_response(response.status)
            self.send_header('Content-Type',response.getheader('Content-Type','application/json'))
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            conn.close()
    do_POST = do_GET = do_PUT = forward
    def log_message(self,*args):
        pass  # Paths can contain auth codes; the test emits stage names only.

server = ThreadingHTTPServer(('127.0.0.1',58443),Gateway)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(stage/'tls.crt',stage/'tls.key')
server.socket=ctx.wrap_socket(server.socket,server_side=True)
server.serve_forever()
