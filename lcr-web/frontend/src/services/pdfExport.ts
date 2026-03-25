/**
 * PDF Export utility using html2canvas + jsPDF.
 *
 * Captures one or more DOM elements as images and assembles them
 * into a single PDF document (A4 landscape by default).
 */

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export interface ExportSection {
  /** The DOM element to capture */
  element: HTMLElement;
  /** Optional label printed above the section in the PDF */
  label?: string;
}

/**
 * Export one or more DOM sections to a PDF file.
 *
 * @param sections  Ordered list of DOM elements to capture
 * @param filename  Output filename (without .pdf extension)
 */
export async function exportSectionsToPdf(
  sections: ExportSection[],
  filename: string,
): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableW = pageW - margin * 2;

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

    // Add label if provided
    if (section.label) {
      if (cursorY + 8 > pageH - margin) {
        pdf.addPage();
        cursorY = margin;
      }
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.text(section.label, margin, cursorY + 5);
      cursorY += 8;
    }

    // If the image doesn't fit on the current page, start a new page
    if (!isFirstSection && cursorY + imgH > pageH - margin) {
      pdf.addPage();
      cursorY = margin;
    }

    // If a single section is taller than one page, scale it down to fit
    let finalW = imgW;
    let finalH = imgH;
    if (finalH > pageH - margin * 2) {
      const scaleFactor = (pageH - margin * 2) / finalH;
      finalW *= scaleFactor;
      finalH *= scaleFactor;
    }

    pdf.addImage(imgData, 'PNG', margin, cursorY, finalW, finalH);
    cursorY += finalH + 6;
    isFirstSection = false;
  }

  pdf.save(`${filename}.pdf`);
}
