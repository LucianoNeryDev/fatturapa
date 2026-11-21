import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInvoice, FatturaPAError } from "@lucianonerydev/fatturapa";
import { renderInvoicePdf } from "../src/index.js";
import { formatAmount, formatDecimal } from "../src/format.js";
import { encodeWinAnsi, textWidth } from "../src/pdf.js";
import { wrap } from "../src/layout.js";
import {
  foreignBuyer,
  longDescription,
  manyLines,
  professional,
  publicAdministration,
} from "./fixtures.js";

/** The PDF bytes as a string, one character per byte. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Checks the header, the xref offsets, startxref and the page tree; returns the page count. */
function checkStructure(bytes: Uint8Array): number {
  const pdf = latin1(bytes);
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.endsWith("%%EOF\n"));
  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf);
  assert.ok(startxref, "startxref");
  const xref = Number(startxref[1]);
  assert.ok(pdf.startsWith("xref\n", xref), "startxref points at xref");
  const table = /^xref\n0 (\d+)\n/.exec(pdf.slice(xref));
  assert.ok(table);
  const size = Number(table[1]);
  const entries = pdf
    .slice(xref + table[0].length)
    .split("\n")
    .slice(0, size);
  assert.equal(entries[0], "0000000000 65535 f ");
  for (let id = 1; id < size; id++) {
    const entry = /^(\d{10}) 00000 n $/.exec(entries[id]!);
    assert.ok(entry, `xref entry ${id}`);
    assert.ok(
      pdf.startsWith(`${id} 0 obj\n`, Number(entry[1])),
      `object ${id} at its offset`,
    );
  }
  assert.match(pdf, new RegExp(`trailer\\n<< /Size ${size} /Root 1 0 R `));
  for (const [, length, content] of pdf.matchAll(
    /<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g,
  ))
    assert.equal(content!.length, Number(length), "stream length");
  const count = Number(
    /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)![1],
  );
  assert.equal(pdf.match(/\/Type \/Page /g)?.length, count);
  return count;
}

