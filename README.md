# fatturapa

Build and validate Italian electronic invoices (FatturaPA FPR12, private sector) in TypeScript. You pass amounts in integer euro cents; the library computes the totals the way SDI recomputes them, checks the rules SDI rejects invoices for, and returns the XML file with its SDI file name. Zero runtime dependencies.

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
- **Discounts and surcharges.** Percentages or per-unit amounts on each line, applied in cascade (`ScontoMaggiorazione`). The line total is computed exactly and rounded once.
- **Foreign buyers.** Foreign tax identifier, recipient code `XXXXXXX` and CAP `00000`, with the foreign postal code kept next to the city.
- **Document types.** Invoices (TD01), credit notes (TD04), debit notes (TD05) and deferred invoices (TD24).
- **Third-party issuing.** A platform can issue in the seller's name (`SoggettoEmittente` TZ).
- **Other content.** Automatic virtual stamp duty, purchase-order references and bank-transfer payment details.
- **Helpers.** `allocateCents` splits an amount proportionally with parts that add up exactly; the identifier validators are exported too.

Generated files validate against the official FatturaPA 1.2.2 schema; `npm run test:schema` checks it.

It does **not** sign or transmit invoices. Send the XML through an SDI intermediary or your own SDI channel. It is not tax advice either: the VAT rates, natures and legal references on your lines are yours to choose with your accountant.

Not supported yet: document-level discounts, public-administration invoices (FPA12), withholding tax (ritenuta), pension funds (cassa previdenziale), instalments, fiscal representatives, and parsing received invoices. See the [roadmap](ROADMAP.md).

## Install

```sh
npm install @lucianonerydev/fatturapa
```

It needs Node.js 20 or later and ships ES modules with type declarations.

## Documentation

- [Guide](docs/guide.md): every input field, the computation and validation rules, foreign buyers, discounts, stamp duty, credit notes, errors and helpers.
- [Changelog](CHANGELOG.md)

## Development

```sh
npm install
npm test             # unit tests
npm run test:schema  # also validates generated files against the official XSD (needs curl and xmllint)
npm run build
```

## License

[MIT](LICENSE) © Luciano Nery
