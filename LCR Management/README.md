# LCR Management Web Dashboard

Simple internal webpage for LCR workbook sharing:

- Any user uploads the latest weekday `.xlsx` file.
- Dashboard reads the `Summary` sheet and renders its tables.
- All users see the latest upload automatically.

## Run

```powershell
cd "c:\Users\Jay Yoon\Desktop\LCR Management"
python server.py
```

Open:

`http://127.0.0.1:8000`

## How it works

- Upload API saves each file into `data/uploads/`.
- The newest file is also stored as `data/latest.xlsx`.
- Viewers poll `/api/latest` every 30 seconds and refresh when a new file is uploaded.

## Notes

- Supported upload: `.xlsx`
- Required worksheet name: `Summary`
- No external Python packages are needed.
