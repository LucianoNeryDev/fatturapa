import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateCents,
  buildInvoice,
  computeTotals,
  FatturaPAError,
  isValidFiscalCode,
  isValidIban,
  isValidVatNumber,
  type InvoiceInput,
} from "../src/index.js";

const base: InvoiceInput = {
  number: "1/MZ",
  date: "2026-10-20",
  seller: {
    vatNumber: "20000000008",
    name: "Macelleria Bresciana",
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
  issuer: { vatNumber: "50000000005", name: "Mercato Digitale Srl" },
  transmitter: { code: "50000000005", sequence: "00001" },
  lines: [
    {
      description: "Controfiletto di manzo",
      quantity: 3,
      unit: "conf.",
      unitPriceCents: 2490,
      vatRate: 10,
    },
    {
      description: "Grana Padano 18 mesi",
      quantity: "1.25",
      unit: "kg",
      unitPriceCents: 1690,
      vatRate: 4,
    },
  ],
  payment: {
    method: "MP05",
    dueDate: "2026-11-19",
    iban: "IT60X0542811101000000123456",
  },
};

const discounted: InvoiceInput = {
  ...base,
  lines: [
    {
      ...base.lines[0]!,
      adjustments: [{ percent: 10 }, { amountCents: 100 }],
    },
    { ...base.lines[1]!, adjustments: [{ kind: "surcharge", percent: 5 }] },
  ],
};

const foreign: InvoiceInput = {
  ...base,
  buyer: {
    vatNumber: "DE 123456789",
    name: "Gasthaus Zur Linde GmbH",
    address: {
      street: "Lindenstraße 5",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    },
  },
  lines: [
    {
      description: "Controfiletto di manzo",
      quantity: 3,
      unitPriceCents: 2490,
      vatRate: 0,
      nature: "N3.2",
      legalReference: "Art. 41, DL 331/1993",
    },
  ],
};

function issues(input: InvoiceInput): string[] {
  try {
    buildInvoice(input);
  } catch (error) {
    assert.ok(error instanceof FatturaPAError);
    return error.issues.map((issue) => issue.path);
  }
  return [];
}

test("identifiers use the Partita IVA, codice fiscale and IBAN checksums", () => {
  assert.equal(isValidVatNumber("20000000008"), true);
  assert.equal(isValidVatNumber("20000000009"), false);
  assert.equal(isValidFiscalCode("RSSMRA85T10A562S"), true);
  assert.equal(isValidFiscalCode("RSSMRA85T10A562T"), false);
  assert.equal(isValidFiscalCode("20000000008"), true);
  assert.equal(isValidIban("IT60X0542811101000000123456"), true);
  assert.equal(isValidIban("IT60X0542811101000000123457"), false);
  assert.equal(isValidIban("IT60X054281110100000012345"), false);
});

test("totals round each line and the VAT once per rate, as SDI recomputes them", () => {
  const totals = computeTotals({
    lines: [
      { description: "A", unitPriceCents: 25, vatRate: 10 },
      { description: "B", unitPriceCents: 25, vatRate: 10 },
      { description: "C", quantity: "1.25", unitPriceCents: 1690, vatRate: 4 },
    ],
  });
  assert.deepEqual(
    totals.lines.map((l) => l.lineTotalCents),
    [25, 25, 2113],
  );
  // Per-line rounding would give 6 cents of VAT on the 10% lines; SDI expects 5.
  assert.deepEqual(
    totals.summary.map((s) => [s.vatRate, s.taxableCents, s.vatCents]),
    [
      [10, 50, 5],
      [4, 2113, 85],
    ],
  );
  assert.equal(totals.totalCents, 50 + 5 + 2113 + 85);
});

test("the invoice renders FPR12 XML with a third-party issuer, payment and SDI file name", () => {
  const invoice = buildInvoice({
    ...base,
    buyer: { ...base.buyer, name: "Trattoria “Il Portico” & Figli" },
  });
  assert.equal(invoice.fileName, "IT50000000005_00001.xml");
  assert.equal(invoice.totalCents, 7470 + 747 + 2113 + 85);
  assert.match(
    invoice.xml,
    /<FormatoTrasmissione>FPR12<\/FormatoTrasmissione>/,
  );
  assert.match(
    invoice.xml,
    /<CodiceDestinatario>0000000<\/CodiceDestinatario>/,
  );
  assert.match(invoice.xml, /<SoggettoEmittente>TZ<\/SoggettoEmittente>/);
  assert.match(
    invoice.xml,
    /<Denominazione>Trattoria &quot;Il Portico&quot; &amp; Figli<\/Denominazione>/,
  );
  assert.match(invoice.xml, /<Quantita>1.25<\/Quantita>/);
  assert.match(invoice.xml, /<PrezzoTotale>21.13<\/PrezzoTotale>/);
  assert.match(invoice.xml, /<ImportoPagamento>104.15<\/ImportoPagamento>/);
  assert.match(invoice.xml, /<IBAN>IT60X0542811101000000123456<\/IBAN>/);
  assert.doesNotMatch(invoice.xml, /DatiBollo/);
});

test("validation reports every problem at once with input paths", () => {
  assert.deepEqual(
    issues({
      ...base,
      number: "MZ",
      seller: { ...base.seller, vatNumber: "123" },
      buyer: { ...base.buyer, recipientCode: "abc", pec: "x@pec.it" },
      lines: [
        { description: "Zero", unitPriceCents: 100, vatRate: 0 },
        { description: "Both", unitPriceCents: 100, vatRate: 10, nature: "N4" },
        { description: "Emoji 🥩", unitPriceCents: 100, vatRate: 22 },
        { description: "Rate", unitPriceCents: 100, vatRate: 10.005 },
      ],
      payment: { method: "MP05", iban: "IT00X0542811101000000123456" },
    }).sort(),
    [
      "buyer.pec",
      "buyer.recipientCode",
      "lines[0].nature",
      "lines[1].nature",
      "lines[2].description",
      "lines[3].vatRate",
      "number",
      "payment.iban",
      "seller.vatNumber",
    ],
  );
});

test("flat-rate sellers charge no VAT and pay stamp duty above €77.47", () => {
  const flatRate = (unitPriceCents: number): InvoiceInput => ({
    ...base,
    seller: { ...base.seller, taxRegime: "RF19" },
    lines: [
      {
        description: "Salame",
        unitPriceCents,
        vatRate: 0,
        nature: "N2.2",
        legalReference: "Art. 1, commi 54-89, L. 190/2014",
      },
    ],
  });
  assert.deepEqual(issues({ ...flatRate(1000), lines: base.lines }), [
    "lines[0].vatRate",
    "lines[1].vatRate",
  ]);
  assert.equal(buildInvoice(flatRate(7747)).stampDutyCents, 0);
  const invoice = buildInvoice(flatRate(7748));
  assert.equal(invoice.stampDutyCents, 200);
  assert.equal(invoice.vatCents, 0);
  assert.match(
    invoice.xml,
    /<DatiBollo>\s*<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2.00<\/ImportoBollo>/,
  );
  assert.match(
    invoice.xml,
    /<Natura>N2.2<\/Natura>\s*<ImponibileImporto>77.48<\/ImponibileImporto>\s*<Imposta>0.00<\/Imposta>\s*<RiferimentoNormativo>/,
  );
});

test("credit notes must reference the invoice they correct", () => {
  assert.deepEqual(issues({ ...base, type: "TD04" }), ["linkedInvoices"]);
  const note = buildInvoice({
    ...base,
    type: "TD04",
    number: "2/MZ",
    linkedInvoices: [{ number: "1/MZ", date: "2026-10-20" }],
  });
  assert.match(note.xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(
    note.xml,
    /<DatiFattureCollegate>\s*<IdDocumento>1\/MZ<\/IdDocumento>\s*<Data>2026-10-20<\/Data>/,
  );
});

test("discounts and surcharges apply to the unit price in cascade", () => {
  const invoice = buildInvoice(discounted);
  // 24.90 less 10% is 22.41, less 1.00 is 21.41, times 3; 16.90 plus 5% is 17.745, times 1.25.
  assert.deepEqual(
    invoice.lines.map((l) => l.lineTotalCents),
    [6423, 2218],
  );
  assert.deepEqual(
    invoice.summary.map((s) => [s.vatRate, s.taxableCents, s.vatCents]),
    [
      [10, 6423, 642],
      [4, 2218, 89],
    ],
  );
  assert.match(
    invoice.xml,
    /<PrezzoUnitario>24.90<\/PrezzoUnitario>\s*<ScontoMaggiorazione>\s*<Tipo>SC<\/Tipo>\s*<Percentuale>10.00<\/Percentuale>\s*<\/ScontoMaggiorazione>\s*<ScontoMaggiorazione>\s*<Tipo>SC<\/Tipo>\s*<Importo>1.00<\/Importo>\s*<\/ScontoMaggiorazione>\s*<PrezzoTotale>64.23<\/PrezzoTotale>/,
  );
  assert.match(
    invoice.xml,
    /<Tipo>MG<\/Tipo>\s*<Percentuale>5.00<\/Percentuale>/,
  );
  const line = base.lines[0]!;
  assert.deepEqual(
    issues({
      ...base,
      lines: [
        {
          ...line,
          adjustments: [
            { percent: 10, amountCents: 100 },
            {},
            { percent: 0 },
            { percent: 150 },
            { kind: "surcharge", percent: 150 },
            { amountCents: -5 },
            { amountCents: 1.5 },
          ],
        },
      ],
    }),
    [
      "lines[0].adjustments[0]",
      "lines[0].adjustments[1]",
      "lines[0].adjustments[2].percent",
      "lines[0].adjustments[3].percent",
      "lines[0].adjustments[5].amountCents",
      "lines[0].adjustments[6].amountCents",
    ],
  );
});

test("foreign buyers get their country's tax identifier, CAP 00000 and recipient code XXXXXXX", () => {
  const invoice = buildInvoice(foreign);
  assert.match(
    invoice.xml,
    /<CessionarioCommittente>\s*<DatiAnagrafici>\s*<IdFiscaleIVA>\s*<IdPaese>DE<\/IdPaese>\s*<IdCodice>123456789<\/IdCodice>/,
  );
  assert.match(
    invoice.xml,
    /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/,
  );
  assert.match(
    invoice.xml,
    /<CAP>00000<\/CAP>\s*<Comune>10115 Berlin<\/Comune>\s*<Nazione>DE<\/Nazione>/,
  );
  assert.equal(invoice.vatCents, 0);
  // Intra-EU supplies (N3.2) are not subject to stamp duty.
  assert.equal(invoice.stampDutyCents, 0);

  const greek = buildInvoice({
    ...foreign,
    buyer: {
      ...foreign.buyer,
      vatNumber: "EL094259216",
      address: { street: "Odos Ermou 1", city: "Athens", country: "GR" },
    },
  });
  assert.match(greek.xml, /<IdPaese>GR<\/IdPaese>\s*<IdCodice>094259216</);
  assert.match(greek.xml, /<CAP>00000<\/CAP>\s*<Comune>Athens<\/Comune>/);

  const buyer = foreign.buyer;
  assert.deepEqual(
    issues({
      ...foreign,
      buyer: {
        ...buyer,
        vatNumber: undefined,
        fiscalCode: "RSSMRA85T10A562S",
        recipientCode: "0000000",
        address: { ...buyer.address, province: "BE" },
      },
    }),
    [
      "buyer.vatNumber",
      "buyer.fiscalCode",
      "buyer.address.province",
      "buyer.recipientCode",
    ],
  );
  assert.deepEqual(
    issues({ ...base, buyer: { ...base.buyer, recipientCode: "XXXXXXX" } }),
    ["buyer.recipientCode"],
  );
  assert.deepEqual(
    issues({
      ...base,
      buyer: {
        ...base.buyer,
        address: { ...base.buyer.address, postalCode: undefined },
      },
    }),
    ["buyer.address.postalCode"],
  );
});

test("allocation splits cents proportionally and always adds up", () => {
  assert.deepEqual(allocateCents(490, [5000, 2500]), [327, 163]);
  assert.deepEqual(allocateCents(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateCents(490, [0, 0]), [490, 0]);
  for (const weights of [
    [7, 3, 1],
    [1999, 1],
    [13, 17, 19, 23],
  ])
    assert.equal(
      allocateCents(997, weights).reduce((n, p) => n + p, 0),
      997,
    );
});

// `npm run test:schema` downloads the official schema and sets FATTURAPA_XSD, so the generated
// files are validated with xmllint.
const xsd = process.env.FATTURAPA_XSD;
test(
  "generated invoices validate against the official FatturaPA schema",
  { skip: !xsd || !existsSync(xsd) ? "FATTURAPA_XSD is not set" : false },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "fatturapa-"));
    try {
      const files = {
        invoice: buildInvoice(base).xml,
        creditNote: buildInvoice({
          ...base,
          type: "TD04",
          linkedInvoices: [{ number: "1/MZ", date: "2026-10-20" }],
        }).xml,
        discounted: buildInvoice(discounted).xml,
        foreign: buildInvoice(foreign).xml,
      };
      for (const [name, xml] of Object.entries(files)) {
        const file = join(dir, `${name}.xml`);
        writeFileSync(file, xml);
        execFileSync("xmllint", ["--noout", "--schema", xsd!, file], {
          stdio: "pipe",
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
