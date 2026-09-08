/**
 * PDF rendering.
 *
 * Built with PDFKit's standard fonts, so the binary embeds no font files and
 * needs nothing installed on the host. Typography follows the product: a serif
 * for headings, a sans for body, one accent rule, generous margins.
 *
 * Kept apart from the report builders because it is the only part of reporting
 * that cares about points, pages and line breaks.
 */

import PDFDocument from 'pdfkit';

import type { ReportDocument, Section, Table } from './reports.js';

const MARGIN = 56;
const ACCENT = '#2e5e4e';
const INK = '#17191d';
const INK_SOFT = '#4a4f57';
const INK_FAINT = '#7a818b';
const RULE = '#dcd8d0';
const BAND_SOFT = '#f4f2ee';

/** Column widths proportional to header length, with a sensible floor. */
function columnWidths(table: Table, available: number): number[] {
  const weights = table.columns.map((column, index) => {
    const longestCell = table.rows.reduce(
      (max, row) => Math.max(max, (row[index] ?? '').length),
      column.length,
    );
    // Square-root damping: a very long column should be wider, but not ten
    // times wider, or every other column becomes unreadable.
    return Math.sqrt(Math.max(longestCell, 6));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => Math.max(52, (weight / total) * available));
}

export function renderPdf(report: ReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      // Required so page numbers can be added after layout, when the total is
      // finally known.
      bufferPages: true,
      margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
      info: {
        Title: `${report.title} — ${report.organization}`,
        Author: 'C.O.R.E.',
        Subject: report.subtitle,
        Creator: 'C.O.R.E. — Continuity, Operations, Risk & Execution',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = doc.page.width - MARGIN * 2;

    // ---- cover block ------------------------------------------------------
    doc.font('Times-Bold').fontSize(24).fillColor(INK).text(report.title, { width: contentWidth });
    doc.moveDown(0.4);
    doc.rect(MARGIN, doc.y, 44, 3).fill(ACCENT);
    doc.moveDown(0.9);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(INK_SOFT)
      .text(`${report.organization} · ${report.subtitle}`, MARGIN, doc.y, { width: contentWidth });
    doc
      .fillColor(INK_FAINT)
      .text(`Generated ${new Date(report.generatedAt).toUTCString()}`, { width: contentWidth });
    doc.moveDown(1.2);

    for (const section of report.sections) {
      renderSection(doc, section, contentWidth);
    }

    if (report.assumptions.length > 0) {
      // Measure before drawing: the panel has to be painted underneath the
      // text, and the text cannot be laid out twice without shifting.
      doc.font('Helvetica').fontSize(9);
      const innerWidth = contentWidth - 24;
      const lineHeights = report.assumptions.map(
        (assumption) => doc.heightOfString(`•  ${assumption}`, { width: innerWidth }) + 3,
      );
      const panelHeight =
        12 + doc.heightOfString('ASSUMPTIONS AND LIMITS', { width: innerWidth }) + 8 +
        lineHeights.reduce((sum, height) => sum + height, 0) + 12;

      ensureRoom(doc, panelHeight + 20);
      doc.moveDown(1);
      const top = doc.y;

      doc.save().rect(MARGIN, top, contentWidth, panelHeight).fill(BAND_SOFT).restore();

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INK_SOFT)
        .text('ASSUMPTIONS AND LIMITS', MARGIN + 12, top + 12, { width: innerWidth });
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT);
      for (const assumption of report.assumptions) {
        doc.text(`•  ${assumption}`, MARGIN + 12, doc.y, { width: innerWidth });
        doc.moveDown(0.25);
      }
      doc.y = top + panelHeight;
    }

    addFooters(doc);
    doc.end();
  });
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - MARGIN - 24) doc.addPage();
}

function renderSection(doc: PDFKit.PDFDocument, section: Section, width: number): void {
  ensureRoom(doc, 70);
  doc.moveDown(0.8);

  doc.font('Times-Bold').fontSize(14).fillColor(INK).text(section.heading, MARGIN, doc.y, { width });
  doc.moveDown(0.25);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
  doc.moveDown(0.6);

  doc.font('Helvetica').fontSize(10).fillColor(INK_SOFT);
  for (const paragraph of section.paragraphs ?? []) {
    ensureRoom(doc, 40);
    // Indented lines (the risk reasons) are monospaced so they line up.
    const indented = paragraph.startsWith('    ');
    doc.font(indented ? 'Courier' : 'Helvetica').fontSize(indented ? 8.5 : 10);
    doc.text(paragraph, MARGIN, doc.y, { width, align: 'left' });
    doc.moveDown(0.35);
  }

  doc.font('Helvetica').fontSize(10).fillColor(INK_SOFT);
  for (const bullet of section.bullets ?? []) {
    ensureRoom(doc, 30);
    doc.text(`•  ${bullet}`, MARGIN, doc.y, { width, indent: 0 });
    doc.moveDown(0.3);
  }

  if (section.table !== undefined) renderTable(doc, section.table, width);
}

function renderTable(doc: PDFKit.PDFDocument, table: Table, width: number): void {
  const widths = columnWidths(table, width);
  const cellPadding = 5;

  const rowHeight = (cells: readonly string[], font: string, size: number): number => {
    doc.font(font).fontSize(size);
    let tallest = 0;
    for (const [index, cell] of cells.entries()) {
      const columnWidth = (widths[index] ?? 60) - cellPadding * 2;
      tallest = Math.max(tallest, doc.heightOfString(cell, { width: columnWidth }));
    }
    return tallest + cellPadding * 2;
  };

  const drawRow = (
    cells: readonly string[],
    font: string,
    size: number,
    colour: string,
    background?: string,
  ): void => {
    const height = rowHeight(cells, font, size);
    ensureRoom(doc, height + 6);
    const top = doc.y;

    if (background !== undefined) {
      doc.save().rect(MARGIN, top, width, height).fill(background).restore();
    }

    let x = MARGIN;
    doc.font(font).fontSize(size).fillColor(colour);
    for (const [index, cell] of cells.entries()) {
      const columnWidth = widths[index] ?? 60;
      doc.text(cell, x + cellPadding, top + cellPadding, {
        width: columnWidth - cellPadding * 2,
      });
      x += columnWidth;
    }

    doc.y = top + height;
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + width, doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
  };

  doc.moveDown(0.4);
  drawRow(table.columns, 'Helvetica-Bold', 8, INK_SOFT, BAND_SOFT);
  for (const row of table.rows) {
    drawRow(row, 'Helvetica', 8.5, INK);
  }
  doc.moveDown(0.5);
}

/**
 * Page numbers, added after layout so the total is known.
 *
 * `bufferedPageRange` is used rather than tracking pages by hand, because
 * content can add pages implicitly and a hand-kept count drifts.
 */
function addFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - MARGIN + 4;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(INK_FAINT)
      .text(
        'C.O.R.E. — generated from recorded organization data',
        MARGIN,
        y,
        { width: doc.page.width - MARGIN * 2, align: 'left', lineBreak: false },
      );
    doc.text(`${index - range.start + 1} of ${range.count}`, MARGIN, y, {
      width: doc.page.width - MARGIN * 2,
      align: 'right',
      lineBreak: false,
    });
  }
}
