# fatturapa

Build, validate and read Italian electronic invoices (FatturaPA FPR12 and FPA12) in TypeScript. You pass amounts in integer euro cents; the library computes the totals the way SDI recomputes them, checks the rules SDI rejects invoices for, and returns the XML file with its SDI file name. Zero runtime dependencies.

I wrote it for a B2B marketplace that issues invoices on its sellers' behalf. Most FatturaPA packages turn a JSON tree you've already filled into XML, so the totals, the VAT summary and the consistency checks are left to you. This one takes the business data and owns the arithmetic.

```ts
import { buildInvoice } from "@lucianonerydev/fatturapa";

const { xml, fileName, totalCents } = buildInvoice({
  number: "1/A",
  date: "2026-10-20",
  seller: {
    vatNumber: "20000000008",
    name: "Macelleria Bresciana Srl",
    taxRegime: "RF01",
    address: {
      street: "Via Milano 12",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  buyer: {
    vatNumber: "10000000009",
    name: "Trattoria Il Portico",
    address: {
      street: "Via Milano 10",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  transmitter: { code: "20000000008", sequence: "00001" },
  lines: [
    {
      description: "Controfiletto di manzo",
      quantity: 3,
      unit: "kg",
      unitPriceCents: 2490,
      vatRate: 10,
      adjustments: [{ percent: 10 }],
    },
  ],
  payment: {
    method: "MP05",
    dueDate: "2026-11-19",
    iban: "IT60X0542811101000000123456",
  },
});
// fileName: "IT20000000008_00001.xml", totalCents: 7395
```

## What it does

- **Totals.** Line totals, the VAT summary per rate and nature, and the document total. VAT is rounded once per rate on the summed taxable amount, as SDI checks it. You never pass a total that could disagree.
- **Validation.** Every problem is reported at once, with the path of the input field (`FatturaPAError.issues`):
  - Partita IVA, codice fiscale and IBAN checksums
  - recipient code and PEC
  - Natura required exactly when the rate is 0
  - flat-rate (`RF19`) lines
  - credit-note references
  - dates and lengths
  - characters outside Latin-1; typographic quotes and dashes become ASCII
- **Discounts and surcharges.** Percentages or per-unit amounts on each line, applied in cascade (`ScontoMaggiorazione`), and discounts or surcharges on the whole invoice, spread over the VAT rates as `SC`/`AC` lines so the VAT summary stays consistent.
- **Withholding tax and pension funds.** Ritenute (RT01–RT06) and casse previdenziali (TC01–TC22), with the net amount payable after withholdings and split payment.
- **Payment.** Bank details, payment terms and instalments that add up exactly to the amount payable.
- **Public administration.** FPA12 invoices with the IPA office code, CIG, CUP, contract and agreement references.
- **Foreign parties.** Foreign buyers (tax identifier, recipient code `XXXXXXX`, CAP `00000`), non-resident sellers with an Italian VAT number, fiscal representatives and permanent establishments.
- **Document types.** Invoices (TD01), credit notes (TD04), debit notes (TD05) and deferred invoices (TD24).
- **Third-party issuing.** A platform can issue in the seller's name (`SoggettoEmittente` TZ).
- **Other content.** Automatic virtual stamp duty and purchase-order references.
- **Reading.** `parseInvoice` reads received XML and `.p7m` files into the same input shape, with the declared amounts, the attachments and a list of the elements it can't represent.
- **Helpers.** `allocateCents` splits an amount proportionally with parts that add up exactly; the identifier validators are exported too.

Generated files validate against the official FatturaPA 1.2.2 schema; `npm run test:schema` checks it.

It does **not** sign or transmit invoices. Send the XML through an SDI intermediary or your own SDI channel. It is not tax advice either: the VAT rates, natures and legal references on your lines are yours to choose with your accountant.

Not supported yet: buyers and sellers who are natural persons (`Nome` and `Cognome`), document types other than TD01, TD04, TD05 and TD24, and transport or delivery-note data. See the [roadmap](ROADMAP.md).

The PDF courtesy copy is a separate package, [`@lucianonerydev/fatturapa-pdf`](packages/pdf/README.md).

## Install

```sh
npm install @lucianonerydev/fatturapa
```

It needs Node.js 20 or later and ships ES modules with type declarations.

## Documentation

- [Guide](docs/guide.md): every input field, the computation and validation rules, withholdings and pension funds, public administration, foreign parties, discounts, stamp duty, credit notes, reading invoices, errors and helpers.
- [Changelog](CHANGELOG.md)

## Development

```sh
npm install
npm test             # unit tests
npm run test:schema  # also validates generated files against the official XSD (needs curl and xmllint)
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project rules and the checks to run before a pull request.

## License

[MIT](LICENSE) © Luciano Nery
