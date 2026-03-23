import { describe, it, expect } from 'vitest';
import { parseCardinality } from '../parser/er-parser.js';

describe('parseCardinality', () => {
  it('|| → one-to-one (min:one, max:one)', () => {
    expect(parseCardinality('||')).toEqual({ min: 'one', max: 'one' });
  });
  it('o| → zero-to-one (min:zero, max:one)', () => {
    expect(parseCardinality('o|')).toEqual({ min: 'zero', max: 'one' });
  });
  it('|{ → one-to-many (min:one, max:many)', () => {
    expect(parseCardinality('|{')).toEqual({ min: 'one', max: 'many' });
  });
  it('o{ → zero-to-many (min:zero, max:many)', () => {
    expect(parseCardinality('o{')).toEqual({ min: 'zero', max: 'many' });
  });
  it('}| → one-to-many (右側)', () => {
    expect(parseCardinality('}|')).toEqual({ min: 'one', max: 'many' });
  });
  it('}o → zero-to-many (右側)', () => {
    expect(parseCardinality('}o')).toEqual({ min: 'zero', max: 'many' });
  });
});
