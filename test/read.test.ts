import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateCents,
  buildInvoice,
  FatturaPAError,
  parseInvoice,
  type InvoiceInput,
} from "../src/index.js";
import { base, schemaFixtures } from "./fixtures.js";

/** Drops undefined properties, so objects compare by their defined fields. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The DettaglioPagamento amounts the builder renders for an input. */
function expectedPayments(input: InvoiceInput, payableCents: number) {
  const payment = input.payment;
  if (!payment) return [];
  const installments = payment.installments;
  if (!installments)
    return [
      plain({
        method: payment.method,
        dueDate: payment.dueDate,
        amountCents: payableCents,
      }),
    ];
  const amounts = installments.every((i) => i.amountCents === undefined)
    ? allocateCents(
        payableCents,
        installments.map(() => 1),
      )
    : installments.map((i) => i.amountCents!);
  return installments.map((item, i) =>
    plain({
      method: item.method ?? payment.method,
      dueDate: item.dueDate,
      amountCents: amounts[i]!,
    }),
  );
}

for (const [name, fixture] of Object.entries(schemaFixtures)) {
  test(`${name}: a generated file reads back and rebuilds byte for byte`, () => {
    const built = buildInvoice(fixture);
    for (const file of [built.xml, new TextEncoder().encode(built.xml)]) {
      const parsed = parseInvoice(file);
      assert.equal(parsed.format, fixture.format ?? "FPR12");
      assert.equal(parsed.invoices.length, 1);
      const invoice = parsed.invoices[0]!;
      assert.deepEqual(invoice.unsupported, []);
      assert.deepEqual(invoice.attachments, []);
      assert.equal(buildInvoice(invoice.input).xml, built.xml);

      const { declared } = invoice;
      assert.deepEqual(declared.lines, [
        ...built.lines,
        ...built.adjustmentLines.map((l) => ({
          lineTotalCents: l.amountCents,
        })),
      ]);
      assert.deepEqual(
        declared.summary.map(({ exigibility: _, ...entry }) => entry),
        plain(built.summary),
      );
      assert.equal(declared.totalCents, built.totalCents);
      assert.equal(declared.roundingCents, undefined);
      assert.equal(declared.stampDutyCents, built.stampDutyCents);
      assert.deepEqual(
        declared.withholdings,
        built.withholdings.map(({ type, rate, reason, amountCents }) => ({
          type,
          rate,
          reason,
          amountCents,
        })),
      );
      assert.deepEqual(
        declared.pensionFunds.map(
          ({ type, taxableCents, contributionCents }) => ({
            type,
            taxableCents,
            contributionCents,
          }),
        ),
        built.pensionFunds.map(({ type, taxableCents, contributionCents }) => ({
          type,
          taxableCents,
          contributionCents,
        })),
      );
      assert.deepEqual(
        declared.payments,
        expectedPayments(fixture, built.payableCents),
      );
    }
  });
}

test("document adjustment lines read back as lines with their kind", () => {
  const built = buildInvoice(schemaFixtures.documentAdjustments!);
  const { input } = parseInvoice(built.xml).invoices[0]!;
  assert.deepEqual(
    input.lines.slice(2).map(({ kind, unitPriceCents, vatRate }) => ({
      kind,
      unitPriceCents,
      vatRate,
    })),
    built.adjustmentLines.map((line) => ({
      kind: line.amountCents < 0 ? "discount" : "charge",
      unitPriceCents: line.amountCents,
      vatRate: line.vatRate,
    })),
  );
  assert.deepEqual(
    [...new Set(input.lines.slice(2).map((l) => l.kind))],
    ["discount", "charge"],
  );
  assert.equal(input.adjustments, undefined);
});

