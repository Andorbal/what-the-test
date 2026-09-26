export interface LineItem {
  sku: string;
  price: number;
  quantity: number;
}

export function lineTotal(item: LineItem): number {
  return roundCents(item.price * item.quantity);
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function applyDiscount(amount: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError('Discount must be between 0 and 100');
  }
  return roundCents(amount * (1 - percent / 100));
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
