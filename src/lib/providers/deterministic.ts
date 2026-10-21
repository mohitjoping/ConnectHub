/** FNV-1a 32-bit — stable across runs so simulations are reproducible. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 0–99 bucket for weighted outcome selection. */
export function bucket(seed: string): number {
  return fnv1a(seed) % 100;
}

/** Pick from [[value, weight], …] where weights sum to 100. */
export function weightedPick<T>(seed: string, table: readonly (readonly [T, number])[]): T {
  const roll = bucket(seed);
  let cumulative = 0;
  for (const [value, weight] of table) {
    cumulative += weight;
    if (roll < cumulative) return value;
  }
  return table[table.length - 1][0];
}

export function fakeId(prefix: string, seed: string): string {
  return `${prefix}_${fnv1a(seed).toString(16).padStart(8, "0")}${fnv1a(`${seed}:2`).toString(16).padStart(8, "0")}`;
}
