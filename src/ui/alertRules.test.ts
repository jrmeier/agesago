import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN, ALERT_MIN_GAP, ALERT_RADIUS, AlertLimiter, BurstCounter, attackText, deathText } from './alertRules';

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
