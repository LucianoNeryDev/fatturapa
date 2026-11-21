import { divideRounded, formatQuantity, parseQuantity } from "./amounts.js";
import { decodeBase64 } from "./base64.js";
import {
  FatturaPAError,
  lineKindCodes,
  type ValidationIssue,
} from "./invoice.js";
import { EnvelopeError, extractSignedContent } from "./p7m.js";
import type {
  Address,
  Buyer,
  DocumentReference,
  DocumentType,
  Installment,
  InvoiceInput,
  InvoiceLine,
  Nature,
  Payment,
  PaymentMethod,
  PaymentReason,
  PensionFund,
  PensionFundType,
  PriceAdjustment,
  Seller,
  ThirdPartyIssuer,
  TransmissionFormat,
  Transmitter,
  VatSummary,
  Withholding,
  WithholdingType,
} from "./types.js";
import {
  natures,
  paymentMethods,
  paymentReasons,
  pensionFundTypes,
  taxRegimes,
  withholdingTypes,
} from "./types.js";
import { parseXml, XmlSyntaxError, type XmlElement } from "./xml-parse.js";

/** An attachment (Allegati) of a received invoice. */
export interface InvoiceAttachment {
  /** NomeAttachment, the file name. */
  name: string;
  /** FormatoAttachment, e.g. "PDF". */
  format?: string;
  /** DescrizioneAttachment. */
  description?: string;
  /**
   * The decoded bytes. They are still compressed when the file declares an
   * AlgoritmoCompressione (e.g. ZIP).
   */
  data: Uint8Array;
}

/** The amounts of a received invoice as written in the file, not recomputed. */
export interface DeclaredTotals {
  /** PrezzoTotale of every DettaglioLinee, in file order. */
  lines: { lineTotalCents: number }[];
  /** DatiRiepilogo, in file order, with its EsigibilitaIVA. */
  summary: (VatSummary & { exigibility?: "I" | "D" | "S" })[];
  /** ImportoTotaleDocumento, when given. */
  totalCents?: number;
  /** Arrotondamento of the document, when given. */
  roundingCents?: number;
  /** ImportoBollo, or 0 without DatiBollo. */
  stampDutyCents: number;
  /** DatiRitenuta, with ImportoRitenuta. */
  withholdings: {
    type: WithholdingType;
    rate: number;
    reason: PaymentReason;
    amountCents: number;
  }[];
  /** DatiCassaPrevidenziale, with ImportoContributoCassa and ImponibileCassa. */
  pensionFunds: {
    type: PensionFundType;
    rate: number;
    taxableCents?: number;
    contributionCents: number;
    vatRate: number;
    nature?: Nature;
    withholding: boolean;
  }[];
  /** Every DettaglioPagamento of every DatiPagamento, with ImportoPagamento. */
  payments: { method: PaymentMethod; dueDate?: string; amountCents: number }[];
}

/** One invoice of a received file: one FatturaElettronicaBody with the shared header. */
export interface ReceivedInvoice {
  /**
   * Best-effort mapping of the header and this body into the shape `buildInvoice` takes. Codes
   * outside the library's unions (e.g. a TD06 document type or an old N2 nature) are kept as
   * written and listed in `unsupported`.
   */
  input: InvoiceInput;
  /** The amounts as written in the file, not recomputed. */
  declared: DeclaredTotals;
  /** Allegati, base64-decoded. */
  attachments: InvoiceAttachment[];
  /**
   * Paths of the elements present in the file that `input` cannot represent, e.g.
   * "FatturaElettronicaBody[0].DatiGenerali.DatiTrasporto". Empty means
   * `buildInvoice(input)` renders the same elements and values, apart from totals it recomputes.
   */
  unsupported: string[];
}

/** A parsed FatturaPA file. */
export interface ParsedInvoiceFile {
  /** The file's `versione`. */
  format: TransmissionFormat;
  /** One invoice per FatturaElettronicaBody: a batch (lotto) has several. */
  invoices: ReceivedInvoice[];
}

/** Elements the schema allows more than once; their paths carry an index. */
const repeatable = new Set([
  "FatturaElettronicaBody",
  "DatiOrdineAcquisto",
  "DatiContratto",
  "DatiConvenzione",
  "DatiRicezione",
  "DatiFattureCollegate",
  "DatiSAL",
  "DatiDDT",
  "DatiRitenuta",
  "DatiCassaPrevidenziale",
  "ScontoMaggiorazione",
  "Causale",
  "RiferimentoNumeroLinea",
  "DettaglioLinee",
  "CodiceArticolo",
  "AltriDatiGestionali",
  "DatiRiepilogo",
  "DatiPagamento",
  "DettaglioPagamento",
  "Allegati",
]);

