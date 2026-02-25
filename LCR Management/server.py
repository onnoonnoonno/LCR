from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
HISTORY_DIR = DATA_DIR / "history"
STATE_FILE = DATA_DIR / "latest.json"
LATEST_FILE = DATA_DIR / "latest.xlsx"


def ensure_dirs() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"latestDate": None, "snapshots": {}}
    try:
        raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"latestDate": None, "snapshots": {}}

    if "snapshots" in raw:
        snapshots = raw.get("snapshots") if isinstance(raw.get("snapshots"), dict) else {}
        latest = raw.get("latestDate")
        if latest not in snapshots:
            latest = sorted(snapshots.keys())[-1] if snapshots else None
        return {"latestDate": latest, "snapshots": snapshots}

    # Backward compatibility for legacy single-file state.
    if raw.get("filename"):
        uploaded = raw.get("uploadedAt") or datetime.now(timezone.utc).isoformat()
        date_key = uploaded[:10]
        snapshots = {
            date_key: {
                "date": date_key,
                "filename": raw.get("filename"),
                "storedName": raw.get("storedName"),
                "processedName": "latest.xlsx",
                "uploadedAt": uploaded,
                "contentHash": raw.get("contentHash"),
            }
        }
        return {"latestDate": date_key, "snapshots": snapshots}

    return {"latestDate": None, "snapshots": {}}


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


def sanitize_date_key(raw: str | None) -> str | None:
    if not raw:
        return None
    return raw if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) else None


def extract_date_from_name(filename: str) -> str | None:
    match = re.search(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})", filename)
    if not match:
        return None
    y, m, d = match.groups()
    try:
        parsed = datetime(int(y), int(m), int(d))
    except ValueError:
        return None
    return parsed.strftime("%Y-%m-%d")


def excel_serial_from_date(date_key: str) -> int:
    # Excel's day 1 is 1900-01-01; serial base for xlsx date values is 1899-12-30.
    base = datetime(1899, 12, 30)
    target = datetime.strptime(date_key, "%Y-%m-%d")
    return (target - base).days


def resolve_base_template() -> Path:
    env_path = os.environ.get("BASE_TEMPLATE_PATH")
    if env_path:
        candidate = Path(env_path).expanduser()
        if candidate.exists():
            return candidate

    candidate = DATA_DIR / "base_template.xlsx"
    if candidate.exists():
        return candidate

    uploads = sorted(UPLOADS_DIR.glob("*04022026*.xlsx"))
    if uploads:
        return uploads[-1]

    home = Path.home()
    download_patterns = [
        "**/LCR Management_(GBS)_04022026.xlsx",
        "**/LCR Management_(GBS)_*.xlsx",
    ]
    for pattern in download_patterns:
        matches = sorted((home / "Downloads").glob(pattern))
        if matches:
            return matches[0]

    raise FileNotFoundError(
        "Base template not found. Place it at data/base_template.xlsx or set BASE_TEMPLATE_PATH."
    )


def process_workbook(upload_file: Path, output_file: Path, date_key: str) -> None:
    template_file = resolve_base_template()
    serial = excel_serial_from_date(date_key)
    ps_script = r"""
param(
  [string]$TemplatePath,
  [string]$InputPath,
  [string]$OutputPath,
  [double]$DateSerial
)

$excel = $null
$wbTemplate = $null
$wbInput = $null
$xlUp = -4162

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false

  $wbTemplate = $excel.Workbooks.Open($TemplatePath)
  $wsTarget = $wbTemplate.Worksheets.Item("BS_RE33")

  $wbInput = $excel.Workbooks.Open($InputPath)
  $wsInput = $wbInput.Worksheets.Item(1)

  # Row 7 onward in A:K is refreshed with the new extract.
  $wsTarget.Range("A7:K1048576").ClearContents()

  $lastRow = 1
  foreach ($col in 1..11) {
    $candidate = $wsInput.Cells($wsInput.Rows.Count, $col).End($xlUp).Row
    if ($candidate -gt $lastRow) {
      $lastRow = $candidate
    }
  }

  if ($lastRow -ge 2) {
    $src = $wsInput.Range("A2:K$lastRow")
    $dest = $wsTarget.Range("A7").Resize($src.Rows.Count, $src.Columns.Count)
    $dest.Value2 = $src.Value2
  }

  $wsTarget.Range("N4").Value2 = $DateSerial

  $excel.CalculateFullRebuild()
  if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  $wbTemplate.SaveAs($OutputPath, 51)
}
finally {
  if ($wbInput -ne $null) { $wbInput.Close($false) }
  if ($wbTemplate -ne $null) { $wbTemplate.Close($false) }
  if ($excel -ne $null) {
    $excel.Quit() | Out-Null
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
}
"""
    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8") as tmp:
        tmp.write(ps_script)
        script_path = Path(tmp.name)
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                "-TemplatePath",
                str(template_file),
                "-InputPath",
                str(upload_file),
                "-OutputPath",
                str(output_file),
                "-DateSerial",
                str(serial),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        try:
            script_path.unlink(missing_ok=True)
        except OSError:
            pass

    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(details or "Excel processing failed")


