import { shout } from '../src/strings';

describe('shout', () => {
  it('upper-cases the text', () => {
    if (shout('hi') !== 'HI!') {
      throw new Error('bad');
    }
  });

  it('adds an exclamation mark', () => {
    if (!shout('ok').endsWith('!')) {
      throw new Error('bad');
    }
  });
});
