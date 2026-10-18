import { InventoryPool, parseInventoryPool } from './inventory-pool.model';

describe('parseInventoryPool', () => {
  const validPools: InventoryPool[] = [
    { isOpen: true, available: 3 },
    { isOpen: true, available: 0 },
    { isOpen: true, available: null },
    { isOpen: false, available: null },
    { isOpen: false, available: 0 },
    { isOpen: true, available: null, closureStatus: true },
    { isOpen: false, available: null, closureStatus: true },
    { isOpen: true, available: 3, closureStatus: false }
  ];

  for (const pool of validPools) {
    it(`preserves the inventory fields in ${JSON.stringify(pool)}`, () => {
      expect(parseInventoryPool(pool)).toEqual(pool);
    });
  }

  it('returns only inventory fields without mutating the response', () => {
    const raw = { isOpen: true, available: 3, extra: 'unused' };

    expect(parseInventoryPool(raw)).toEqual({ isOpen: true, available: 3 });
    expect(raw.extra).toBe('unused');
  });

  const invalidPools: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a primitive', true],
    ['an array', [{ isOpen: true, available: 3 }]],
    ['an empty object', {}],
    ['a wrapped response', { data: { isOpen: true, available: 3 } }],
    ['a missing pass requirement', { available: 3 }],
    ['a non-boolean pass requirement', { isOpen: 'false', available: 3 }],
    ['a missing count', { isOpen: true }],
    ['a missing no-pass count', { isOpen: false }],
    ['a string count', { isOpen: true, available: '3' }],
    ['a boolean count', { isOpen: true, available: false }],
    ['NaN', { isOpen: true, available: NaN }],
    ['positive infinity', { isOpen: true, available: Infinity }],
    ['negative infinity', { isOpen: true, available: -Infinity }],
    ['a string closure flag', { isOpen: true, available: 3, closureStatus: 'true' }],
    ['a null closure flag', { isOpen: true, available: 3, closureStatus: null }]
  ];

  for (const [label, pool] of invalidPools) {
    it(`rejects ${label}`, () => {
      expect(parseInventoryPool(pool)).toBeNull();
    });
  }
});