const documentTypes: readonly DocumentType[] = ["TD01", "TD04", "TD05", "TD24"];
const lineKinds = Object.fromEntries(
  Object.entries(lineKindCodes).map(([kind, code]) => [code, kind]),
) as Record<string, InvoiceLine["kind"]>;
const paymentTerms: Record<string, Payment["terms"]> = {
  TP01: "installments",
  TP02: "full",
  TP03: "advance",
};

interface Node {
  name: string;
  attributes: Record<string, string>;
  children: Node[];
  /** Trimmed text content. */
  text: string;
  path: string;
  /** Read by the mapping. */
  used: boolean;
  /** Present but not representable in the builder's input. */
  flagged: boolean;
}

function join(path: string, name: string): string {
  return path ? `${path}.${name}` : name;
}

/** Copies the parsed tree, adding each element's path; iterative, so depth is no concern. */
function annotate(root: XmlElement): Node {
  const make = (element: XmlElement, path: string): Node => ({
    name: element.name,
    attributes: element.attributes,
    children: [],
    text: element.text.trim(),
    path,
    used: false,
    flagged: false,
  });
  const top = make(root, "");
  const stack: [XmlElement, Node][] = [[root, top]];
  while (stack.length) {
    const [element, node] = stack.pop()!;
    const counts = new Map<string, number>();
    for (const child of element.children) {
      const index = counts.get(child.name) ?? 0;
      counts.set(child.name, index + 1);
      const name = repeatable.has(child.name)
        ? `${child.name}[${index}]`
        : child.name;
      const copy = make(child, join(node.path, name));
      node.children.push(copy);
      stack.push([child, copy]);
    }
  }
  return top;
}

/** Paths of the elements under `start` that were not read or are flagged, in document order. */
function unread(start: Node, skip: Set<Node> = new Set()): string[] {
  const paths: string[] = [];
  const stack = [...start.children].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (skip.has(node)) continue;
    if (!node.used || node.flagged) {
      paths.push(node.path);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push(node.children[i]!);
  }
  return paths;
}

const decimalPattern = /^([-+]?)(\d+)(?:\.(\d+))?$/;

/** Parses a decimal into cents, rounding half away from zero; undefined when invalid. */
function toCents(
  text: string,
  maxDecimals: number,
): { cents: number; exact: boolean } | undefined {
  const match = decimalPattern.exec(text);
  if (!match) return;
  const decimals = match[3] ?? "";
  if (decimals.length > maxDecimals) return;
  const scaled = BigInt(match[2]! + decimals) * 100n;
  const denominator = 10n ** BigInt(decimals.length);
  const rounded = divideRounded(scaled, denominator);
  const cents = Number(match[1] === "-" ? -rounded : rounded);
  if (!Number.isSafeInteger(cents)) return;
  return { cents, exact: scaled % denominator === 0n };
}

/** Reads the element tree, collecting issues and marking what it consumes. */
class Reader {
  readonly issues: ValidationIssue[] = [];

  issue(path: string, message: string) {
    this.issues.push({ path, message });
  }

  /** Marks an element as present but not representable. */
  flag(node: Node) {
    node.used = true;
    node.flagged = true;
  }

  child(
    parent: Node | undefined,
    name: string,
    required = false,
  ): Node | undefined {
    if (!parent) return undefined;
    const found = parent.children.find((c) => c.name === name);
    if (found) found.used = true;
    else if (required) this.issue(join(parent.path, name), "is required");
    return found;
  }

  all(parent: Node | undefined, name: string): Node[] {
    const found = parent?.children.filter((c) => c.name === name) ?? [];
    for (const node of found) node.used = true;
    return found;
  }

  /** Text of an optional child; undefined when absent or empty. */
  text(parent: Node | undefined, name: string): string | undefined {
    return this.child(parent, name)?.text || undefined;
  }

  /** Text of a required child; "" (with an issue) when absent or empty. */
  required(parent: Node | undefined, name: string): string {
    const node = this.child(parent, name, true);
    if (node && !node.text) this.issue(node.path, "is empty");
    return node?.text ?? "";
  }

  /** An amount with at most 2 decimals, in cents. */
  amount(node: Node | undefined): number | undefined {
    if (!node) return undefined;
    const parsed = toCents(node.text, 2);
    if (!parsed)
      this.issue(
        node.path,
        `must be an amount with at most 2 decimals, found "${node.text}"`,
      );
    return parsed?.cents;
  }

