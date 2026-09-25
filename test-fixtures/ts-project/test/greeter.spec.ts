import { Greeter } from '../src/greeter';

function makeGreeter(): Greeter {
  return new Greeter('world');
}

describe('Greeter', () => {
  it('greets loudly', () => {
    if (makeGreeter().greet() !== 'Hello, WORLD!') {
      throw new Error('bad');
    }
  });
});
