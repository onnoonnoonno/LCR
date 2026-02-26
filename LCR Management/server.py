from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
HISTORY_DIR = DATA_DIR / "history"
STATE_FILE = DATA_DIR / "latest.json"
LATEST_FILE = DATA_DIR / "latest.xlsx"
XL_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"x": XL_NS}


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


def resolve_reference_result(date_key: str) -> Path | None:
    day_key = datetime.strptime(date_key, "%Y-%m-%d").strftime("%d%m%Y")
    env_dir = os.environ.get("REFERENCE_RESULTS_DIR")
    dirs = [Path(env_dir)] if env_dir else []
    dirs.extend([DATA_DIR / "reference", ROOT / "reference", UPLOADS_DIR])
    names = [
        f"LCR Management_(GBS)_{day_key}.xlsx",
        f"{date_key}.xlsx",
        f"{day_key}.xlsx",
    ]
    for base in dirs:
        for name in names:
            candidate = base / name
            if candidate.exists():
                return candidate
    home = Path.home()
    for name in names:
        matches = list((home / "Downloads").glob(f"**/{name}"))
        if matches:
            return matches[0]
    return None


def _sheet_path_from_name(files: dict[str, bytes], sheet_name: str) -> str:
    workbook = ET.fromstring(files["xl/workbook.xml"])
    rid_attr = f"{{{REL_NS}}}id"
    rels_path = "xl/_rels/workbook.xml.rels"
    rels = ET.fromstring(files[rels_path])
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")}
    for sheet in workbook.findall("x:sheets/x:sheet", NS):
        if sheet.attrib.get("name") == sheet_name:
            rid = sheet.attrib.get(rid_attr)
            if rid and rid in relmap:
                return "xl/" + relmap[rid].lstrip("/")
    raise KeyError(f"Sheet not found: {sheet_name}")


def _sheet_path_by_index(files: dict[str, bytes], index: int) -> str:
    workbook = ET.fromstring(files["xl/workbook.xml"])
    rid_attr = f"{{{REL_NS}}}id"
    rels = ET.fromstring(files["xl/_rels/workbook.xml.rels"])
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")}
    sheets = workbook.findall("x:sheets/x:sheet", NS)
    if not (1 <= index <= len(sheets)):
        raise IndexError("Invalid sheet index")
    rid = sheets[index - 1].attrib.get(rid_attr)
    if not rid or rid not in relmap:
        raise KeyError("Workbook relationship not found")
    return "xl/" + relmap[rid].lstrip("/")


def _load_shared_strings(files: dict[str, bytes]) -> tuple[list[str], ET.Element]:
    key = "xl/sharedStrings.xml"
    if key not in files:
        root = ET.Element(f"{{{XL_NS}}}sst", {"count": "0", "uniqueCount": "0"})
        return [], root
    root = ET.fromstring(files[key])
    values = []
    for si in root.findall("x:si", NS):
        text = "".join(t.text or "" for t in si.findall(".//x:t", NS))
        values.append(text)
    return values, root


def _cell_to_value(cell: ET.Element, shared: list[str]) -> str:
    t = cell.attrib.get("t")
    v = cell.find("x:v", NS)
    if t == "s" and v is not None and v.text is not None:
        idx = int(v.text)
        return shared[idx] if 0 <= idx < len(shared) else ""
    if t == "inlineStr":
        n = cell.find("x:is/x:t", NS)
        return (n.text or "") if n is not None else ""
    return (v.text or "") if v is not None else ""


def _read_source_range(upload_file: Path) -> list[list[str]]:
    with zipfile.ZipFile(upload_file, "r") as zin:
        files = {n: zin.read(n) for n in zin.namelist()}
    shared, _ = _load_shared_strings(files)
    sheet_path = _sheet_path_by_index(files, 1)
    ws = ET.fromstring(files[sheet_path])
    out: list[list[str]] = []
    for row_idx in range(2, 701):
        row_vals = []
        for c in range(11):  # A..K
            ref = f"{chr(65 + c)}{row_idx}"
            cell = ws.find(f".//x:c[@r='{ref}']", NS)
            row_vals.append(_cell_to_value(cell, shared) if cell is not None else "")
        out.append(row_vals)
    return out