  amountOf(parent: Node | undefined, name: string, required = false) {
    return this.amount(this.child(parent, name, required));
  }

  /**
   * A unit price with up to 8 decimals, rounded to the cent; flagged when it is not a whole
   * number of cents, since the builder works in cents.
   */
  price(node: Node | undefined): number | undefined {
    if (!node) return undefined;
    const parsed = toCents(node.text, 8);
    if (!parsed)
      this.issue(
        node.path,
        `must be an amount with at most 8 decimals, found "${node.text}"`,
      );
    else if (!parsed.exact) this.flag(node);
    return parsed?.cents;
  }

  /** A non-negative percentage with at most 2 decimals, e.g. "22.00" → 22. */
  rate(node: Node | undefined): number | undefined {
    if (!node) return undefined;
    const parsed = toCents(node.text, 2);
    if (!parsed || parsed.cents < 0) {
      this.issue(
        node.path,
        `must be a percentage with at most 2 decimals, found "${node.text}"`,
      );
      return undefined;
    }
    return parsed.cents / 100;
  }

  rateOf(parent: Node | undefined, name: string, required = false) {
    return this.rate(this.child(parent, name, required));
  }

  /** A code as written; flagged when the builder does not know it. */
  code<T extends string>(
    parent: Node | undefined,
    name: string,
    codes: readonly T[],
    required = false,
  ): T | undefined {
    const node = this.child(parent, name, required);
    if (!node) return undefined;
    if (!codes.includes(node.text as T)) this.flag(node);
    return node.text as T;
  }

  /** IdFiscaleIVA-like element: IdPaese and IdCodice. */
  fiscalId(
    parent: Node | undefined,
    name: string,
    required = false,
  ): { country: string; code: string; node: Node } | undefined {
    const node = this.child(parent, name, required);
    if (!node) return undefined;
    return {
      country: this.required(node, "IdPaese"),
      code: this.required(node, "IdCodice"),
      node,
    };
  }

  /** Denominazione, or Nome and Cognome joined (flagged: the builder writes Denominazione). */
  personName(parent: Node | undefined): string {
    if (!parent) return "";
    const denomination = this.child(parent, "Denominazione");
    if (denomination) return this.required(parent, "Denominazione");
    const first = this.child(parent, "Nome");
    const last = this.child(parent, "Cognome");
    if (!first && !last) {
      this.issue(join(parent.path, "Denominazione"), "is required");
      return "";
    }
    for (const node of [first, last]) if (node) this.flag(node);
    return [first?.text, last?.text].filter(Boolean).join(" ");
  }

  anagrafica(parent: Node | undefined): string {
    return this.personName(this.child(parent, "Anagrafica", true));
  }

  address(
    parent: Node | undefined,
    name: string,
    required = false,
  ): Address | undefined {
    const node = this.child(parent, name, required);
    if (!node) return undefined;
    const street = this.required(node, "Indirizzo");
    const streetNumber = this.text(node, "NumeroCivico");
    const postalCode = this.child(node, "CAP", true);
    const city = this.required(node, "Comune");
    const province = this.child(node, "Provincia");
    const country = this.required(node, "Nazione");
    const address: Address = { street, city, country };
    if (streetNumber) address.streetNumber = streetNumber;
    if (country === "IT") {
      if (postalCode) address.postalCode = postalCode.text;
      if (province) address.province = province.text;
    } else {
      // The builder writes CAP 00000 abroad and keeps a foreign postal code with the city.
      if (postalCode && postalCode.text !== "00000") this.flag(postalCode);
      if (province) this.flag(province);
    }
    return address;
  }
}

interface Header {
  format: TransmissionFormat;
  transmitter: Transmitter;
  seller: Seller;
  buyer: Buyer;
  issuer?: ThirdPartyIssuer;
}

