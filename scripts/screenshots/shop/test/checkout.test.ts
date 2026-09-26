import { checkoutTotal } from '../src/checkout';

const basket = [{ sku: 'tea', price: 5, quantity: 4 }];

describe('checkout', () => {
  it('applies the SAVE10 coupon', () => {
    expect(checkoutTotal(basket, 'SAVE10')).toBe(18);
  });

  it('ignores unknown coupons', () => {
    expect(checkoutTotal(basket, 'NOPE')).toBe(20);
  });
});
