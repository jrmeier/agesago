import type { Rank, UnitKind } from '../core/types';
import { canRank, RANKS } from '../core/units';

/** What the selection panel shows for one soldier's rank. */
export interface RankLine {
  name: string;
  /** 0..1 of the way from this rank's threshold to the next (1 at Elite). */
  fraction: number;
  /** "40 / 100 xp to Advanced", or "Top rank" at Elite. */
  label: string;
}

/** One soldier's rank and progress, or null for units that never rank. */
export function rankLine(kind: UnitKind, rank: Rank | undefined, xp: number | undefined): RankLine | null {
  if (!canRank(kind)) return null;
  const r = rank ?? 0;
  const name = RANKS[r].name;
  if (r >= 2) return { name, fraction: 1, label: 'Top rank' };
  const from = RANKS[r].xp;
  const next = RANKS[(r + 1) as Rank];
  const have = Math.max(0, Math.min(next.xp - from, (xp ?? 0) - from));
  const need = next.xp - from;
  return {
    name,
    fraction: need > 0 ? have / need : 1,
    label: `${Math.floor(have)} / ${need} xp to ${next.name}`,
  };
}

/** Soldiers in a group by rank, "3 Basic · 2 Advanced · 1 Elite" (empty ranks left out; null if none rank). */
export function rankSummary(units: readonly { kind: UnitKind; rank?: Rank }[]): string | null {
  const counts = [0, 0, 0];
  for (const u of units) if (canRank(u.kind)) counts[u.rank ?? 0] += 1;
  if (counts[0] + counts[1] + counts[2] === 0) return null;
  const parts: string[] = [];
  for (let r = 0; r < 3; r++) if (counts[r] > 0) parts.push(`${counts[r]} ${RANKS[r].name}`);
  return parts.join(' · ');
}
