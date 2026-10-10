import type { Building } from '../core/types';

export type ProductionKind = 'train' | 'research';
type Queues = Pick<Building, 'queue' | 'research' | 'productionQueue'>;

/** Old v2 saves did not record interleaving: retain their research-first semantics. */
export function productionOrder(b: Queues): readonly ProductionKind[] {
  return b.productionQueue ?? [
    ...Array<ProductionKind>(b.research?.length ?? 0).fill('research'),
    ...Array<ProductionKind>(b.queue).fill('train'),
  ];
}

/** Materialize before changing either of the two payload queues. */
export function ensureProductionQueue(b: Queues): ProductionKind[] {
  return (b.productionQueue ??= [...productionOrder(b)]);
}

/** Remove the nth entry of one payload queue, retaining the interleaved order. */
export function removeProduction(b: Queues, kind: ProductionKind, index: number): void {
  const queue = ensureProductionQueue(b);
  let seen = 0;
  const at = queue.findIndex((entry) => entry === kind && seen++ === index);
  if (at >= 0) queue.splice(at, 1);
}
