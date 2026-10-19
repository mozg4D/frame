"""Serve Frame and its neighboring assets on localhost for automatic STL loading."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import csv
import io
import json
import subprocess
import threading
import time

gpu_lock = threading.Lock()
gpu_snapshot = None
gpu_sampled = 0

def gpu_memory():
    global gpu_snapshot, gpu_sampled
    with gpu_lock:
        if time.monotonic() - gpu_sampled < 2:
            return gpu_snapshot
        try:
            result = subprocess.run(['nvidia-smi', '--query-gpu=name,pci.device_id,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=2, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            gpu_snapshot = [{'name': name.strip(), 'vendor': 'nvidia', 'device': device.strip()[2:6].lower(), 'total': int(total)*1048576, 'used': int(used)*1048576, 'free': int(free)*1048576} for name,device,total,used,free in csv.reader(io.StringIO(result.stdout))]
        except (OSError, subprocess.SubprocessError, ValueError):
            gpu_snapshot = None
        gpu_sampled = time.monotonic()
        return gpu_snapshot

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=56116)
args = parser.parse_args()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *values, **kwargs):
        super().__init__(*values, directory=str(Path(__file__).resolve().parent.parent), **kwargs)

    def do_GET(self):
        if self.path == '/__frame/gpu-memory':
            body = json.dumps({'gpus': gpu_memory(), 'sampledAt': time.time()}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(f'Frame: http://127.0.0.1:{server.server_port}/index.html', flush=True)
server.serve_forever()
