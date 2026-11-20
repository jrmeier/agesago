import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN, ALERT_MIN_GAP, ALERT_RADIUS, AlertLimiter, BurstCounter, DepletionLimiter, depletedText, destroyedText, lastNodeNearDrop, attackText, captureText, deathText, resignText } from './alertRules';

describe('under-attack alerts', () => {
  const here = { x: 50, z: 50 };

  it('alerts once per fight, then again after the cooldown', () => {
    const a = new AlertLimiter();
    expect(a.shouldAlert(here, 0)).toBe(true);
    expect(a.shouldAlert(here, 1)).toBe(false);
    expect(a.shouldAlert({ x: 55, z: 50 }, ALERT_COOLDOWN - 0.1)).toBe(false);
    expect(a.shouldAlert(here, ALERT_COOLDOWN + 0.1)).toBe(true);
  });

  it('alerts for a second front far away, but never twice within the minimum gap', () => {
    const a = new AlertLimiter();
    const far = { x: here.x + ALERT_RADIUS + 5, z: here.z };
    expect(a.shouldAlert(here, 0)).toBe(true);
    expect(a.shouldAlert(far, ALERT_MIN_GAP / 2)).toBe(false);
    expect(a.shouldAlert(far, ALERT_MIN_GAP + 0.1)).toBe(true);
  });

  it('says where the attack is relative to home', () => {
    expect(attackText({ x: 50, z: 50 }, { x: 50, z: 10 })).toBe('You are under attack! (north)');
    expect(attackText({ x: 50, z: 50 }, { x: 90, z: 90 })).toBe('You are under attack! (south-east)');
    expect(attackText({ x: 50, z: 50 }, { x: 52, z: 51 })).toBe('You are under attack! (at your town)');
  });
});

describe('villager death toasts', () => {
  it('shows the first at once and batches a burst', () => {
    const b = new BurstCounter(4);
    expect(b.add(0)).toBe(1);
    expect(b.add(1)).toBe(0);
    expect(b.add(2)).toBe(0);
    expect(b.poll(3)).toBe(0);
    expect(b.poll(4)).toBe(2);
    expect(b.poll(5)).toBe(0);
    expect(b.add(9)).toBe(1);
  });

  it('words single and plural deaths', () => {
    expect(deathText(1)).toBe('A villager was killed');
    expect(deathText(3)).toBe('3 villagers were killed');
  });
});

describe('capture toasts (M18-4)', () => {
  it('names the building and the other player', () => {
    expect(captureText('barracks', true, 'Rival 1')).toBe('Your Barracks was captured by Rival 1');
    expect(captureText('house', false, 'Rival 2')).toBe('Captured a House from Rival 2');
    expect(captureText('house', false, null)).toBe('Captured a neutral House');
  });
});

describe('resignation toast (M16-10)', () => {
  it('names the rival who resigned', () => {
    expect(resignText('Rival 1')).toBe('Rival 1 resigned');
  });
});


describe('work feedback rules', () => {
  const pos = { x: 20, z: 20 };
  const drop = { pos, kind: 'miningCamp' as const };
  it('names one destroyed building and batches several', () => {
    expect(destroyedText('barracks')).toBe('Your Barracks was destroyed');
    expect(destroyedText('palisade', 3)).toBe('3 buildings destroyed');
    expect(depletedText('gold', 'miningCamp')).toBe('Gold near your Mining Camp is exhausted');
  });
  it('announces the last nearby node, considering only live nodes of the same resource', () => {
    expect(lastNodeNearDrop(pos, 'gold', drop, [{ pos, resource: 'gold', amount: 1 }])).toBe(false);
    expect(lastNodeNearDrop(pos, 'gold', drop, [{ pos, resource: 'gold', amount: 0 },
      { pos, resource: 'stone', amount: 100 }])).toBe(true);
    expect(lastNodeNearDrop({ x: 33, z: 20 }, 'gold', drop, [])).toBe(false);
    expect(lastNodeNearDrop(pos, 'food', drop, [])).toBe(false);
    expect(lastNodeNearDrop(pos, 'wood', { pos, kind: 'townCenter' }, [])).toBe(false);
    expect(lastNodeNearDrop(pos, 'wood', { pos, kind: 'storehouse' }, [
      { pos: { x: 33, z: 20 }, resource: 'wood', amount: 100 },
    ])).toBe(true);
  });
  it('announces only once per site/resource and separates all announcements by 20 seconds', () => {
    const limiter = new DepletionLimiter();
    expect(limiter.shouldAlert(1, 'gold', 0)).toBe(true);
    expect(limiter.shouldAlert(2, 'gold', 19.99)).toBe(false);
    expect(limiter.shouldAlert(2, 'gold', 20)).toBe(true);
    expect(limiter.shouldAlert(1, 'gold', 60)).toBe(false);
    expect(limiter.shouldAlert(1, 'stone', 60)).toBe(true);
  });
});
