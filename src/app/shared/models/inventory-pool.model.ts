export interface InventoryPool {
  isOpen: boolean;
  available: number | null;
  closureStatus?: boolean;
}

/** Parse an unwrapped inventory response without inventing availability. */
export function parseInventoryPool(value: unknown): InventoryPool | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const { isOpen, available, closureStatus } = value as Record<string, unknown>;
  if (typeof isOpen !== 'boolean' ||
      (available !== null && (typeof available !== 'number' || !Number.isFinite(available))) ||
      (closureStatus !== undefined && typeof closureStatus !== 'boolean')) {
    return null;
  }

  const pool: InventoryPool = { isOpen, available: typeof available === 'number' ? available : null };
  if (typeof closureStatus === 'boolean') pool.closureStatus = closureStatus;
  return pool;
}
