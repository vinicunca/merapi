import { beforeEach, describe, expect, it, test, vi } from 'vitest';

import { FocusManager } from '../focus-manager';
import { sleep } from '../utils';
import { setIsServer } from './utils';

describe('focus-manager', () => {
  let focusManager: FocusManager;

  beforeEach(() => {
    vi.resetModules();
    focusManager = new FocusManager();
  });

  it('should call previous remove handler when replacing an event listener', () => {
    const remove1Spy = vi.fn();
    const remove2Spy = vi.fn();

    focusManager.setEventListener(() => remove1Spy);
    focusManager.setEventListener(() => remove2Spy);

    expect(remove1Spy).toHaveBeenCalledTimes(1);
    expect(remove2Spy).not.toHaveBeenCalled();
  });

  it('should use focused boolean arg', async () => {
    let count = 0;

    const setup = (setFocused: (focused?: boolean) => void) => {
      setTimeout(() => {
        count++;
        setFocused(true);
      }, 20);
      return () => void 0;
    };

    focusManager.setEventListener(setup);

    await sleep(30);
    expect(count).toEqual(1);
    expect(focusManager.isFocused()).toBeTruthy();
  });

  it('should not notify listeners on focus if already focused', async () => {
    const subscriptionSpy = vi.fn();
    const unsubscribe = focusManager.subscribe(subscriptionSpy);

    focusManager.setFocused(true);
    expect(subscriptionSpy).toHaveBeenCalledTimes(1);
    subscriptionSpy.mockReset();

    focusManager.setFocused(false);
    expect(subscriptionSpy).toHaveBeenCalledTimes(0);

    unsubscribe();
  });

  it('should return true for isFocused if document is undefined', async () => {
    const { document } = globalThis;

    // @ts-expect-error - The operand of a 'delete' operator must be optional
    delete globalThis.document;

    focusManager.setFocused();
    expect(focusManager.isFocused()).toBeTruthy();
    globalThis.document = document;
  });

  test('cleanup should still be undefined if window is not defined', async () => {
    const restoreIsServer = setIsServer(true);

    const unsubscribe = focusManager.subscribe(() => undefined);
    // @ts-expect-error - private property
    expect(focusManager.cleanup).toBeUndefined();

    unsubscribe();
    restoreIsServer();
  });

  test('cleanup should still be undefined if window.addEventListener is not defined', async () => {
    const { addEventListener } = globalThis.window;

    // @ts-expect-error - type undefined
    globalThis.window.addEventListener = undefined;

    const unsubscribe = focusManager.subscribe(() => undefined);
    // @ts-expect-error - private property
    expect(focusManager.cleanup).toBeUndefined();

    unsubscribe();
    globalThis.window.addEventListener = addEventListener;
  });

  it('should replace default window listener when a new event listener is set', async () => {
    const addEventListenerSpy = vi.spyOn(
      globalThis.window,
      'addEventListener',
    );

    const removeEventListenerSpy = vi.spyOn(
      globalThis.window,
      'removeEventListener',
    );

    // Should set the default event listener with window event listeners
    const unsubscribe = focusManager.subscribe(() => undefined);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2);

    // Should replace the window default event listener by a new one
    // and it should call window.removeEventListener twice
    focusManager.setEventListener(() => {
      return () => void 0;
    });

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);

    unsubscribe();
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  test('should call removeEventListener when last listener unsubscribes', () => {
    const addEventListenerSpy = vi.spyOn(
      globalThis.window,
      'addEventListener',
    );

    const removeEventListenerSpy = vi.spyOn(
      globalThis.window,
      'removeEventListener',
    );

    const unsubscribe1 = focusManager.subscribe(() => undefined);
    const unsubscribe2 = focusManager.subscribe(() => undefined);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2); // visibilitychange + focus

    unsubscribe1();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(0);
    unsubscribe2();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2); // visibilitychange + focus
  });

  test('should keep setup function even if last listener unsubscribes', () => {
    const setupSpy = vi.fn().mockImplementation(() => () => undefined);

    focusManager.setEventListener(setupSpy);

    const unsubscribe1 = focusManager.subscribe(() => undefined);

    expect(setupSpy).toHaveBeenCalledTimes(1);

    unsubscribe1();

    const unsubscribe2 = focusManager.subscribe(() => undefined);

    expect(setupSpy).toHaveBeenCalledTimes(2);

    unsubscribe2();
  });
});