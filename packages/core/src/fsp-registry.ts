/* FSP payout-destination registry (BS98 / withdrawals #7 follow-up).

   The canonical list of where an organizer can be paid: mobile-money operators
   (MNOs) and banks. This MIRRORS the x-bridge payment gateway's own registry
   (x-bridge-Tech/bridge-fsp-adapter · src/metadata/payment-method-registry.ts),
   which is the single source of truth once we wire live payouts.

   ── Why we store the CANONICAL code, not an FSP code ────────────────────────
   Each entry carries per-FSP code mappings (NMB / SELCOM pass-through; ClickPesa
   uses BIC/SWIFT). We persist the *canonical* code on the payout record so the
   choice is gateway-agnostic: when settlement is automated, the adapter for
   whichever provider we route through translates canonical → FSP code at send
   time (`fspCodeFor`). If we hard-coded a ClickPesa SWIFT today, switching a
   payout to Selcom later would silently break.

   Keep this in step with x-bridge when they add a bank/MNO. `providerName` is a
   snapshot we also copy onto the payout row, so a record stays readable even if a
   provider is later renamed or removed here. */

export type PayoutMethod = 'mobile_money' | 'bank';

export interface FspCodeMap {
  [fspId: string]: string;
}

export interface CanonicalBank {
  /** Canonical short code — what we store + what callers pick. */
  code: string;
  name: string;
  /** Per-FSP code the adapter sends to the external API (integration-time). */
  fspCodes: FspCodeMap;
}

export interface CanonicalMno {
  code: string;
  name: string;
  fspCodes: FspCodeMap;
}

