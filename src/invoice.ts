import {
  type Adjustment,
  formatCents,
  formatQuantity,
  lineTotal,
  parseQuantity,
  rateBasisPoints,
  vatAmount,
} from "./amounts.js";
import {
  isValidFiscalCode,
  isValidIban,
  isValidRecipientCode,
  isValidVatNumber,
} from "./identifiers.js";
import type {
  Address,
  Invoice,
  InvoiceInput,
  InvoiceLine,
  InvoiceTotals,
  Nature,
  VatSummary,
} from "./types.js";
import { natures, paymentMethods, taxRegimes } from "./types.js";
import { cleanText, renderXml, type XmlNode } from "./xml.js";

export interface ValidationIssue {
  /** Path of the offending input field, e.g. "lines[2].vatRate". */
  path: string;
  message: string;
}

export class FatturaPAError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Invalid invoice: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "FatturaPAError";
  }
}

/** Natures whose VAT-free amounts make the €2 stamp duty due above €77.47. */
const stampDutyNatures: Nature[] = ["N1", "N2.1", "N2.2", "N3.5", "N3.6", "N4"];
const stampDutyThresholdCents = 7747;
const stampDutyCents = 200;
const namespaces = [
  'versione="FPR12"',
  'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
  'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
].join(" ");

class Checker {
  readonly issues: ValidationIssue[] = [];
  add(path: string, message: string) {
    this.issues.push({ path, message });
  }
  /** Cleans free text and checks its length and character set. */
  text(
    path: string,
    value: string | undefined,
    max: number,
    ascii = false,
  ): string {
    const { text, invalid } = cleanText(value ?? "", ascii);
    if (!text) this.add(path, "is required");
    else if (invalid)
      this.add(
        path,
        `contains "${invalid}", which SDI does not accept${ascii ? " (ASCII only)" : ""}`,
      );
    else if (text.length > max) this.add(path, `exceeds ${max} characters`);
    return text;
  }
  optionalText(
    path: string,
    value: string | undefined,
    max: number,
    ascii = false,
  ): string | undefined {
    return value === undefined || !value.trim()
      ? undefined
      : this.text(path, value, max, ascii);
  }
  date(path: string, value: string | undefined) {
    if (value === undefined) return;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      this.add(path, "must be a valid YYYY-MM-DD date");
  }
}

function country(address: { country?: string }) {
  return address.country ?? "IT";
}

/** The largest percentage the Percentuale field holds. */
const maxPercent = 999.99;

/** Normalises line adjustments for the arithmetic; invalid ones are reported by buildInvoice. */
function adjustments(line: InvoiceLine): Adjustment[] {
  return (line.adjustments ?? []).map((a) => ({
    sign: a.kind === "surcharge" ? 1 : -1,
    ...(a.percent !== undefined
      ? { basisPoints: rateBasisPoints(a.percent, maxPercent) ?? 0 }
      : { amountCents: a.amountCents ?? 0 }),
  }));
}

function checkAddress(check: Checker, path: string, address: Address) {
  const italian = country(address) === "IT";
  const city = check.text(`${path}.city`, address.city, 60);
  const result = {
    street: check.text(`${path}.street`, address.street, 60),
    streetNumber: check.optionalText(
      `${path}.streetNumber`,
      address.streetNumber,
      8,
      true,
    ),
    city,
    // A foreign postal code does not fit the 5-digit CAP: it is kept with the city instead.
    postalCode: italian ? address.postalCode : "00000",
    province: address.province,
    country: country(address),
  };
  if (italian) {
    if (!/^\d{5}$/.test(address.postalCode ?? ""))
      check.add(`${path}.postalCode`, "must be 5 digits");
  } else if (address.postalCode?.trim()) {
    const postalCode = check.text(
      `${path}.postalCode`,
      address.postalCode,
      12,
      true,
    );
    result.city = `${postalCode} ${city}`;
    if (city && result.city.length > 60)
      check.add(`${path}.city`, "exceeds 60 characters with the postal code");
  }
  if (address.province !== undefined) {
    if (!italian)
      check.add(`${path}.province`, "is only used for Italian addresses");
    else if (!/^[A-Z]{2}$/.test(address.province))
      check.add(`${path}.province`, "must be 2 upper-case letters");
  }
  if (!/^[A-Z]{2}$/.test(result.country))
    check.add(`${path}.country`, "must be an ISO 3166-1 alpha-2 code");
  return result;
}

