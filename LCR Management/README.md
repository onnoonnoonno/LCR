# LCR Management Web Dashboard

Simple internal webpage for LCR workbook sharing:

- Users upload a partial daily `.xlsx` extract (A-K data).
- Server copies extract into `BS_RE33` of the base template, updates `N4` from the upload filename date, recalculates in Excel, and saves the result.
- Dashboard renders `Summary` tables and keeps snapshots by date.

## Run

```powershell
cd "c:\Users\Jay Yoon\Desktop\LCR Management"
python server.py
```

Open:

`http://127.0.0.1:8000`

## How it works

- Upload API saves raw files into `data/uploads/`.
- Processed daily workbooks are stored in `data/history/YYYY-MM-DD.xlsx`.
- The newest processed file is mirrored to `data/latest.xlsx`.
- Viewers can select a date and poll `/api/latest` every 30 seconds.

## Base template

- Preferred: place base format workbook at `data/base_template.xlsx`.
- Or set env var: `BASE_TEMPLATE_PATH`.
- Fallback search: existing uploads (`*04022026*.xlsx`) and `~/Downloads/**/LCR Management_(GBS)_*.xlsx`.
- Processing uses Excel COM automation on Windows, so Microsoft Excel must be installed.

## Notes

- Supported upload: `.xlsx`
- Required worksheet name: `Summary`
- No external Python packages are needed.
