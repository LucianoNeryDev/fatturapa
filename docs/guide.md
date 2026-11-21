# Guide

`buildInvoice(input)` validates an invoice, computes its totals and renders a FatturaPA XML file: FPR12 for businesses and consumers, or FPA12 for [public administrations](#public-administration-fpa12). It returns the XML, the SDI file name and the computed totals, or throws a `FatturaPAError` listing every problem it found.

```ts
import { buildInvoice, FatturaPAError } from "@lucianonerydev/fatturapa";

try {
  const invoice = buildInvoice(input);
  await sendToSdi(invoice.fileName, invoice.xml);
} catch (error) {
  if (error instanceof FatturaPAError) console.table(error.issues);
  else throw error;
}
```

All amounts are integer euro cents (`2490` is €24.90). Quantities and percentages are decimals.

## Input

### `InvoiceInput`

| Field                | Required   | Description                                                                                                                          |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `format`             |            | `FPR12` (default) for businesses and consumers, `FPA12` for [public administrations](#public-administration-fpa12).                  |
| `type`               |            | `TD01` invoice (default), `TD04` credit note, `TD05` debit note, `TD24` deferred invoice.                                            |
| `number`             | yes        | Invoice number, up to 20 ASCII characters with at least one digit, e.g. `12/A`.                                                      |
| `date`               | yes        | Issue date, `YYYY-MM-DD`.                                                                                                            |
| `seller`             | yes        | The supplier (`CedentePrestatore`), see [Seller](#seller).                                                                           |
| `buyer`              | yes        | The customer (`CessionarioCommittente`), see [Buyer](#buyer).                                                                        |
| `issuer`             |            | A third party issuing on the seller's behalf, see [Third-party issuer](#third-party-issuer).                                         |
| `transmitter`        | yes        | Who sends the file to SDI, see [Transmitter and file name](#transmitter-and-file-name).                                              |
| `lines`              | yes        | 1 to 9999 lines, see [Line](#line).                                                                                                  |
| `adjustments`        |            | Discounts and surcharges on the whole invoice, see [Discounts and surcharges](#discounts-and-surcharges).                            |
| `pensionFunds`       |            | Pension fund contributions (`DatiCassaPrevidenziale`), see [Withholding tax and pension funds](#withholding-tax-and-pension-funds).  |
| `withholdings`       |            | Withholding taxes and contributions (`DatiRitenuta`), see [Withholding tax and pension funds](#withholding-tax-and-pension-funds).   |
| `vatExigibility`     |            | `I` immediate (default), `D` deferred, `S` split payment: the buyer pays the VAT to the Treasury, so the amount payable excludes it. |
| `description`        |            | Free text (`Causale`), split into 200-character elements at word boundaries.                                                         |
| `orderReference`     |            | The buyer's purchase orders (`DatiOrdineAcquisto`), see [Document references](#document-references).                                 |
| `contractReference`  |            | Contracts (`DatiContratto`), see [Document references](#document-references).                                                        |
| `agreementReference` |            | Framework agreements, convenzioni (`DatiConvenzione`), see [Document references](#document-references).                              |
| `receiptReference`   |            | Receipts of the goods or services (`DatiRicezione`), see [Document references](#document-references).                                |
| `linkedInvoices`     | TD04, TD05 | `[{ number, date }]`: the invoices a credit or debit note corrects (`DatiFattureCollegate`).                                         |
| `payment`            |            | See [Payment](#payment).                                                                                                             |
| `stampDuty`          |            | `"auto"` (default), `true` or `false`. See [Stamp duty](#stamp-duty).                                                                |

### Seller

| Field                    | Required | Description                                                                                                                                                                                  |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vatNumber`              | yes      | Italian Partita IVA, 11 digits with a valid check digit. A non-resident seller puts the one it was assigned in Italy.                                                                        |
| `fiscalCode`             |          | Codice fiscale, when it differs from the Partita IVA.                                                                                                                                        |
| `name`                   | yes      | Company name, up to 80 characters.                                                                                                                                                           |
| `taxRegime`              | yes      | `RegimeFiscale`: `RF01` ordinary, `RF19` flat-rate (forfettario), or another `RF` code.                                                                                                      |
| `address`                | yes      | Registered office, see [Address](#address). Abroad for a non-resident seller.                                                                                                                |
| `permanentEstablishment` |          | Italian permanent establishment (`StabileOrganizzazione`) of a seller based abroad, an [Address](#address). See [Foreign sellers and representatives](#foreign-sellers-and-representatives). |
| `fiscalRepresentative`   |          | Fiscal representative (`RappresentanteFiscale`) of a seller based abroad: `vatNumber`, optional `vatCountry` (default `IT`) and `fiscalCode`, and `name`. Not with `permanentEstablishment`. |

### Buyer

| Field                    | Required  | Description                                                                                                                                                                               |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vatNumber`              | see below | Italian Partita IVA, or a foreign tax identifier for a [foreign buyer](#foreign-buyers).                                                                                                  |
| `vatCountry`             |           | Country that issued `vatNumber`; defaults to the address country.                                                                                                                         |
| `fiscalCode`             | see below | Italian codice fiscale, 11 digits or 16 characters with omocodia.                                                                                                                         |
| `name`                   | yes       | Up to 80 characters.                                                                                                                                                                      |
| `address`                | yes       | See [Address](#address). Its country decides whether the buyer is foreign.                                                                                                                |
| `permanentEstablishment` |           | Italian permanent establishment (`StabileOrganizzazione`) of a buyer based abroad, an [Address](#address). Not with `fiscalRepresentative`.                                               |
| `fiscalRepresentative`   |           | Fiscal representative of a buyer based abroad: `vatNumber`, optional `vatCountry` (default `IT`) and `name`.                                                                              |
| `recipientCode`          | FPA12     | SDI recipient code (codice destinatario). FPR12: 7 upper-case letters or digits, defaulting to `0000000`, or `XXXXXXX` for foreign buyers. FPA12: the 6-character codice univoco ufficio. |
| `pec`                    |           | Certified email, only for FPR12 with recipient code `0000000`.                                                                                                                            |

An Italian buyer needs a `vatNumber`, a `fiscalCode` or both. Private consumers usually have only a fiscal code.

### Address

| Field          | Required | Description                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------- |
| `street`       | yes      | Up to 60 characters. Include the civic number, or put it in `streetNumber`. |
| `streetNumber` |          | Up to 8 ASCII characters.                                                   |
| `postalCode`   | Italy    | Five-digit CAP. Optional abroad, see [Foreign buyers](#foreign-buyers).     |
| `city`         | yes      | Up to 60 characters.                                                        |
| `province`     |          | Two-letter Italian province code, e.g. `BS`. Only for Italian addresses.    |
| `country`      |          | ISO 3166-1 alpha-2 code, default `IT`.                                      |

### Line

| Field            | Required | Description                                                                                                                                                                                            |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`    | yes      | Up to 1000 characters.                                                                                                                                                                                 |
| `quantity`       |          | Positive decimal (number or string) with up to 12 digits and 8 decimals. Omit for a single service or charge. Pass a string such as `"1.25"` to avoid binary floating-point surprises.                 |
| `unit`           |          | Unit of measure, up to 10 ASCII characters.                                                                                                                                                            |
| `unitPriceCents` | yes      | Unit price before VAT. May be negative for a discount line.                                                                                                                                            |
| `adjustments`    |          | Discounts and surcharges on the unit price, see [Discounts and surcharges](#discounts-and-surcharges).                                                                                                 |
| `vatRate`        | yes      | Percentage with up to 2 decimals, e.g. `22`, `10`, `4`, `0`.                                                                                                                                           |
| `nature`         | rate 0   | Why the line carries no VAT (`Natura`), e.g. `N2.2`, `N3.1`, `N4`. Required when the rate is 0 and rejected otherwise. The generic `N2`, `N3` and `N6` codes are rejected, as SDI has done since 2021. |
| `legalReference` |          | Law reference for zero-rated lines, up to 100 characters, printed in the VAT summary (`RiferimentoNormativo`).                                                                                         |
| `withholding`    |          | `true` when the line is subject to the invoice's `withholdings` (`Ritenuta` `SI`). See [Withholding tax and pension funds](#withholding-tax-and-pension-funds).                                        |

### Document references

`orderReference`, `contractReference`, `agreementReference` and `receiptReference` each take one reference or an array of them. They are rendered in schema order: purchase orders, contracts, agreements, receipts, then `linkedInvoices`.

| Field         | Required | Description                                                                                                |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Document number, up to 20 ASCII characters (`IdDocumento`).                                                |
| `date`        |          | `YYYY-MM-DD`.                                                                                              |
| `lineNumbers` |          | The invoice lines the reference applies to, from 1 (`RiferimentoNumeroLinea`). Omit for the whole invoice. |
| `itemCode`    |          | Order, contract or agreement code, up to 100 characters (`CodiceCommessaConvenzione`).                     |
| `cup`         |          | Codice Unico di Progetto, up to 15 ASCII characters (`CodiceCUP`).                                         |
| `cig`         |          | Codice Identificativo Gara, up to 15 ASCII characters (`CodiceCIG`).                                       |

Issue paths name the reference: `orderReference.date` for a single object, `contractReference[1].cig` for an array.

### Payment

| Field          | Required | Description                                                                                                                                   |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`       | yes      | `ModalitaPagamento`, e.g. `MP05` bank transfer, `MP08` card, `MP01` cash.                                                                     |
| `terms`        |          | `"full"` (`TP02`), `"installments"` (`TP01`) or `"advance"` (`TP03`). Defaults to `"installments"` with `installments`, else `"full"`.        |
| `dueDate`      |          | `YYYY-MM-DD`. Not allowed with `installments`: give each instalment its own date.                                                             |
| `iban`         |          | Checked with its mod-97 checksum; Italian IBANs must have 27 characters. Use `compactIdentifier` on typed input.                              |
| `bank`         |          | Bank name, up to 80 characters.                                                                                                               |
| `beneficiary`  |          | Up to 200 characters, when the payee is not the seller.                                                                                       |
| `installments` |          | `[{ dueDate?, amountCents?, method?, iban?, bank?, beneficiary? }]`: one `DettaglioPagamento` each. `terms: "installments"` needs at least 2. |

The invoice asks for full payment (`TP02`) of the amount payable, `payableCents`: the document total less the [withholdings](#withholding-tax-and-pension-funds), and less the VAT with split payment (`vatExigibility: "S"`).

Each instalment inherits `method`, `iban`, `bank` and `beneficiary` from the payment unless it sets its own. Give `amountCents` on every instalment or on none. Without amounts, `payableCents` is split equally, and the extra cents go to the first instalments (largest-remainder method, `allocateCents`), so 104.15 EUR in three gives 34.72, 34.72 and 34.71. With amounts, they must add up exactly to `payableCents`, which is the net amount after withholdings. Issues name the instalment, e.g. `payment.installments[1].iban`.

### Third-party issuer

`issuer: { vatNumber, fiscalCode?, name }` declares a third party that issues the invoice on the seller's behalf, such as a marketplace or an accountant. The file gets the `TerzoIntermediarioOSoggettoEmittente` block and `SoggettoEmittente` `TZ`. The invoice is still the seller's: their Partita IVA, numbering and payment details. Issuing on someone's behalf needs their mandate.

### Transmitter and file name

`transmitter: { country?, code, sequence }` identifies who sends the file to SDI:

- `code` is the sender's Partita IVA or codice fiscale.
- `country` defaults to `IT`.
- `sequence` is 1 to 5 letters or digits and becomes `ProgressivoInvio`.

The file name is `<country><code>_<sequence>.xml`, e.g. `IT20000000008_00001.xml`. SDI rejects a file name it has already received, so keep `sequence` unique for each transmitter, e.g. with a stored counter written in base 36.

## Computation

### Totals and rounding

Each line total is the unit price, after its adjustments, times the quantity, rounded half away from zero to the cent. Lines are grouped by VAT rate and nature. The VAT of each group is computed once on the group's taxable total. Rounding line by line would differ: two lines of €0.25 at 10% give 5 cents of VAT, not 6. SDI recomputes the summary this way.

The result carries:

- `lines[i].lineTotalCents`
- `adjustmentLines`: the lines generated from document adjustments, see [below](#discounts-and-surcharges-on-the-whole-invoice)
- `summary`: one entry per rate and nature, highest rate first, each with `taxableCents`, `vatCents` and `legalReference`
- `pensionFunds` and `withholdings`: the computed contributions and withholdings, see [below](#withholding-tax-and-pension-funds)
- `taxableCents`, `vatCents`, and `totalCents` (`ImportoTotaleDocumento`, gross of withholdings)
- `withholdingCents`, the sum of the withholdings, and `payableCents` (`ImportoPagamento`): `totalCents` less `withholdingCents`, and less `vatCents` with split payment
- `stampDutyCents`

`computeTotals({ lines, stampDuty, adjustments, pensionFunds, withholdings, vatExigibility })` returns the same totals without validating or rendering. Use it to show totals before issuing. An invoice (`TD01`) cannot have a negative total; issue a credit note instead.

### Discounts and surcharges

Each line takes `adjustments`, applied to the unit price in the order given:

```ts
{
  description: "Controfiletto di manzo",
  quantity: 3,
  unitPriceCents: 2490,
  vatRate: 10,
  adjustments: [
    { percent: 10 },          // 24.90 → 22.41
    { amountCents: 100 },     // 22.41 → 21.41 (per unit)
  ],
}
// lineTotalCents: 6423
```

Each adjustment has exactly one of these:

- `percent`: a percentage of the running unit price, above 0 and at most 100 for a discount, up to 999.99 for a surcharge
- `amountCents`: a positive amount per unit

`kind` is `"discount"` (default, `SC`) or `"surcharge"` (`MG`). The line total is computed exactly from the original unit price and rounded once, which keeps it within SDI's one-cent tolerance. The XML repeats the original unit price and lists each adjustment.

#### Discounts and surcharges on the whole invoice

`adjustments` on the invoice itself applies to the sum of the line totals:

```ts
{
  // ...
  lines: [/* €74.70 at 10%, €21.13 at 4% */],
  adjustments: [
    { percent: 10, description: "Sconto fedeltà" },   // 10% of the line total
    { amountCents: 500 },                              // then €5.00 more
  ],
}
```

Each adjustment has `kind` (`"discount"`, the default, or `"surcharge"`), exactly one of `percent` or `amountCents`, and an optional `description` (up to 1000 characters, Latin-1).

- **Cascade.** Adjustments apply in order. A `percent` is taken on the running taxable amount: the line totals, plus the effect of the adjustments before it. The amount is rounded half away from zero to the cent. A discount percent is above 0 and at most 100, a surcharge percent up to 999.99, both with at most 2 decimals. An `amountCents` is a positive amount before VAT.
- **Allocation.** Each adjustment is split across the VAT groups (rate and nature) in proportion to the taxable amount of the lines alone, with the largest-remainder method, so the shares add up exactly to the adjustment. Groups with no positive taxable amount get nothing. If no group has one, the invoice is rejected with an issue on `adjustments[i]`.
- **Rendering.** Each non-zero share becomes a `DettaglioLinee` after your lines, numbered on from them, with `TipoCessionePrestazione` `SC` (discount) or `AC` (surcharge), the share as signed `PrezzoUnitario` and `PrezzoTotale`, and the group's `AliquotaIVA` and `Natura`. The description is yours or "Sconto" / "Maggiorazione", followed by the percentage when it is percent-based, and by the group (`(IVA 22%)` or the nature) when the adjustment spans several groups. `totals.adjustmentLines` lists them in the same order.
- **Totals.** The VAT summary, the total and the automatic stamp duty check include the shares. A discount larger than the invoice is only accepted on non-`TD01` documents.

Why lines and not a document-level `ScontoMaggiorazione`: an unconditional discount reduces the VAT base (art. 15 DPR 633/72), so each rate needs its own reduction. A document-level `ScontoMaggiorazione` is informative in FatturaPA and would be counted twice. The library therefore spreads the discount per rate as `SC`/`AC` lines, which SDI sums into the summary as is.

### Withholding tax and pension funds

Professionals and sales agents often invoice with a pension fund contribution (cassa previdenziale) charged to the buyer, and a withholding tax (ritenuta d'acconto) the buyer keeps and pays to the State on their behalf.

```ts
{
  // ...
  lines: [
    {
      description: "Progettazione impianto elettrico",
      unitPriceCents: 100000,
      vatRate: 22,
      withholding: true,
    },
  ],
  pensionFunds: [{ type: "TC04", rate: 4, vatRate: 22 }],
  withholdings: [{ type: "RT01", rate: 20, reason: "A" }],
}
// contribution 40.00, taxable 1040.00, VAT 228.80, total 1268.80
// withholding 200.00 (20% of 1000.00), payable 1068.80
```

`pensionFunds` (`DatiCassaPrevidenziale`):

| Field          | Required | Description                                                                                                                                                                      |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`         | yes      | `TipoCassa`, `TC01` to `TC22`, e.g. `TC01` lawyers, `TC04` engineers and architects, `TC22` INPS.                                                                                |
| `rate`         | yes      | Contribution rate (`AlCassa`), above 0 and at most 100, with at most 2 decimals.                                                                                                 |
| `vatRate`      | yes      | VAT rate on the contribution, usually the fee's. The same rules as a line: rate 0 needs `nature`, flat-rate sellers use 0 with `N2.2`.                                           |
| `nature`       | rate 0   | `Natura` of a zero-rated contribution.                                                                                                                                           |
| `withholding`  |          | `true` when the contribution is subject to the withholdings (`Ritenuta` `SI`), as the INPS rivalsa is. Inarcassa's and most professional funds' integrative contribution is not. |
| `taxableCents` |          | Amount the contribution is computed on (`ImponibileCassa`), a non-negative integer. Defaults to the taxable amount of the lines and document adjustments.                        |
| `reference`    |          | Up to 20 ASCII characters (`RiferimentoAmministrazione`).                                                                                                                        |

`withholdings` (`DatiRitenuta`):

| Field         | Required | Description                                                                                                         |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `type`        | yes      | `TipoRitenuta`: `RT01` individuals, `RT02` companies, `RT03` INPS, `RT04` ENASARCO, `RT05` ENPAM, `RT06` other.     |
| `rate`        | yes      | Withholding rate (`AliquotaRitenuta`), above 0 and at most 100, with at most 2 decimals, e.g. 20.                   |
| `reason`      | yes      | `CausalePagamento`, the 770 payment reason, e.g. `A` professional work, `Q` and `R` sales agents.                   |
| `basePercent` |          | Share of the subject amount the rate applies to, above 0 and at most 100; default 100. Sales agents use 50 (or 20). |

The amounts are computed in this order, each rounded half away from zero to the cent:

1. **Lines and document adjustments**, as above.
2. **Pension funds.** Each contribution is `rate` percent of `taxableCents`, or of the taxable amount of all lines (including document adjustment lines) before any pension fund. It is added to the VAT group of its `vatRate` and `nature`, created if needed, so the VAT summary, the taxable amount, the VAT and the total include it. VAT is still rounded once per group.
3. **Withholdings.** The subject amount is the sum of the lines with `withholding: true` and the contributions with `withholding: true`. Each withholding is `rate` percent of `basePercent` percent of it. A sales agent at 23% on 50% of a €1000.00 commission is withheld €115.00.

A document adjustment line is subject to withholding (`Ritenuta` `SI`, counted in the subject amount) only when every line of its VAT group has `withholding: true`.

`ImportoTotaleDocumento` stays the taxable amount plus VAT, gross of withholdings. `payableCents` is the total less the withholdings, and with split payment (`vatExigibility: "S"`) less the VAT as well, since the buyer pays it to the Treasury. A professional invoicing a public administration with split payment is paid the taxable amount less the withholding. `ImportoPagamento` is `payableCents`.

The XML follows the schema order: `DatiRitenuta` after `Numero`, then `DatiBollo`, then `DatiCassaPrevidenziale`, then `ImportoTotaleDocumento`. On each line, `Ritenuta` comes after `AliquotaIVA`.

SDI's consistency checks are run before rendering, with these issue paths:

- `withholdings`: withholdings with no line and no pension fund marked `withholding: true`
- `lines[i].withholding`, `pensionFunds[i].withholding`: marked `withholding: true` on an invoice without withholdings
- `withholdings[i].type`: a type already used; SDI allows one `DatiRitenuta` per type
- `withholdings`: an invoice (`TD01`) whose withholdings exceed the amount payable

### Stamp duty

Invoices without VAT owe the €2 virtual stamp duty (bollo virtuale) when their VAT-free amounts exceed €77.47. With `stampDuty: "auto"`, the default, the library sums the lines with natures `N1`, `N2.1`, `N2.2`, `N3.5`, `N3.6` and `N4`. Above €77.47 it declares `DatiBollo` and returns `stampDutyCents: 200`. Exports (`N3.1`) and intra-EU supplies (`N3.2`) are not subject to it. Pass `true` or `false` to decide yourself.

The declared duty is not added to the invoice total. If you charge it to the buyer, add a line for it, e.g. "Bollo" at €2.00 with rate 0 and nature `N1`.

### Flat-rate sellers

A seller with `taxRegime: "RF19"` (forfettario) charges no VAT. Every line must have rate 0 and nature `N2.2`. The usual legal reference is "Art. 1, commi 54-89, L. 190/2014", and stamp duty usually applies.

## Foreign buyers

A buyer whose `address.country` is not `IT` is foreign:

- **Tax identifier.** `vatNumber` is required and holds the foreign tax identifier, up to 28 letters or digits, with no checksum check. Spaces and the country prefix are removed, so `DE 123456789` and `123456789` are the same. For Greece, both `EL` and `GR` prefixes are removed. `IdPaese` is the address country, or `vatCountry` when they differ.
- **Buyers without an identifier.** For a private consumer, or a business without a VAT number, put the conventional code your accountant uses in `vatNumber`. `OO99999999999` is common for non-EU buyers.
- **Codice fiscale.** `fiscalCode` is rejected; it is Italian only.
- **Recipient code.** Must be `XXXXXXX`, the default for foreign buyers. SDI does not deliver these invoices, so send the buyer a copy yourself (PDF or paper).
- **Address.** The CAP field only takes 5 digits, so it is set to `00000`. A foreign `postalCode` (up to 12 characters) is printed before the city, e.g. `10115 Berlin`. `province` is rejected.

The VAT treatment depends on the transaction and is set on the lines. Common cases:

- intra-EU supply of goods to a business: rate 0, `N3.2`, "Art. 41, DL 331/1993"
- export of goods outside the EU: rate 0, `N3.1`, "Art. 8, comma 1, lett. a, DPR 633/1972"
- services to a foreign business: rate 0, `N2.1`, "Art. 7-ter, DPR 633/1972"
- sales to foreign private consumers: often Italian VAT, with exceptions such as EU distance sales above the threshold

Confirm the treatment with your accountant.

## Foreign sellers and representatives

A seller based abroad but identified for VAT in Italy keeps `vatNumber` as the Italian Partita IVA it was assigned, whether it registered directly, through a fiscal representative or through a permanent establishment. `address` is its foreign head office (`Sede`):

```ts
seller: {
  vatNumber: "01234567890", // Italian Partita IVA
  name: "Fleischerei Schmidt GmbH",
  taxRegime: "RF01",
  address: { street: "Hauptstraße 1", postalCode: "10115", city: "Berlin", country: "DE" },
}
```

Add one of these, never both:

- **`permanentEstablishment`** is the Italian address of the seller's permanent establishment, rendered as `StabileOrganizzazione` right after `Sede`. Its country must be `IT`.
- **`fiscalRepresentative`** renders `RappresentanteFiscale` between the seller and the buyer. `vatNumber` is an Italian Partita IVA (checked) unless `vatCountry` names another country, where it is 1-28 letters or digits. `fiscalCode` is optional and `name` is up to 80 characters.

Both are rejected when the seller's address is Italian. A buyer based abroad takes the same two fields (`permanentEstablishment`, and a `fiscalRepresentative` with `vatNumber`, `vatCountry` and `name`), also not together, and only when the buyer's address is foreign. The buyer's recipient code stays `XXXXXXX` for a foreign buyer.

## Public administration (FPA12)

Invoices to Italian public administrations use `format: "FPA12"`. The file is the same apart from `versione` and `FormatoTrasmissione`, and validates against the same schema.

```ts
buildInvoice({
  ...input,
  format: "FPA12",
  buyer: {
    fiscalCode: "80012000826",
    name: "Comune di Esempio",
    recipientCode: "UF7Q2K",
    address: {
      street: "Piazza Municipio 1",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  vatExigibility: "S",
  contractReference: {
    id: "REP. 45/2026",
    date: "2026-09-15",
    cig: "Z1A2B3C4D5",
    cup: "J41B26000120004",
  },
});
```

- **Recipient code.** `recipientCode` is required and must be the 6-character codice univoco ufficio of the receiving office, listed in IPA (indicepa.gov.it). `pec` is rejected: SDI delivers to the office code.
- **Buyer.** Must be Italian; a foreign address is rejected. Many public bodies have only an 11-digit numeric codice fiscale and no Partita IVA, so pass `fiscalCode` alone.
- **CIG and CUP.** Put them on the order, contract or agreement they belong to, with `lineNumbers` when they cover only some lines. Their format is checked, but their presence is not: some supplies are exempt. Most offices reject an invoice without the CIG or CUP they expect, so check with the office.
- **Split payment.** Most public administrations pay VAT directly to the State (scissione dei pagamenti): set `vatExigibility: "S"`. The amount payable (`payableCents`, `ImportoPagamento`) then excludes the VAT.
- **Signature.** FPA12 files must carry a qualified electronic signature (CAdES-BES `.p7m` or XAdES-BES) before they reach SDI. This library does not sign: sign through your SDI channel or intermediary, or with your own signing tool.

FPR12 invoices reject 6-character recipient codes, which belong to public administration offices.

## Credit and debit notes

Credit notes (`TD04`) and debit notes (`TD05`) must reference the invoices they correct in `linkedInvoices`. Their lines carry positive amounts: a credit note for €100 has positive lines, and its type tells SDI it reduces the original. Omit `payment` on a credit note unless you are refunding by a stated method.

## Text

Free text is normalised (NFC). Typographic quotes, apostrophes, dashes and ellipses are replaced with ASCII, `€` becomes `EUR`, and runs of whitespace become one space. Characters outside Latin-1, such as emoji, are reported as errors rather than silently dropped. Identifiers and codes (number, unit, street number, reference ids, CIG and CUP) must be ASCII. XML special characters are escaped.

## Errors

`FatturaPAError` has `issues: { path, message }[]`. `path` names the input field, e.g. `seller.vatNumber`, `lines[2].nature` or `lines[0].adjustments[1].percent`. Its message lists all issues. Map the paths to your own form fields or messages; the English messages are meant for developers and logs.

## Helpers

| Export                                                                                              | Description                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeTotals(input)`                                                                              | Totals and VAT summary without validation or XML.                                                                                                                                       |
| `allocateCents(total, weights)`                                                                     | Splits an amount in proportion to weights with the largest-remainder method; the parts always add up to the total. Useful for sharing a delivery fee or discount across lines or rates. |
| `formatCents(cents)`                                                                                | `1234` → `"12.34"`.                                                                                                                                                                     |
| `isValidVatNumber`, `isValidFiscalCode`, `isValidIban`, `isValidRecipientCode`                      | The checks `buildInvoice` uses, for validating forms early. `isValidRecipientCode(code, "FPA12")` checks a 6-character office code.                                                     |
| `compactIdentifier(value)`                                                                          | Removes spaces and upper-cases, e.g. for a typed IBAN.                                                                                                                                  |
| `taxRegimes`, `natures`, `paymentMethods`, `withholdingTypes`, `paymentReasons`, `pensionFundTypes` | The accepted codes, as arrays.                                                                                                                                                          |

## Validating against the official schema

`npm run test:schema` downloads the FatturaPA 1.2.2 schema from fatturapa.gov.it and the W3C XML Signature schema it imports into `.xsd/`. It then validates generated invoices, credit notes, discounted, foreign-buyer, public administration and professional invoices (withholding, pension funds, split payment) with `xmllint`. To check your own files:

```sh
sh scripts/fetch-xsd.sh
xmllint --noout --schema .xsd/fatturapa.xsd invoice.xml
```

The schema checks structure. SDI also runs content checks: totals, VAT numbers, duplicate files. This library covers the content checks that depend only on the invoice itself; duplicate numbers and file names depend on your records.
