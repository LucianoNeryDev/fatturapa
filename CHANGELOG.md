# Changelog

## 0.1.0 - 2026-10-21

First release.

- `buildInvoice` validates an invoice and renders FatturaPA FPR12 (private-sector) XML with its SDI file name. Generated files validate against the official 1.2.2 schema.
- Totals and the VAT summary are computed from integer cents, with VAT rounded once per rate as SDI recomputes it. `computeTotals` returns them without rendering.
- Validation reports every problem with its input path: Partita IVA, codice fiscale and IBAN checksums, recipient code and PEC, natures, flat-rate lines, credit-note references, dates, lengths and character set.
- Invoices, credit notes, debit notes and deferred invoices (TD01, TD04, TD05, TD24).
- Line discounts and surcharges in cascade (ScontoMaggiorazione).
- Foreign buyers: foreign tax identifier, recipient code `XXXXXXX`, CAP `00000`.
- Third-party issuers (SoggettoEmittente TZ), automatic virtual stamp duty, purchase-order references and payment details.
- Helpers: `allocateCents`, `formatCents`, `compactIdentifier` and the identifier validators.