/** The content streams, one per page. */
function pageContents(bytes: Uint8Array): string[] {
  return [...latin1(bytes).matchAll(/stream\n([\s\S]*?)endstream/g)].map(
    (m) => m[1]!,
  );
}

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function extractText(bytes: Uint8Array, layout = false): string {
  const dir = mkdtempSync(join(tmpdir(), "fatturapa-pdf-"));
  try {
    const file = join(dir, "invoice.pdf");
    writeFileSync(file, bytes);
    return execFileSync(
      "pdftotext",
      [...(layout ? ["-layout"] : []), file, "-"],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pdftotext = hasPdftotext();

test("renders a structurally valid single-page PDF", () => {
  const bytes = renderInvoicePdf(professional);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(checkStructure(bytes), 1);
  const pdf = latin1(bytes);
  assert.match(pdf, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /\/MediaBox \[0 0 595.28 841.89\]/);
  assert.doesNotMatch(pdf, /\/ID|\/CreationDate/);
});

test("the same input always yields the same bytes", () => {
  for (const input of [professional, publicAdministration, foreignBuyer]) {
    assert.deepEqual(renderInvoicePdf(input), renderInvoicePdf(input));
  }
  const date = new Date(Date.UTC(2026, 9, 20, 9, 30, 5));
  const dated = renderInvoicePdf(professional, {
    creationDate: date,
    title: "Fattura 12",
  });
  assert.deepEqual(
    dated,
    renderInvoicePdf(professional, { creationDate: date, title: "Fattura 12" }),
  );
  checkStructure(dated);
  assert.match(latin1(dated), /\/CreationDate \(D:20261020093005Z\)/);
});

test("a 120-line invoice paginates with the table header on every page", () => {
  const bytes = renderInvoicePdf(manyLines(120));
  const pages = checkStructure(bytes);
  assert.ok(pages >= 3, `${pages} pages`);
  const contents = pageContents(bytes);
  assert.equal(contents.length, pages);
  contents.forEach((content, i) => {
    assert.ok(
      content.includes(`(Pagina ${i + 1} di ${pages})`),
      `page ${i + 1} numbered`,
    );
    assert.ok(content.includes("(Copia di cortesia priva di valore fiscale."));
  });
  // Every page that holds lines starts with the table header.
  const withLines = contents.filter((c) => c.includes("(Articolo "));
  assert.ok(withLines.length >= 3);
  for (const content of withLines) {
    assert.ok(content.includes("(Descrizione)"));
    assert.ok(content.includes("(Importo)"));
  }
  // Every line appears exactly once, in order.
  const all = contents.join("");
  let last = -1;
  for (let n = 1; n <= 120; n++) {
    const at = all.indexOf(`(Articolo ${n}`, last + 1);
    assert.ok(at > last, `line ${n} in order`);
    last = at;
  }
});

test("parentheses and backslashes in text are escaped", () => {
  const bytes = renderInvoicePdf(foreignBuyer);
  checkStructure(bytes);
  const content = pageContents(bytes).join("");
  assert.ok(
    content.includes(
      "(Controfiletto di manzo \\(sottovuoto\\) - lotto \\\\A12\\\\)",
    ),
  );
  // Latin-1 letters become octal WinAnsi codes: ß is 0xDF.
  assert.ok(content.includes("(Lindenstra\\337e 5)"));
});

test("WinAnsi encoding and Helvetica metrics", () => {
  assert.deepEqual(
    encodeWinAnsi("aé€’\u0007ж"),
    [0x61, 0xe9, 0x80, 0x92, 0x3f, 0x3f],
  );
  // Adobe Core14 AFM advance widths.
  assert.equal(textWidth("W", "regular", 1000), 944);
  assert.equal(textWidth("i", "regular", 1000), 222);
  assert.equal(textWidth("i", "bold", 1000), 278);
  assert.equal(textWidth("€", "bold", 1000), 556);
  assert.equal(textWidth("è", "regular", 1000), 556);
  assert.equal(textWidth("'", "regular", 1000), 191);
  assert.equal(textWidth("Fattura", "regular", 10), 31.68);
  assert.deepEqual(wrap("aaaa bbbb", "regular", 10, 30), ["aaaa", "bbbb"]);
  // A word longer than the column breaks inside it.
  const broken = wrap("x".repeat(40), "regular", 10, 50);
  assert.ok(broken.length > 1);
  assert.equal(broken.join(""), "x".repeat(40));
  for (const line of broken) assert.ok(textWidth(line, "regular", 10) <= 50);
});

test("Italian number formatting", () => {
  assert.equal(formatAmount(123456789), "1.234.567,89");
  assert.equal(formatAmount(-500), "-5,00");
  assert.equal(formatAmount(7), "0,07");
  assert.equal(formatDecimal("3.00"), "3");
  assert.equal(formatDecimal("1.25000000"), "1,25");
  assert.equal(formatDecimal("1240.50"), "1.240,5");
});

test("invalid input throws the core FatturaPAError", () => {
  assert.throws(
    () =>
      renderInvoicePdf({
        ...professional,
        seller: { ...professional.seller, vatNumber: "123" },
      }),
    (error: unknown) =>
      error instanceof FatturaPAError &&
      error.issues.some((issue) => issue.path === "seller.vatNumber"),
  );
});

test(
  "pdftotext reads the invoice data back",
  { skip: !pdftotext && "pdftotext is not installed" },
  () => {
    const invoice = buildInvoice(professional);
    const bytes = renderInvoicePdf(professional);
    const text = extractText(bytes).replace(/\s+/g, " ");
    const layout = extractText(bytes, true);
    assert.ok(text.includes("N. 12/ING del 20/10/2026"));
    assert.ok(text.includes("Edilizia Bresciana Srl"));
    assert.ok(text.includes(longDescription), "wrapped description");
    // VAT summary: 22% on 3.156,40 (fee, discounted line and Inarcassa) with 694,41 VAT.
    assert.match(layout, /22%\s+3\.156,40\s+694,41\s+Immediata/);
    assert.match(
      layout,
      /di cui contributo Inarcassa \(TC04\) 4% su € 3\.035,00\s+€ 121,40/,
    );
    assert.match(layout, /Totale documento\s+€ 3\.850,81/);
    assert.match(
      layout,
      /Ritenuta d'acconto persone fisiche \(RT01\) 20%[\s\S]*€ -607,00/,
    );
    assert.match(layout, /1 19\/11\/2026\s+€ 1\.500,00/);
    assert.match(layout, /2 19\/12\/2026\s+€ 1\.743,81/);
    assert.equal(invoice.payableCents, 324381);
    assert.match(layout, /Netto a pagare\s+€ 3\.243,81/);
    assert.ok(text.includes("IT60 X054 2811 1010 0000 0123 456"));
    assert.ok(
      text.includes(
        "Copia di cortesia priva di valore fiscale. L'originale è il file XML trasmesso tramite il Sistema di Interscambio (SdI).",
      ),
    );

    const pa = extractText(renderInvoicePdf(publicAdministration)).replace(
      /\s+/g,
      " ",
    );
    assert.ok(pa.includes("Fattura verso Pubblica Amministrazione"));
    assert.ok(pa.includes("CIG Z1A2B3C4D5"));
    assert.ok(pa.includes("CUP J41B26000120004"));
    assert.ok(pa.includes("Codice univoco ufficio UF7Q2K"));
    assert.ok(pa.includes("Sconto contrattuale 2% (IVA 22%)"));
    assert.ok(pa.includes("Scissione dei pagamenti"));

    const foreign = extractText(renderInvoicePdf(foreignBuyer)).replace(
      /\s+/g,
      " ",
    );
    assert.ok(foreign.includes("Lindenstraße 5"));
    assert.ok(foreign.includes("10115 Berlin - DE"));
    assert.ok(foreign.includes("Id. fiscale IVA DE123456789"));
    assert.ok(foreign.includes("lotto \\A12\\"));
    assert.ok(foreign.includes("Carta di pagamento (MP08)"));
    assert.ok(foreign.includes("Mercato Digitale Srl"));

    const many = extractText(renderInvoicePdf(manyLines(120)));
    const pages = many.split("\f").filter((p) => p.trim());
    pages.forEach((page, i) =>
      assert.ok(page.includes(`Pagina ${i + 1} di ${pages.length}`)),
    );
  },
);
