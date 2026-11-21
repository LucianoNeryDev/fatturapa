import type { InvoiceInput } from "../src/index.js";

// Invoices shared by the builder, schema and round-trip tests.

export const base: InvoiceInput = {
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

export const discounted: InvoiceInput = {
  ...base,
  lines: [
    {
      ...base.lines[0]!,
      adjustments: [{ percent: 10 }, { amountCents: 100 }],
    },
    { ...base.lines[1]!, adjustments: [{ kind: "surcharge", percent: 5 }] },
  ],
};

export const withDocumentDiscount: InvoiceInput = {
  ...base,
  adjustments: [{ percent: 10 }],
};

export const foreign: InvoiceInput = {
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

export const germanSeller = {
  ...base.seller,
  name: "Fleischerei Schmidt GmbH",
  address: {
    street: "Hauptstraße 1",
    postalCode: "10115",
    city: "Berlin",
    country: "DE",
  },
};
export const italianEstablishment = {
  street: "Via Torino 3",
  postalCode: "20123",
  city: "Milano",
  province: "MI",
};
export const withRepresentative: InvoiceInput = {
  ...base,
  seller: {
    ...germanSeller,
    fiscalRepresentative: {
      vatNumber: "10000000009",
      fiscalCode: "RSSMRA80A01H501U",
      name: "Rappresentanza Fiscale Srl",
    },
  },
};
export const withEstablishment: InvoiceInput = {
  ...base,
  seller: {
    ...germanSeller,
    name: "Boucherie Martin SARL",
    address: {
      street: "Rue de la Paix 1",
      postalCode: "75002",
      city: "Paris",
      country: "FR",
    },
    permanentEstablishment: italianEstablishment,
  },
};

export const publicAdministration: InvoiceInput = {
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
export const professional: InvoiceInput = {
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
export const professionalInps: InvoiceInput = {
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
export const professionalToPublicAdministration: InvoiceInput = {
  ...professional,
  format: "FPA12",
  buyer: publicAdministration.buyer,
  vatExigibility: "S",
};

/** Every generated variant, validated against the official schema and read back. */
export const schemaFixtures: Record<string, InvoiceInput> = {
  invoice: base,
  creditNote: {
    ...base,
    type: "TD04",
    linkedInvoices: [{ number: "1/MZ", date: "2026-10-20" }],
  },
  discounted: discounted,
  documentDiscount: withDocumentDiscount,
  documentAdjustments: {
    ...withDocumentDiscount,
    adjustments: [
      { percent: 10 },
      { kind: "surcharge", amountCents: 250, description: "Trasporto" },
    ],
  },
  foreign: foreign,
  fiscalRepresentative: withRepresentative,
  permanentEstablishment: withEstablishment,
  buyerRepresentative: {
    ...foreign,
    buyer: {
      ...foreign.buyer,
      fiscalRepresentative: {
        vatNumber: "10000000009",
        name: "Rappr Srl",
      },
    },
  },
  buyerEstablishment: {
    ...foreign,
    buyer: {
      ...foreign.buyer,
      permanentEstablishment: italianEstablishment,
    },
  },
  publicAdministration: publicAdministration,
  professional: professional,
  professionalInps: professionalInps,
  splitPaymentWithholding: professionalToPublicAdministration,
  installments: {
    ...professional,
    payment: {
      method: "MP05",
      terms: "installments",
      iban: "IT60X0542811101000000123456",
      installments: [
        { dueDate: "2026-12-31" },
        { dueDate: "2027-01-31", method: "MP08", bank: "Banca Due" },
        { dueDate: "2027-02-28", beneficiary: "Studio Associato" },
      ],
    },
  },
  flatRatePensionFund: {
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
  },
  lineKinds: {
    ...base,
    lines: [
      ...base.lines,
      {
        kind: "premium",
        description: "Premio fedelta",
        unitPriceCents: 0,
        vatRate: 10,
      },
      {
        kind: "rebate",
        description: "Abbuono",
        unitPriceCents: -50,
        vatRate: 10,
      },
      {
        kind: "charge",
        description: "Spese di trasporto",
        unitPriceCents: 500,
        vatRate: 22,
      },
      {
        kind: "discount",
        description: "Sconto merce",
        quantity: "2.5",
        unitPriceCents: -100,
        vatRate: 4,
      },
    ],
  },
};
