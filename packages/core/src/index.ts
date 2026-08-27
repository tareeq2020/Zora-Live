export { makeSql, db, tx, closeDb } from './db';
export type { Sql } from './db';
export {
  placeHold, convertHolds, releaseHolds, tryReacquire, tryRehold, releaseOrderInventory,
  reserveInventory, convertReservation, releaseReservation, sweepExpiredReservations,
  poolSnapshots, poolSnapshotsCached,
} from './inventory';
export type { PoolSnapshot } from './inventory';
export {
  QR_SCHEME, generateCode, generatePublicRef, signCredential, verifyCredential, qrPayload, ticketSigningKeys,
  renderQrPng,
} from './credentials';
export type { CredentialClaims } from './credentials';
export { createGaVipOrder, issueCredentials, createComp, sellGateCash, voidGateSale, SoldOut } from './payments/service';
export type { CreateCompInput, CreateCompResult, DeliveryTarget, TicketDeliveryResult, SellGateCashInput, SellGateCashResult, VoidGateSaleResult } from './payments/service';
export type {
  CartLine, CreateGaVipOrderInput, CreateGaVipOrderResult,
} from './payments/service';
export {
  nextAttemptKey, initiatePayment, mapStatus, applyOutcome, reconcile,
  notifyOrderPaid, organizerContactForEvent, resendOrderTickets, alertOps, resolveTransactionId, reconcilePending, sweepExpiredHolds,
} from './payments/service';
export type {
  PaymentOutcome, InitiatePaymentInput, InitiatePaymentResult,
} from './payments/service';
export {
  resolveFsp, feeRateForFsp, DEFAULT_FSP_ROUTE_MAP, DEFAULT_FEE_RATE, FSP_IDS, PAYMENT_METHODS,
} from './payments/fsp';
export type { FspId, PaymentMethod, FspRouteMap } from './payments/fsp';
export {
  xbridgeConfig, normalizeMsisdn, cardCheckoutUrl,
  collectMobile, collectBillPay, collectCard, collectionStatus,
  __resetTokenCache, __setMockCollectionStatus, __clearMockCollectionStatus,
} from './payments/xbridge';
export type {
  XbridgeConfig,
  CollectMobileInput, CollectMobileResponse,
  CollectBillPayInput, CollectBillPayResponse,
  CollectCardInput, CollectCardResponse,
  CollectionStatus, CollectionStatusResponse,
} from './payments/xbridge';
export { buildTicketsPdf } from './credentials/ticket-pdf';
export type { TicketForPdf } from './credentials/ticket-pdf';
// BS2: bill-split (split-a-table) domain + consumer OTP.
export {
  computeShareAmounts, signShareToken, verifyShareToken, createTableSplit, claimShare, createShareOrder,
  onShareSuccessful, onShareShort, onShareFailed, issueTableCredentials, splitAwareExpirySweep,
  notifyShareReceived, notifySplitComplete, notifySplitCompleteByOrder, SplitSoldOut,
} from './split';
export type {
  CreateTableSplitInput, CreateTableSplitResult, ClaimShareResult, CreateShareOrderResult, ShareStatus,
} from './split';
export {
  requestOtp, verifyOtp, generateOtpCode, hashOtp,
  OTP_TTL_SEC, OTP_MAX_ATTEMPTS, OTP_MAX_PER_WINDOW, OTP_THROTTLE_WINDOW_SEC,
} from './otp';
export type { RequestOtpResult, VerifyOtpResult } from './otp';
// BS35: point-in-time commission — the ONLY place the rate is resolved and the
// only place the net-of-commission rounding rule lives (eng review CQ1).
export {
  resolveCommissionRate, netOf, isCommissionRate, DEFAULT_COMMISSION_RATE,
} from './commission';
export type { CommissionEventLike, CommissionOrgLike } from './commission';
// BS35: the debit side — refunded money leaves the organizer's earnings (OV1).
export { refundOrder, REFUNDABLE_ORDER_STATUSES } from './refunds';
export type { RefundOrderResult } from './refunds';
// BS38: the ONE earnings read (net of the stamped commission, net of refunds),
// shared by the sales summary and the payout balance so they cannot drift.
export {
  readOrderMoney, netEarningsByCurrency, foldMoneyByCurrency,
  EARNING_STATUSES, SETTLED_SHARE_STATES,
} from './earnings';
export type { OrderMoney, CurrencyBucket } from './earnings';
// BS70 (dashboard #8): the pure date-bucket + KPI aggregator behind the org and
// admin dashboards. Reuses the netted OrderMoney (never re-derives commission).
export {
  buildAnalytics, rangeDays, normalizeRange, ANALYTICS_RANGES,
} from './analytics';
export type {
  AnalyticsRange, AnalyticsOrder, AnalyticsInput, AnalyticsResult,
  AnalyticsKpis, RevenuePoint,
} from './analytics';
// BS70 (dashboard #6): the suspended-organizer cascade — a cached suspended-handle
// set filtered on every public event read, refreshed synchronously on a status flip.
export {
  SuspendedHandleSet, suspendedHandles, fetchSuspendedHandles, normalizeHandle,
  __resetSuspendedHandles, SUSPENDED_HANDLES_TTL_MS,
} from './suspension';
export type { HasOrganizerHandle } from './suspension';
// BS38 (#7): the withdrawal ledger + the server-authoritative balance. Request
// computes the balance and inserts the row in ONE transaction under a per-org
// advisory lock, so two concurrent requests cannot over-withdraw (ARCH-2).
export {
  availableBalance, availableBalances, requestPayout, decidePayout, listPayouts, getPayout,
  payoutErrorMessage, payoutMinimum, payoutLockKey, validateDestination,
  PAYOUT_HOLDING_STATUSES, DEFAULT_PAYOUT_MINIMUM,
} from './payouts';
export type {
  PayoutStatus, PayoutErrorCode, PayoutDecisionErrorCode, PayoutRecord, PayoutBalance,
  PayoutOrgContext, RequestPayoutInput, RequestPayoutResult, PayoutDestination,
  DecidePayoutInput, DecidePayoutResult, ListPayoutsFilter,
} from './payouts';
// BS98 — the canonical payout-destination registry (mirrors x-bridge), used to
// validate an organizer's chosen method/provider and to serve the form's lists.
export {
  CANONICAL_BANKS, CANONICAL_MNOS, bankByCode, mnoByCode, providerFor, fspCodeFor,
  payoutDestinationCatalog,
} from './fsp-registry';
export type { PayoutMethod, CanonicalBank, CanonicalMno } from './fsp-registry';
export { sendSms, smsConfigSummary, logSmsStartup, gsmSafe } from './sms';
export { publicWebOrigin } from './origins';
export type { SmsDriver, SmsResult } from './sms';
export { sendEmail, sendCredentialEmail, escapeHtml } from './email';
export type {
  EmailDriver, EmailResult, EmailAttachment, CredentialTicket, CredentialEmailData,
} from './email';
// BS42 (#1): the door. The two-step scan lifecycle rides the EXISTING
// credential.state (OV4); the agent scan is the gate and the supervisor confirm
// is selective (OV6). Row-locked, so a replayed QR can never win twice.
export {
  scanCredential, confirmCredential, pendingConfirmations, getPass, scanTotals,
  parseQrPayload, requiresSupervisor, scanErrorMessage, confirmErrorMessage,
  CREDENTIAL_STATES, TERMINAL_CREDENTIAL_STATES,
} from './scan';
export type {
  CredentialState, ScanErrorCode, ConfirmErrorCode, ScanPass, ScanActor, ScanOutcome,
  ScanCredentialInput, ScanCredentialResult, ConfirmCredentialInput, ConfirmCredentialResult,
  PendingFilter, ParsedQr,
} from './scan';
// BS42 (#1): the code→session exchange, rate-limited with lockout (ARCH-3/OV4).
export {
  authenticateScannerCode, scanLockoutState, generateScannerCode, hashScanCode,
  toScannerUser, scanAuthMessage,
  SCAN_LOCKOUT_WINDOW_SEC, SCAN_CODE_MAX_FAILURES, SCAN_IP_MAX_FAILURES, SCAN_SESSION_TTL_SEC,
  SCANNER_USER_COLUMNS,
} from './scan-auth';
export type {
  ScannerRole, ScannerUser, ScannerUserRow, ScanAuthInput, ScanAuthResult, ScanAuthErrorCode,
} from './scan-auth';
// BS43 (#2): broadcasts — ONE audience resolver / gate / queue / drain, mounted
// twice (organizer + admin) so opt-out and the caps cannot diverge (CQ2).
export {
  countAudience, queueRecipients, createBroadcast, listBroadcasts, getBroadcast,
  drainBroadcasts, pendingBroadcastCount,
  suppressAddress, isSuppressed, resolveUnsubscribeToken, unsubscribeByToken, maskAddress,
  smsSegments, smsUnitCost, estimateSmsCost, monthlySmsCap, smsUsedThisMonth, smsCapState,
  broadcastErrorMessage, broadcastBatchSize, broadcastRateMs,
  renderSmsBody, renderEmailBody,
  BROADCAST_AUDIENCE_STATUSES, AUDIENCE_PAGE_SIZE,
  DEFAULT_SMS_UNIT_COST, DEFAULT_MONTHLY_SMS_CAP,
  DEFAULT_BROADCAST_BATCH, DEFAULT_BROADCAST_RATE_MS,
} from './broadcasts';
export type {
  BroadcastChannel, RecipientChannel, BroadcastScopeKind, BroadcastStatus,
  AudienceScope, AudienceCount, SmsCostEstimate, SmsCapState,
  BroadcastErrorCode, BroadcastRecord, CreateBroadcastInput, CreateBroadcastResult,
  ListBroadcastsFilter, SuppressInput, UnsubscribeTarget, DrainResult,
} from './broadcasts';
// Platform support contacts (phone/WhatsApp/email/Instagram) — the ONE source of
// truth every surface imports. Also available as the dependency-free subpath
// `@zora/core/contacts` for browser bundles (client components) that must not
// pull in the server barrel.
export {
  SUPPORT_EMAIL, SUPPORT_EMAIL_HREF, SUPPORT_PHONE, SUPPORT_PHONE_HREF,
  WHATSAPP_HREF, INSTAGRAM_HANDLE, INSTAGRAM_LABEL, INSTAGRAM_URL,
} from './contacts';
