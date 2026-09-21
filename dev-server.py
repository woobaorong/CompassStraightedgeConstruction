"""开发用静态文件服务器: 禁用缓存 (Cache-Control: no-store), 避免改动后浏览器仍用旧文件。

用法: python dev-server.py [端口]  (默认 8642)
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with ThreadingTCPServer(('127.0.0.1', PORT), NoCacheHandler) as httpd:
        print(f'Serving http://127.0.0.1:{PORT} (no-cache)')
        httpd.serve_forever()
