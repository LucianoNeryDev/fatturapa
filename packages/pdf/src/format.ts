/** Italian formatting of amounts, quantities and dates, and labels for FatturaPA codes. */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Integer cents in Italian format: 123456 → "1.234,56", -500 → "-5,00". */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${groupThousands(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, "0")}`;
}

/** An amount with the euro sign, for the totals: "€ 1.234,56". */
export function formatEuro(cents: number): string {
  return `€\u00a0${formatAmount(cents)}`;
}

/**
 * A decimal from the XML ("3.00", "1.25", "22.00") in Italian format without needless
 * trailing zeros: "3", "1,25", "22". Thousands are grouped.
 */
export function formatDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, whole, fraction = ""] = match;
  const decimals = fraction.replace(/0+$/, "");
  return `${sign}${groupThousands(whole!)}${decimals ? `,${decimals}` : ""}`;
}

/** Cents from an XML amount with two decimals ("1234.56" → 123456), parsed exactly. */
export function centsFromXml(value: string): number {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Unexpected amount in the XML: ${value}`);
  const cents = Number(match[2]) * 100 + Number(match[3]);
  return match[1] ? -cents : cents;
}

/** YYYY-MM-DD → dd/mm/yyyy. */
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** An IBAN in groups of four characters. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

export const documentTypes: Record<string, string> = {
  TD01: "Fattura",
  TD04: "Nota di credito",
  TD05: "Nota di debito",
  TD24: "Fattura differita",
};

export const taxRegimes: Record<string, string> = {
  RF01: "ordinario",
  RF02: "contribuenti minimi",
  RF04: "agricoltura e attività connesse e pesca",
  RF05: "vendita sali e tabacchi",
  RF06: "commercio fiammiferi",
  RF07: "editoria",
  RF08: "gestione servizi telefonia pubblica",
  RF09: "rivendita documenti di trasporto pubblico e di sosta",
  RF10: "intrattenimenti, giochi e altre attività",
  RF11: "agenzie viaggi e turismo",
  RF12: "agriturismo",
  RF13: "vendite a domicilio",
  RF14: "rivendita beni usati, oggetti d'arte, antiquariato o da collezione",
  RF15: "agenzie di vendite all'asta",
  RF16: "IVA per cassa P.A.",
  RF17: "IVA per cassa",
  RF18: "altro",
  RF19: "forfettario",
};

export const paymentTerms: Record<string, string> = {
  TP01: "Pagamento a rate",
  TP02: "Pagamento completo",
  TP03: "Anticipo",
};

export const paymentMethods: Record<string, string> = {
  MP01: "Contanti",
  MP02: "Assegno",
  MP03: "Assegno circolare",
  MP04: "Contanti presso Tesoreria",
  MP05: "Bonifico",
  MP06: "Vaglia cambiario",
  MP07: "Bollettino bancario",
  MP08: "Carta di pagamento",
  MP09: "RID",
  MP10: "RID utenze",
  MP11: "RID veloce",
  MP12: "RIBA",
  MP13: "MAV",
  MP14: "Quietanza erario",
  MP15: "Giroconto su conti di contabilità speciale",
  MP16: "Domiciliazione bancaria",
  MP17: "Domiciliazione postale",
  MP18: "Bollettino di c/c postale",
  MP19: "SEPA Direct Debit",
  MP20: "SEPA Direct Debit CORE",
  MP21: "SEPA Direct Debit B2B",
  MP22: "Trattenuta su somme già riscosse",
  MP23: "PagoPA",
};

/** "Bonifico (MP05)", or the bare code when it has no label. */
export function paymentMethod(code: string): string {
  const label = paymentMethods[code];
  return label ? `${label} (${code})` : code;
}

export const withholdingTypes: Record<string, string> = {
  RT01: "Ritenuta d'acconto persone fisiche",
  RT02: "Ritenuta d'acconto persone giuridiche",
  RT03: "Contributo INPS",
  RT04: "Contributo ENASARCO",
  RT05: "Contributo ENPAM",
  RT06: "Altro contributo previdenziale",
};

export const pensionFunds: Record<string, string> = {
  TC01: "Cassa Forense",
  TC02: "Cassa dottori commercialisti",
  TC03: "Cassa geometri",
  TC04: "Inarcassa",
  TC05: "Cassa del notariato",
  TC06: "Cassa ragionieri e periti commerciali",
  TC07: "ENASARCO",
  TC08: "ENPACL",
  TC09: "ENPAM",
  TC10: "ENPAF",
  TC11: "ENPAV",
  TC12: "ENPAIA",
  TC13: "Fondo spedizionieri e agenzie marittime",
  TC14: "INPGI",
  TC15: "ONAOSI",
  TC16: "CASAGIT",
  TC17: "EPPI",
  TC18: "EPAP",
  TC19: "ENPAB",
  TC20: "ENPAPI",
  TC21: "ENPAP",
  TC22: "INPS",
};

export const vatExigibility: Record<string, string> = {
  I: "Immediata",
  D: "Differita",
  S: "Scissione dei pagamenti",
};
