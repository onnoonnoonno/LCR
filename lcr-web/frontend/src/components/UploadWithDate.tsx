/**
 * UploadWithDate — Minimal file upload with report date.
 *
 * Only two inputs: Report Date + File.
 * Order-independent: file can be selected before or after date.
 */

import { useState, useRef, useEffect } from 'react';

interface Props {
  onUpload: (file: File, reportDate: string) => void;
  isLoading: boolean;
}

export function UploadWithDate({ onUpload, isLoading }: Props) {
  const [reportDate, setReportDate] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(reportDate);

  // Auto-submit when both file and date are present
  useEffect(() => {
    if (pendingFile && dateValid) {
      const file = pendingFile;
      setPendingFile(null);
      onUpload(file, reportDate);
    }
  }, [pendingFile, reportDate, dateValid, onUpload]);

  function handleFileSelected(file: File) {
    if (dateValid) {
      onUpload(file, reportDate);
    } else {
      setPendingFile(file);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
  }

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem' }}>
        <div className="spinner" />
        <p style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Processing...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      {/* Report Date */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', color: '#475569' }}>Report Date:</span>
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          style={{
            padding: '0.4rem 0.6rem',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-mono)',
            width: '160px',
          }}
        />
      </label>

      {/* File Upload */}
      <button
        className="btn btn--ghost"
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '0.4rem 1rem',
          fontSize: '0.85rem',
          border: '1px dashed #94a3b8',
        }}
      >
        {pendingFile ? pendingFile.name : 'Choose File (.xlsx)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleChange}
        style={{ display: 'none' }}
      />

      {/* Pending indicator */}
      {pendingFile && !dateValid && (
        <span style={{ fontSize: '0.75rem', color: '#d97706' }}>
          Set date to submit
        </span>
      )}
    </div>
  );
}
