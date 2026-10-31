import type { Request } from 'express';
import { verifySession } from './session-cookie';
import { resolveSessionSecret } from './secret';
import { readNamedCookie, CONSUMER_COOKIE } from './consumer';

/* BS134: may this request read a buyer's order details (amounts, phone)?
   An order id alone is NOT enough (it travels in SMS links). Accepted proofs:
     1. the zora_checkout cookie minted for THIS order at checkout, or
     2. a verified buyer session (zora_buyer) for the order's customer — minted by
        the SMS-OTP sign-in (role consumer + customerId) or by the payer auto-verify
        on a paid order (phone + verified). */
export function canReadBuyerOrder(
  req: Request, orderId: string, owner: { customerId: string; phone: string | null } | null,
): boolean {
  if (!owner) return false;
  const secret = resolveSessionSecret();
  const co: any = verifySession(readNamedCookie(req, 'zora_checkout'), secret);
  if (co && co.orderId === orderId) return true;
  const buyer: any = verifySession(readNamedCookie(req, CONSUMER_COOKIE), secret);
  if (!buyer || buyer.verified !== true) return false;
  if (buyer.customerId && buyer.customerId === owner.customerId) return true;
  return !!(owner.phone && buyer.phone && String(buyer.phone) === String(owner.phone));
}
