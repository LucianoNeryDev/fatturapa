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
   * SDI recipient code (codice destinatario), 7 characters. Defaults to "0000000" for Italian
   * buyers and "XXXXXXX" for foreign ones, the only code allowed for them.
   */
  recipientCode?: string;
  /** Certified email (PEC), used only with recipient code "0000000". */
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
  /** VAT exigibility: immediate (default), deferred or split payment. */
  vatExigibility?: "I" | "D" | "S";
  /** Free text (Causale), split into 200-character elements. */
  description?: string;
  /** Buyer's purchase order this invoice refers to (DatiOrdineAcquisto). */
  orderReference?: { id: string; date?: string };
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
  summary: VatSummary[];
  taxableCents: number;
  vatCents: number;
  /** Taxable amount plus VAT (ImportoTotaleDocumento). */
  totalCents: number;
  stampDutyCents: number;
}

export interface Invoice extends InvoiceTotals {
  xml: string;
  /** SDI file name, e.g. IT01234567890_00001.xml. */
  fileName: string;
}
