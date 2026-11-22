// CSV and PDF export (jsPDF is loaded only when a PDF is requested).

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBlob(blob: Blob, name: string) {
  download(blob, name);
}

export function exportCsv<T>(name: string, cols: Column<T>[], rows: T[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(','))];
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export interface PdfSection {
  title: string;
  kpis?: { label: string; value: string }[];
  image?: string;
  table?: { head: string[]; body: (string | number)[][] };
}

export async function exportPdf(name: string, title: string, subtitle: string, sections: PdfSection[]) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const header = () => {
    doc.setFillColor(14, 19, 26);
    doc.rect(0, 0, W, 64, 'F');
    doc.setFillColor(245, 165, 36);
    doc.triangle(M, 40, M + 10, 22, M + 20, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('STRATA', M + 28, 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(180, 190, 205);
    doc.text('Mine Operations Intelligence', M + 28, 48);
    doc.text(new Date().toLocaleString(), W - M, 36, { align: 'right' });
  };
  header();
  let y = 92;
  doc.setTextColor(20, 24, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, M, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 115);
  doc.text(subtitle, M, y);
  y += 22;
  const ensure = (h: number) => {
    if (y + h > H - 40) {
      doc.addPage();
      header();
      y = 90;
    }
  };
  for (const s of sections) {
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 24, 32);
    doc.text(s.title, M, y);
    y += 12;
    if (s.kpis?.length) {
      const per = 4;
      const cw = (W - 2 * M - (per - 1) * 8) / per;
      for (let i = 0; i < s.kpis.length; i++) {
        if (i % per === 0) { ensure(52); if (i) y += 52; }
        const x = M + (i % per) * (cw + 8);
        doc.setDrawColor(225, 229, 235);
        doc.setFillColor(247, 248, 250);
        doc.roundedRect(x, y, cw, 44, 4, 4, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 110, 125);
        doc.text(s.kpis[i].label.toUpperCase(), x + 8, y + 15);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(20, 24, 32);
        doc.text(s.kpis[i].value, x + 8, y + 34);
      }
      y += 60;
    }
    if (s.image) {
      const ih = (W - 2 * M) * 0.36;
      ensure(ih + 10);
      doc.addImage(s.image, 'JPEG', M, y, W - 2 * M, ih, undefined, 'FAST');
      y += ih + 14;
    }
    if (s.table) {
      autoTable(doc, {
        startY: y + 4,
        head: [s.table.head],
        body: s.table.body,
        margin: { left: M, right: M, top: 84 },
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [24, 32, 43], textColor: 255 },
        alternateRowStyles: { fillColor: [246, 247, 249] },
        didDrawPage: () => header(),
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(140, 148, 160);
    doc.text(`Page ${p} of ${pages}  ·  Simulated demo data`, W / 2, H - 20, { align: 'center' });
  }
  doc.save(`${name}.pdf`);
}
