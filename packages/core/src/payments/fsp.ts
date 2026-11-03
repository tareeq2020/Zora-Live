/* Payment methods + the platform base fee.
   ZORA talks to ONE upstream, x-bridge. We choose the METHOD (mobile money,
   card, control number); x-bridge chooses the network and credentials behind
   it. There is deliberately no provider routing or provider setting here. */

export type PaymentMethod = 'mobile' | 'billpay' | 'card';

/** Runtime list of the methods (used by the methods-enabled settings save). */
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['mobile', 'billpay', 'card'];

/** Platform base take rate (3%). */
export const DEFAULT_FEE_RATE = 0.03;