function readHeader(
  r: Reader,
  header: Node | undefined,
  format: TransmissionFormat,
): Header {
  const transmission = r.child(header, "DatiTrasmissione", true);
  const transmitterId = r.fiscalId(transmission, "IdTrasmittente", true);
  const transmitter: Transmitter = {
    country: transmitterId?.country ?? "IT",
    code: transmitterId?.code ?? "",
    sequence: r.required(transmission, "ProgressivoInvio"),
  };
  const formatNode = r.child(transmission, "FormatoTrasmissione", true);
  if (formatNode && formatNode.text !== format) r.flag(formatNode);
  const recipientCode = r.required(transmission, "CodiceDestinatario");
  const pec = r.text(transmission, "PECDestinatario");

  const supplier = r.child(header, "CedentePrestatore", true);
  const supplierData = r.child(supplier, "DatiAnagrafici", true);
  const supplierId = r.fiscalId(supplierData, "IdFiscaleIVA", true);
  // The builder writes the seller's Partita IVA as Italian.
  if (supplierId && supplierId.country !== "IT")
    r.flag(r.child(supplierId.node, "IdPaese")!);
  const seller: Seller = {
    vatNumber: supplierId?.code ?? "",
    name: "",
    taxRegime: "RF01",
    address: { street: "", city: "" },
  };
  const sellerFiscalCode = r.text(supplierData, "CodiceFiscale");
  if (sellerFiscalCode) seller.fiscalCode = sellerFiscalCode;
  seller.name = r.anagrafica(supplierData);
  seller.taxRegime =
    r.code(supplierData, "RegimeFiscale", taxRegimes, true) ?? "RF01";
  seller.address = r.address(supplier, "Sede", true) ?? seller.address;
  const sellerEstablishment = r.address(supplier, "StabileOrganizzazione");
  if (sellerEstablishment) seller.permanentEstablishment = sellerEstablishment;

  const representative = r.child(header, "RappresentanteFiscale");
  if (representative) {
    const data = r.child(representative, "DatiAnagrafici", true);
    const id = r.fiscalId(data, "IdFiscaleIVA", true);
    const fiscalCode = r.text(data, "CodiceFiscale");
    seller.fiscalRepresentative = {
      vatNumber: id?.code ?? "",
      vatCountry: id?.country ?? "IT",
      ...(fiscalCode && { fiscalCode }),
      name: r.anagrafica(data),
    };
  }

  const customer = r.child(header, "CessionarioCommittente", true);
  const customerData = r.child(customer, "DatiAnagrafici", true);
  const customerId = r.fiscalId(customerData, "IdFiscaleIVA");
  const buyerFiscalCode = r.text(customerData, "CodiceFiscale");
  const buyer: Buyer = {
    ...(customerId && {
      vatNumber: customerId.code,
      vatCountry: customerId.country,
    }),
    ...(buyerFiscalCode && { fiscalCode: buyerFiscalCode }),
    name: r.anagrafica(customerData),
    address: r.address(customer, "Sede", true) ?? { street: "", city: "" },
    recipientCode,
    ...(pec && { pec }),
  };
  const buyerEstablishment = r.address(customer, "StabileOrganizzazione");
  if (buyerEstablishment) buyer.permanentEstablishment = buyerEstablishment;
  const buyerRepresentative = r.child(customer, "RappresentanteFiscale");
  if (buyerRepresentative) {
    const id = r.fiscalId(buyerRepresentative, "IdFiscaleIVA", true);
    buyer.fiscalRepresentative = {
      vatNumber: id?.code ?? "",
      vatCountry: id?.country ?? "IT",
      name: r.personName(buyerRepresentative),
    };
  }

  // The builder renders a third party only as the issuer (SoggettoEmittente TZ), with an
  // Italian Partita IVA.
  const thirdParty = r.child(header, "TerzoIntermediarioOSoggettoEmittente");
  const issuedBy = r.child(header, "SoggettoEmittente");
  let issuer: ThirdPartyIssuer | undefined;
  if (thirdParty && issuedBy?.text === "TZ") {
    const data = r.child(thirdParty, "DatiAnagrafici", true);
    const id = r.fiscalId(data, "IdFiscaleIVA");
    if (!id) r.flag(thirdParty);
    else {
      if (id.country !== "IT") r.flag(r.child(id.node, "IdPaese")!);
      const fiscalCode = r.text(data, "CodiceFiscale");
      issuer = {
        vatNumber: id.code,
        ...(fiscalCode && { fiscalCode }),
        name: r.anagrafica(data),
      };
    }
  } else {
    if (thirdParty) r.flag(thirdParty);
    if (issuedBy) r.flag(issuedBy);
  }

  return { format, transmitter, seller, buyer, ...(issuer && { issuer }) };
}

