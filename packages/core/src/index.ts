export { makeSql, db, tx, closeDb } from './db';
export type { Sql } from './db';
export {
  placeHold, convertHolds, releaseHolds, tryReacquire,
  reserveInventory, convertReservation, releaseReservation, sweepExpiredReservations,
  poolSnapshots, poolSnapshotsCached,
} from './inventory';
export type { PoolSnapshot } from './inventory';
export {
  QR_SCHEME, generateCode, generatePublicRef, signCredential, verifyCredential, qrPayload, ticketSigningKeys,
  renderQrPng,
} from './credentials';
export type { CredentialClaims } from './credentials';
export { createGaVipOrder, issueCredentials, SoldOut } from './payments/service';
export type {
  CartLine, CreateGaVipOrderInput, CreateGaVipOrderResult,
} from './payments/service';
export {
  nextAttemptKey, initiatePayment, mapStatus, applyOutcome, reconcile,
  notifyOrderPaid, alertOps, resolveTransactionId, reconcilePending, sweepExpiredHolds,
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
  readOrderMoney, netEarningsByCurrency, EARNING_STATUSES, SETTLED_SHARE_STATES,
} from './earnings';
export type { OrderMoney } from './earnings';
// BS38 (#7): the withdrawal ledger + the server-authoritative balance. Request
// computes the balance and inserts the row in ONE transaction under a per-org
// advisory lock, so two concurrent requests cannot over-withdraw (ARCH-2).
export {
  availableBalance, availableBalances, requestPayout, decidePayout, listPayouts, getPayout,
  payoutErrorMessage, payoutMinimum, payoutLockKey,
  PAYOUT_HOLDING_STATUSES, DEFAULT_PAYOUT_MINIMUM,
} from './payouts';
export type {
  PayoutStatus, PayoutErrorCode, PayoutDecisionErrorCode, PayoutRecord, PayoutBalance,
  PayoutOrgContext, RequestPayoutInput, RequestPayoutResult,
  DecidePayoutInput, DecidePayoutResult, ListPayoutsFilter,
} from './payouts';
export { sendSms } from './sms';
export type { SmsDriver, SmsResult } from './sms';
export { sendEmail, sendCredentialEmail, escapeHtml } from './email';
export type {
  EmailDriver, EmailResult, EmailAttachment, CredentialTicket, CredentialEmailData,
} from './email';
