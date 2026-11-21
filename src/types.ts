/** FatturaPA document types supported by this module (Allegato A, TipoDocumento). */
export type DocumentType =
  /** Invoice. */
  | "TD01"
  /** Credit note. */
  | "TD04"
  /** Debit note. */
  | "TD05"
  /** Deferred invoice (art. 21, comma 4, lett. a, DPR 633/72). */
  | "TD24";

/**
 * FatturaPA transmission format: FPR12 for businesses and consumers, FPA12 for public
 * administrations.
 */
export type TransmissionFormat = "FPR12" | "FPA12";

export const taxRegimes = [
  "RF01",
  "RF02",
  "RF04",
  "RF05",
  "RF06",
  "RF07",
  "RF08",
  "RF09",
  "RF10",
  "RF11",
  "RF12",
  "RF13",
  "RF14",
  "RF15",
  "RF16",
  "RF17",
  "RF18",
  "RF19",
] as const;
/** RegimeFiscale: RF01 is the ordinary regime, RF19 the flat-rate (forfettario) regime. */
export type TaxRegime = (typeof taxRegimes)[number];

export const natures = [
  "N1",
  "N2.1",
  "N2.2",
  "N3.1",
  "N3.2",
  "N3.3",
  "N3.4",
  "N3.5",
  "N3.6",
  "N4",
  "N5",
  "N6.1",
  "N6.2",
  "N6.3",
  "N6.4",
  "N6.5",
  "N6.6",
  "N6.7",
  "N6.8",
  "N6.9",
  "N7",
] as const;
/** Natura: why a line carries no VAT. The generic N2, N3 and N6 codes are rejected by SDI since 2021. */
export type Nature = (typeof natures)[number];

export const paymentMethods = [
  "MP01",
  "MP02",
  "MP03",
  "MP04",
  "MP05",
  "MP06",
  "MP07",
  "MP08",
  "MP09",
  "MP10",
  "MP11",
  "MP12",
  "MP13",
  "MP14",
  "MP15",
  "MP16",
  "MP17",
  "MP18",
  "MP19",
  "MP20",
  "MP21",
  "MP22",
  "MP23",
] as const;
/** ModalitaPagamento: MP05 is a bank transfer (bonifico). */
export type PaymentMethod = (typeof paymentMethods)[number];

export const withholdingTypes = [
  "RT01",
  "RT02",
  "RT03",
  "RT04",
  "RT05",
  "RT06",
] as const;
/**
 * TipoRitenuta: RT01 withholding on individuals, RT02 on companies, RT03 INPS contribution,
 * RT04 ENASARCO contribution, RT05 ENPAM contribution, RT06 other social security contribution.
 */
export type WithholdingType = (typeof withholdingTypes)[number];

export const paymentReasons = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "G",
  "H",
  "I",
  "L",
  "L1",
  "M",
  "M1",
  "M2",
  "N",
  "O",
  "O1",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "V1",
  "W",
  "X",
  "Y",
  "Z",
  "ZO",
] as const;
/**
 * CausalePagamento: the reason code of the payment in the withholding agent's return (modello
 * 770). A is professional work, Q and R are sales agents' commissions.
 */
export type PaymentReason = (typeof paymentReasons)[number];

export const pensionFundTypes = [
  "TC01",
  "TC02",
  "TC03",
  "TC04",
  "TC05",
  "TC06",
  "TC07",
  "TC08",
  "TC09",
  "TC10",
  "TC11",
  "TC12",
  "TC13",
  "TC14",
  "TC15",
  "TC16",
  "TC17",
  "TC18",
  "TC19",
  "TC20",
  "TC21",
  "TC22",
] as const;
/**
 * TipoCassa: the professional pension fund, e.g. TC01 lawyers, TC04 engineers and architects,
 * TC22 INPS (the 4% rivalsa of the gestione separata).
 */
export type PensionFundType = (typeof pensionFundTypes)[number];

export interface Address {
  /** Street, without the civic number when `streetNumber` is given. */
  street: string;
  streetNumber?: string;
  /**
   * Five-digit CAP for Italian addresses. Foreign postal codes do not fit the CAP field, which
   * is set to "00000"; they are printed with the city instead, and may be omitted.
   */
  postalCode?: string;
  city: string;
  /** Two-letter province code, e.g. "BS". */
  province?: string;
  /** ISO 3166-1 alpha-2 country, default "IT". */
  country?: string;
}

export interface Seller {
  /** Italian Partita IVA, 11 digits. */
  vatNumber: string;
  fiscalCode?: string;
  name: string;
  taxRegime: TaxRegime;
  address: Address;
}