function readReference(r: Reader, node: Node): DocumentReference {
  const lineNumbers = r.all(node, "RiferimentoNumeroLinea").map((n) => {
    if (!/^\d{1,4}$/.test(n.text))
      r.issue(n.path, `must be a line number, found "${n.text}"`);
    return Number(n.text);
  });
  const reference: DocumentReference = { id: r.required(node, "IdDocumento") };
  const date = r.text(node, "Data");
  if (date) reference.date = date;
  if (lineNumbers.length) reference.lineNumbers = lineNumbers;
  const itemCode = r.text(node, "CodiceCommessaConvenzione");
  if (itemCode) reference.itemCode = itemCode;
  const cup = r.text(node, "CodiceCUP");
  if (cup) reference.cup = cup;
  const cig = r.text(node, "CodiceCIG");
  if (cig) reference.cig = cig;
  return reference;
}

function readLineAdjustment(r: Reader, node: Node): PriceAdjustment {
  const type = r.child(node, "Tipo", true);
  const percentNode = r.child(node, "Percentuale");
  const amountNode = r.child(node, "Importo");
  const adjustment: PriceAdjustment = {};
  if (type?.text === "MG") adjustment.kind = "surcharge";
  else if (type && type.text !== "SC") r.flag(type);
  if (percentNode) {
    adjustment.percent = r.rate(percentNode) ?? 0;
    // The builder takes a percentage or an amount, not both.
    if (amountNode) r.flag(amountNode);
  } else if (amountNode) adjustment.amountCents = r.price(amountNode) ?? 0;
  else r.flag(node);
  return adjustment;
}

function readLine(
  r: Reader,
  node: Node,
  index: number,
): { line: InvoiceLine; lineTotalCents: number } {
  const lineNumber = r.child(node, "NumeroLinea", true);
  if (lineNumber && lineNumber.text !== String(index + 1)) r.flag(lineNumber);
  const kindNode = r.child(node, "TipoCessionePrestazione");
  const kind = kindNode && lineKinds[kindNode.text];
  if (kindNode && !kind) r.flag(kindNode);
  const line: InvoiceLine = {
    ...(kind && { kind }),
    description: r.required(node, "Descrizione"),
    unitPriceCents: 0,
    vatRate: 0,
  };
  const quantityNode = r.child(node, "Quantita");
  if (quantityNode) {
    const quantity = parseQuantity(quantityNode.text);
    if (quantity === undefined) {
      r.flag(quantityNode);
      line.quantity = quantityNode.text;
    } else line.quantity = formatQuantity(quantity);
  }
  const unit = r.text(node, "UnitaMisura");
  if (unit) line.unit = unit;
  line.unitPriceCents = r.price(r.child(node, "PrezzoUnitario", true)) ?? 0;
  const adjustments = r
    .all(node, "ScontoMaggiorazione")
    .map((n) => readLineAdjustment(r, n));
  if (adjustments.length) line.adjustments = adjustments;
  const lineTotalCents = r.amountOf(node, "PrezzoTotale", true) ?? 0;
  line.vatRate = r.rateOf(node, "AliquotaIVA", true) ?? 0;
  const withholding = r.child(node, "Ritenuta");
  if (withholding?.text === "SI") line.withholding = true;
  else if (withholding) r.flag(withholding);
  const nature = r.code(node, "Natura", natures);
  if (nature) line.nature = nature;
  return { line, lineTotalCents };
}

interface PaymentDetail {
  method: PaymentMethod;
  amountCents: number;
  dueDate?: string;
  beneficiary?: string;
  bank?: string;
  iban?: string;
}

function readPaymentDetail(r: Reader, node: Node): PaymentDetail {
  const beneficiary = r.text(node, "Beneficiario");
  const method =
    r.code(node, "ModalitaPagamento", paymentMethods, true) ?? "MP05";
  const dueDate = r.text(node, "DataScadenzaPagamento");
  const amountCents = r.amountOf(node, "ImportoPagamento", true) ?? 0;
  const bank = r.text(node, "IstitutoFinanziario");
  const iban = r.text(node, "IBAN");
  return {
    method,
    amountCents,
    ...(dueDate && { dueDate }),
    ...(beneficiary && { beneficiary }),
    ...(bank && { bank }),
    ...(iban && { iban }),
  };
}

