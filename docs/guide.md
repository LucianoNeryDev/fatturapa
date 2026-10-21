# Guide

`buildInvoice(input)` validates an invoice, computes its totals and renders a FatturaPA FPR12 (private-sector) XML file. It returns the XML, the SDI file name and the computed totals, or throws a `FatturaPAError` listing every problem it found.

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

| Field            | Required   | Description                                                                                       |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `type`           |            | `TD01` invoice (default), `TD04` credit note, `TD05` debit note, `TD24` deferred invoice.         |
| `number`         | yes        | Invoice number, up to 20 ASCII characters with at least one digit, e.g. `12/A`.                   |
| `date`           | yes        | Issue date, `YYYY-MM-DD`.                                                                         |
| `seller`         | yes        | The supplier (`CedentePrestatore`), see [Seller](#seller).                                        |
| `buyer`          | yes        | The customer (`CessionarioCommittente`), see [Buyer](#buyer).                                     |
| `issuer`         |            | A third party issuing on the seller's behalf, see [Third-party issuer](#third-party-issuer).      |
| `transmitter`    | yes        | Who sends the file to SDI, see [Transmitter and file name](#transmitter-and-file-name).           |
| `lines`          | yes        | 1 to 9999 lines, see [Line](#line).                                                               |
| `vatExigibility` |            | `I` immediate (default), `D` deferred, `S` split payment.                                         |
| `description`    |            | Free text (`Causale`), split into 200-character elements at word boundaries.                      |
| `orderReference` |            | `{ id, date? }`: the buyer's purchase order (`DatiOrdineAcquisto`), id up to 20 ASCII characters. |
| `linkedInvoices` | TD04, TD05 | `[{ number, date }]`: the invoices a credit or debit note corrects (`DatiFattureCollegate`).      |
| `payment`        |            | See [Payment](#payment).                                                                          |
| `stampDuty`      |            | `"auto"` (default), `true` or `false`. See [Stamp duty](#stamp-duty).                             |

### Seller

| Field        | Required | Description                                                                             |
| ------------ | -------- | --------------------------------------------------------------------------------------- |
| `vatNumber`  | yes      | Italian Partita IVA, 11 digits with a valid check digit.                                |
| `fiscalCode` |          | Codice fiscale, when it differs from the Partita IVA.                                   |
| `name`       | yes      | Company name, up to 80 characters.                                                      |
| `taxRegime`  | yes      | `RegimeFiscale`: `RF01` ordinary, `RF19` flat-rate (forfettario), or another `RF` code. |
| `address`    | yes      | Registered office, see [Address](#address).                                             |

### Buyer

| Field           | Required  | Description                                                                                                                       |
| --------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `vatNumber`     | see below | Italian Partita IVA, or a foreign tax identifier for a [foreign buyer](#foreign-buyers).                                          |
| `vatCountry`    |           | Country that issued `vatNumber`; defaults to the address country.                                                                 |
| `fiscalCode`    | see below | Italian codice fiscale, 11 digits or 16 characters with omocodia.                                                                 |
| `name`          | yes       | Up to 80 characters.                                                                                                              |
| `address`       | yes       | See [Address](#address). Its country decides whether the buyer is foreign.                                                        |
| `recipientCode` |           | SDI recipient code (codice destinatario), 7 upper-case letters or digits. Defaults to `0000000`, or `XXXXXXX` for foreign buyers. |
| `pec`           |           | Certified email, only with recipient code `0000000`.                                                                              |

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

### Payment

| Field         | Required | Description                                                                                                      |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `method`      | yes      | `ModalitaPagamento`, e.g. `MP05` bank transfer, `MP08` card, `MP01` cash.                                        |
| `dueDate`     |          | `YYYY-MM-DD`.                                                                                                    |
| `iban`        |          | Checked with its mod-97 checksum; Italian IBANs must have 27 characters. Use `compactIdentifier` on typed input. |
| `bank`        |          | Bank name, up to 80 characters.                                                                                  |
| `beneficiary` |          | Up to 200 characters, when the payee is not the seller.                                                          |

The invoice asks for full payment (`TP02`) of the document total.

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
- `summary`: one entry per rate and nature, highest rate first, each with `taxableCents`, `vatCents` and `legalReference`
- `taxableCents`, `vatCents`, and `totalCents` (`ImportoTotaleDocumento`)
- `stampDutyCents`

`computeTotals({ lines, stampDuty })` returns the same totals without validating or rendering. Use it to show totals before issuing. An invoice (`TD01`) cannot have a negative total; issue a credit note instead.

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

For a discount on the whole invoice, add a negative line at each VAT rate concerned, e.g. "Sconto 5%" at -€3.36 with rate 10. Document-level `ScontoMaggiorazione` is informative only in FatturaPA and is not supported.

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

## Credit and debit notes

Credit notes (`TD04`) and debit notes (`TD05`) must reference the invoices they correct in `linkedInvoices`. Their lines carry positive amounts: a credit note for €100 has positive lines, and its type tells SDI it reduces the original. Omit `payment` on a credit note unless you are refunding by a stated method.

## Text

Free text is normalised (NFC). Typographic quotes, apostrophes, dashes and ellipses are replaced with ASCII, `€` becomes `EUR`, and runs of whitespace become one space. Characters outside Latin-1, such as emoji, are reported as errors rather than silently dropped. Identifiers and codes (number, unit, street number, order id) must be ASCII. XML special characters are escaped.

## Errors

`FatturaPAError` has `issues: { path, message }[]`. `path` names the input field, e.g. `seller.vatNumber`, `lines[2].nature` or `lines[0].adjustments[1].percent`. Its message lists all issues. Map the paths to your own form fields or messages; the English messages are meant for developers and logs.

## Helpers

| Export                                                                         | Description                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeTotals(input)`                                                         | Totals and VAT summary without validation or XML.                                                                                                                                       |
| `allocateCents(total, weights)`                                                | Splits an amount in proportion to weights with the largest-remainder method; the parts always add up to the total. Useful for sharing a delivery fee or discount across lines or rates. |
| `formatCents(cents)`                                                           | `1234` → `"12.34"`.                                                                                                                                                                     |
| `isValidVatNumber`, `isValidFiscalCode`, `isValidIban`, `isValidRecipientCode` | The checks `buildInvoice` uses, for validating forms early.                                                                                                                             |
| `compactIdentifier(value)`                                                     | Removes spaces and upper-cases, e.g. for a typed IBAN.                                                                                                                                  |
| `taxRegimes`, `natures`, `paymentMethods`                                      | The accepted codes, as arrays.                                                                                                                                                          |

## Validating against the official schema

`npm run test:schema` downloads the FatturaPA 1.2.2 schema from fatturapa.gov.it and the W3C XML Signature schema it imports into `.xsd/`. It then validates generated invoices, credit notes, discounted and foreign-buyer invoices with `xmllint`. To check your own files:

```sh
sh scripts/fetch-xsd.sh
xmllint --noout --schema .xsd/fatturapa.xsd invoice.xml
```

The schema checks structure. SDI also runs content checks: totals, VAT numbers, duplicate files. This library covers the content checks that depend only on the invoice itself; duplicate numbers and file names depend on your records.
