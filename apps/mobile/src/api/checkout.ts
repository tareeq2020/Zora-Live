import { apiFetch } from './client';

export type MobilePaymentMethod = 'mobile' | 'billpay' | 'card';

export interface CheckoutOrder {
  orderId: string;
  total: number;
  holdExpiresAt?: string;
}

export async function createCheckout(input: {
  phone: string;
  email: string;
  tierId: string;
  quantity?: number;
}) {
  return apiFetch<CheckoutOrder>('/api/checkout', {
    method: 'POST',
    auth: false,
    body: {
      phone: input.phone,
      email: input.email,
      ageAttested: true,
      cart: [{ tier: input.tierId, quantity: input.quantity ?? 1 }],
    },
  });
}

export async function startCheckoutPayment(orderId: string, input: { method: MobilePaymentMethod; phone?: string }) {
  return apiFetch<{ ok?: boolean; status?: string; redirectUrl?: string }>(`/api/checkout/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    auth: false,
    body: {
      method: input.method,
      payerPhone: input.phone,
    },
  });
}
