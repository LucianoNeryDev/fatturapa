/**
 * A minimal PDF 1.4 writer: A4 pages, uncompressed content streams and the base-14 fonts
 * Helvetica and Helvetica-Bold with WinAnsiEncoding. Output is deterministic: the same pages
 * always serialize to the same bytes.
 */

export type FontName = "regular" | "bold";

/** A4 portrait, in points. */
export const pageWidth = 595.28;
export const pageHeight = 841.89;

/**
 * Advance widths (1/1000 em) of WinAnsi codes 32-255, from the Adobe Core14 AFM files of
 * Helvetica and Helvetica-Bold (identical to URW Nimbus Sans). Codes WinAnsi leaves undefined
 * carry the width of "?", which the encoder substitutes for them.
 */
const widths: Record<FontName, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
    278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
    584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
    833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
    278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
    500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
    500, 334, 260, 334, 584, 556, 556, 556, 222, 556, 333, 1000, 556, 556, 333,
    1000, 667, 333, 1000, 556, 611, 556, 556, 222, 222, 333, 333, 350, 556,
    1000, 333, 1000, 500, 333, 944, 556, 500, 667, 278, 333, 556, 556, 556, 556,
    260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333,
    556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667,
    667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778,
    778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556,
    556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556,
    556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
    278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
    584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
    833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
    278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
    556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
    500, 389, 280, 389, 584, 611, 556, 611, 278, 556, 500, 1000, 556, 556, 333,
    1000, 667, 333, 1000, 611, 611, 611, 611, 278, 278, 500, 500, 350, 556,
    1000, 333, 1000, 556, 333, 944, 611, 500, 667, 278, 333, 556, 556, 556, 556,
    280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333,
    611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722,
    722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778,
    778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556,
    556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611,
    611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
  ],
};

const baseFonts: Record<FontName, string> = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
};
const fontKeys: Record<FontName, string> = { regular: "F1", bold: "F2" };

/** Unicode characters of the WinAnsi block 0x80-0x9F, by code. */
const winAnsiHigh: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/**
 * Maps text to WinAnsi codes. Latin-1 printable characters keep their code, the WinAnsi
 * extras (€ at 0x80, typographic quotes and dashes) get theirs, and anything else (control
 * characters, other scripts) becomes "?".
 */
export function encodeWinAnsi(text: string): number[] {
  const codes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff))
      codes.push(code);
    else codes.push(winAnsiHigh[code] ?? 0x3f);
  }
  return codes;
}

/** Width of `text` in points, set in `font` at `size`. */
export function textWidth(text: string, font: FontName, size: number): number {
  const table = widths[font];
  let total = 0;
  for (const code of encodeWinAnsi(text)) total += table[code - 32]!;
  return (total * size) / 1000;
}

/** A PDF literal string: printable ASCII as is, ( ) \ escaped, other bytes as octal. */
function literal(codes: number[]): string {
  let out = "(";
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c)
      out += "\\" + String.fromCharCode(code);
    else if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
    else out += "\\" + code.toString(8).padStart(3, "0");
  }
  return out + ")";
}

/** A coordinate or size with at most 2 decimals, without trailing zeros. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** One page's drawing operations. Coordinates are measured from the top-left corner. */
export class PdfPage {
  private readonly ops: string[] = [];

  /** Draws `text` with its baseline at `y` points from the top. */
  text(
    x: number,
    y: number,
    text: string,
    font: FontName,
    size: number,
    gray = 0,
  ): void {
    if (!text) return;
    this.ops.push(
      `BT ${num(gray)} g /${fontKeys[font]} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(pageHeight - y)} Tm ${literal(encodeWinAnsi(text))} Tj ET`,
    );
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 0.5,
    gray = 0,
  ): void {
    this.ops.push(
      `${num(gray)} G ${num(width)} w ${num(x1)} ${num(pageHeight - y1)} m ${num(x2)} ${num(pageHeight - y2)} l S`,
    );
  }

  /** Fills a rectangle whose top-left corner is at (x, y). */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    gray: number,
  ): void {
    this.ops.push(
      `${num(gray)} g ${num(x)} ${num(pageHeight - y - height)} ${num(width)} ${num(height)} re f`,
    );
  }

  /** The content stream. */
  content(): string {
    return this.ops.join("\n") + "\n";
  }
}

export interface DocumentInfo {
  title?: string;
  author?: string;
  creationDate?: Date;
}

/** A text string for the document information dictionary, in UTF-16BE with a BOM. */
function infoString(text: string): string {
  let hex = "<FEFF";
  for (let i = 0; i < text.length; i++)
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return hex + ">";
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * Serializes the pages into a PDF file. Every byte of the output is built from the pages and
 * `info`, so identical input yields identical bytes; there is no /ID and no creation date
 * unless one is given.
 */
export function writePdf(
  pages: PdfPage[],
  info: DocumentInfo = {},
): Uint8Array {
  // Fixed objects: 1 catalog, 2 page tree, 3-4 fonts, 5 info; then a page and its content
  // stream for each page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFonts.regular} /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFonts.bold} /Encoding /WinAnsiEncoding >>`;
  const entries = [`/Producer ${infoString("@lucianonerydev/fatturapa-pdf")}`];
  if (info.title) entries.push(`/Title ${infoString(info.title)}`);
  if (info.author) entries.push(`/Author ${infoString(info.author)}`);
  if (info.creationDate)
    entries.push(`/CreationDate (${pdfDate(info.creationDate)})`);
  objects[5] = `<< ${entries.join(" ")} >>`;
  pages.forEach((page, i) => {
    const id = pageIds[i]!;
    const content = page.content();
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] =
      `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  });

  // Every object is ASCII except the binary marker comment, so string offsets are byte offsets.
  let file = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = file.length;
    file += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = file.length;
  file += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++)
    file += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i);
  return bytes;
}