const received = `<?xml version="1.0" encoding="UTF-8"?>
<!-- A batch from a supplier's software -->
<ns3:FatturaElettronica xmlns:ns3="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:ds='http://www.w3.org/2000/09/xmldsig#' versione="FPR12" SistemaEmittente="ACME">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente>
      <ProgressivoInvio>A1B2C</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>ABC1234</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>20000000008</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>Forniture Rossi &amp; Figli Srl</Denominazione></Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 1</Indirizzo><CAP>25121</CAP><Comune>Brescia</Comune>
        <Provincia>BS</Provincia><Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>RSSMRA85T10A562S</CodiceFiscale>
        <Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Verdi 2</Indirizzo><CAP>25122</CAP><Comune>Brescia</Comune>
        <Provincia>BS</Provincia><Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-11-02</Data>
        <Numero>FT/118</Numero>
        <ImportoTotaleDocumento>150.61</ImportoTotaleDocumento>
        <Causale><![CDATA[Fornitura <ottobre>]]></Causale>
      </DatiGeneraliDocumento>
      <DatiTrasporto><MezzoTrasporto>Furgone</MezzoTrasporto></DatiTrasporto>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <CodiceArticolo><CodiceTipo>EAN</CodiceTipo><CodiceValore>8001234567890</CodiceValore></CodiceArticolo>
        <Descrizione>Viti inox M6 &#232; &#x20AC;</Descrizione>
        <Quantita>100.00</Quantita>
        <UnitaMisura>pz</UnitaMisura>
        <PrezzoUnitario>0.1235</PrezzoUnitario>
        <PrezzoTotale>12.35</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>2</NumeroLinea>
        <Descrizione>Montaggio</Descrizione>
        <PrezzoUnitario>111.10</PrezzoUnitario>
        <PrezzoTotale>111.10</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>123.45</ImponibileImporto>
        <Imposta>27.16</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>2026-12-02</DataScadenzaPagamento>
        <ImportoPagamento>150.61</ImportoPagamento>
        <IBAN>IT60X0542811101000000123456</IBAN>
      </DettaglioPagamento>
    </DatiPagamento>
    <Allegati>
      <NomeAttachment>fattura.pdf</NomeAttachment>
      <FormatoAttachment>PDF</FormatoAttachment>
      <DescrizioneAttachment>Copia di cortesia</DescrizioneAttachment>
      <Attachment>
        JVBERi0xLjQK
      </Attachment>
    </Allegati>
  </FatturaElettronicaBody>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-11-03</Data>
        <Numero>FT/119</Numero>
        <ImportoTotaleDocumento>55.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Intervento</Descrizione>
        <PrezzoUnitario>50.00</PrezzoUnitario>
        <PrezzoTotale>50.00</PrezzoTotale>
        <AliquotaIVA>10.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>10.00</AliquotaIVA>
        <ImponibileImporto>50.00</ImponibileImporto>
        <Imposta>5.00</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</ns3:FatturaElettronica>
`;