export interface Buyer {
  /**
   * VAT number. For Italian buyers a Partita IVA; an Italian buyer needs a VAT number, a fiscal
   * code or both. For foreign buyers (address outside Italy) the foreign tax identifier,
   * required: the EU VAT number with or without its country prefix, or a conventional code
   * agreed with your accountant for buyers without one, e.g. "OO99999999999".
   */
  vatNumber?: string;
  /** Country that issued `vatNumber`, default the address country. */
  vatCountry?: string;
  /** Italian codice fiscale; not allowed for foreign buyers. */
  fiscalCode?: string;
  name: string;
  address: Address;
  /**
   * SDI recipient code (codice destinatario). FPR12: 7 characters, defaulting to "0000000" for
   * Italian buyers and "XXXXXXX" for foreign ones, the only code allowed for them. FPA12:
   * required, the 6-character codice univoco ufficio listed in IPA.
   */
  recipientCode?: string;
  /** Certified email (PEC), used only with FPR12 and recipient code "0000000". */
  pec?: string;
}

/** A third party issuing the invoice on the seller's behalf (SoggettoEmittente TZ). */
export interface ThirdPartyIssuer {
  vatNumber: string;
  fiscalCode?: string;
  name: string;
}

export interface Transmitter {
  /** Country of the transmitting subject's fiscal ID, default "IT". */
  country?: string;
  /** Fiscal ID of the subject transmitting to SDI: Partita IVA or codice fiscale. */
  code: string;
  /** Unique progressive of 1-5 letters or digits, used as ProgressivoInvio and in the file name. */
  sequence: string;
}

/**
 * A discount or surcharge on the unit price (ScontoMaggiorazione). Several apply in cascade, in
 * order: 10% then 5% leaves 85.5% of the price.
 */
export interface PriceAdjustment {
  /** Discount (SC, default) or surcharge (MG). */
  kind?: "discount" | "surcharge";
  /** Percentage of the running unit price with at most 2 decimals. Set this or `amountCents`. */
  percent?: number;
  /** Amount per unit in euro cents. Set this or `percent`. */
  amountCents?: number;
}

/**
 * A discount or surcharge on the whole invoice. It is applied to the sum of the line totals, in
 * cascade with the other document adjustments, and spread over the VAT rates in proportion to
 * their taxable amounts. Each share is rendered as a discount (SC) or surcharge (AC) line.
 */
export interface DocumentAdjustment {
  /** Discount (default) or surcharge. */
  kind?: "discount" | "surcharge";
  /** Percentage of the running taxable amount with at most 2 decimals. Set this or `amountCents`. */
  percent?: number;
  /** Total amount in euro cents, before VAT. Set this or `percent`. */
  amountCents?: number;
  /** Text of the generated lines, default "Sconto" or "Maggiorazione". */
  description?: string;
}

export interface InvoiceLine {
  description: string;
  /** Decimal quantity with up to 8 decimals. Omit for a single service or charge. */
  quantity?: number | string;
  /** Unit of measure, up to 10 characters (UnitaMisura). */
  unit?: string;
  /** Unit price before VAT in euro cents; may be negative for discount lines. */
  unitPriceCents: number;
  /** Discounts and surcharges on the unit price; the line total includes them. */
  adjustments?: PriceAdjustment[];
  /** VAT rate as a percentage, e.g. 10 or 22. Zero requires `nature`. */
  vatRate: number;
  nature?: Nature;
  /** Law reference printed in the VAT summary for zero-rated lines (RiferimentoNormativo). */
  legalReference?: string;
  /** The line is subject to the invoice's withholdings (Ritenuta SI). Requires `withholdings`. */
  withholding?: boolean;
}

/**
 * A withholding tax or contribution the buyer withholds and pays to the State on the seller's
 * behalf (DatiRitenuta). It applies to the lines with `withholding: true` and to the pension
 * fund contributions with `withholding: true`.
 */
export interface Withholding {
  type: WithholdingType;
  /** Withholding rate as a percentage above 0 and at most 100, with at most 2 decimals. */
  rate: number;
  /** CausalePagamento code, e.g. "A" for professional work. */
  reason: PaymentReason;
  /**
   * Share of the subject amount the rate applies to, as a percentage above 0 and at most 100
   * with at most 2 decimals; default 100. Sales agents are withheld on 50% (or 20%) of the
   * commission.
   */
  basePercent?: number;
}

/**
 * A professional pension fund contribution charged to the buyer (DatiCassaPrevidenziale). It
 * is added to the taxable amount of its VAT rate.
 */
export interface PensionFund {
  type: PensionFundType;
  /** Contribution rate (AlCassa) as a percentage above 0 and at most 100, e.g. 4. */
  rate: number;
  /** VAT rate on the contribution, usually the rate of the fee. Zero requires `nature`. */
  vatRate: number;
  nature?: Nature;
  /** The contribution is subject to the withholdings (Ritenuta SI), as INPS rivalsa is. */
  withholding?: boolean;
  /**
   * Amount the contribution is computed on (ImponibileCassa), in cents. Defaults to the taxable
   * amount of the lines and document adjustments.
   */
  taxableCents?: number;
  /** Administrative reference, up to 20 ASCII characters (RiferimentoAmministrazione). */
  reference?: string;
}