function readPayment(
  r: Reader,
  blocks: Node[],
  declared: DeclaredTotals["payments"],
): Payment | undefined {
  let payment: Payment | undefined;
  blocks.forEach((block, index) => {
    const termsNode = r.child(block, "CondizioniPagamento", true);
    const detailNodes = r.all(block, "DettaglioPagamento");
    if (!detailNodes.length)
      r.issue(join(block.path, "DettaglioPagamento[0]"), "is required");
    const details = detailNodes.map((n) => readPaymentDetail(r, n));
    for (const { method, dueDate, amountCents } of details)
      declared.push({ method, ...(dueDate && { dueDate }), amountCents });
    // The builder renders a single DatiPagamento.
    if (index > 0) return r.flag(block);
    let terms = termsNode && paymentTerms[termsNode.text];
    if (termsNode && !terms) r.flag(termsNode);
    const [first] = details;
    if (!first) return;
    if (details.length === 1) {
      // Instalment terms need at least two instalments in the builder.
      if (terms === "installments") {
        r.flag(termsNode!);
        terms = undefined;
      }
      const { amountCents: _amount, ...rest } = first;
      payment = { ...rest, ...(terms && { terms }) };
    } else
      payment = {
        method: first.method,
        ...(terms && { terms }),
        installments: details.map((d): Installment => ({
          ...(d.dueDate && { dueDate: d.dueDate }),
          amountCents: d.amountCents,
          method: d.method,
          ...(d.iban && { iban: d.iban }),
          ...(d.bank && { bank: d.bank }),
          ...(d.beneficiary && { beneficiary: d.beneficiary }),
        })),
      };
  });
  return payment;
}

