import { applyDiscount, LineItem, subtotal } from './cart';

export function checkoutTotal(items: LineItem[], coupon?: string): number {
  const total = subtotal(items);
  return coupon === 'SAVE10' ? applyDiscount(total, 10) : total;
}