def build_snapshot_response(snapshot: dict | None, dates: list[str]) -> dict:
    if not snapshot:
        return {
            "exists": False,
            "date": None,
            "filename": None,
            "uploadedAt": None,
            "contentHash": None,
            "fileUrl": None,
            "availableDates": dates,
            "selectedDate": None,
        }

    date_key = snapshot.get("date")
    file_name = snapshot.get("processedName") or ""
    file_exists = bool(date_key and file_name and (HISTORY_DIR / file_name).exists())
    return {
        "exists": file_exists,
        "date": date_key,
        "filename": snapshot.get("filename"),
        "uploadedAt": snapshot.get("uploadedAt"),
        "contentHash": snapshot.get("contentHash"),
        "fileUrl": f"/data/history/{file_name}" if file_exists else None,
        "availableDates": dates,
        "selectedDate": date_key,
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "LCRWeb/2.0"

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

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        if path == "/api/latest" or path == "/api/dates":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/":
            self._send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return

        if path.startswith("/static/"):
            self._serve_static(path[len("/static/") :])
            return

        if path == "/api/latest":
            state = load_state()
            snapshots = state.get("snapshots", {})
            dates = sorted(snapshots.keys(), reverse=True)
            requested_date = sanitize_date_key((qs.get("date") or [None])[0])
            selected = requested_date or state.get("latestDate")
            snapshot = snapshots.get(selected) if selected else None
            response = build_snapshot_response(snapshot, dates)
            self._send_json(response)
            return

        if path == "/api/dates":
            state = load_state()
            snapshots = state.get("snapshots", {})
            dates = sorted(snapshots.keys(), reverse=True)
            self._send_json({"dates": dates, "latestDate": state.get("latestDate")})
            return

        if path == "/data/latest.xlsx":
            self._send_file(LATEST_FILE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            return

        if path.startswith("/data/history/"):
            file_name = Path(path[len("/data/history/") :]).name
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.xlsx", file_name):
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid history file")
                return
            self._send_file(HISTORY_DIR / file_name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
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
        date_key = extract_date_from_name(filename) or datetime.now().strftime("%Y-%m-%d")
        processed_name = f"{date_key}.xlsx"
        processed_path = HISTORY_DIR / processed_name

        try:
            process_workbook(stored_path, processed_path, date_key)
        except Exception as exc:
            self._send_json(
                {
                    "ok": False,
                    "error": f"Failed to process workbook: {exc}",
                },
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return

        shutil.copyfile(processed_path, LATEST_FILE)
        state = load_state()
        snapshots = state.get("snapshots", {})
        snapshot = {
            "date": date_key,
            "filename": filename,
            "storedName": stored_name,
            "processedName": processed_name,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
            "contentHash": f"{len(payload)}-{timestamp}",
        }
        snapshots[date_key] = snapshot
        state["snapshots"] = snapshots
        state["latestDate"] = date_key
        save_state(state)
        response = {"ok": True, **build_snapshot_response(snapshot, sorted(snapshots.keys(), reverse=True))}
        self._send_json(response)


def run() -> None:
    ensure_dirs()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"LCR dashboard running at http://0.0.0.0:{port}")
    server.serve_forever()

if __name__ == "__main__":
    run()