/** Strips spaces and a leading country prefix from a foreign VAT number (EL for Greece). */
function foreignVatNumber(value: string, idCountry: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const prefixes = idCountry === "GR" ? ["GR", "EL"] : [idCountry];
  const prefix = prefixes.find(
    (p) => compact.startsWith(p) && compact.length > p.length,
  );
  return prefix ? compact.slice(prefix.length) : compact;
}

/**
 * Computes line totals and the VAT summary per rate and nature, as SDI recomputes them:
 * VAT is rounded once per rate on the summed taxable amount.
 */
export function computeTotals(
  input: Pick<InvoiceInput, "lines" | "stampDuty">,
): InvoiceTotals {
  const groups = new Map<string, VatSummary>();
  const lines = input.lines.map((line) => {
    const quantity =
      line.quantity === undefined ? undefined : parseQuantity(line.quantity);
    const lineTotalCents = lineTotal(
      line.unitPriceCents,
      quantity,
      adjustments(line),
    );
    const key = `${line.vatRate}|${line.nature ?? ""}`;
    const group = groups.get(key) ?? {
      vatRate: line.vatRate,
      ...(line.nature && { nature: line.nature }),
      taxableCents: 0,
      vatCents: 0,
    };
    group.legalReference ??= line.legalReference;
    group.taxableCents += lineTotalCents;
    groups.set(key, group);
    return { lineTotalCents };
  });
  const summary = [...groups.values()]
    .map((group) => ({
      ...group,
      vatCents: vatAmount(
        group.taxableCents,
        rateBasisPoints(group.vatRate) ?? 0,
      ),
    }))
    .sort(
      (a, b) =>
        b.vatRate - a.vatRate || (a.nature ?? "").localeCompare(b.nature ?? ""),
    );
  const taxableCents = summary.reduce((n, s) => n + s.taxableCents, 0);
  const vatCents = summary.reduce((n, s) => n + s.vatCents, 0);
  const stampable = summary
    .filter((s) => s.nature && stampDutyNatures.includes(s.nature))
    .reduce((n, s) => n + s.taxableCents, 0);
  const stampDuty =
    input.stampDuty === "auto" || input.stampDuty === undefined
      ? stampable > stampDutyThresholdCents
      : input.stampDuty;
  return {
    lines,
    summary,
    taxableCents,
    vatCents,
    totalCents: taxableCents + vatCents,
    stampDutyCents: stampDuty ? stampDutyCents : 0,
  };
}

/**
 * Validates an invoice and renders it as a FatturaPA FPR12 (private-sector) XML file,
 * ready for an SDI channel or intermediary. Throws FatturaPAError listing every problem.
 */
