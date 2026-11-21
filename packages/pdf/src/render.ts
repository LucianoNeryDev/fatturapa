import type { Invoice } from "@lucianonerydev/fatturapa";
import {
  centsFromXml,
  documentTypes,
  formatAmount,
  formatDate,
  formatDecimal,
  formatEuro,
  formatIban,
  paymentMethod,
  paymentTerms,
  pensionFunds,
  taxRegimes,
  vatExigibility,
  withholdingTypes,
} from "./format.js";
import {
  type Column,
  bodySize,
  cellPadding,
  contentWidth,
  Layout,
  lineHeight,
  margin,
  wrap,
} from "./layout.js";
import {
  type DocumentInfo,
  type FontName,
  textWidth,
  writePdf,
} from "./pdf.js";
import { type XmlElement, find, findAll, parseXml, textAt } from "./xml.js";

export const disclaimer =
  "Copia di cortesia priva di valore fiscale. L'originale è il file XML trasmesso tramite il Sistema di Interscambio (SdI).";

interface Styled {
  text: string;
  font?: FontName;
  size?: number;
  gray?: number;
}

function addressLines(address: XmlElement | undefined): string[] {
  if (!address) return [];
  const street = [textAt(address, "Indirizzo"), textAt(address, "NumeroCivico")]
    .filter(Boolean)
    .join(" ");
  const country = textAt(address, "Nazione") ?? "IT";
  const province = textAt(address, "Provincia");
  // Foreign addresses carry CAP 00000 and keep their postal code with the city.
  const postalCode = country === "IT" ? textAt(address, "CAP") : undefined;
  const city = [postalCode, textAt(address, "Comune")]
    .filter(Boolean)
    .join(" ");
  return [
    street,
    `${city}${province ? ` (${province})` : ""}${country === "IT" ? "" : ` - ${country}`}`,
  ];
}

function oneLineAddress(address: XmlElement | undefined): string {
  return addressLines(address).join(", ");
}

function vatId(element: XmlElement | undefined): string | undefined {
  const id = find(element, "IdFiscaleIVA");
  if (!id) return;
  return `${textAt(id, "IdPaese")}${textAt(id, "IdCodice")}`;
}

function vatLabel(element: XmlElement | undefined): string | undefined {
  const id = vatId(element);
  if (!id) return;
  return id.startsWith("IT")
    ? `P.IVA\u00a0${id}`
    : `Id. fiscale IVA\u00a0${id}`;
}

function representative(element: XmlElement | undefined): string | undefined {
  if (!element) return;
  const data = find(element, "DatiAnagrafici") ?? element;
  const name =
    textAt(data, "Anagrafica/Denominazione") ?? textAt(data, "Denominazione");
  const fiscalCode = textAt(data, "CodiceFiscale");
  return [name, vatLabel(data), fiscalCode && `Codice fiscale ${fiscalCode}`]
    .filter(Boolean)
    .join(", ");
}

function percent(value: string | undefined): string {
  return value === undefined ? "" : `${formatDecimal(value)}%`;
}

function vatCell(line: XmlElement): string {
  return textAt(line, "Natura") ?? percent(textAt(line, "AliquotaIVA"));
}

function adjustmentsCell(line: XmlElement): string {
  return findAll(line, "ScontoMaggiorazione")
    .map((a) => {
      const sign = textAt(a, "Tipo") === "MG" ? "+" : "-";
      const rate = textAt(a, "Percentuale");
      const amount = textAt(a, "Importo");
      return rate !== undefined
        ? `${sign}${formatDecimal(rate)}%`
        : `${sign}${formatAmount(centsFromXml(amount ?? "0.00"))}`;
    })
    .join(" ");
}