function readBody(
  r: Reader,
  body: Node,
  header: Header,
): Omit<ReceivedInvoice, "unsupported"> {
  const general = r.child(body, "DatiGenerali", true);
  const document = r.child(general, "DatiGeneraliDocumento", true);
  const type = r.code(document, "TipoDocumento", documentTypes, true) ?? "TD01";
  const currency = r.child(document, "Divisa", true);
  if (currency && currency.text !== "EUR") r.flag(currency);
  const date = r.required(document, "Data");
  const number = r.required(document, "Numero");

  const declared: DeclaredTotals = {
    lines: [],
    summary: [],
    stampDutyCents: 0,
    withholdings: [],
    pensionFunds: [],
    payments: [],
  };

  const withholdings = r.all(document, "DatiRitenuta").map((node) => {
    const withholding: Withholding = {
      type: r.code(node, "TipoRitenuta", withholdingTypes, true) ?? "RT01",
      rate: 0,
      reason: "A",
    };
    const amountCents = r.amountOf(node, "ImportoRitenuta", true) ?? 0;
    withholding.rate = r.rateOf(node, "AliquotaRitenuta", true) ?? 0;
    withholding.reason =
      r.code(node, "CausalePagamento", paymentReasons, true) ?? "A";
    declared.withholdings.push({ ...withholding, amountCents });
    return withholding;
  });

  const stamp = r.child(document, "DatiBollo");
  if (stamp) {
    const virtual = r.child(stamp, "BolloVirtuale", true);
    if (virtual && virtual.text !== "SI") r.flag(virtual);
    const amount = r.child(stamp, "ImportoBollo");
    declared.stampDutyCents = r.amount(amount) ?? 0;
    // The builder always declares the €2.00 duty.
    if (declared.stampDutyCents !== 200) r.flag(stamp);
  }

  const pensionFunds = r.all(document, "DatiCassaPrevidenziale").map((node) => {
    const type = r.code(node, "TipoCassa", pensionFundTypes, true) ?? "TC01";
    const rate = r.rateOf(node, "AlCassa", true) ?? 0;
    const contributionCents =
      r.amountOf(node, "ImportoContributoCassa", true) ?? 0;
    const taxableCents = r.amountOf(node, "ImponibileCassa");
    const vatRate = r.rateOf(node, "AliquotaIVA", true) ?? 0;
    const withholdingNode = r.child(node, "Ritenuta");
    const withholding = withholdingNode?.text === "SI";
    if (withholdingNode && !withholding) r.flag(withholdingNode);
    const nature = r.code(node, "Natura", natures);
    const reference = r.text(node, "RiferimentoAmministrazione");
    declared.pensionFunds.push({
      type,
      rate,
      ...(taxableCents !== undefined && { taxableCents }),
      contributionCents,
      vatRate,
      ...(nature && { nature }),
      withholding,
    });
    const fund: PensionFund = { type, rate, vatRate };
    if (nature) fund.nature = nature;
    if (withholding) fund.withholding = true;
    if (taxableCents !== undefined) fund.taxableCents = taxableCents;
    if (reference) fund.reference = reference;
    return fund;
  });

  declared.totalCents = r.amountOf(document, "ImportoTotaleDocumento");
  if (declared.totalCents === undefined) delete declared.totalCents;
  const rounding = r.child(document, "Arrotondamento");
  if (rounding) {
    declared.roundingCents = r.amount(rounding);
    r.flag(rounding);
  }
  const description = r
    .all(document, "Causale")
    .map((n) => n.text)
    .filter(Boolean)
    .join(" ");

  const references = (name: string) =>
    r.all(general, name).map((n) => readReference(r, n));
  const orderReference = references("DatiOrdineAcquisto");
  const contractReference = references("DatiContratto");
  const agreementReference = references("DatiConvenzione");
  const receiptReference = references("DatiRicezione");
  const linkedInvoices: { number: string; date: string }[] = [];
  for (const node of r.all(general, "DatiFattureCollegate")) {
    const linkedNumber = r.required(node, "IdDocumento");
    const linkedDate = r.text(node, "Data");
    // The builder needs the date of a linked invoice.
    if (linkedDate)
      linkedInvoices.push({ number: linkedNumber, date: linkedDate });
    else r.flag(node);
  }

  const goods = r.child(body, "DatiBeniServizi", true);
  const lineNodes = r.all(goods, "DettaglioLinee");
  if (goods && !lineNodes.length)
    r.issue(join(goods.path, "DettaglioLinee[0]"), "is required");
  const lines = lineNodes.map((node, index) => {
    const { line, lineTotalCents } = readLine(r, node, index);
    declared.lines.push({ lineTotalCents });
    return line;
  });

  const summaryNodes = r.all(goods, "DatiRiepilogo");
  if (goods && !summaryNodes.length)
    r.issue(join(goods.path, "DatiRiepilogo[0]"), "is required");
  let vatExigibility: InvoiceInput["vatExigibility"];
  for (const node of summaryNodes) {
    const vatRate = r.rateOf(node, "AliquotaIVA", true) ?? 0;
    const nature = r.code(node, "Natura", natures);
    const taxableCents = r.amountOf(node, "ImponibileImporto", true) ?? 0;
    const vatCents = r.amountOf(node, "Imposta", true) ?? 0;
    const exigibilityNode = r.child(node, "EsigibilitaIVA");
    const legalReferenceNode = r.child(node, "RiferimentoNormativo");
    const entry: DeclaredTotals["summary"][number] = {
      vatRate,
      ...(nature && { nature }),
      taxableCents,
      vatCents,
    };
    if (legalReferenceNode?.text) {
      entry.legalReference = legalReferenceNode.text;
      // The builder takes the group's legal reference from its first line that has one.
      const line = lines.find(
        (l) => l.vatRate === vatRate && l.nature === nature,
      );
      if (line) line.legalReference = legalReferenceNode.text;
      else r.flag(legalReferenceNode);
    }
    if (exigibilityNode) {
      const exigibility = exigibilityNode.text;
      if (exigibility === "I" || exigibility === "D" || exigibility === "S") {
        entry.exigibility = exigibility;
        // The builder writes one exigibility, on the groups without a nature.
        if (nature || (vatExigibility && vatExigibility !== exigibility))
          r.flag(exigibilityNode);
        else vatExigibility = exigibility;
      } else r.flag(exigibilityNode);
    }
    declared.summary.push(entry);
  }

  const payment = readPayment(
    r,
    r.all(body, "DatiPagamento"),
    declared.payments,
  );

  const attachments = r.all(body, "Allegati").map((node) => {
    // Attachments are returned apart: buildInvoice does not render them.
    r.flag(node);
    const name = r.required(node, "NomeAttachment");
    r.child(node, "AlgoritmoCompressione");
    const format = r.text(node, "FormatoAttachment");
    const description = r.text(node, "DescrizioneAttachment");
    const content = r.child(node, "Attachment", true);
    const data = content ? decodeBase64(content.text) : undefined;
    if (content && !data) r.issue(content.path, "is not valid base64");
    const attachment: InvoiceAttachment = {
      name,
      data: data ?? new Uint8Array(),
    };
    if (format) attachment.format = format;
    if (description) attachment.description = description;
    return attachment;
  });

  const input: InvoiceInput = {
    format: header.format,
    type,
    number,
    date,
    seller: structuredClone(header.seller),
    buyer: structuredClone(header.buyer),
    transmitter: structuredClone(header.transmitter),
    lines,
    stampDuty: stamp !== undefined,
  };
  if (header.issuer) input.issuer = structuredClone(header.issuer);
  if (pensionFunds.length) input.pensionFunds = pensionFunds;
  if (withholdings.length) input.withholdings = withholdings;
  if (vatExigibility && vatExigibility !== "I")
    input.vatExigibility = vatExigibility;
  if (description) input.description = description;
  if (orderReference.length) input.orderReference = orderReference;
  if (contractReference.length) input.contractReference = contractReference;
  if (agreementReference.length) input.agreementReference = agreementReference;
  if (receiptReference.length) input.receiptReference = receiptReference;
  if (linkedInvoices.length) input.linkedInvoices = linkedInvoices;
  if (payment) input.payment = payment;
  return { input, declared, attachments };
}