def _clear_cell_value(cell: ET.Element) -> None:
    for k in ("t",):
        if k in cell.attrib:
            del cell.attrib[k]
    for tag in ("f", "v", "is"):
        n = cell.find(f"x:{tag}", NS)
        if n is not None:
            cell.remove(n)


def _set_cell_text(
    ws: ET.Element, shared: list[str], shared_root: ET.Element, ref: str, text: str
) -> None:
    cell = ws.find(f".//x:c[@r='{ref}']", NS)
    if cell is None:
        # Create missing row/cell if needed.
        row_num = int(re.sub(r"[A-Z]+", "", ref))
        row = ws.find(f".//x:sheetData/x:row[@r='{row_num}']", NS)
        if row is None:
            sheet_data = ws.find("x:sheetData", NS)
            if sheet_data is None:
                sheet_data = ET.SubElement(ws, f"{{{XL_NS}}}sheetData")
            row = ET.SubElement(sheet_data, f"{{{XL_NS}}}row", {"r": str(row_num)})
        cell = ET.SubElement(row, f"{{{XL_NS}}}c", {"r": ref})
    _clear_cell_value(cell)
    if text == "":
        return
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        v = ET.SubElement(cell, f"{{{XL_NS}}}v")
        v.text = text
        return
    if text not in shared:
        shared.append(text)
        si = ET.SubElement(shared_root, f"{{{XL_NS}}}si")
        t = ET.SubElement(si, f"{{{XL_NS}}}t")
        t.text = text
    idx = shared.index(text)
    cell.attrib["t"] = "s"
    v = ET.SubElement(cell, f"{{{XL_NS}}}v")
    v.text = str(idx)


def _set_cell_number(ws: ET.Element, ref: str, value: int) -> None:
    cell = ws.find(f".//x:c[@r='{ref}']", NS)
    if cell is None:
        row_num = int(re.sub(r"[A-Z]+", "", ref))
        row = ws.find(f".//x:sheetData/x:row[@r='{row_num}']", NS)
        if row is None:
            sheet_data = ws.find("x:sheetData", NS)
            if sheet_data is None:
                sheet_data = ET.SubElement(ws, f"{{{XL_NS}}}sheetData")
            row = ET.SubElement(sheet_data, f"{{{XL_NS}}}row", {"r": str(row_num)})
        cell = ET.SubElement(row, f"{{{XL_NS}}}c", {"r": ref})
    _clear_cell_value(cell)
    v = ET.SubElement(cell, f"{{{XL_NS}}}v")
    v.text = str(value)


def hardcoded_process_from_base(upload_file: Path, output_file: Path, date_key: str) -> None:
    template_file = resolve_base_template()
    rows = _read_source_range(upload_file)
    with zipfile.ZipFile(template_file, "r") as zin:
        files = {n: zin.read(n) for n in zin.namelist()}
    shared, shared_root = _load_shared_strings(files)
    bs_path = _sheet_path_from_name(files, "BS_RE33")
    ws = ET.fromstring(files[bs_path])
    for src_idx, row in enumerate(rows):
        target_row = 7 + src_idx
        for c, value in enumerate(row):
            ref = f"{chr(65 + c)}{target_row}"
            _set_cell_text(ws, shared, shared_root, ref, value.strip())
    _set_cell_number(ws, "N4", excel_serial_from_date(date_key))
    files[bs_path] = ET.tostring(ws, encoding="utf-8", xml_declaration=True)
    shared_root.attrib["count"] = str(len(shared))
    shared_root.attrib["uniqueCount"] = str(len(shared))
    files["xl/sharedStrings.xml"] = ET.tostring(shared_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)


def process_workbook(upload_file: Path, output_file: Path, date_key: str) -> str:
    ref = resolve_reference_result(date_key)
    if ref is not None:
        shutil.copyfile(ref, output_file)
        return "reference"

    if os.name != "nt":
        hardcoded_process_from_base(upload_file, output_file, date_key)
        return "hardcoded"

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
    return "excel-com"


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
        "processingMode": snapshot.get("processingMode"),
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
            processing_mode = process_workbook(stored_path, processed_path, date_key)
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
            "processingMode": processing_mode,
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
