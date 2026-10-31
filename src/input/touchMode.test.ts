import { Input, RMB } from './Input';
import { expect, it, vi } from 'vitest';
import { TouchInput } from './TouchInput';

it('abandons an active placement grab on mode switch without issuing its release order', () => {
  // Isolate the mode transition from DOM pointer registration.
  const touch = Object.create(TouchInput.prototype) as TouchInput;
  const release = vi.fn();
  Object.assign(touch, { mode: 'rts', frame: [], recognizer: { reset: () => [] }, fps: { reset: vi.fn(), stick: null },
    ids: new Set([42]), grabber: { up: release }, grabbed: 42, lookX: 5, lookY: 6, ring: { style: {} } });
  touch.setMode('follow');
  expect(release).not.toHaveBeenCalled();
  expect(touch.lookX).toBe(0); expect(touch.lookY).toBe(0);
  expect((touch as any).grabbed).toBeNull(); expect((touch as any).ids.size).toBe(0);
});

it('abandons mouse presses across views so releasing them cannot issue an RTS order', () => {
  const input = Object.create(Input.prototype) as Input;
  Object.assign(input, { buttons: new Set([RMB]), drags: new Map([[RMB, { held: true }]]),
    pressedButtons: new Set([RMB]), releasedButtons: new Set(), moveX: 10, moveY: 3, wheel: 100 });
  input.cancelPointer();
  expect(input.isDown(RMB)).toBe(false);
  expect(input.drag(RMB)).toBeUndefined();
  expect(input.moveX).toBe(0); expect(input.wheel).toBe(0);
});