/** Canonical bank registry — mirrors x-bridge CANONICAL_BANKS. */
export const CANONICAL_BANKS: CanonicalBank[] = [
  { code: 'BOT', name: 'Bank of Tanzania', fspCodes: { NMB: 'BOT', SELCOM: 'BOT', CLICKPESA: 'BOTZTZTX' } },
  { code: 'CRDB', name: 'CRDB Bank Limited', fspCodes: { NMB: 'CRDB', SELCOM: 'CRDB', CLICKPESA: 'CORUTZTZ' } },
  { code: 'PBZ', name: 'People Bank of Zanzibar', fspCodes: { NMB: 'PBZ', SELCOM: 'PBZ', CLICKPESA: 'PBZATZTZ' } },
  { code: 'STANCHART', name: 'Standard Chartered', fspCodes: { NMB: 'STANCHART', SELCOM: 'STANCHART', CLICKPESA: 'SCBLTZTZ' } },
  { code: 'STANBIC', name: 'Stanbic Bank', fspCodes: { NMB: 'STANBIC', SELCOM: 'STANBIC', CLICKPESA: 'SBICTZTZ' } },
  { code: 'CITI', name: 'Citibank', fspCodes: { NMB: 'CITI', SELCOM: 'CITI', CLICKPESA: 'CITITZTZ' } },
  { code: 'BOA', name: 'Bank of Africa', fspCodes: { NMB: 'BOA', SELCOM: 'BOA', CLICKPESA: 'ABORTZTZ' } },
  { code: 'DTB', name: 'Diamond Trust Bank', fspCodes: { NMB: 'DTB', SELCOM: 'DTB', CLICKPESA: 'DLOATZTZ' } },
  { code: 'AKIBA', name: 'Akiba Bank Ltd', fspCodes: { NMB: 'AKIBA', SELCOM: 'AKIBA', CLICKPESA: 'AKCOTZTZ' } },
  { code: 'EXIM', name: 'Exim Bank', fspCodes: { NMB: 'EXIM', SELCOM: 'EXIM', CLICKPESA: 'EXTNTZTZ' } },
  { code: 'KILI', name: 'Kilimanjaro Cooperative Bank', fspCodes: { NMB: 'KILI', SELCOM: 'KILI', CLICKPESA: 'KLCBTZTZ' } },
  { code: 'NBC', name: 'NBC Bank Limited', fspCodes: { NMB: 'NBC', SELCOM: 'NBC', CLICKPESA: 'NLCBTZTZ' } },
  { code: 'NMB', name: 'National Microfinance Bank', fspCodes: { NMB: 'NMB', SELCOM: 'NMB', CLICKPESA: 'NMBATZTZ' } },
  { code: 'KCB', name: 'Kenya Commercial Bank', fspCodes: { NMB: 'KCB', SELCOM: 'KCB', CLICKPESA: 'KCBLTZTZ' } },
  { code: 'HABIB', name: 'Habib African Ltd', fspCodes: { NMB: 'HABIB', SELCOM: 'HABIB', CLICKPESA: 'HABORTZTZ' } },
  { code: 'ICB', name: 'International Commercial Bank (Tanzania) LTD', fspCodes: { NMB: 'ICB', SELCOM: 'ICB', CLICKPESA: 'BABORTZTZ' } },
  { code: 'BARCLAYS', name: 'Barclays Bank Tanzania', fspCodes: { NMB: 'BARCLAYS', SELCOM: 'BARCLAYS', CLICKPESA: 'BABORTZTZ' } },
  { code: 'IANDM', name: 'I & M Bank', fspCodes: { NMB: 'IANDM', SELCOM: 'IANDM', CLICKPESA: 'IMBLTZTZ' } },
  { code: 'CBA', name: 'Commercial Bank of Africa', fspCodes: { NMB: 'CBA', SELCOM: 'CBA', CLICKPESA: 'CBAFTZTZ' } },
  { code: 'DCB', name: 'Dar es Salaam Community Bank', fspCodes: { NMB: 'DCB', SELCOM: 'DCB', CLICKPESA: 'DACBTZTZ' } },
  { code: 'NIC', name: 'NIC Bank', fspCodes: { NMB: 'NIC', SELCOM: 'NIC', CLICKPESA: 'NICATZTZ' } },
  { code: 'BARODA', name: 'Bank of Baroda (Tanzania) Limited', fspCodes: { NMB: 'BARODA', SELCOM: 'BARODA', CLICKPESA: 'BARBTZTZ' } },
  { code: 'AZANIA', name: 'Azania Bankcorp Limited', fspCodes: { NMB: 'AZANIA', SELCOM: 'AZANIA', CLICKPESA: 'AZANTZTZ' } },
  { code: 'UCHUMI', name: 'Uchumi Bank Ltd', fspCodes: { NMB: 'UCHUMI', SELCOM: 'UCHUMI', CLICKPESA: 'UCOBTZTZ' } },
  { code: 'ABC', name: 'African Banking Cooperation', fspCodes: { NMB: 'ABC', SELCOM: 'ABC', CLICKPESA: 'ABORTZTZ' } },
  { code: 'ACCESS', name: 'AccessBank', fspCodes: { NMB: 'ACCESS', SELCOM: 'ACCESS', CLICKPESA: 'ACTZTZTZ' } },
  { code: 'BOI', name: 'Bank of India', fspCodes: { NMB: 'BOI', SELCOM: 'BOI', CLICKPESA: 'BKIDTZTZ' } },
  { code: 'UBA', name: 'United Bank for Africa (UBA)', fspCodes: { NMB: 'UBA', SELCOM: 'UBA', CLICKPESA: 'ABORTZTZ' } },
  { code: 'MKOMBOZI', name: 'Mkombozi Bank', fspCodes: { NMB: 'MKOMBOZI', SELCOM: 'MKOMBOZI', CLICKPESA: 'MKCOTZTZ' } },
  { code: 'ECOBANK', name: 'Eco Bank Tanzania Ltd', fspCodes: { NMB: 'ECOBANK', SELCOM: 'ECOBANK', CLICKPESA: 'ECOCTZTX' } },
  { code: 'MWANGA', name: 'Mwanga Community Bank', fspCodes: { NMB: 'MWANGA', SELCOM: 'MWANGA', CLICKPESA: 'MWCOTZTZ' } },
  { code: 'FNB', name: 'First National Bank Tanzania', fspCodes: { NMB: 'FNB', SELCOM: 'FNB', CLICKPESA: 'FIRNTZTZ' } },
  { code: 'AMANA', name: 'Amana Bank', fspCodes: { NMB: 'AMANA', SELCOM: 'AMANA', CLICKPESA: 'AMBNTZTZ' } },
  { code: 'EQUITY', name: 'Equity Bank Tanzania', fspCodes: { NMB: 'EQUITY', SELCOM: 'EQUITY', CLICKPESA: 'EABORTZTZ' } },
  { code: 'TPB', name: 'TPB Bank PLC', fspCodes: { NMB: 'TPB', SELCOM: 'TPB', CLICKPESA: 'TPBATZTZ' } },
  { code: 'UBL', name: 'UBL Bank (Tanzania) Ltd', fspCodes: { NMB: 'UBL', SELCOM: 'UBL', CLICKPESA: 'ABORTZTZ' } },
  { code: 'MAENDELEO', name: 'Maendeleo Bank PLC', fspCodes: { NMB: 'MAENDELEO', SELCOM: 'MAENDELEO', CLICKPESA: 'MAENTZTZ' } },
  { code: 'CHINABANK', name: 'Commercial Bank of China', fspCodes: { NMB: 'CHINABANK', SELCOM: 'CHINABANK', CLICKPESA: 'ICBKTZTZ' } },
  { code: 'TIB', name: 'Tanzania Investments Bank', fspCodes: { NMB: 'TIB', SELCOM: 'TIB', CLICKPESA: 'TIBDTZTZ' } },
  { code: 'CANARA', name: 'Canara Bank', fspCodes: { NMB: 'CANARA', SELCOM: 'CANARA', CLICKPESA: 'CNRBTZTZ' } },
  { code: 'MWALIMU', name: 'Mwalimu Commercial Bank', fspCodes: { NMB: 'MWALIMU', SELCOM: 'MWALIMU', CLICKPESA: 'MWCBTZTZ' } },
  { code: 'GTBANK', name: 'GT Bank (T) Ltd', fspCodes: { NMB: 'GTBANK', SELCOM: 'GTBANK', CLICKPESA: 'GTBITZTZ' } },
  { code: 'DASHENG', name: 'China Dasheng Bank Limited', fspCodes: { NMB: 'DASHENG', SELCOM: 'DASHENG', CLICKPESA: 'CDSBTZTZ' } },
];

