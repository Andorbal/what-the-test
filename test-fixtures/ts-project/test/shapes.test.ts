import { Square, totalArea } from '../src/shapes';

describe('shapes', () => {
  it('adds up areas', () => {
    if (totalArea([new Square(2), new Square(3)]) !== 13) {
      throw new Error('bad');
    }
  });

  it('describes a polygon', () => {
    if (!new Square(2).describe().includes('4')) {
      throw new Error('bad');
    }
  });
});
