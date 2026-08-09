export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

function safeFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

function downloadBlob(content: BlobPart, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportCsv<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const lines = [
    columns.map((column) => csvCell(column.header)).join(','),
    ...rows.map((row) =>
      columns
        .map((column) => csvCell(displayValue(column.value(row))))
        .join(','),
    ),
  ];
  downloadBlob(
    `\uFEFF${lines.join('\r\n')}`,
    'text/csv;charset=utf-8',
    `${safeFilename(title)}.csv`,
  );
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Excel opens HTML tables saved with the legacy .xls extension natively.
// This avoids shipping a large spreadsheet dependency for a read-only report
// export while still producing a file that opens directly in Excel.
export function exportExcel<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const header = columns
    .map((column) => `<th>${htmlEscape(column.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${htmlEscape(displayValue(column.value(row)))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(
    title,
  )}</title></head><body><h1>${htmlEscape(title)}</h1><table border="1"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;

  downloadBlob(
    `\uFEFF${html}`,
    'application/vnd.ms-excel;charset=utf-8',
    `${safeFilename(title)}.xls`,
  );
}

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?');
}

function pdfEscape(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(value: string, width = 104): string[] {
  const text = ascii(value).replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (word.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }

    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function makePdf(title: string, lines: string[]): Blob {
  const pageLineLimit = 48;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLineLimit) {
    pages.push(lines.slice(index, index + pageLineLimit));
  }
  if (pages.length === 0) pages.push(['No rows.']);

  const fontObject = 3;
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const objectBodies = new Map<number, string>();

  objectBodies.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objectBodies.set(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] >>`,
  );
  objectBodies.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((pageLines, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const contentLines = [
      'BT',
      '/F1 9 Tf',
      '36 756 Td',
      '11 TL',
      `(${pdfEscape(title)}${pages.length > 1 ? ` - Page ${index + 1} of ${pages.length}` : ''}) Tj`,
      'T*',
      ...pageLines.flatMap((line) => [`(${pdfEscape(line)}) Tj`, 'T*']),
      'ET',
    ];
    const stream = contentLines.join('\n');
    objectBodies.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objectBodies.set(
      contentId,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  const maxObjectId = Math.max(...objectBodies.keys());
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = new Array(maxObjectId + 1).fill(0);

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objectBodies.get(id) ?? '<<>>'}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

export function exportPdf<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const header = columns.map((column) => column.header).join(' | ');
  const divider = '-'.repeat(Math.min(104, header.length || 20));
  const lines = [
    ...wrapText(header),
    divider,
    ...rows.flatMap((row) =>
      wrapText(columns.map((column) => displayValue(column.value(row))).join(' | ')),
    ),
  ];
  const blob = makePdf(title, lines);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename(title)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
