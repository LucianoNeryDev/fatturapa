# Changelog

## Unreleased

- Document-level discounts and surcharges (`adjustments` on the invoice), applied in cascade and spread over the VAT rates as `SC`/`AC` lines. `computeTotals` and the result gain `adjustmentLines`.
- Public administration invoices: `format: "FPA12"` sets `versione` and `FormatoTrasmissione`. It requires the 6-character codice univoco ufficio as recipient code and rejects PEC and foreign buyers. FPR12 invoices reject 6-character codes.
- `isValidRecipientCode(code, format?)` takes an optional format; `"FPA12"` checks a 6-character office code.
- Document references: `orderReference` takes one reference or an array, and the new `contractReference`, `agreementReference` and `receiptReference` render `DatiContratto`, `DatiConvenzione` and `DatiRicezione`. Each reference (`DocumentReference`) carries line numbers, an order or agreement code, CUP and CIG, checked against the schema lengths.
- Withholding tax (`withholdings`, `DatiRitenuta`): one per `TipoRitenuta`, with rate, `CausalePagamento` reason and an optional `basePercent` for sales agents. Lines take `withholding: true` (`Ritenuta` `SI`); a document adjustment line inherits it when its whole VAT group is subject to withholding.
- Pension funds (`pensionFunds`, `DatiCassaPrevidenziale`): the contribution is computed on the taxable amount (or `taxableCents`) after the document adjustments and added to its VAT rate. It can be subject to withholding.
- SDI consistency checks between withholdings, lines and pension funds, reported with their input paths; an invoice whose withholdings exceed the amount payable is rejected.
- `computeTotals` and the result gain `pensionFunds`, `withholdings`, `withholdingCents` and `payableCents`; `computeTotals` also takes `pensionFunds`, `withholdings` and `vatExigibility`. New code lists `withholdingTypes`, `paymentReasons` and `pensionFundTypes`.
- `ImportoPagamento` is now the amount payable: the total less the withholdings, and less the VAT with split payment (`vatExigibility: "S"`). It was the document total.
- Docs: FPA12 files must be signed (CAdES or XAdES) by the SDI channel before transmission; the library does not sign.

## 0.1.1 - 2026-10-21

- Published on npm as `@lucianonerydev/fatturapa`. No code changes.

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