function referenceLines(body: XmlElement | undefined): string[] {
  const general = find(body, "DatiGenerali");
  const kinds: [string, string][] = [
    ["DatiOrdineAcquisto", "Ordine d'acquisto"],
    ["DatiContratto", "Contratto"],
    ["DatiConvenzione", "Convenzione"],
    ["DatiRicezione", "Ricezione"],
  ];
  const lines: string[] = [];
  for (const [tag, label] of kinds)
    for (const ref of findAll(general, tag)) {
      const date = textAt(ref, "Data");
      const lineNumbers = findAll(ref, "RiferimentoNumeroLinea").map((n) =>
        n.text.trim(),
      );
      const parts = [
        `${label} n. ${textAt(ref, "IdDocumento")}${date ? ` del ${formatDate(date)}` : ""}`,
      ];
      const code = textAt(ref, "CodiceCommessaConvenzione");
      if (code) parts.push(`codice commessa/convenzione ${code}`);
      const cup = textAt(ref, "CodiceCUP");
      if (cup) parts.push(`CUP ${cup}`);
      const cig = textAt(ref, "CodiceCIG");
      if (cig) parts.push(`CIG ${cig}`);
      if (lineNumbers.length)
        parts.push(
          `${lineNumbers.length > 1 ? "righe" : "riga"} ${lineNumbers.join(", ")}`,
        );
      lines.push(parts.join(", "));
    }
  for (const linked of findAll(general, "DatiFattureCollegate")) {
    const date = textAt(linked, "Data");
    lines.push(
      `Fattura collegata n. ${textAt(linked, "IdDocumento")}${date ? ` del ${formatDate(date)}` : ""}`,
    );
  }
  return lines;
}

