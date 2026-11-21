# fatturapa-pdf

Render the PDF courtesy copy (copia di cortesia) of an Italian electronic invoice built with [`@lucianonerydev/fatturapa`](https://github.com/LucianoNeryDev/fatturapa#readme). It validates the invoice with the core library, so the PDF shows exactly the data and totals of the XML file you send to SDI. No dependencies besides the core: the PDF writer is part of the package, and it runs in Node.js and in the browser.

```ts
import { writeFileSync } from "node:fs";
import { renderInvoicePdf } from "@lucianonerydev/fatturapa-pdf";

const pdf = renderInvoicePdf(input); // the same InvoiceInput you pass to buildInvoice
writeFileSync("fattura-1-A.pdf", pdf);
```

## Install

```sh
npm install @lucianonerydev/fatturapa @lucianonerydev/fatturapa-pdf
```

The core library is a peer dependency (`^0.2.0`). The package needs Node.js 20 or later, or any modern browser, and ships ES modules with type declarations.

## API

`renderInvoicePdf(input: InvoiceInput, options?: RenderPdfOptions): Uint8Array`

- `input` is an `InvoiceInput` from `@lucianonerydev/fatturapa`. The function calls `buildInvoice(input)` first: invalid input throws its `FatturaPAError` with every issue, and no PDF is produced.
- `options.creationDate` (`Date`) is written to the document information as `/CreationDate`, in UTC. It is omitted by default.
- `options.title` sets the document title in the PDF metadata. The default is the document type, number and date, e.g. "Fattura N. 1/A del 20/10/2026".

The output is deterministic: the same input and options always produce the same bytes (no `/ID`, no timestamp unless you pass one), so you can store the PDF or compare it in tests.

## What it renders

The labels are in Italian. Amounts are in Italian format (`1.234,56`), with the euro sign in the totals; dates are `dd/mm/yyyy`.

- **Header**: the document type (Fattura, Nota di credito, Nota di debito, Fattura differita; "verso Pubblica Amministrazione" for FPA12), number and date.
- **Parties**: the seller with address, Partita IVA, codice fiscale, tax regime, permanent establishment or fiscal representative; the buyer with address, Partita IVA or foreign tax identifier, codice fiscale, recipient code, office code (FPA12) or PEC, permanent establishment or fiscal representative. A third-party issuer gets its own line.
- **References**: purchase orders, contracts, agreements and receipts with their CIG, CUP and line numbers; the invoices a credit or debit note corrects; the causale.
- **Lines**: description (wrapped), quantity, unit, unit price, discounts and surcharges (e.g. `-10% -5,00`), VAT rate or nature, and amount, followed by the lines generated from document-level discounts and surcharges. The table header repeats on every page.
- **VAT summary**: rate or nature, taxable amount, VAT, exigibility and legal reference.
- **Totals**: taxable amount with each pension fund contribution, VAT, document total, each withholding with its rate and base, the VAT the buyer pays under split payment, the virtual stamp duty (for information) and the net amount payable.
- **Payment**: terms, method, IBAN, bank and beneficiary, and a table of instalments with due dates and amounts.
- **Footer** on every page: "Copia di cortesia priva di valore fiscale. L'originale è il file XML trasmesso tramite il Sistema di Interscambio (SdI)." and the page number.

## Limits

- The PDF is a courtesy copy with no fiscal value. The invoice is the XML file delivered by SDI.
- It uses the PDF base-14 fonts Helvetica and Helvetica-Bold with WinAnsi encoding, which cover the Latin-1 characters the core library accepts. Fonts are not embedded, so the viewer supplies a metric-compatible Helvetica; the file is not PDF/A.
- The layout is fixed: A4 portrait, no logo, no custom colors or fields.
- Content streams are not compressed. A one-page invoice is about 8 KB.

## Development

The package depends on the core library through `file:../..`, so the core must be built first: run `npm ci` at the repository root (its `prepare` script builds `dist/`), or `npm run build` there after changing it.

```sh
cd packages/pdf
npm ci
npm run typecheck
npm test              # the text-extraction test needs pdftotext (poppler-utils) and is skipped without it
npm run format:check
npm run build
```

## License

[MIT](LICENSE) © Luciano Nery