export function buildInvoice(input: InvoiceInput): Invoice {
  const check = new Checker();
  const type = input.type ?? "TD01";
  const { seller, buyer, issuer, transmitter } = input;

  const number = check.text("number", input.number, 20, true);
  if (number && !/\d/.test(number))
    check.add("number", "must contain at least one digit");
  check.date("date", input.date);

  if (!/^[A-Za-z0-9]{1,5}$/.test(transmitter.sequence))
    check.add("transmitter.sequence", "must be 1-5 letters or digits");
  if (!/^[A-Z0-9]{11,16}$/.test(transmitter.code))
    check.add(
      "transmitter.code",
      "must be a Partita IVA or codice fiscale (11-16 characters)",
    );

  if (!isValidVatNumber(seller.vatNumber))
    check.add("seller.vatNumber", "is not a valid Partita IVA");
  if (seller.fiscalCode !== undefined && !isValidFiscalCode(seller.fiscalCode))
    check.add("seller.fiscalCode", "is not a valid codice fiscale");
  if (!taxRegimes.includes(seller.taxRegime))
    check.add("seller.taxRegime", "is not a FatturaPA RegimeFiscale code");
  const sellerName = check.text("seller.name", seller.name, 80);
  const sellerAddress = checkAddress(check, "seller.address", seller.address);

  const foreign = country(buyer.address) !== "IT";
  const buyerVatCountry = buyer.vatCountry ?? country(buyer.address);
  let buyerVatNumber = buyer.vatNumber;
  if (!/^[A-Z]{2}$/.test(buyerVatCountry))
    check.add("buyer.vatCountry", "must be an ISO 3166-1 alpha-2 code");
  if (foreign) {
    if (!buyer.vatNumber)
      check.add(
        "buyer.vatNumber",
        "is required for foreign buyers: their tax identifier or a conventional code",
      );
    if (buyer.fiscalCode !== undefined)
      check.add(
        "buyer.fiscalCode",
        "is only for Italian buyers: put a foreign tax identifier in vatNumber",
      );
  } else if (!buyer.vatNumber && !buyer.fiscalCode)
    check.add("buyer", "needs a vatNumber or a fiscalCode");
  if (buyer.vatNumber !== undefined) {
    if (buyerVatCountry === "IT") {
      if (!isValidVatNumber(buyer.vatNumber))
        check.add("buyer.vatNumber", "is not a valid Partita IVA");
    } else {
      buyerVatNumber = foreignVatNumber(buyer.vatNumber, buyerVatCountry);
      if (!/^[A-Z0-9]{1,28}$/.test(buyerVatNumber))
        check.add("buyer.vatNumber", "must be 1-28 letters or digits");
    }
  }
  if (buyer.fiscalCode !== undefined && !isValidFiscalCode(buyer.fiscalCode))
    check.add("buyer.fiscalCode", "is not a valid codice fiscale");
  const buyerName = check.text("buyer.name", buyer.name, 80);
  const buyerAddress = checkAddress(check, "buyer.address", buyer.address);
  const recipientCode =
    buyer.recipientCode ?? (foreign ? "XXXXXXX" : "0000000");
  if (!isValidRecipientCode(recipientCode))
    check.add("buyer.recipientCode", "must be 7 upper-case letters or digits");
  else if (foreign !== (recipientCode === "XXXXXXX"))
    check.add(
      "buyer.recipientCode",
      foreign
        ? 'must be "XXXXXXX" for foreign buyers'
        : '"XXXXXXX" is only for foreign buyers',
    );
  if (buyer.pec !== undefined) {
    if (recipientCode !== "0000000")
      check.add(
        "buyer.pec",
        'is used only when the recipient code is "0000000"',
      );
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.pec) || buyer.pec.length > 256)
      check.add("buyer.pec", "is not a valid email address");
  }

  let issuerName: string | undefined;
  if (issuer) {
    if (!isValidVatNumber(issuer.vatNumber))
      check.add("issuer.vatNumber", "is not a valid Partita IVA");
    if (
      issuer.fiscalCode !== undefined &&
      !isValidFiscalCode(issuer.fiscalCode)
    )
      check.add("issuer.fiscalCode", "is not a valid codice fiscale");
    issuerName = check.text("issuer.name", issuer.name, 80);
  }

  if (!input.lines.length) check.add("lines", "needs at least one line");
  if (input.lines.length > 9999)
    check.add("lines", "allows at most 9999 lines");
  const lines = input.lines.map((line, index) => {
    const path = `lines[${index}]`;
    const quantity =
      line.quantity === undefined ? undefined : parseQuantity(line.quantity);
    if (line.quantity !== undefined && quantity === undefined)
      check.add(
        `${path}.quantity`,
        "must be a positive number with at most 12 digits and 8 decimals",
      );
    if (!Number.isSafeInteger(line.unitPriceCents))
      check.add(`${path}.unitPriceCents`, "must be an integer");
    (line.adjustments ?? []).forEach((adjustment, i) => {
      const at = `${path}.adjustments[${i}]`;
      const { kind = "discount", percent, amountCents } = adjustment;
      if (kind !== "discount" && kind !== "surcharge")
        check.add(`${at}.kind`, 'must be "discount" or "surcharge"');
      if ((percent === undefined) === (amountCents === undefined))
        check.add(at, "needs exactly one of percent and amountCents");
      else if (percent !== undefined) {
        const bp = rateBasisPoints(
          percent,
          kind === "discount" ? 100 : maxPercent,
        );
        if (!bp)
          check.add(
            `${at}.percent`,
            `must be above 0 and at most ${kind === "discount" ? 100 : maxPercent}, with at most 2 decimals`,
          );
      } else if (!Number.isSafeInteger(amountCents) || amountCents! <= 0)
        check.add(`${at}.amountCents`, "must be a positive integer");
    });
    const basisPoints = rateBasisPoints(line.vatRate);
    if (basisPoints === undefined)
      check.add(
        `${path}.vatRate`,
        "must be a percentage between 0 and 100 with at most 2 decimals",
      );
    if (basisPoints === 0 && !line.nature)
      check.add(`${path}.nature`, "is required when the VAT rate is 0");
    if (basisPoints && line.nature)
      check.add(`${path}.nature`, "is only allowed when the VAT rate is 0");
    if (line.nature && !natures.includes(line.nature))
      check.add(`${path}.nature`, "is not a FatturaPA Natura code");
    if (seller.taxRegime === "RF19" && (basisPoints || line.nature !== "N2.2"))
      check.add(
        `${path}.vatRate`,
        "flat-rate (RF19) sellers charge no VAT: use rate 0 with nature N2.2",
      );
    return {
      quantity,
      description: check.text(`${path}.description`, line.description, 1000),
      unit: check.optionalText(`${path}.unit`, line.unit, 10, true),
      legalReference: check.optionalText(
        `${path}.legalReference`,
        line.legalReference,
        100,
      ),
    };
  });

  if ((type === "TD04" || type === "TD05") && !input.linkedInvoices?.length)
    check.add("linkedInvoices", "must reference the corrected invoice");
  const linkedInvoices = (input.linkedInvoices ?? []).map((linked, index) => {
    check.date(`linkedInvoices[${index}].date`, linked.date);
    return {
      number: check.text(
        `linkedInvoices[${index}].number`,
        linked.number,
        20,
        true,
      ),
      date: linked.date,
    };
  });
  const orderReference = input.orderReference && {
    id: check.text("orderReference.id", input.orderReference.id, 20, true),
    date: input.orderReference.date,
  };
  check.date("orderReference.date", input.orderReference?.date);

  const payment = input.payment;
  if (payment) {
    if (!paymentMethods.includes(payment.method))
      check.add("payment.method", "is not a FatturaPA ModalitaPagamento code");
    check.date("payment.dueDate", payment.dueDate);
    if (payment.iban !== undefined && !isValidIban(payment.iban))
      check.add("payment.iban", "is not a valid IBAN");
  }
  const bank = check.optionalText("payment.bank", payment?.bank, 80);
  const beneficiary = check.optionalText(
    "payment.beneficiary",
    payment?.beneficiary,
    200,
  );
  const description = cleanText(input.description ?? "");
  if (description.invalid)
    check.add(
      "description",
      `contains "${description.invalid}", which SDI does not accept`,
    );

  if (check.issues.length) throw new FatturaPAError(check.issues);

  const totals = computeTotals(input);
  if (type === "TD01" && totals.totalCents < 0)
    throw new FatturaPAError([
      { path: "lines", message: "an invoice total cannot be negative" },
    ]);

  const idFiscale = (code: string, idCountry = "IT"): XmlNode[] => [
    ["IdPaese", idCountry],
    ["IdCodice", code],
  ];
  const sede = (a: ReturnType<typeof checkAddress>): XmlNode => [
    "Sede",
    [
      ["Indirizzo", a.street],
      ["NumeroCivico", a.streetNumber],
      ["CAP", a.postalCode],
      ["Comune", a.city],
      ["Provincia", a.province],
      ["Nazione", a.country],
    ],
  ];
  const causali =
    description.text
      .match(/.{1,200}(?=\s|$)|.{1,200}/g)
      ?.map((part) => part.trim()) ?? [];

  const tree: XmlNode = [
    `p:FatturaElettronica ${namespaces}`,
    [
      [
        "FatturaElettronicaHeader",
        [
          [
            "DatiTrasmissione",
            [
              [
                "IdTrasmittente",
                idFiscale(transmitter.code, transmitter.country),
              ],
              ["ProgressivoInvio", transmitter.sequence],
              ["FormatoTrasmissione", "FPR12"],
              ["CodiceDestinatario", recipientCode],
              ["PECDestinatario", buyer.pec],
            ],
          ],
          [
            "CedentePrestatore",
            [
              [
                "DatiAnagrafici",
                [
                  ["IdFiscaleIVA", idFiscale(seller.vatNumber)],
                  ["CodiceFiscale", seller.fiscalCode],
                  ["Anagrafica", [["Denominazione", sellerName]]],
                  ["RegimeFiscale", seller.taxRegime],
                ],
              ],
              sede(sellerAddress),
            ],
          ],
          [
            "CessionarioCommittente",
            [
              [
                "DatiAnagrafici",
                [
                  buyerVatNumber
                    ? [
                        "IdFiscaleIVA",
                        idFiscale(buyerVatNumber, buyerVatCountry),
                      ]
                    : undefined,
                  ["CodiceFiscale", buyer.fiscalCode],
                  ["Anagrafica", [["Denominazione", buyerName]]],
                ],
              ],
              sede(buyerAddress),
            ],
          ],
          issuer
            ? [
                "TerzoIntermediarioOSoggettoEmittente",
                [
                  [
                    "DatiAnagrafici",
                    [
                      ["IdFiscaleIVA", idFiscale(issuer.vatNumber)],
                      ["CodiceFiscale", issuer.fiscalCode],
                      ["Anagrafica", [["Denominazione", issuerName!]]],
                    ],
                  ],
                ],
              ]
            : undefined,
          ["SoggettoEmittente", issuer ? "TZ" : undefined],
        ],
      ],
      [
        "FatturaElettronicaBody",
        [
          [
            "DatiGenerali",
            [
              [
                "DatiGeneraliDocumento",
                [
                  ["TipoDocumento", type],
                  ["Divisa", "EUR"],
                  ["Data", input.date],
                  ["Numero", number],
                  totals.stampDutyCents
                    ? [
                        "DatiBollo",
                        [
                          ["BolloVirtuale", "SI"],
                          ["ImportoBollo", formatCents(totals.stampDutyCents)],
                        ],
                      ]
                    : undefined,
                  ["ImportoTotaleDocumento", formatCents(totals.totalCents)],
                  ...causali.map((c): XmlNode => ["Causale", c]),
                ],
              ],
              orderReference
                ? [
                    "DatiOrdineAcquisto",
                    [
                      ["IdDocumento", orderReference.id],
                      ["Data", orderReference.date],
                    ],
                  ]
                : undefined,
              ...linkedInvoices.map((linked): XmlNode => [
                "DatiFattureCollegate",
                [
                  ["IdDocumento", linked.number],
                  ["Data", linked.date],
                ],
              ]),
            ],
          ],
          [
            "DatiBeniServizi",
            [
              ...input.lines.map((line, index): XmlNode => {
                const clean = lines[index]!;
                return [
                  "DettaglioLinee",
                  [
                    ["NumeroLinea", String(index + 1)],
                    ["Descrizione", clean.description],
                    [
                      "Quantita",
                      clean.quantity === undefined
                        ? undefined
                        : formatQuantity(clean.quantity),
                    ],
                    ["UnitaMisura", clean.unit],
                    ["PrezzoUnitario", formatCents(line.unitPriceCents)],
                    ...(line.adjustments ?? []).map((a): XmlNode => [
                      "ScontoMaggiorazione",
                      [
                        ["Tipo", a.kind === "surcharge" ? "MG" : "SC"],
                        [
                          "Percentuale",
                          a.percent === undefined
                            ? undefined
                            : formatCents(
                                rateBasisPoints(a.percent, maxPercent)!,
                              ),
                        ],
                        [
                          "Importo",
                          a.amountCents === undefined
                            ? undefined
                            : formatCents(a.amountCents),
                        ],
                      ],
                    ]),
                    [
                      "PrezzoTotale",
                      formatCents(totals.lines[index]!.lineTotalCents),
                    ],
                    [
                      "AliquotaIVA",
                      formatCents(rateBasisPoints(line.vatRate)!),
                    ],
                    ["Natura", line.nature],
                  ],
                ];
              }),
              ...totals.summary.map((group): XmlNode => [
                "DatiRiepilogo",
                [
                  ["AliquotaIVA", formatCents(rateBasisPoints(group.vatRate)!)],
                  ["Natura", group.nature],
                  ["ImponibileImporto", formatCents(group.taxableCents)],
                  ["Imposta", formatCents(group.vatCents)],
                  [
                    "EsigibilitaIVA",
                    group.nature ? undefined : (input.vatExigibility ?? "I"),
                  ],
                  [
                    "RiferimentoNormativo",
                    group.legalReference &&
                      cleanText(group.legalReference).text,
                  ],
                ],
              ]),
            ],
          ],
          payment
            ? [
                "DatiPagamento",
                [
                  ["CondizioniPagamento", "TP02"],
                  [
                    "DettaglioPagamento",
                    [
                      ["Beneficiario", beneficiary],
                      ["ModalitaPagamento", payment.method],
                      ["DataScadenzaPagamento", payment.dueDate],
                      ["ImportoPagamento", formatCents(totals.totalCents)],
                      ["IstitutoFinanziario", bank],
                      ["IBAN", payment.iban],
                    ],
                  ],
                ],
              ]
            : undefined,
        ],
      ],
    ],
  ];

  return {
    ...totals,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n${renderXml(tree)}`,
    fileName: `${transmitter.country ?? "IT"}${transmitter.code}_${transmitter.sequence}.xml`,
  };
}
