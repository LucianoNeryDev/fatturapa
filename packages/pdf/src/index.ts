import { buildInvoice, type InvoiceInput } from "@lucianonerydev/fatturapa";
import { renderPages } from "./render.js";

export interface RenderPdfOptions {
  /** Written to the document information as /CreationDate; omitted by default. */
  creationDate?: Date;
  /** Document title in the PDF metadata, default e.g. "Fattura N. 1/A del 20/10/2026". */
  title?: string;
}

/**
 * Renders the PDF courtesy copy (copia di cortesia) of an invoice. The invoice is built with
 * buildInvoice first, so invalid input throws its FatturaPAError and every amount on the page
 * is the one in the XML. The same input and options always produce the same bytes.
 */
export function renderInvoicePdf(
  input: InvoiceInput,
  options: RenderPdfOptions = {},
): Uint8Array {
  return renderPages(buildInvoice(input), options);
}
