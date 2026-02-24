from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
STATE_FILE = DATA_DIR / "latest.json"
LATEST_FILE = DATA_DIR / "latest.xlsx"


def ensure_dirs() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")


def sanitize_filename(filename: str) -> str:
    base = Path(filename).name
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._")
    if not safe:
        safe = "upload.xlsx"
    if not safe.lower().endswith(".xlsx"):
        safe += ".xlsx"
    return safe


class AppHandler(BaseHTTPRequestHandler):
    server_version = "LCRWeb/1.0"

    def _send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, relative: str) -> None:
        target = (STATIC_DIR / relative).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return
        if target.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif target.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"
        else:
            ctype = "text/plain; charset=utf-8"
        self._send_file(target, ctype)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self._send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return

        if path.startswith("/static/"):
            self._serve_static(path[len("/static/") :])
            return

        if path == "/api/latest":
            state = load_state()
            exists = bool(state) and LATEST_FILE.exists()
            response = {
                "exists": exists,
                "filename": state.get("filename") if exists else None,
                "uploadedAt": state.get("uploadedAt") if exists else None,
                "contentHash": state.get("contentHash") if exists else None,
                "fileUrl": "/data/latest.xlsx" if exists else None,
            }
            self._send_json(response)
            return

        if path == "/data/latest.xlsx":
            self._send_file(LATEST_FILE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/upload":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"ok": False, "error": "Empty request body."}, status=HTTPStatus.BAD_REQUEST)
            return

        content_type = self.headers.get("Content-Type", "")
        if "application/octet-stream" not in content_type:
            self._send_json(
                {
                    "ok": False,
                    "error": "Use application/octet-stream upload.",
                },
                status=HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            )
            return

        raw_name = self.headers.get("X-Filename", "upload.xlsx")
        filename = sanitize_filename(raw_name)
        payload = self.rfile.read(length)
        if len(payload) != length:
            self._send_json({"ok": False, "error": "Upload interrupted."}, status=HTTPStatus.BAD_REQUEST)
            return

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        stored_name = f"{timestamp}_{filename}"
        stored_path = UPLOADS_DIR / stored_name
        stored_path.write_bytes(payload)
        shutil.copyfile(stored_path, LATEST_FILE)

        state = {
            "filename": filename,
            "storedName": stored_name,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
            "contentHash": f"{len(payload)}-{timestamp}",
        }
        save_state(state)
        self._send_json({"ok": True, **state})


def run() -> None:
    ensure_dirs()
    port = 8000
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"LCR dashboard running at http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
