/** Flowing layout on A4 pages: text wrapping, page breaks and tables with repeated headers. */

import {
  type FontName,
  PdfPage,
  pageHeight,
  pageWidth,
  textWidth,
} from "./pdf.js";

export const margin = 40;
export const contentWidth = pageWidth - 2 * margin;
const top = 40;
/** Lowest baseline area for content; the footer sits below. */
const bottom = pageHeight - 56;

export const bodySize = 8.5;
export const lineHeight = 10.5;
export const cellPadding = 4;
const headerSize = 7.5;
const headerLineHeight = 9;

/** Distance from the top of a line box to its baseline (Helvetica ascender is 0.718 em). */
export function ascent(size: number): number {
  return size * 0.78;
}

/**
 * Splits text into lines no wider than `width`, breaking at spaces, and inside words that are
 * wider than the whole column.
 */
export function wrap(
  text: string,
  font: FontName,
  size: number,
  width: number,
): string[] {
  const fits = (s: string) => textWidth(s, font, size) <= width;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let rest = word;
    while (!fits(rest)) {
      let n = 1;
      while (n < rest.length - 1 && fits(rest.slice(0, n + 1))) n++;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export type Align = "left" | "right";

export interface Column {
  title: string;
  width: number;
  align?: Align;
}

export interface TextStyle {
  font?: FontName;
  size?: number;
  gray?: number;
}

export class Layout {
  readonly pages: PdfPage[] = [];
  page!: PdfPage;
  /** Top of the free space on the current page, in points from the top edge. */
  y = 0;
  /** Redraws a table header after a page break inside the table. */
  private repeatHeader: (() => void) | undefined;

  constructor(private readonly runningHeader: string) {
    this.addPage();
  }

  addPage(): void {
    this.page = new PdfPage();
    this.pages.push(this.page);
    this.y = top;
    if (this.pages.length > 1) {
      this.page.text(
        margin,
        top + ascent(7.5),
        this.runningHeader,
        "regular",
        7.5,
        0.4,
      );
      this.y = top + 18;
    }
    this.repeatHeader?.();
  }

  /** Starts a new page unless `height` points fit below the cursor. */
  ensure(height: number): void {
    if (this.y + height > bottom) this.addPage();
  }

  /** Draws one line of text aligned in the box [x, x + width], with its top at `y`. */
  draw(
    x: number,
    y: number,
    text: string,
    style: TextStyle = {},
    align: Align = "left",
    width = 0,
  ): void {
    const { font = "regular", size = bodySize, gray = 0 } = style;
    const left =
      align === "right" ? x + width - textWidth(text, font, size) : x;
    this.page.text(left, y + ascent(size), text, font, size, gray);
  }

  /** A wrapped paragraph across the full width (or `width` from `x`), breaking pages per line. */
  paragraph(
    text: string,
    style: TextStyle = {},
    x = margin,
    width = contentWidth,
  ): void {
    const size = style.size ?? bodySize;
    const height = size * 1.25;
    for (const line of wrap(text, style.font ?? "regular", size, width)) {
      this.ensure(height);
      this.draw(x, this.y, line, style);
      this.y += height;
    }
  }

  /** A section title, kept on the same page as the start of its content. */
  section(title: string): void {
    this.y += 12;
    this.ensure(80);
    this.draw(margin, this.y, title, { font: "bold", size: 9.5 });
    this.y += 13;
    this.page.line(margin, this.y, margin + contentWidth, this.y, 0.8, 0.2);
    this.y += 5;
  }

  /** Label and value pairs, the label in a narrow grey column. */
  fields(pairs: [string, string][], labelWidth = 95): void {
    for (const [label, value] of pairs) {
      const lines = wrap(value, "regular", bodySize, contentWidth - labelWidth);
      this.ensure(lines.length * lineHeight);
      this.draw(margin, this.y, label, { gray: 0.35 });
      lines.forEach((line, i) =>
        this.draw(margin + labelWidth, this.y + i * lineHeight, line),
      );
      this.y += lines.length * lineHeight;
    }
  }

  private headerLines(columns: Column[]): string[][] {
    return columns.map((c) =>
      wrap(c.title, "bold", headerSize, c.width - 2 * cellPadding),
    );
  }

  private drawHeader(columns: Column[], x: number): void {
    const titles = this.headerLines(columns);
    const height =
      Math.max(...titles.map((t) => t.length)) * headerLineHeight +
      2 * cellPadding;
    const width = columns.reduce((n, c) => n + c.width, 0);
    this.page.rect(x, this.y, width, height, 0.9);
    let left = x;
    columns.forEach((column, i) => {
      titles[i]!.forEach((line, k) =>
        this.draw(
          left + cellPadding,
          this.y + cellPadding + k * headerLineHeight,
          line,
          { font: "bold", size: headerSize },
          column.align,
          column.width - 2 * cellPadding,
        ),
      );
      left += column.width;
    });
    this.y += height;
  }

  /**
   * A table whose cells wrap inside their column. Rows never split across pages, and the
   * header is repeated at the top of every page the table continues on.
   */
  table(
    columns: Column[],
    rows: string[][],
    options: { x?: number; boldRows?: Set<number> } = {},
  ): void {
    const x = options.x ?? margin;
    const width = columns.reduce((n, c) => n + c.width, 0);
    const titles = this.headerLines(columns);
    const headerHeight =
      Math.max(...titles.map((t) => t.length)) * headerLineHeight +
      2 * cellPadding;
    this.ensure(headerHeight + lineHeight + 2 * cellPadding);
    this.drawHeader(columns, x);
    this.repeatHeader = () => this.drawHeader(columns, x);
    rows.forEach((row, r) => {
      const font: FontName = options.boldRows?.has(r) ? "bold" : "regular";
      const cells = columns.map((column, i) =>
        wrap(row[i] ?? "", font, bodySize, column.width - 2 * cellPadding),
      );
      const height =
        Math.max(...cells.map((c) => c.length)) * lineHeight + 2 * cellPadding;
      this.ensure(height);
      let left = x;
      columns.forEach((column, i) => {
        cells[i]!.forEach((line, k) =>
          this.draw(
            left + cellPadding,
            this.y + cellPadding + k * lineHeight,
            line,
            { font },
            column.align,
            column.width - 2 * cellPadding,
          ),
        );
        left += column.width;
      });
      this.y += height;
      this.page.line(x, this.y, x + width, this.y, 0.4, 0.8);
    });
    this.repeatHeader = undefined;
  }

  /** Writes the footer on every page; call once the content is complete. */
  footer(text: string): void {
    const size = 7;
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const number = `Pagina ${i + 1} di ${total}`;
      const numberWidth = textWidth(number, "regular", 7.5);
      const lines = wrap(
        text,
        "regular",
        size,
        contentWidth - numberWidth - 16,
      );
      const first = pageHeight - 44;
      page.line(margin, first - 6, margin + contentWidth, first - 6, 0.4, 0.6);
      lines.forEach((line, k) =>
        page.text(
          margin,
          first + ascent(size) + k * 8.5,
          line,
          "regular",
          size,
          0.35,
        ),
      );
      page.text(
        margin + contentWidth - numberWidth,
        first + ascent(7.5),
        number,
        "regular",
        7.5,
        0.35,
      );
    });
  }
}