function fileError(message: string): FatturaPAError {
  return new FatturaPAError([{ path: "file", message }]);
}

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** Decodes base64 text of a .p7m and unwraps CAdES envelopes, down to the XML bytes. */
function unwrap(input: Uint8Array): Uint8Array {
  let bytes = input;
  let start = 0;
  while (isWhitespace(bytes[start])) start++;
  // Base64 of DER starts with "M" (0x30 is 001100 in its first six bits).
  if (bytes[start] === 0x4d) {
    const decoded = decodeBase64(new TextDecoder().decode(bytes));
    if (!decoded || decoded[0] !== 0x30)
      throw fileError("is neither XML nor a signed .p7m file");
    bytes = decoded;
  }
  for (let depth = 0; bytes[0] === 0x30; depth++) {
    if (depth === 3) throw fileError("has too many nested signatures");
    try {
      bytes = extractSignedContent(bytes);
    } catch (error) {
      if (error instanceof EnvelopeError)
        throw fileError(`is not a readable .p7m file: ${error.message}`);
      throw error;
    }
  }
  return bytes;
}

/** Decodes XML bytes with their BOM or the encoding of their XML declaration. */
function decodeXml(bytes: Uint8Array): string {
  let label = "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
  else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    const head = String.fromCharCode(...bytes.subarray(0, 200));
    const declared =
      /^[ \t\r\n]*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z][A-Za-z0-9._-]*)["']/.exec(
        head,
      );
    if (declared) label = declared[1]!;
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal: true });
  } catch {
    throw fileError(`uses an unsupported encoding "${label}"`);
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw fileError(`is not valid ${label} text`);
  }
}

function readDocument(file: string | Uint8Array): XmlElement {
  let text: string;
  if (typeof file === "string") {
    const first = file.search(/[^ \t\r\n﻿]/);
    text =
      file[first] === "M"
        ? decodeXml(unwrap(new TextEncoder().encode(file)))
        : file;
  } else text = decodeXml(unwrap(file));
  try {
    return parseXml(text);
  } catch (error) {
    if (error instanceof XmlSyntaxError)
      throw fileError(`is not well-formed XML: ${error.message}`);
    throw error;
  }
}

/**
 * Reads a received FatturaPA file: XML (as text or bytes) or a CAdES-signed .p7m, binary or
 * base64. The signature is not verified. Returns each invoice of the file mapped to the
 * builder's input, with the amounts as declared and the attachments. Throws FatturaPAError when
 * the file is not a FatturaPA FPR12/FPA12 document, is malformed, misses a required element or
 * has an unparsable amount, with the element paths.
 */
export function parseInvoice(file: string | Uint8Array): ParsedInvoiceFile {
  const root = annotate(readDocument(file));
  if (root.name !== "FatturaElettronica")
    throw new FatturaPAError([
      {
        path: root.name,
        message:
          "is not a FatturaPA document: the root element must be FatturaElettronica",
      },
    ]);
  const format = root.attributes.versione;
  if (format !== "FPR12" && format !== "FPA12")
    throw new FatturaPAError([
      {
        path: "FatturaElettronica@versione",
        message:
          format === undefined
            ? "is required"
            : `must be FPR12 or FPA12, found "${format}"`,
      },
    ]);
  root.used = true;
  const r = new Reader();
  // An enveloped XAdES signature is not part of the invoice; it is not verified.
  r.child(root, "Signature");
  const headerNode = r.child(root, "FatturaElettronicaHeader", true);
  const bodies = r.all(root, "FatturaElettronicaBody");
  if (!bodies.length) r.issue("FatturaElettronicaBody[0]", "is required");
  const header = readHeader(r, headerNode, format);
  const invoices = bodies.map((body) => readBody(r, body, header));
  if (r.issues.length) throw new FatturaPAError(r.issues);
  const shared = unread(root, new Set(bodies));
  return {
    format,
    invoices: invoices.map((invoice, index) => ({
      ...invoice,
      unsupported: [...shared, ...unread(bodies[index]!)],
    })),
  };
}
