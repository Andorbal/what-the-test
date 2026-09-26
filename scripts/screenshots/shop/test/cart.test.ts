import { applyDiscount, lineTotal, subtotal } from '../src/cart';

describe('cart', () => {
  describe('lineTotal', () => {
    it('multiplies price by quantity', () => {
      expect(lineTotal({ sku: 'tea', price: 2.5, quantity: 4 })).toBe(10);
    });
  });

  describe('subtotal', () => {
    it('adds up every line', () => {
      const items = [
        { sku: 'tea', price: 2.5, quantity: 2 },
        { sku: 'mug', price: 8.99, quantity: 1 },
      ];
      expect(subtotal(items)).toBe(13.99);
    });

    it('is zero for an empty cart', () => {
      expect(subtotal([])).toBe(0);
    });
  });

  describe('applyDiscount', () => {
    it('takes a percentage off', () => {
      expect(applyDiscount(20, 15)).toBe(17);
    });

    it('rejects discounts over 100%', () => {
      expect(() => applyDiscount(20, 150)).toThrow(RangeError);
    });
  });
});