test("a received batch maps each body and lists what the builder cannot express", () => {
  const parsed = parseInvoice(received);
  assert.equal(parsed.format, "FPR12");
  assert.equal(parsed.invoices.length, 2);
  const [first, second] = parsed.invoices as [
    (typeof parsed.invoices)[0],
    (typeof parsed.invoices)[0],
  ];
  const header = [
    "FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.Anagrafica.Nome",
    "FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici.Anagrafica.Cognome",
  ];
  assert.deepEqual(first.unsupported, [
    ...header,
    "FatturaElettronicaBody[0].DatiGenerali.DatiTrasporto",
    "FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[0].CodiceArticolo[0]",
    "FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[0].PrezzoUnitario",
    "FatturaElettronicaBody[0].Allegati[0]",
  ]);
  assert.deepEqual(second.unsupported, header);

  const { input } = first;
  assert.equal(input.number, "FT/118");
  assert.equal(input.seller.name, "Forniture Rossi & Figli Srl");
  assert.deepEqual(input.buyer, {
    fiscalCode: "RSSMRA85T10A562S",
    name: "Mario Rossi",
    address: {
      street: "Via Verdi 2",
      postalCode: "25122",
      city: "Brescia",
      province: "BS",
      country: "IT",
    },
    recipientCode: "ABC1234",
  });
  assert.equal(input.description, "Fornitura <ottobre>");
  assert.deepEqual(input.lines[0], {
    description: "Viti inox M6 è €",
    quantity: "100.00",
    unit: "pz",
    unitPriceCents: 12,
    vatRate: 22,
  });
  assert.deepEqual(input.payment, {
    method: "MP05",
    terms: "full",
    dueDate: "2026-12-02",
    iban: "IT60X0542811101000000123456",
  });
  assert.equal(input.stampDuty, false);

  assert.deepEqual(first.declared, {
    lines: [{ lineTotalCents: 1235 }, { lineTotalCents: 11110 }],
    summary: [
      { vatRate: 22, taxableCents: 12345, vatCents: 2716, exigibility: "I" },
    ],
    totalCents: 15061,
    stampDutyCents: 0,
    withholdings: [],
    pensionFunds: [],
    payments: [{ method: "MP05", dueDate: "2026-12-02", amountCents: 15061 }],
  });
  assert.deepEqual(first.attachments, [
    {
      name: "fattura.pdf",
      format: "PDF",
      description: "Copia di cortesia",
      data: new TextEncoder().encode("%PDF-1.4\n"),
    },
  ]);

  // The second body has only the header's unsupported fields, so it rebuilds as declared.
  assert.equal(second.input.number, "FT/119");
  assert.equal(second.input.payment, undefined);
  const rebuilt = buildInvoice(second.input);
  assert.equal(rebuilt.totalCents, second.declared.totalCents);
  assert.deepEqual(
    rebuilt.summary.map((s) => plain(s)),
    second.declared.summary.map(({ exigibility: _, ...s }) => s),
  );
  // Each invoice owns its header objects.
  first.input.seller.name = "Changed";
  assert.equal(second.input.seller.name, "Forniture Rossi & Figli Srl");
});

test("codes, currencies and elements outside the builder are kept and flagged", () => {
  const xml = buildInvoice(base)
    .xml.replace("<TipoDocumento>TD01", "<TipoDocumento>TD06")
    .replace("<Divisa>EUR", "<Divisa>USD")
    .replace(
      "<ImportoTotaleDocumento>",
      "<Arrotondamento>0.01</Arrotondamento><ImportoTotaleDocumento>",
    )
    .replace("<NumeroLinea>2</NumeroLinea>", "<NumeroLinea>5</NumeroLinea>");
  const [invoice] = parseInvoice(xml).invoices;
  assert.equal(invoice!.input.type, "TD06");
  assert.equal(invoice!.declared.roundingCents, 1);
  const document =
    "FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento";
  assert.deepEqual(invoice!.unsupported, [
    `${document}.TipoDocumento`,
    `${document}.Divisa`,
    `${document}.Arrotondamento`,
    "FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[1].NumeroLinea",
  ]);
});

test("several DettaglioPagamento read back as instalments with their amounts", () => {
  const xml = buildInvoice({
    ...base,
    payment: {
      method: "MP05",
      installments: [
        { dueDate: "2026-11-30", amountCents: 5000 },
        { dueDate: "2026-12-31", amountCents: 5415, method: "MP08" },
      ],
    },
  }).xml;
  const { input, declared } = parseInvoice(xml).invoices[0]!;
  assert.deepEqual(input.payment, {
    method: "MP05",
    terms: "installments",
    installments: [
      { dueDate: "2026-11-30", amountCents: 5000, method: "MP05" },
      { dueDate: "2026-12-31", amountCents: 5415, method: "MP08" },
    ],
  });
  assert.deepEqual(declared.payments, [
    { method: "MP05", dueDate: "2026-11-30", amountCents: 5000 },
    { method: "MP08", dueDate: "2026-12-31", amountCents: 5415 },
  ]);
});