/**
 * A document the invoice refers to: a purchase order, contract, agreement or receipt
 * (DatiDocumentiCorrelati). Public administrations use it for the CIG and CUP codes.
 */
export interface DocumentReference {
  /** Document number, up to 20 ASCII characters (IdDocumento). */
  id: string;
  /** Document date, YYYY-MM-DD. */
  date?: string;
  /** Invoice lines the reference applies to, 1-based; omit when it covers the whole invoice. */
  lineNumbers?: number[];
  /** Order, contract or agreement code, up to 100 characters (CodiceCommessaConvenzione). */
  itemCode?: string;
  /** Codice Unico di Progetto, up to 15 ASCII characters (CodiceCUP). */
  cup?: string;
  /** Codice Identificativo Gara, up to 15 ASCII characters (CodiceCIG). */
  cig?: string;
}

export interface Payment {
  method: PaymentMethod;
  /** YYYY-MM-DD. */
  dueDate?: string;
  iban?: string;
  bank?: string;
  beneficiary?: string;
}

export interface InvoiceInput {
  /** Transmission format: FPR12 (default) for private recipients, FPA12 for public administrations. */
  format?: TransmissionFormat;
  type?: DocumentType;
  /** Invoice number, up to 20 ASCII characters with at least one digit, e.g. "12/MZ". */
  number: string;
  /** Issue date, YYYY-MM-DD. */
  date: string;
  seller: Seller;
  buyer: Buyer;
  issuer?: ThirdPartyIssuer;
  transmitter: Transmitter;
  lines: InvoiceLine[];
  /** Discounts and surcharges on the whole invoice, applied in order after the lines. */
  adjustments?: DocumentAdjustment[];
  /** Pension fund contributions, computed after the document adjustments. */
  pensionFunds?: PensionFund[];
  /** Withholding taxes and contributions, one per type. */
  withholdings?: Withholding[];
  /**
   * VAT exigibility: immediate (default), deferred or split payment. With split payment the
   * buyer pays the VAT to the Treasury, so the payable amount excludes it.
   */
  vatExigibility?: "I" | "D" | "S";
  /** Free text (Causale), split into 200-character elements. */
  description?: string;
  /** Buyer's purchase orders this invoice refers to (DatiOrdineAcquisto). */
  orderReference?: DocumentReference | DocumentReference[];
  /** Contracts this invoice refers to (DatiContratto). */
  contractReference?: DocumentReference | DocumentReference[];
  /** Framework agreements (convenzioni) this invoice refers to (DatiConvenzione). */
  agreementReference?: DocumentReference | DocumentReference[];
  /** Receipts of the goods or services this invoice refers to (DatiRicezione). */
  receiptReference?: DocumentReference | DocumentReference[];
  /** Invoices corrected by a credit or debit note (DatiFattureCollegate). */
  linkedInvoices?: { number: string; date: string }[];
  payment?: Payment;
  /**
   * Virtual stamp duty (bollo virtuale, €2). "auto" applies it when VAT-free amounts subject
   * to stamp duty exceed €77.47; the seller pays it unless it is added as a line.
   */
  stampDuty?: "auto" | boolean;
}

export interface VatSummary {
  vatRate: number;
  nature?: Nature;
  taxableCents: number;
  vatCents: number;
  legalReference?: string;
}

export interface InvoiceTotals {
  lines: { lineTotalCents: number }[];
  /** Lines generated from the document adjustments, in rendered order after `lines`. */
  adjustmentLines: {
    adjustmentIndex: number;
    vatRate: number;
    nature?: Nature;
    amountCents: number;
    /** Present when every line of its VAT group is subject to withholding (Ritenuta SI). */
    withholding?: true;
  }[];
  /** Pension fund contributions, in input order. */
  pensionFunds: {
    type: PensionFundType;
    /** Amount the contribution is computed on (ImponibileCassa). */
    taxableCents: number;
    contributionCents: number;
    vatRate: number;
    nature?: Nature;
  }[];
  /** Withholdings, in input order. */
  withholdings: {
    type: WithholdingType;
    rate: number;
    reason: PaymentReason;
    /** Amount the rate applies to: the subject amount times `basePercent`. */
    taxableCents: number;
    amountCents: number;
  }[];
  summary: VatSummary[];
  taxableCents: number;
  vatCents: number;
  /** Taxable amount plus VAT (ImportoTotaleDocumento), gross of withholdings. */
  totalCents: number;
  /** Sum of the withholdings. */
  withholdingCents: number;
  /**
   * Amount the buyer pays the seller (ImportoPagamento): the total less the withholdings, and
   * less the VAT with split payment.
   */
  payableCents: number;
  stampDutyCents: number;
}

export interface Invoice extends InvoiceTotals {
  xml: string;
  /** SDI file name, e.g. IT01234567890_00001.xml. */
  fileName: string;
}
