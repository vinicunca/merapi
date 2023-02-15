import { isBoolean, isUndefined } from '@vinicunca/js-utilities';

import { Subscribable } from './subscribable';
import { isServer } from './utils';

type SetupFn = (
  setFocused: (focused?: boolean) => void,
) => (() => void) | undefined;

export class FocusManager extends Subscribable {
  private focused?: boolean;
  private cleanup?: () => void;

  private setup: SetupFn;

  constructor() {
    super();
    this.setup = (onFocus) => {
      if (!isServer && window.addEventListener) {
        const listener = () => onFocus();

        window.addEventListener('visibilitychange', listener, false);
        window.addEventListener('focus', listener, false);

        return () => {
          // Be sure to unsubscribe if a new handler is set
          window.removeEventListener('visibilitychange', listener);
          window.removeEventListener('focus', listener);
        };
      }

      return undefined;
    };
  }

  protected onSubscribe(): void {
    if (!this.cleanup) {
      this.setEventListener(this.setup);
    }
  }

  protected onUnsubscribe(): void {
    if (!this.hasListeners()) {
      this.cleanup?.();
      this.cleanup = undefined;
    }
  }

  setEventListener(setup: SetupFn): void {
    this.setup = setup;
    this.cleanup?.();
    this.cleanup = setup((focused) => {
      if (isBoolean(focused)) {
        this.setFocused(focused);
      } else {
        this.onFocus();
      }
    });
  }

  setFocused(focused?: boolean): void {
    this.focused = focused;

    if (focused) {
      this.onFocus();
    }
  }

  onFocus(): void {
    this.listeners.forEach((listener) => listener());
  }

  isFocused(): boolean {
    if (isBoolean(this.focused)) {
      return this.focused;
    }

    if (isUndefined(document)) {
      return true;
    }

    return [undefined, 'visible', 'prerender'].includes(
      document.visibilityState,
    );
  }
}

export const focusManager = new FocusManager();
