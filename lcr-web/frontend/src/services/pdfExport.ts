/**
 * PDF Export utility using html2canvas + jsPDF.
 *
 * Captures one or more DOM elements as images and assembles them
 * into a PDF document.
 */

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export interface ExportSection {
  /** The DOM element to capture */
  element: HTMLElement;
  /** Optional label printed above the section in the PDF */
  label?: string;
}

export interface ExportOptions {
  /** Force all sections onto a single page (scales down to fit) */
  singlePage?: boolean;
}

const PDF_EXPORT_CLASS = 'pdf-export-mode';

/**
 * Export one or more DOM sections to a PDF file.
 *
 * @param sections  Ordered list of DOM elements to capture
 * @param filename  Output filename (without .pdf extension)
 * @param options   Export options
 */
export async function exportSectionsToPdf(
  sections: ExportSection[],
  filename: string,
  options: ExportOptions = {},
): Promise<void> {
  // Apply export-mode class to tighten spacing during capture
  const root = document.documentElement;
  root.classList.add(PDF_EXPORT_CLASS);

  // Brief delay so the browser applies the class
  await new Promise((r) => setTimeout(r, 50));

  try {
    if (options.singlePage) {
      await exportSinglePage(sections, filename);
    } else {
      await exportMultiPage(sections, filename);
    }
  } finally {
    root.classList.remove(PDF_EXPORT_CLASS);
  }
}

// ---------------------------------------------------------------------------
// Single-page export: capture all sections, stitch into one tall image,
// scale to fit exactly within one A4 landscape page.
// ---------------------------------------------------------------------------

async function exportSinglePage(
  sections: ExportSection[],
  filename: string,
): Promise<void> {
  // Capture each section
  const canvases: HTMLCanvasElement[] = [];
  for (const section of sections) {
    const canvas = await html2canvas(section.element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    canvases.push(canvas);
  }

  // Stitch canvases vertically into one combined canvas
  const gap = 16; // pixels gap between sections (at 2x scale)
  const maxW = Math.max(...canvases.map((c) => c.width));
  const totalH = canvases.reduce((sum, c) => sum + c.height, 0) + gap * (canvases.length - 1);

  const combined = document.createElement('canvas');
  combined.width = maxW;
  combined.height = totalH;
  const ctx = combined.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, maxW, totalH);

  let y = 0;
  for (let i = 0; i < canvases.length; i++) {
    ctx.drawImage(canvases[i], 0, y);
    y += canvases[i].height + gap;
  }

  // Create A4 landscape PDF
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  // Scale proportionally to fit the combined image within the page
  const imgAspect = combined.width / combined.height;
  const pageAspect = usableW / usableH;

  let finalW: number;
  let finalH: number;
  if (imgAspect > pageAspect) {
    // Image is wider proportionally — constrain by width
    finalW = usableW;
    finalH = usableW / imgAspect;
  } else {
    // Image is taller proportionally — constrain by height
    finalH = usableH;
    finalW = usableH * imgAspect;
  }

  const imgData = combined.toDataURL('image/png');
  const x = margin + (usableW - finalW) / 2; // center horizontally
  pdf.addImage(imgData, 'PNG', x, margin, finalW, finalH);
  pdf.save(`${filename}.pdf`);
}

// ---------------------------------------------------------------------------
// Multi-page export: each section gets its own page if it doesn't fit.
// Sections are scaled individually to fit within a single page.
// ---------------------------------------------------------------------------

async function exportMultiPage(
  sections: ExportSection[],
  filename: string,
): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  let cursorY = margin;
  let isFirstSection = true;

  for (const section of sections) {
    const canvas = await html2canvas(section.element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const imgW = usableW;
    const imgH = (canvas.height / canvas.width) * imgW;

    // If the image doesn't fit on the current page, start a new page
    if (!isFirstSection && cursorY + imgH > pageH - margin) {
      pdf.addPage();
      cursorY = margin;
    }

    // If a single section is taller than one page, scale it down to fit
    let finalW = imgW;
    let finalH = imgH;
    if (finalH > usableH) {
      const scaleFactor = usableH / finalH;
      finalW *= scaleFactor;
      finalH *= scaleFactor;
    }

    pdf.addImage(imgData, 'PNG', margin, cursorY, finalW, finalH);
    cursorY += finalH + 4;
    isFirstSection = false;
  }

  pdf.save(`${filename}.pdf`);
}