test("Latin-1 files and a UTF-8 byte order mark are decoded", () => {
  const latin1 = Uint8Array.from(
    buildInvoice({
      ...base,
      lines: [{ ...base.lines[0]!, description: "Caffè" }],
    })
      .xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
  assert.equal(
    parseInvoice(latin1).invoices[0]!.input.lines[0]!.description,
    "Caffè",
  );
  const xml = buildInvoice(base).xml;
  const bom = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode(xml),
  ]);
  assert.equal(parseInvoice(bom).invoices[0]!.input.number, "1/MZ");
  assert.equal(parseInvoice(`﻿${xml}`).invoices[0]!.input.number, "1/MZ");
});

// A minimal CAdES-like envelope: ContentInfo { signedData, [0] SignedData { version,
// digestAlgorithms, encapContentInfo { data, [0] OCTET STRING }, certificates, signerInfos } }.
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function definite(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(content);
  const n = body.length;
  const length =
    n < 0x80
      ? [n]
      : n < 0x100
        ? [0x81, n]
        : n < 0x10000
          ? [0x82, n >> 8, n & 0xff]
          : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return concat([Uint8Array.from([tag, ...length]), body]);
}

function indefinite(tag: number, ...content: Uint8Array[]): Uint8Array {
  return concat([Uint8Array.from([tag, 0x80]), ...content, new Uint8Array(2)]);
}

const oid = (...bytes: number[]) => definite(0x06, Uint8Array.from(bytes));
const signedDataOid = oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02);
const dataOid = oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01);
const sha256 = oid(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01);

function envelope(
  content: Uint8Array | undefined,
  wrap: (tag: number, ...content: Uint8Array[]) => Uint8Array,
): Uint8Array {
  const encapsulated = wrap(
    0x30,
    dataOid,
    ...(content ? [wrap(0xa0, content)] : []),
  );
  const signedData = wrap(
    0x30,
    definite(0x02, Uint8Array.from([1])),
    definite(0x31, definite(0x30, sha256)),
    encapsulated,
    definite(0xa0, definite(0x30, Uint8Array.from([0x02, 0x01, 0x05]))),
    definite(0x31),
  );
  return wrap(0x30, signedDataOid, wrap(0xa0, signedData));
}

function base64Lines(bytes: Uint8Array): string {
  return `\n  ${Buffer.from(bytes).toString("base64").replace(/.{76}/g, "$&\r\n")}\n`;
}

test("signed .p7m files are unwrapped, in DER, BER and base64", () => {
  const xml = buildInvoice(base).xml;
  const bytes = new TextEncoder().encode(xml);
  const der = envelope(definite(0x04, bytes), definite);
  // Indefinite lengths throughout, with the content split into nested OCTET STRING segments.
  const segments: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 1000)
    segments.push(definite(0x04, bytes.subarray(i, i + 1000)));
  const ber = envelope(
    indefinite(
      0x24,
      definite(0x24, ...segments.slice(0, 2)),
      ...segments.slice(2),
    ),
    indefinite,
  );
  const files: (string | Uint8Array)[] = [
    der,
    ber,
    base64Lines(der),
    new TextEncoder().encode(base64Lines(ber)),
  ];
  for (const file of files) {
    const [invoice] = parseInvoice(file).invoices;
    assert.equal(buildInvoice(invoice!.input).xml, xml);
  }
});

function issuesOf(
  file: string | Uint8Array,
): { path: string; message: string }[] {
  try {
    parseInvoice(file);
  } catch (error) {
    assert.ok(error instanceof FatturaPAError, String(error));
    return error.issues;
  }
  assert.fail("parseInvoice did not throw");
}