/** Canonical MNO registry — mirrors x-bridge CANONICAL_MNOS. */
export const CANONICAL_MNOS: CanonicalMno[] = [
  { code: 'MPESA', name: 'Vodacom (M-Pesa)', fspCodes: { NMB: 'MPESA', SELCOM: 'VMCASHIN', GODIGITAL: 'VODACOM' } },
  { code: 'TIGOPESA', name: 'Tigo (Mixx by Yas)', fspCodes: { NMB: 'TIGOPESA', SELCOM: 'TPCASHIN', GODIGITAL: 'YAS' } },
  { code: 'HALOPESA', name: 'Halotel (HaloPesa)', fspCodes: { NMB: 'HALOPESA', SELCOM: 'HPCASHIN', GODIGITAL: 'HALOTEL' } },
  { code: 'AIRTEL MONEY', name: 'Airtel (Airtel Money)', fspCodes: { NMB: 'AIRTEL MONEY', SELCOM: 'AMCASHIN', GODIGITAL: 'AIRTEL' } },
  { code: 'TTCL PESA', name: 'TTCL (TTCL Pesa)', fspCodes: { NMB: 'TTCL PESA', SELCOM: 'TTCASHIN' } },
  { code: 'EASY PESA', name: 'Zantel (EzyPesa)', fspCodes: { NMB: 'EASY PESA', SELCOM: 'EZCASHIN' } },
];

const BANK_BY_CODE = new Map(CANONICAL_BANKS.map((b) => [b.code.toUpperCase(), b]));
const MNO_BY_CODE = new Map(CANONICAL_MNOS.map((m) => [m.code.toUpperCase(), m]));

export function bankByCode(code: string): CanonicalBank | null {
  return BANK_BY_CODE.get(String(code || '').trim().toUpperCase()) ?? null;
}
export function mnoByCode(code: string): CanonicalMno | null {
  return MNO_BY_CODE.get(String(code || '').trim().toUpperCase()) ?? null;
}

/** The provider entry for a (method, code) pair, or null if the code is not valid
    for that method. The one lookup the payout validator uses. */
export function providerFor(method: PayoutMethod, code: string): CanonicalBank | CanonicalMno | null {
  return method === 'bank' ? bankByCode(code) : method === 'mobile_money' ? mnoByCode(code) : null;
}

/** Translate a canonical code to the FSP-specific code for a given provider, used
    at settlement time. Returns null if that FSP does not serve the provider. */
export function fspCodeFor(method: PayoutMethod, code: string, fspId: string): string | null {
  const entry = providerFor(method, code);
  if (!entry) return null;
  return entry.fspCodes[String(fspId || '').toUpperCase()] ?? null;
}

/** The lists the withdrawal form renders (code + display name only — the fspCodes
    are integration detail the browser never needs). */
export function payoutDestinationCatalog(): {
  methods: { id: PayoutMethod; label: string }[];
  banks: { code: string; name: string }[];
  mnos: { code: string; name: string }[];
} {
  return {
    methods: [
      { id: 'mobile_money', label: 'Mobile money' },
      { id: 'bank', label: 'Bank account' },
    ],
    banks: CANONICAL_BANKS.map((b) => ({ code: b.code, name: b.name })),
    mnos: CANONICAL_MNOS.map((m) => ({ code: m.code, name: m.name })),
  };
}
