import { scheduleMicrotask } from './utils';

type NotifyCallback = () => void;

type NotifyFunction = (callback: () => void) => void;

type BatchNotifyFunction = (callback: () => void) => void;

export function createNotifyManager() {
  let queue: NotifyCallback[] = [];
  let transactions = 0;
  let notifyFn: NotifyFunction = (callback) => {
    callback();
  };
  let batchNotifyFn: BatchNotifyFunction = (callback: () => void) => {
    callback();
  };

  function batch<T>(callback: () => T): T {
    let result;
    transactions++;

    try {
      result = callback();
    } finally {
      transactions--;
      if (!transactions) {
        flush();
      }
    }

    return result;
  }

  function schedule(callback: NotifyCallback): void {
    if (transactions) {
      queue.push(callback);
    } else {
      scheduleMicrotask(() => {
        notifyFn(callback);
      });
    }
  }

  /**
   * All calls to the wrapped function will be batched.
   */
  function batchCalls<T extends Function>(callback: T): T {
    return ((...args: any[]) => {
      schedule(() => {
        callback(...args);
      });
    }) as any;
  }

  function flush(): void {
    const originalQueue = queue;
    queue = [];

    if (originalQueue.length) {
      scheduleMicrotask(() => {
        batchNotifyFn(() => {
          originalQueue.forEach((callback) => {
            notifyFn(callback);
          });
        });
      });
    }
  }

  /**
   * Use this method to set a custom notify function.
   * This can be used to for example wrap notifications with `React.act` while running tests.
   */
  function setNotifyFunction(fn: NotifyFunction) {
    notifyFn = fn;
  }

  /**
   * Use this method to set a custom function to batch notifications together into a single tick.
   * By default React Query will use the batch function provided by ReactDOM or React Native.
   */
  function setBatchNotifyFunction(fn: BatchNotifyFunction) {
    batchNotifyFn = fn;
  }

  return {
    batch,
    batchCalls,
    schedule,
    setNotifyFunction,
    setBatchNotifyFunction,
  } as const;
}

export const notifyManager = createNotifyManager();