test("unreadable .p7m files are rejected", () => {
  const bytes = new TextEncoder().encode(buildInvoice(base).xml);
  const [detached] = issuesOf(envelope(undefined, definite));
  assert.equal(detached!.path, "file");
  assert.match(detached!.message, /detached signature/);
  const notSigned = definite(
    0x30,
    dataOid,
    definite(0xa0, definite(0x04, bytes)),
  );
  assert.match(issuesOf(notSigned)[0]!.message, /not a CMS SignedData/);
  const truncated = envelope(definite(0x04, bytes), definite).subarray(0, 500);
  assert.match(issuesOf(truncated)[0]!.message, /truncated/);
  assert.match(issuesOf("MIInotbase64!")[0]!.message, /neither XML nor/);
});

test("a DOCTYPE is rejected, so entities cannot expand", () => {
  const [issue] = issuesOf(
    '<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol">]>\n<FatturaElettronica versione="FPR12">&lol;</FatturaElettronica>',
  );
  assert.equal(issue!.path, "file");
  assert.match(
    issue!.message,
    /line 2, column 1: DOCTYPE declarations are not allowed/,
  );
});

test("malformed XML is reported with its line and column", () => {
  const xml = buildInvoice(base).xml.replace("</Numero>", "</Numer>");
  const lines = xml.split("\n");
  const line = lines.findIndex((l) => l.includes("</Numer>"));
  const column = lines[line]!.indexOf("</Numer>") + 1;
  const [issue] = issuesOf(xml);
  assert.equal(issue!.path, "file");
  assert.equal(
    issue!.message,
    `is not well-formed XML: line ${line + 1}, column ${column}: expected </Numero>, found </Numer>`,
  );
  const cases: [string, RegExp][] = [
    ["<a>&foo;</a>", /line 1, column 4: unknown entity "&foo;"/],
    ["<a>AT&T</a>", /"&" must start an entity/],
    ["<a b='1' b='2'/>", /duplicate attribute "b"/],
    ["<a><b></a>", /expected <\/b>, found <\/a>/],
    ["<a>", /unclosed element <a>/],
    ["<a/><b/>", /more than one root element/],
    ["<a>&#0;</a>", /character reference "&#0;" is not allowed/],
    [
      "<a/>\n<?xml version='1.0'?>",
      /line 2, column 1: the XML declaration must come first/,
    ],
    [
      `${"<a>".repeat(101)}${"</a>".repeat(101)}`,
      /nested deeper than 100 levels/,
    ],
  ];
  for (const [input, message] of cases)
    assert.match(issuesOf(input)[0]!.message, message, input);
});

test("non-FatturaPA documents, missing elements and bad amounts are rejected with paths", () => {
  assert.deepEqual(issuesOf("<Invoice><ID>1</ID></Invoice>"), [
    {
      path: "Invoice",
      message:
        "is not a FatturaPA document: the root element must be FatturaElettronica",
    },
  ]);
  const xml = buildInvoice(base).xml;
  assert.deepEqual(
    issuesOf(xml.replace('versione="FPR12"', 'versione="FSM10"')),
    [
      {
        path: "FatturaElettronica@versione",
        message: 'must be FPR12 or FPA12, found "FSM10"',
      },
    ],
  );
  const broken = xml
    .replace("<Numero>1/MZ</Numero>", "")
    .replace(
      "<PrezzoTotale>74.70</PrezzoTotale>",
      "<PrezzoTotale>74,70</PrezzoTotale>",
    )
    .replace(
      "<AliquotaIVA>4.00</AliquotaIVA>",
      "<AliquotaIVA>4.000</AliquotaIVA>",
    );
  assert.deepEqual(issuesOf(broken), [
    {
      path: "FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento.Numero",
      message: "is required",
    },
    {
      path: "FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[0].PrezzoTotale",
      message: 'must be an amount with at most 2 decimals, found "74,70"',
    },
    {
      path: "FatturaElettronicaBody[0].DatiBeniServizi.DettaglioLinee[1].AliquotaIVA",
      message: 'must be a percentage with at most 2 decimals, found "4.000"',
    },
  ]);
});
