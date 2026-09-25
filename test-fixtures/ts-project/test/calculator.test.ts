import { add, sum } from '../src/calculator';

describe('calculator', () => {
  describe('add', () => {
    it('adds two numbers', () => {
      if (add(1, 2) !== 3) {
        throw new Error('bad');
      }
    });
  });

  describe('sum', () => {
    it('sums a list', () => {
      if (sum([1, 2, 3]) !== 6) {
        throw new Error('bad');
      }
    });
  });
});
