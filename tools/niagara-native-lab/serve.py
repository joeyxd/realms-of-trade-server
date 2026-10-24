"""Lab QA server: the handler of `python -m http.server` with a listen backlog of 128.

`python -m http.server` keeps the socketserver default request_queue_size of 5. The pilot
pages request 241 particle states at once when they switch to the observed mode, the kernel
refuses the overflow (WinError 10061 on Windows) and qa-native.mjs and qa-update.mjs time out
after 30 s. This server uses the same SimpleHTTPRequestHandler (GET and HEAD only, no write
endpoints), serves the worktree root from any cwd, binds 127.0.0.1 and accepts a backlog of
128 connections. The bytes served do not change.

Usage, from any folder:
    python tools/niagara-native-lab/serve.py            # 127.0.0.1:5197, logs every request
    python tools/niagara-native-lab/serve.py --quiet    # no per-request log
    python tools/niagara-native-lab/serve.py --port 5198
"""

import argparse
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WORKTREE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_PORT = 5197
DEFAULT_BIND = "127.0.0.1"
LISTEN_BACKLOG = 128


class LabServer(ThreadingHTTPServer):
    """ThreadingHTTPServer with the backlog the pilot QA needs (241 concurrent requests)."""

    request_queue_size = LISTEN_BACKLOG
    daemon_threads = True


class QuietHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler without the per-request log line."""

    def log_message(self, format, *args):  # noqa: A002 (signature fixed by the base class)
        return


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--bind", default=DEFAULT_BIND, help="interface to bind (default 127.0.0.1)")
    parser.add_argument("--quiet", action="store_true", help="do not log each request")
    parser.add_argument("--root", default=WORKTREE_ROOT, help="folder to serve (default: the worktree root)")
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        parser.error(f"root is not a folder: {root}")
    handler_class = QuietHandler if args.quiet else SimpleHTTPRequestHandler
    handler = partial(handler_class, directory=root)
    with LabServer((args.bind, args.port), handler) as server:
        host, port = server.server_address[:2]
        print(f"serving {root} at http://{host}:{port}/ backlog {LISTEN_BACKLOG}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
