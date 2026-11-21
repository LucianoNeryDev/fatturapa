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
  isValidRecipientCode,
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

const withDocumentDiscount: InvoiceInput = {
  ...base,
  adjustments: [{ percent: 10 }],
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

const publicAdministration: InvoiceInput = {
  ...base,
  format: "FPA12",
  number: "3/PA",
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
  orderReference: { id: "ORD-2026-118", date: "2026-10-01" },
  contractReference: [
    {
      id: "REP. 45/2026",
      date: "2026-09-15",
      lineNumbers: [1, 2],
      itemCode: "Fornitura mensa scolastica",
      cup: "J41B26000120004",
      cig: "Z1A2B3C4D5",
    },
  ],
};

// An engineer's fee: Inarcassa's 4% integrative contribution is not subject to withholding.
const professional: InvoiceInput = {
  ...base,
  number: "4/ING",
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
};

// A gestione separata professional: the 4% INPS rivalsa is subject to withholding.
const professionalInps: InvoiceInput = {
  ...professional,
  pensionFunds: [
    {
      type: "TC22",
      rate: 4,
      vatRate: 22,
      withholding: true,
      reference: "PRAT-2026/18",
    },
  ],
  stampDuty: true,
};

// A professional invoicing a public administration with split payment.
const professionalToPublicAdministration: InvoiceInput = {
  ...professional,
  format: "FPA12",
  buyer: publicAdministration.buyer,
  vatExigibility: "S",
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
  // Public bodies often have only an 11-digit numeric codice fiscale.
  assert.equal(isValidFiscalCode("80012000826"), true);
  assert.equal(isValidFiscalCode("80012000827"), false);
  assert.equal(isValidRecipientCode("ABC1234"), true);
  assert.equal(isValidRecipientCode("UF7Q2K"), false);
  assert.equal(isValidRecipientCode("UF7Q2K", "FPA12"), true);
  assert.equal(isValidRecipientCode("ABC1234", "FPA12"), false);
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

test("a document discount is spread over the VAT rates as SC lines", () => {
  const invoice = buildInvoice(withDocumentDiscount);
  // Lines total 9583 (7470 at 10%, 2113 at 4%): 10% is 958, split 747 and 211.
  assert.deepEqual(invoice.adjustmentLines, [
    { adjustmentIndex: 0, vatRate: 10, amountCents: -747 },
    { adjustmentIndex: 0, vatRate: 4, amountCents: -211 },
  ]);
  assert.equal(
    invoice.adjustmentLines.reduce((n, l) => n + l.amountCents, 0),
    -958,
  );
  assert.deepEqual(
    invoice.summary.map((s) => [s.vatRate, s.taxableCents, s.vatCents]),
    [
      [10, 6723, 672],
      [4, 1902, 76],
    ],
  );
  assert.equal(invoice.taxableCents, 9583 - 958);
  assert.equal(invoice.totalCents, 8625 + 672 + 76);
  assert.equal(invoice.xml.match(/<TipoCessionePrestazione>SC</g)?.length, 2);
  assert.match(
    invoice.xml,
    /<NumeroLinea>3<\/NumeroLinea>\s*<TipoCessionePrestazione>SC<\/TipoCessionePrestazione>\s*<Descrizione>Sconto 10% \(IVA 10%\)<\/Descrizione>\s*<PrezzoUnitario>-7\.47<\/PrezzoUnitario>\s*<PrezzoTotale>-7\.47<\/PrezzoTotale>\s*<AliquotaIVA>10\.00<\/AliquotaIVA>/,
  );
  assert.match(invoice.xml, /Sconto 10% \(IVA 4%\)/);
  assert.doesNotMatch(invoice.xml, /ScontoMaggiorazione/);
});

test("document adjustments apply in cascade", () => {
  const totals = computeTotals({
    ...base,
    adjustments: [{ percent: 10 }, { amountCents: 500 }],
  });
  // 9583 - 958 = 8625, then 500 more.
  assert.equal(totals.taxableCents, 8625 - 500);
  assert.equal(
    totals.adjustmentLines.reduce((n, l) => n + l.amountCents, 0),
    -958 - 500,
  );
  const percentAfter = computeTotals({
    ...base,
    adjustments: [{ amountCents: 583 }, { percent: 10 }],
  });
  assert.equal(percentAfter.taxableCents, 9000 - 900);
});

test("a document surcharge renders an AC line with a positive price", () => {
  const invoice = buildInvoice({
    ...base,
    lines: [base.lines[0]!],
    adjustments: [
      { kind: "surcharge", percent: 2.5, description: "Spese di trasporto" },
    ],
  });
  // 7470 * 2.5% = 186.75, rounded to 187.
  assert.deepEqual(invoice.adjustmentLines, [
    { adjustmentIndex: 0, vatRate: 10, amountCents: 187 },
  ]);
  assert.match(
    invoice.xml,
    /<TipoCessionePrestazione>AC<\/TipoCessionePrestazione>\s*<Descrizione>Spese di trasporto 2\.5%<\/Descrizione>\s*<PrezzoUnitario>1\.87<\/PrezzoUnitario>/,
  );
  assert.equal(invoice.taxableCents, 7657);
});

test("document adjustments report every invalid field", () => {
  const withAdjustments = (adjustments: InvoiceInput["adjustments"]) =>
    issues({ ...base, adjustments });
  assert.deepEqual(
    withAdjustments([
      { percent: 0 },
      { percent: 100.5 },
      { percent: 12.345 },
      { kind: "surcharge", percent: 1000 },
      { percent: 10, amountCents: 100 },
      {},
      { amountCents: -5 },
      { amountCents: 1.5 },
      { description: "x".repeat(1001), amountCents: 100 },
      { kind: "refund" as "discount", amountCents: 100 },
    ]),
    [
      "adjustments[0].percent",
      "adjustments[1].percent",
      "adjustments[2].percent",
      "adjustments[3].percent",
      "adjustments[4]",
      "adjustments[5]",
      "adjustments[6].amountCents",
      "adjustments[7].amountCents",
      "adjustments[8].description",
      "adjustments[9].kind",
    ],
  );
  assert.deepEqual(
    issues({
      ...base,
      lines: [{ ...base.lines[0]!, unitPriceCents: 0 }],
      adjustments: [{ percent: 10 }],
    }),
    ["adjustments[0]"],
  );
});

test("a zero-rate group takes its share of a document adjustment with its nature", () => {
  const invoice = buildInvoice({
    ...base,
    lines: [
      base.lines[0]!,
      {
        description: "Esportazione",
        unitPriceCents: 10000,
        vatRate: 0,
        nature: "N3.1",
      },
    ],
    adjustments: [{ amountCents: 1000 }],
  });
  assert.deepEqual(
    invoice.adjustmentLines.map((l) => [l.vatRate, l.nature, l.amountCents]),
    [
      [10, undefined, -428],
      [0, "N3.1", -572],
    ],
  );
  assert.match(invoice.xml, /Sconto \(N3\.1\)<\/Descrizione>/);
  assert.match(
    invoice.xml,
    /<PrezzoTotale>-5\.72<\/PrezzoTotale>\s*<AliquotaIVA>0\.00<\/AliquotaIVA>\s*<Natura>N3\.1<\/Natura>/,
  );
  assert.equal(
    invoice.summary.find((s) => s.nature === "N3.1")?.taxableCents,
    10000 - 572,
  );
});

test("public administration invoices render FPA12 with the office code and references", () => {
  const invoice = buildInvoice(publicAdministration);
  assert.match(invoice.xml, /<p:FatturaElettronica versione="FPA12" /);
  assert.match(
    invoice.xml,
    /<FormatoTrasmissione>FPA12<\/FormatoTrasmissione>\s*<CodiceDestinatario>UF7Q2K<\/CodiceDestinatario>\s*<\/DatiTrasmissione>/,
  );
  assert.match(
    invoice.xml,
    /<CessionarioCommittente>\s*<DatiAnagrafici>\s*<CodiceFiscale>80012000826<\/CodiceFiscale>/,
  );
  assert.match(invoice.xml, /<EsigibilitaIVA>S<\/EsigibilitaIVA>/);
  assert.match(
    invoice.xml,
    /<\/DatiGeneraliDocumento>\s*<DatiOrdineAcquisto>\s*<IdDocumento>ORD-2026-118<\/IdDocumento>\s*<Data>2026-10-01<\/Data>\s*<\/DatiOrdineAcquisto>\s*<DatiContratto>\s*<RiferimentoNumeroLinea>1<\/RiferimentoNumeroLinea>\s*<RiferimentoNumeroLinea>2<\/RiferimentoNumeroLinea>\s*<IdDocumento>REP. 45\/2026<\/IdDocumento>\s*<Data>2026-09-15<\/Data>\s*<CodiceCommessaConvenzione>Fornitura mensa scolastica<\/CodiceCommessaConvenzione>\s*<CodiceCUP>J41B26000120004<\/CodiceCUP>\s*<CodiceCIG>Z1A2B3C4D5<\/CodiceCIG>\s*<\/DatiContratto>\s*<\/DatiGenerali>/,
  );

  const all = buildInvoice({
    ...publicAdministration,
    type: "TD04",
    linkedInvoices: [{ number: "1/PA", date: "2026-10-02" }],
    orderReference: [{ id: "O1" }, { id: "O2" }],
    contractReference: { id: "C1" },
    agreementReference: { id: "A1", cig: "1234567890" },
    receiptReference: { id: "R1" },
  });
  assert.deepEqual(
    [
      ...all.xml.matchAll(
        /<(Dati(?:OrdineAcquisto|Contratto|Convenzione|Ricezione|FattureCollegate))>\s*<IdDocumento>([^<]+)/g,
      ),
    ].map((m) => `${m[1]} ${m[2]}`),
    [
      "DatiOrdineAcquisto O1",
      "DatiOrdineAcquisto O2",
      "DatiContratto C1",
      "DatiConvenzione A1",
      "DatiRicezione R1",
      "DatiFattureCollegate 1/PA",
    ],
  );
});

test("FPA12 needs an Italian buyer with a 6-character office code and no PEC", () => {
  const buyer = publicAdministration.buyer;
  assert.deepEqual(
    issues({
      ...publicAdministration,
      buyer: { ...buyer, recipientCode: "ABC1234" },
    }),
    ["buyer.recipientCode"],
  );
  assert.deepEqual(
    issues({
      ...publicAdministration,
      buyer: { ...buyer, recipientCode: undefined },
    }),
    ["buyer.recipientCode"],
  );
  assert.deepEqual(
    issues({
      ...publicAdministration,
      buyer: { ...buyer, pec: "ufficio@pec.it" },
    }),
    ["buyer.pec"],
  );
  assert.deepEqual(
    issues({
      ...publicAdministration,
      buyer: {
        vatNumber: "DE123456789",
        name: "Stadt Berlin",
        recipientCode: "UF7Q2K",
        address: { street: "Rathausstraße 15", city: "Berlin", country: "DE" },
      },
    }),
    ["buyer.address.country"],
  );
  // A 6-character office code on a private-sector invoice.
  assert.deepEqual(
    issues({ ...base, buyer: { ...base.buyer, recipientCode: "UF7Q2K" } }),
    ["buyer.recipientCode"],
  );
  assert.deepEqual(issues({ ...base, format: "FPA13" as "FPA12" }), ["format"]);
});

test("document references validate CIG, CUP, dates and line numbers with input paths", () => {
  assert.deepEqual(
    issues({
      ...base,
      orderReference: { id: "", date: "2026-02-30" },
      contractReference: [
        { id: "C1", cig: "Z1A2B3C4D5" },
        {
          id: "C2",
          lineNumbers: [0, 2, 3, 1.5],
          cig: "Z1A2B3C4D5E6F7G8",
          cup: "J41B26000120004X",
          itemCode: "x".repeat(101),
        },
      ],
      receiptReference: { id: "R1", cig: "CIG “È”" },
    }),
    [
      "orderReference.id",
      "orderReference.date",
      "contractReference[1].lineNumbers[0]",
      "contractReference[1].lineNumbers[2]",
      "contractReference[1].lineNumbers[3]",
      "contractReference[1].itemCode",
      "contractReference[1].cup",
      "contractReference[1].cig",
      "receiptReference.cig",
    ],
  );
});

test("a single purchase-order reference still renders as before", () => {
  const invoice = buildInvoice({
    ...base,
    orderReference: { id: "PO-77", date: "2026-10-01" },
  });
  assert.match(invoice.xml, /<p:FatturaElettronica versione="FPR12" /);
  assert.match(
    invoice.xml,
    /<\/DatiGeneraliDocumento>\s*<DatiOrdineAcquisto>\s*<IdDocumento>PO-77<\/IdDocumento>\s*<Data>2026-10-01<\/Data>\s*<\/DatiOrdineAcquisto>\s*<\/DatiGenerali>/,
  );
});

test("a professional's invoice adds the pension fund and withholds on the fee", () => {
  const invoice = buildInvoice(professional);
  assert.deepEqual(invoice.pensionFunds, [
    {
      type: "TC04",
      taxableCents: 100000,
      contributionCents: 4000,
      vatRate: 22,
    },
  ]);
  assert.deepEqual(
    invoice.summary.map((s) => [s.vatRate, s.taxableCents, s.vatCents]),
    [[22, 104000, 22880]],
  );
  assert.equal(invoice.taxableCents, 104000);
  assert.equal(invoice.vatCents, 22880);
  assert.equal(invoice.totalCents, 126880);
  assert.deepEqual(invoice.withholdings, [
    {
      type: "RT01",
      rate: 20,
      reason: "A",
      taxableCents: 100000,
      amountCents: 20000,
    },
  ]);
  assert.equal(invoice.withholdingCents, 20000);
  assert.equal(invoice.payableCents, 126880 - 20000);
  assert.match(
    invoice.xml,
    /<AliquotaIVA>22\.00<\/AliquotaIVA>\s*<Ritenuta>SI<\/Ritenuta>\s*<\/DettaglioLinee>/,
  );
  assert.match(
    invoice.xml,
    /<ImponibileImporto>1040\.00<\/ImponibileImporto>\s*<Imposta>228\.80<\/Imposta>/,
  );
  assert.match(invoice.xml, /<ImportoPagamento>1068\.80<\/ImportoPagamento>/);

  // The INPS rivalsa is subject to withholding: the base is 1040.00.
  const inps = buildInvoice(professionalInps);
  assert.equal(inps.totalCents, 126880);
  assert.equal(inps.withholdings[0]!.taxableCents, 104000);
  assert.equal(inps.withholdingCents, 20800);
  assert.equal(inps.payableCents, 126880 - 20800);
  assert.match(inps.xml, /<ImportoPagamento>1060\.80<\/ImportoPagamento>/);
  assert.match(
    inps.xml,
    /<DatiGeneraliDocumento>\s*<TipoDocumento>TD01<\/TipoDocumento>\s*<Divisa>EUR<\/Divisa>\s*<Data>2026-10-20<\/Data>\s*<Numero>4\/ING<\/Numero>\s*<DatiRitenuta>\s*<TipoRitenuta>RT01<\/TipoRitenuta>\s*<ImportoRitenuta>208\.00<\/ImportoRitenuta>\s*<AliquotaRitenuta>20\.00<\/AliquotaRitenuta>\s*<CausalePagamento>A<\/CausalePagamento>\s*<\/DatiRitenuta>\s*<DatiBollo>\s*<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2\.00<\/ImportoBollo>\s*<\/DatiBollo>\s*<DatiCassaPrevidenziale>\s*<TipoCassa>TC22<\/TipoCassa>\s*<AlCassa>4\.00<\/AlCassa>\s*<ImportoContributoCassa>40\.00<\/ImportoContributoCassa>\s*<ImponibileCassa>1000\.00<\/ImponibileCassa>\s*<AliquotaIVA>22\.00<\/AliquotaIVA>\s*<Ritenuta>SI<\/Ritenuta>\s*<RiferimentoAmministrazione>PRAT-2026\/18<\/RiferimentoAmministrazione>\s*<\/DatiCassaPrevidenziale>\s*<ImportoTotaleDocumento>1268\.80<\/ImportoTotaleDocumento>\s*<\/DatiGeneraliDocumento>/,
  );

  // ImponibileCassa can be overridden.
  const overridden = computeTotals({
    ...professional,
    pensionFunds: [{ type: "TC04", rate: 4, vatRate: 22, taxableCents: 50000 }],
  });
  assert.equal(overridden.pensionFunds[0]!.contributionCents, 2000);
  assert.equal(overridden.taxableCents, 102000);
});

test("a flat-rate seller's pension fund takes rate 0 with nature N2.2", () => {
  const flatRate: InvoiceInput = {
    ...base,
    seller: { ...base.seller, taxRegime: "RF19" },
    lines: [
      {
        description: "Consulenza",
        unitPriceCents: 100000,
        vatRate: 0,
        nature: "N2.2",
      },
    ],
    pensionFunds: [{ type: "TC22", rate: 4, vatRate: 0, nature: "N2.2" }],
  };
  const invoice = buildInvoice(flatRate);
  assert.equal(invoice.taxableCents, 104000);
  assert.equal(invoice.payableCents, 104000);
  assert.equal(invoice.stampDutyCents, 200);
  assert.match(
    invoice.xml,
    /<AliquotaIVA>0\.00<\/AliquotaIVA>\s*<Natura>N2\.2<\/Natura>\s*<\/DatiCassaPrevidenziale>/,
  );
  assert.deepEqual(
    issues({
      ...flatRate,
      pensionFunds: [{ type: "TC22", rate: 4, vatRate: 22 }],
    }),
    ["pensionFunds[0].vatRate"],
  );
});

test("a sales agent is withheld on half of the commission", () => {
  const invoice = buildInvoice({
    ...base,
    lines: [
      {
        description: "Provvigioni ottobre 2026",
        unitPriceCents: 100000,
        vatRate: 22,
        withholding: true,
      },
    ],
    withholdings: [{ type: "RT01", rate: 23, reason: "R", basePercent: 50 }],
  });
  assert.deepEqual(invoice.withholdings, [
    {
      type: "RT01",
      rate: 23,
      reason: "R",
      taxableCents: 50000,
      amountCents: 11500,
    },
  ]);
  assert.equal(invoice.totalCents, 122000);
  assert.equal(invoice.payableCents, 122000 - 11500);
  assert.match(
    invoice.xml,
    /<ImportoRitenuta>115\.00<\/ImportoRitenuta>\s*<AliquotaRitenuta>23\.00<\/AliquotaRitenuta>\s*<CausalePagamento>R<\/CausalePagamento>/,
  );
});

test("withholdings of different types add up; a type cannot repeat", () => {
  const invoice = buildInvoice({
    ...professional,
    pensionFunds: undefined,
    withholdings: [
      { type: "RT01", rate: 20, reason: "A" },
      { type: "RT03", rate: 9.09, reason: "A" },
    ],
  });
  assert.deepEqual(
    invoice.withholdings.map((w) => [w.type, w.amountCents]),
    [
      ["RT01", 20000],
      ["RT03", 9090],
    ],
  );
  assert.equal(invoice.withholdingCents, 29090);
  assert.equal(invoice.payableCents, 122000 - 29090);
  assert.deepEqual(
    [...invoice.xml.matchAll(/<TipoRitenuta>(RT\d\d)<\/TipoRitenuta>/g)].map(
      (m) => m[1],
    ),
    ["RT01", "RT03"],
  );
  assert.deepEqual(
    issues({
      ...professional,
      withholdings: [
        { type: "RT01", rate: 20, reason: "A" },
        { type: "RT03", rate: 4, reason: "A" },
        { type: "RT01", rate: 4, reason: "A" },
      ],
    }),
    ["withholdings[2].type"],
  );
});

test("split payment leaves the VAT out of the amount payable", () => {
  const invoice = buildInvoice({ ...base, vatExigibility: "S" });
  assert.equal(invoice.totalCents, 10415);
  assert.equal(invoice.payableCents, 9583);
  assert.match(
    invoice.xml,
    /<ImportoTotaleDocumento>104\.15<\/ImportoTotaleDocumento>/,
  );
  assert.match(invoice.xml, /<ImportoPagamento>95\.83<\/ImportoPagamento>/);

  // A professional invoicing a public administration: the taxable amount less the withholding.
  const pa = buildInvoice(professionalToPublicAdministration);
  assert.equal(pa.payableCents, 104000 - 20000);
  assert.match(pa.xml, /<ImportoPagamento>840\.00<\/ImportoPagamento>/);
});

test("withholdings and pension funds report SDI inconsistencies and invalid fields", () => {
  assert.deepEqual(
    issues({
      ...base,
      withholdings: [{ type: "RT01", rate: 20, reason: "A" }],
    }),
    ["withholdings"],
  );
  assert.deepEqual(
    issues({
      ...base,
      lines: [{ ...base.lines[0]!, withholding: true }, base.lines[1]!],
    }),
    ["lines[0].withholding"],
  );
  assert.deepEqual(
    issues({
      ...base,
      pensionFunds: [{ type: "TC22", rate: 4, vatRate: 10, withholding: true }],
    }),
    ["pensionFunds[0].withholding"],
  );
  // A pension fund subject to withholding is enough on its own.
  assert.deepEqual(
    issues({
      ...base,
      pensionFunds: [{ type: "TC22", rate: 4, vatRate: 10, withholding: true }],
      withholdings: [{ type: "RT01", rate: 20, reason: "A" }],
    }),
    [],
  );
  // Withholdings larger than the total.
  const excessive: InvoiceInput = {
    ...professional,
    pensionFunds: undefined,
    withholdings: [
      { type: "RT01", rate: 100, reason: "A" },
      { type: "RT03", rate: 50, reason: "A" },
    ],
  };
  assert.deepEqual(issues(excessive), ["withholdings"]);
  assert.deepEqual(
    issues({
      ...excessive,
      type: "TD05",
      linkedInvoices: [{ number: "1/MZ", date: "2026-10-20" }],
    }),
    [],
  );
  assert.deepEqual(
    issues({
      ...professional,
      withholdings: [
        {
          type: "RT07" as "RT01",
          rate: 0,
          reason: "F" as "A",
          basePercent: 150,
        },
        { type: "RT02", rate: 20.005, reason: "A", basePercent: 0 },
      ],
      pensionFunds: [
        { type: "TC23" as "TC01", rate: 101, vatRate: 0 },
        {
          type: "TC01",
          rate: 4,
          vatRate: 22,
          nature: "N4",
          taxableCents: -1,
          reference: "x".repeat(21),
        },
        {
          type: "TC01",
          rate: 4,
          vatRate: 22,
          taxableCents: 1.5,
          reference: "Pratica “È”",
        },
      ],
    }).sort(),
    [
      "pensionFunds[0].nature",
      "pensionFunds[0].rate",
      "pensionFunds[0].type",
      "pensionFunds[1].nature",
      "pensionFunds[1].reference",
      "pensionFunds[1].taxableCents",
      "pensionFunds[2].reference",
      "pensionFunds[2].taxableCents",
      "withholdings[0].basePercent",
      "withholdings[0].rate",
      "withholdings[0].reason",
      "withholdings[0].type",
      "withholdings[1].basePercent",
      "withholdings[1].rate",
    ],
  );
});

test("a document adjustment line is subject to withholding only when its whole VAT group is", () => {
  const invoice = buildInvoice({
    ...base,
    lines: [
      {
        description: "Onorario",
        unitPriceCents: 100000,
        vatRate: 22,
        withholding: true,
      },
      { description: "Materiale", unitPriceCents: 10000, vatRate: 22 },
      {
        description: "Corso",
        unitPriceCents: 50000,
        vatRate: 10,
        withholding: true,
      },
    ],
    adjustments: [{ percent: 10 }],
    withholdings: [{ type: "RT01", rate: 20, reason: "A" }],
  });
  assert.deepEqual(invoice.adjustmentLines, [
    { adjustmentIndex: 0, vatRate: 22, amountCents: -11000 },
    { adjustmentIndex: 0, vatRate: 10, amountCents: -5000, withholding: true },
  ]);
  // 1000.00 + 500.00 - 50.00: the mixed 22% group's discount is not subject to withholding.
  assert.equal(invoice.withholdings[0]!.taxableCents, 145000);
  assert.equal(invoice.withholdingCents, 29000);
  assert.match(
    invoice.xml,
    /<PrezzoTotale>-110\.00<\/PrezzoTotale>\s*<AliquotaIVA>22\.00<\/AliquotaIVA>\s*<\/DettaglioLinee>/,
  );
  assert.match(
    invoice.xml,
    /<PrezzoTotale>-50\.00<\/PrezzoTotale>\s*<AliquotaIVA>10\.00<\/AliquotaIVA>\s*<Ritenuta>SI<\/Ritenuta>\s*<\/DettaglioLinee>/,
  );
  assert.equal(invoice.xml.match(/<Ritenuta>SI<\/Ritenuta>/g)?.length, 3);
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
        documentDiscount: buildInvoice(withDocumentDiscount).xml,
        documentAdjustments: buildInvoice({
          ...withDocumentDiscount,
          adjustments: [
            { percent: 10 },
            { kind: "surcharge", amountCents: 250, description: "Trasporto" },
          ],
        }).xml,
        foreign: buildInvoice(foreign).xml,
        publicAdministration: buildInvoice(publicAdministration).xml,
        professional: buildInvoice(professional).xml,
        professionalInps: buildInvoice(professionalInps).xml,
        splitPaymentWithholding: buildInvoice(
          professionalToPublicAdministration,
        ).xml,
        flatRatePensionFund: buildInvoice({
          ...base,
          seller: { ...base.seller, taxRegime: "RF19" },
          lines: [
            {
              description: "Consulenza",
              unitPriceCents: 100000,
              vatRate: 0,
              nature: "N2.2",
            },
          ],
          pensionFunds: [{ type: "TC22", rate: 4, vatRate: 0, nature: "N2.2" }],
        }).xml,
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