/** Lays out the courtesy copy of a built invoice. */
export function renderPages(
  invoice: Invoice,
  options: { creationDate?: Date; title?: string },
): Uint8Array {
  const root = parseXml(invoice.xml);
  const header = find(root, "FatturaElettronicaHeader");
  const body = find(root, "FatturaElettronicaBody");
  const general = find(body, "DatiGenerali/DatiGeneraliDocumento");
  const format = textAt(header, "DatiTrasmissione/FormatoTrasmissione");
  const type = textAt(general, "TipoDocumento") ?? "TD01";
  const number = textAt(general, "Numero") ?? "";
  const date = formatDate(textAt(general, "Data") ?? "");
  const typeLabel = documentTypes[type] ?? type;
  const title = `${typeLabel}${format === "FPA12" ? " verso Pubblica Amministrazione" : ""}`;
  const numberLine = `N. ${number} del ${date}`;

  const seller = find(header, "CedentePrestatore");
  const sellerData = find(seller, "DatiAnagrafici");
  const sellerName = textAt(sellerData, "Anagrafica/Denominazione") ?? "";
  const layout = new Layout(`${typeLabel} ${numberLine} - ${sellerName}`);

  // Title block.
  layout.draw(margin, layout.y, title, { font: "bold", size: 16 });
  layout.draw(
    margin,
    layout.y + 2,
    "Copia di cortesia",
    { size: 8, gray: 0.4 },
    "right",
    contentWidth,
  );
  layout.y += 21;
  layout.draw(margin, layout.y, numberLine, { font: "bold", size: 11 });
  layout.y += 22;

  // Parties.
  const sellerLines: Styled[] = [
    { text: "CEDENTE / PRESTATORE", font: "bold", size: 7, gray: 0.4 },
    { text: sellerName, font: "bold", size: 10 },
    ...addressLines(find(seller, "Sede")).map((text) => ({ text })),
  ];
  const sellerVat = vatLabel(sellerData);
  if (sellerVat) sellerLines.push({ text: sellerVat });
  const sellerFiscalCode = textAt(sellerData, "CodiceFiscale");
  if (sellerFiscalCode)
    sellerLines.push({ text: `Codice fiscale ${sellerFiscalCode}` });
  const regime = textAt(sellerData, "RegimeFiscale");
  if (regime)
    sellerLines.push({
      text: `Regime fiscale ${regime}${taxRegimes[regime] ? ` (${taxRegimes[regime]})` : ""}`,
    });
  const sellerEstablishment = find(seller, "StabileOrganizzazione");
  if (sellerEstablishment)
    sellerLines.push({
      text: `Stabile organizzazione: ${oneLineAddress(sellerEstablishment)}`,
    });
  const sellerRepresentative = representative(
    find(header, "RappresentanteFiscale"),
  );
  if (sellerRepresentative)
    sellerLines.push({
      text: `Rappresentante fiscale: ${sellerRepresentative}`,
    });

  const buyer = find(header, "CessionarioCommittente");
  const buyerData = find(buyer, "DatiAnagrafici");
  const buyerLines: Styled[] = [
    { text: "CESSIONARIO / COMMITTENTE", font: "bold", size: 7, gray: 0.4 },
    {
      text: textAt(buyerData, "Anagrafica/Denominazione") ?? "",
      font: "bold",
      size: 10,
    },
    ...addressLines(find(buyer, "Sede")).map((text) => ({ text })),
  ];
  const buyerVat = vatLabel(buyerData);
  if (buyerVat) buyerLines.push({ text: buyerVat });
  const buyerFiscalCode = textAt(buyerData, "CodiceFiscale");
  if (buyerFiscalCode)
    buyerLines.push({ text: `Codice fiscale ${buyerFiscalCode}` });
  const recipientCode = textAt(header, "DatiTrasmissione/CodiceDestinatario");
  const pec = textAt(header, "DatiTrasmissione/PECDestinatario");
  if (format === "FPA12" && recipientCode)
    buyerLines.push({ text: `Codice univoco ufficio ${recipientCode}` });
  else if (pec) buyerLines.push({ text: `PEC ${pec}` });
  else if (recipientCode && recipientCode !== "XXXXXXX")
    buyerLines.push({ text: `Codice destinatario ${recipientCode}` });
  const buyerEstablishment = find(buyer, "StabileOrganizzazione");
  if (buyerEstablishment)
    buyerLines.push({
      text: `Stabile organizzazione: ${oneLineAddress(buyerEstablishment)}`,
    });
  const buyerRepresentative = representative(
    find(buyer, "RappresentanteFiscale"),
  );
  if (buyerRepresentative)
    buyerLines.push({ text: `Rappresentante fiscale: ${buyerRepresentative}` });

  const gap = 12;
  const boxWidth = (contentWidth - gap) / 2;
  const padding = 7;
  const wrapBlock = (lines: Styled[]) =>
    lines.flatMap((line) =>
      wrap(
        line.text,
        line.font ?? "regular",
        line.size ?? bodySize,
        boxWidth - 2 * padding,
      ).map((text) => ({ ...line, text })),
    );
  const blocks = [wrapBlock(sellerLines), wrapBlock(buyerLines)];
  const blockHeight = (lines: Styled[]) =>
    lines.reduce((n, l) => n + (l.size ?? bodySize) * 1.3, 0);
  const boxHeight = Math.max(...blocks.map(blockHeight)) + 2 * padding - 2;
  blocks.forEach((lines, i) => {
    const x = margin + i * (boxWidth + gap);
    layout.page.rect(x, layout.y, boxWidth, boxHeight, 0.95);
    let y = layout.y + padding;
    for (const line of lines) {
      layout.draw(x + padding, y, line.text, line);
      y += (line.size ?? bodySize) * 1.3;
    }
  });
  layout.y += boxHeight + 8;

  const issuer = find(header, "TerzoIntermediarioOSoggettoEmittente");
  if (issuer)
    layout.paragraph(
      `Documento emesso da terzo per conto del cedente/prestatore: ${representative(issuer)}`,
      { size: 8 },
    );

  // References and causale.
  const references = referenceLines(body);
  const causale = findAll(general, "Causale")
    .map((c) => c.text.trim())
    .join(" ");
  if (references.length || causale) {
    layout.section("Riferimenti");
    for (const line of references) layout.paragraph(line);
    if (causale) layout.paragraph(`Causale: ${causale}`);
  }

  // Lines.
  const goods = find(body, "DatiBeniServizi");
  const detailLines = findAll(goods, "DettaglioLinee");
  const amounts = [
    ...invoice.lines.map((l) => l.lineTotalCents),
    ...invoice.adjustmentLines.map((l) => l.amountCents),
  ];
  if (amounts.length !== detailLines.length)
    throw new Error("The XML lines do not match the invoice totals");
  // The number column fits the longest line number.
  const numberWidth = Math.max(
    22,
    textWidth(String(detailLines.length), "regular", bodySize) +
      2 * cellPadding +
      2,
  );
  const lineColumns: Column[] = [
    { title: "N.", width: numberWidth, align: "right" },
    { title: "Descrizione", width: contentWidth - 294 - numberWidth },
    { title: "Quantità", width: 46, align: "right" },
    { title: "U.M.", width: 30 },
    { title: "Prezzo unitario", width: 58, align: "right" },
    { title: "Sconti/ maggiorazioni", width: 64, align: "right" },
    { title: "IVA", width: 34, align: "right" },
    { title: "Importo", width: 62, align: "right" },
  ];
  layout.section("Dettaglio beni e servizi");
  layout.table(
    lineColumns,
    detailLines.map((line, i) => {
      const quantity = textAt(line, "Quantita");
      return [
        textAt(line, "NumeroLinea") ?? String(i + 1),
        textAt(line, "Descrizione") ?? "",
        quantity === undefined ? "" : formatDecimal(quantity),
        textAt(line, "UnitaMisura") ?? "",
        formatAmount(centsFromXml(textAt(line, "PrezzoUnitario") ?? "0.00")),
        adjustmentsCell(line),
        vatCell(line),
        formatAmount(amounts[i]!),
      ];
    }),
  );

  // VAT summary, in the order of the XML (the same as invoice.summary).
  const summaryNodes = findAll(goods, "DatiRiepilogo");
  layout.section("Riepilogo IVA");
  layout.table(
    [
      { title: "Aliquota / Natura", width: 72 },
      { title: "Imponibile", width: 78, align: "right" },
      { title: "Imposta", width: 72, align: "right" },
      { title: "Esigibilità", width: 110 },
      { title: "Riferimento normativo", width: contentWidth - 332 },
    ],
    invoice.summary.map((group, i) => {
      const node = summaryNodes[i];
      const exigibility = textAt(node, "EsigibilitaIVA");
      return [
        group.nature ?? `${String(group.vatRate).replace(".", ",")}%`,
        formatAmount(group.taxableCents),
        formatAmount(group.vatCents),
        exigibility ? (vatExigibility[exigibility] ?? exigibility) : "",
        textAt(node, "RiferimentoNormativo") ?? "",
      ];
    }),
  );

  // Totals, right-aligned.
  const funds = findAll(general, "DatiCassaPrevidenziale");
  const totals: { label: string; value: string; strong?: boolean }[] = [
    { label: "Totale imponibile", value: formatEuro(invoice.taxableCents) },
  ];
  invoice.pensionFunds.forEach((fund, i) => {
    const name = pensionFunds[fund.type];
    totals.push({
      label: `di cui contributo ${name ? `${name} (${fund.type})` : fund.type} ${percent(textAt(funds[i], "AlCassa"))} su ${formatEuro(fund.taxableCents)}`,
      value: formatEuro(fund.contributionCents),
    });
  });
  totals.push({ label: "Totale IVA", value: formatEuro(invoice.vatCents) });
  totals.push({
    label: "Totale documento",
    value: formatEuro(invoice.totalCents),
    strong: true,
  });
  for (const w of invoice.withholdings)
    totals.push({
      label: `${withholdingTypes[w.type] ?? w.type} (${w.type}) ${String(w.rate).replace(".", ",")}% su ${formatEuro(w.taxableCents)}, causale ${w.reason}`,
      value: formatEuro(-w.amountCents),
    });
  const splitPayment = summaryNodes.some(
    (n) => textAt(n, "EsigibilitaIVA") === "S",
  );
  if (splitPayment)
    totals.push({
      label:
        "IVA versata dal committente (scissione dei pagamenti, art. 17-ter DPR 633/1972)",
      value: formatEuro(-invoice.vatCents),
    });
  if (invoice.stampDutyCents)
    totals.push({
      label: "Imposta di bollo assolta in modo virtuale (informativa)",
      value: formatEuro(invoice.stampDutyCents),
    });

  const totalsWidth = 300;
  const valueWidth = 80;
  const totalsX = margin + contentWidth - totalsWidth;
  const labelWidth = totalsWidth - valueWidth - 8;
  layout.y += 10;
  for (const row of totals) {
    const font: FontName = row.strong ? "bold" : "regular";
    const lines = wrap(row.label, font, bodySize, labelWidth);
    layout.ensure(lines.length * lineHeight + 4);
    lines.forEach((line, k) =>
      layout.draw(totalsX, layout.y + 2 + k * lineHeight, line, { font }),
    );
    layout.draw(
      totalsX + labelWidth,
      layout.y + 2,
      row.value,
      { font },
      "right",
      valueWidth + 8,
    );
    layout.y += lines.length * lineHeight + 4;
    layout.page.line(
      totalsX,
      layout.y,
      totalsX + totalsWidth,
      layout.y,
      0.4,
      0.8,
    );
  }
  layout.ensure(24);
  layout.page.rect(totalsX, layout.y + 3, totalsWidth, 20, 0.88);
  layout.draw(totalsX + 6, layout.y + 8.5, "Netto a pagare", {
    font: "bold",
    size: 10.5,
  });
  layout.draw(
    totalsX,
    layout.y + 8.5,
    formatEuro(invoice.payableCents),
    { font: "bold", size: 10.5 },
    "right",
    totalsWidth - 6,
  );
  layout.y += 26;

  // Payment.
  const payment = find(body, "DatiPagamento");
  if (payment) {
    layout.section("Pagamento");
    const terms = textAt(payment, "CondizioniPagamento");
    const details = findAll(payment, "DettaglioPagamento");
    const fieldDefs: [string, string, (v: string) => string][] = [
      ["ModalitaPagamento", "Modalità", paymentMethod],
      ["Beneficiario", "Beneficiario", (v) => v],
      ["IstitutoFinanziario", "Istituto", (v) => v],
      ["IBAN", "IBAN", formatIban],
    ];
    const pairs: [string, string][] = [];
    if (terms)
      pairs.push(["Condizioni", `${paymentTerms[terms] ?? terms} (${terms})`]);
    const varying: typeof fieldDefs = [];
    for (const def of fieldDefs) {
      const values = details.map((d) => textAt(d, def[0]));
      if (details.length > 1 && values.some((v) => v !== values[0]))
        varying.push(def);
      else if (values[0] !== undefined) pairs.push([def[1], def[2](values[0])]);
    }
    if (details.length === 1) {
      const due = textAt(details[0], "DataScadenzaPagamento");
      if (due) pairs.push(["Scadenza", formatDate(due)]);
      pairs.push([
        "Importo",
        formatEuro(
          centsFromXml(textAt(details[0], "ImportoPagamento") ?? "0.00"),
        ),
      ]);
    }
    layout.fields(pairs);
    if (details.length > 1) {
      layout.y += 6;
      const fixed = 40 + 70 + 90;
      const flexible = (contentWidth - fixed) / Math.max(varying.length, 1);
      layout.table(
        [
          { title: "Rata", width: 40, align: "right" },
          { title: "Scadenza", width: 70 },
          ...varying.map(([, label]) => ({
            title: label,
            width: varying.length ? flexible : 0,
          })),
          ...(varying.length
            ? []
            : [{ title: "", width: contentWidth - fixed }]),
          { title: "Importo", width: 90, align: "right" },
        ],
        details.map((detail, i) => {
          const due = textAt(detail, "DataScadenzaPagamento");
          return [
            String(i + 1),
            due ? formatDate(due) : "",
            ...varying.map(([tag, , show]) => {
              const value = textAt(detail, tag);
              return value === undefined ? "" : show(value);
            }),
            ...(varying.length ? [] : [""]),
            formatEuro(
              centsFromXml(textAt(detail, "ImportoPagamento") ?? "0.00"),
            ),
          ];
        }),
      );
    }
  }

  layout.footer(disclaimer);

  const info: DocumentInfo = {
    title: options.title ?? `${typeLabel} ${numberLine}`,
    author: sellerName,
  };
  if (options.creationDate) info.creationDate = options.creationDate;
  return writePdf(layout.pages, info);
}
