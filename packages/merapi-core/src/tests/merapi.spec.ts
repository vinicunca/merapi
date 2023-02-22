import { waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { sleep } from '@vinicunca/js-utilities';

import {
  type MerapiCache,
  type MerapiClient,
  type MerapiFunctionContext,
  type MerapiObserverResult,
} from '..';
import {
  createMerapiClient,
  merapiKey,
  mockLogger,
  mockVisibilityState,
} from './utils';
import { MerapiObserver, isCancelledError, isError, onlineManager } from '..';

describe('query', () => {
  let merapiClient: MerapiClient;
  let merapiCache: MerapiCache;

  beforeEach(() => {
    merapiClient = createMerapiClient();
    merapiCache = merapiClient.getMerapiCache();
    merapiClient.mount();
  });

  afterEach(() => {
    merapiClient.clear();
  });

  test('should use the longest cache time it has seen', async () => {
    const key = merapiKey();
    await merapiClient.prefetchMerapi(key, () => 'data', {
      cacheTime: 100,
    });
    await merapiClient.prefetchMerapi(key, () => 'data', {
      cacheTime: 200,
    });
    await merapiClient.prefetchMerapi(key, () => 'data', {
      cacheTime: 10,
    });
    const query = merapiCache.find(key)!;
    expect(query.cacheTime).toBe(200);
  });

  it('should continue retry after focus regain and resolve all promises', async () => {
    const key = merapiKey();

    // make page unfocused
    const visibilityMock = mockVisibilityState('hidden');

    let count = 0;
    let result;

    const promise = merapiClient.fetchMerapi(
      key,
      async () => {
        count++;

        if (count === 3) {
          return `data${count}`;
        }

        throw new Error(`error${count}`);
      },
      {
        retry: 3,
        retryDelay: 1,
      },
    );

    promise.then((data) => {
      result = data;
    });

    // Check if we do not have a result
    expect(result).toBeUndefined();

    // Check if the query is really paused
    await sleep(50);
    expect(result).toBeUndefined();

    // Reset visibilityState to original value
    visibilityMock.mockRestore();
    window.dispatchEvent(new FocusEvent('focus'));

    // There should not be a result yet
    expect(result).toBeUndefined();

    // By now we should have a value
    await sleep(50);
    expect(result).toBe('data3');
  });

  it('should continue retry after reconnect and resolve all promises', async () => {
    const key = merapiKey();

    onlineManager.setOnline(false);

    let count = 0;
    let result;

    const promise = merapiClient.fetchMerapi(
      key,
      async () => {
        count++;

        if (count === 3) {
          return `data${count}`;
        }

        throw new Error(`error${count}`);
      },
      {
        retry: 3,
        retryDelay: 1,
      },
    );

    promise.then((data) => {
      result = data;
    });

    // Check if we do not have a result
    expect(result).toBeUndefined();

    // Check if the query is really paused
    await sleep(50);
    expect(result).toBeUndefined();

    // Reset navigator to original value
    onlineManager.setOnline(true);

    // There should not be a result yet
    expect(result).toBeUndefined();

    // Promise should eventually be resolved
    await promise;
    expect(result).toBe('data3');
  });

  it('should throw a CancelledError when a paused query is cancelled', async () => {
    const key = merapiKey();

    // make page unfocused
    const visibilityMock = mockVisibilityState('hidden');

    let count = 0;
    let result;

    const promise = merapiClient.fetchMerapi(
      key,
      async (): Promise<unknown> => {
        count++;
        throw new Error(`error${count}`);
      },
      {
        retry: 3,
        retryDelay: 1,
      },
    );

    promise.catch((data) => {
      result = data;
    });

    const query = merapiCache.find(key)!;

    // Check if the query is really paused
    await sleep(50);
    expect(result).toBeUndefined();

    // Cancel query
    query.cancel();

    // Check if the error is set to the cancelled error
    try {
      await promise;
    } catch {
      expect(isCancelledError(result)).toBe(true);
    } finally {
      // Reset visibilityState to original value
      visibilityMock.mockRestore();
      window.dispatchEvent(new FocusEvent('focus'));
    }
  });

  test('should provide context to merapiFn', async () => {
    const key = merapiKey();

    const merapiFn = vi
      .fn<
        Promise<'data'>,
        [MerapiFunctionContext<ReturnType<typeof merapiKey>>]
      >()
      .mockResolvedValue('data');

    merapiClient.prefetchMerapi(key, merapiFn);

    await sleep(10);

    expect(merapiFn).toHaveBeenCalledTimes(1);
    const args = merapiFn.mock.calls[0]![0];
    expect(args).toBeDefined();
    expect(args.pageParam).toBeUndefined();
    expect(args.merapiKey).toEqual(key);
    expect(args.signal).toBeInstanceOf(AbortSignal);
  });

  test('should continue if cancellation is not supported and signal is not consumed', async () => {
    const key = merapiKey();

    merapiClient.prefetchMerapi(key, async () => {
      await sleep(100);
      return 'data';
    });

    await sleep(10);

    // Subscribe and unsubscribe to simulate cancellation because the last observer unsubscribed
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        enabled: false,
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    unsubscribe();

    await sleep(100);

    const query = merapiCache.find(key)!;

    expect(query.state).toMatchObject({
      data: 'data',
      status: 'success',
      dataUpdateCount: 1,
    });
  });

  test('should not continue when last observer unsubscribed if the signal was consumed', async () => {
    const key = merapiKey();

    merapiClient.prefetchMerapi(key, async ({ signal }) => {
      await sleep(100);
      return signal?.aborted ? 'aborted' : 'data';
    });

    await sleep(10);

    // Subscribe and unsubscribe to simulate cancellation because the last observer unsubscribed
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        enabled: false,
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    unsubscribe();

    await sleep(100);

    const query = merapiCache.find(key)!;

    expect(query.state).toMatchObject({
      data: undefined,
      status: 'loading',
      fetchStatus: 'idle',
    });
  });

  test('should provide an AbortSignal to the merapiFn that provides info about the cancellation state', async () => {
    const key = merapiKey();

    const merapiFn = vi.fn<
      Promise<unknown>,
      [MerapiFunctionContext<ReturnType<typeof merapiKey>>]
    >();
    const onAbort = vi.fn();
    const abortListener = vi.fn();
    let error;

    merapiFn.mockImplementation(async ({ signal }) => {
      if (signal) {
        signal.onabort = onAbort;
        signal.addEventListener('abort', abortListener);
      }
      await sleep(10);
      if (signal) {
        signal.onabort = null;
        signal.removeEventListener('abort', abortListener);
      }
      throw new Error();
    });

    const promise = merapiClient.fetchMerapi(key, merapiFn, {
      retry: 3,
      retryDelay: 10,
    });

    promise.catch((e) => {
      error = e;
    });

    const query = merapiCache.find(key)!;

    expect(merapiFn).toHaveBeenCalledTimes(1);

    const signal = merapiFn.mock.calls[0]![0].signal;
    expect(signal?.aborted).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();
    expect(abortListener).not.toHaveBeenCalled();

    query.cancel();

    await sleep(100);

    expect(signal?.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(abortListener).toHaveBeenCalledTimes(1);
    expect(isCancelledError(error)).toBe(true);
  });

  test('should not continue if explicitly cancelled', async () => {
    const key = merapiKey();

    const merapiFn = vi.fn<unknown, unknown[]>();

    merapiFn.mockImplementation(async () => {
      await sleep(10);
      throw new Error();
    });

    let error;

    const promise = merapiClient.fetchMerapi(key, merapiFn, {
      retry: 3,
      retryDelay: 10,
    });

    promise.catch((e) => {
      error = e;
    });

    const query = merapiCache.find(key)!;
    query.cancel();

    await sleep(100);

    expect(merapiFn).toHaveBeenCalledTimes(1);
    expect(isCancelledError(error)).toBe(true);
  });

  test('should not error if reset while loading', async () => {
    const key = merapiKey();

    const merapiFn = vi.fn<unknown, unknown[]>();

    merapiFn.mockImplementation(async () => {
      await sleep(10);
      throw new Error();
    });

    merapiClient.fetchMerapi(key, merapiFn, {
      retry: 3,
      retryDelay: 10,
    });

    // Ensure the query is loading
    const query = merapiCache.find(key)!;
    expect(query.state.status).toBe('loading');

    // Reset the query while it is loading
    query.reset();

    await sleep(100);

    // The query should
    expect(merapiFn).toHaveBeenCalledTimes(1); // have been called,
    expect(query.state.error).toBe(null); // not have an error, and
    expect(query.state.fetchStatus).toBe('idle'); // not be loading any longer
  });

  test('should be able to refetch a cancelled query', async () => {
    const key = merapiKey();

    const merapiFn = vi.fn<unknown, unknown[]>();

    merapiFn.mockImplementation(async () => {
      await sleep(50);
      return 'data';
    });

    merapiClient.prefetchMerapi(key, merapiFn);
    const query = merapiCache.find(key)!;
    await sleep(10);
    query.cancel();
    await sleep(100);

    expect(merapiFn).toHaveBeenCalledTimes(1);
    expect(isCancelledError(query.state.error)).toBe(true);
    const result = await query.fetch();
    expect(result).toBe('data');
    expect(query.state.error).toBe(null);
    expect(merapiFn).toHaveBeenCalledTimes(2);
  });

  test('cancelling a resolved query should not have any effect', async () => {
    const key = merapiKey();
    await merapiClient.prefetchMerapi(key, async () => 'data');
    const query = merapiCache.find(key)!;
    query.cancel();
    await sleep(10);
    expect(query.state.data).toBe('data');
  });

  test('cancelling a rejected query should not have any effect', async () => {
    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, async (): Promise<unknown> => {
      throw new Error('error');
    });
    const query = merapiCache.find(key)!;
    query.cancel();
    await sleep(10);

    expect(isError(query.state.error)).toBe(true);
    expect(isCancelledError(query.state.error)).toBe(false);
  });

  test('the previous query status should be kept when refetching', async () => {
    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, () => 'data');
    const query = merapiCache.find(key)!;
    expect(query.state.status).toBe('success');

    await merapiClient.prefetchMerapi(
      key,
      () => Promise.reject<string>('reject'),
      {
        retry: false,
      },
    );
    expect(query.state.status).toBe('error');

    merapiClient.prefetchMerapi(
      key,
      async () => {
        await sleep(10);
        return Promise.reject<unknown>('reject');
      },
      { retry: false },
    );
    expect(query.state.status).toBe('error');

    await sleep(100);
    expect(query.state.status).toBe('error');
  });

  test('queries with cacheTime 0 should be removed immediately after unsubscribing', async () => {
    const key = merapiKey();
    let count = 0;
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: () => {
          count++;
          return 'data';
        },
        cacheTime: 0,
        staleTime: Infinity,
      },
    });
    const unsubscribe1 = observer.subscribe(() => undefined);
    unsubscribe1();
    await waitFor(() => expect(merapiCache.find(key)).toBeUndefined());
    const unsubscribe2 = observer.subscribe(() => undefined);
    unsubscribe2();

    await waitFor(() => expect(merapiCache.find(key)).toBeUndefined());
    expect(count).toBe(1);
  });

  test('should be garbage collected when unsubscribed to', async () => {
    const key = merapiKey();
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: async () => 'data',
        cacheTime: 0,
      },
    });
    expect(merapiCache.find(key)).toBeDefined();
    const unsubscribe = observer.subscribe(() => undefined);
    expect(merapiCache.find(key)).toBeDefined();
    unsubscribe();
    await waitFor(() => expect(merapiCache.find(key)).toBeUndefined());
  });

  test('should be garbage collected later when unsubscribed and query is fetching', async () => {
    const key = merapiKey();
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: async () => {
          await sleep(20);
          return 'data';
        },
        cacheTime: 10,
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await sleep(20);
    expect(merapiCache.find(key)).toBeDefined();
    observer.refetch();
    unsubscribe();
    await sleep(10);
    // unsubscribe should not remove even though cacheTime has elapsed b/c query is still fetching
    expect(merapiCache.find(key)).toBeDefined();
    await sleep(10);
    // should be removed after an additional staleTime wait
    await waitFor(() => expect(merapiCache.find(key)).toBeUndefined());
  });

  test('should not be garbage collected unless there are no subscribers', async () => {
    const key = merapiKey();
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: async () => 'data',
        cacheTime: 0,
      },
    });
    expect(merapiCache.find(key)).toBeDefined();
    const unsubscribe = observer.subscribe(() => undefined);
    await sleep(100);
    expect(merapiCache.find(key)).toBeDefined();
    unsubscribe();
    await sleep(100);
    expect(merapiCache.find(key)).toBeUndefined();
    merapiClient.setMerapiData(key, 'data');
    await sleep(100);
    expect(merapiCache.find(key)).toBeDefined();
  });

  test('should return proper count of observers', async () => {
    const key = merapiKey();
    const options = { merapiKey: key, merapiFn: async () => 'data' };
    const observer = new MerapiObserver({ client: merapiClient, options });
    const observer2 = new MerapiObserver({ client: merapiClient, options });
    const observer3 = new MerapiObserver({ client: merapiClient, options });
    const query = merapiCache.find(key);

    expect(query?.getObserversCount()).toEqual(0);

    const unsubscribe1 = observer.subscribe(() => undefined);
    const unsubscribe2 = observer2.subscribe(() => undefined);
    const unsubscribe3 = observer3.subscribe(() => undefined);
    expect(query?.getObserversCount()).toEqual(3);

    unsubscribe3();
    expect(query?.getObserversCount()).toEqual(2);

    unsubscribe2();
    expect(query?.getObserversCount()).toEqual(1);

    unsubscribe1();
    expect(query?.getObserversCount()).toEqual(0);
  });

  test('stores meta object in query', async () => {
    const meta = {
      it: 'works',
    };

    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, () => 'data', {
      meta,
    });

    const query = merapiCache.find(key)!;

    expect(query.meta).toBe(meta);
    expect(query.options.meta).toBe(meta);
  });

  test('updates meta object on change', async () => {
    const meta = {
      it: 'works',
    };

    const key = merapiKey();
    const merapiFn = () => 'data';

    await merapiClient.prefetchMerapi(key, merapiFn, {
      meta,
    });

    await merapiClient.prefetchMerapi(key, merapiFn, {
      meta: undefined,
    });

    const query = merapiCache.find(key)!;

    expect(query.meta).toBeUndefined();
    expect(query.options.meta).toBeUndefined();
  });

  test('can use default meta', async () => {
    const meta = {
      it: 'works',
    };

    const key = merapiKey();
    const merapiFn = () => 'data';

    merapiClient.setMerapiDefaults(key, { meta });

    await merapiClient.prefetchMerapi(key, merapiFn);

    const query = merapiCache.find(key)!;

    expect(query.meta).toBe(meta);
  });

  test('provides meta object inside query function', async () => {
    const meta = {
      it: 'works',
    };

    const merapiFn = vi.fn(() => 'data');

    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, merapiFn, {
      meta,
    });

    expect(merapiFn).toBeCalledWith(
      expect.objectContaining({
        meta,
      }),
    );
  });

  test('should refetch the observer when online method is called', async () => {
    const key = merapiKey();

    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: () => 'data',
      },
    });

    const refetchSpy = vi.spyOn(observer, 'refetch');
    const unsubscribe = observer.subscribe(() => undefined);
    merapiCache.onOnline();

    // Should refetch the observer
    expect(refetchSpy).toHaveBeenCalledTimes(1);

    unsubscribe();
    refetchSpy.mockRestore();
  });

  test('should not add an existing observer', async () => {
    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, () => 'data');
    const query = merapiCache.find(key)!;
    expect(query.getObserversCount()).toEqual(0);

    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
      },
    });
    expect(query.getObserversCount()).toEqual(0);

    query.addObserver(observer);
    expect(query.getObserversCount()).toEqual(1);

    query.addObserver(observer);
    expect(query.getObserversCount()).toEqual(1);
  });

  test('should not try to remove an observer that does not exist', async () => {
    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, () => 'data');
    const query = merapiCache.find(key)!;
    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
      },
    });
    expect(query.getObserversCount()).toEqual(0);

    const notifySpy = vi.spyOn(merapiCache, 'notify');
    expect(() => query.removeObserver(observer)).not.toThrow();
    expect(notifySpy).not.toHaveBeenCalled();

    notifySpy.mockRestore();
  });

  test('should not dispatch "invalidate" on invalidate() if already invalidated', async () => {
    const key = merapiKey();

    await merapiClient.prefetchMerapi(key, () => 'data');
    const merapi = merapiCache.find(key)!;

    merapi.invalidate();
    expect(merapi.state.isInvalidated).toBeTruthy();

    const dispatchOriginal = merapi.dispatch;
    const dispatchSpy = vi.fn();
    merapi.dispatch = dispatchSpy;

    merapi.invalidate();

    expect(merapi.state.isInvalidated).toBeTruthy();
    expect(dispatchSpy).not.toHaveBeenCalled();

    merapi.dispatch = dispatchOriginal;
  });

  test('fetch should not dispatch "fetch" if state meta and fetchOptions meta are the same object', async () => {
    const key = merapiKey();

    const merapiFn = async () => {
      await sleep(10);
      return 'data';
    };

    await merapiClient.prefetchMerapi(key, merapiFn);
    const query = merapiCache.find(key)!;

    const meta = { meta1: '1' };

    // This first fetch will set the state.meta value
    query.fetch({
      options: {
        merapiKey: key,
        merapiFn,
      },
      fetchOptions: {
        meta,
      },
    });

    // Spy on private dispatch method
    const dispatchOriginal = query.dispatch;
    const dispatchSpy = vi.fn();
    query.dispatch = dispatchSpy;

    // Second fetch in parallel with the same meta
    query.fetch({
      options: {
        merapiKey: key,
        merapiFn,
      },
      fetchOptions: {
        meta,
        // cancelRefetch must be set to true to enter in the case to test
        // where isFetching is true
        cancelRefetch: true,
      },
    });

    // Should not call dispatch with type set to fetch
    expect(dispatchSpy).not.toHaveBeenCalledWith({
      meta,
      type: 'fetch',
    });

    // Clean-up
    await sleep(20);
    query.dispatch = dispatchOriginal;
  });

  test('fetch should not set the signal in the merapiFnContext if AbortController is undefined', async () => {
    const key = merapiKey();

    // Mock the AbortController to be undefined
    const AbortControllerOriginal = globalThis.AbortController;
    // @ts-expect-error
    globalThis.AbortController = undefined;

    let signalTest: any;
    await merapiClient.prefetchMerapi(key, ({ signal }) => {
      signalTest = signal;
      return 'data';
    });

    expect(signalTest).toBeUndefined();

    // Clean-up
    // @ts-expect-error
    globalThis.AbortController = AbortControllerOriginal;
  });

  test('fetch should throw an error if the merapiFn is not defined', async () => {
    const key = merapiKey();

    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: undefined,
        retry: false,
      },
    });

    const unsubscribe = observer.subscribe(() => undefined);
    await sleep(10);
    expect(mockLogger.error).toHaveBeenCalledWith('Missing merapiFn');

    unsubscribe();
  });

  test('fetch should dispatch an error if the merapiFn returns undefined', async () => {
    const key = merapiKey();

    const observer = new MerapiObserver({
      client: merapiClient,
      options: {
        merapiKey: key,
        merapiFn: () => undefined,
        retry: false,
      },
    });

    let observerResult: MerapiObserverResult<unknown, unknown> | undefined;

    const unsubscribe = observer.subscribe((result) => {
      observerResult = result;
    });

    await sleep(10);

    const error = new Error('undefined');

    expect(observerResult).toMatchObject({
      isError: true,
      error,
    });

    expect(mockLogger.error).toHaveBeenCalledWith(error);
    unsubscribe();
  });

  test('fetch should dispatch fetch if is fetching and current promise is undefined', async () => {
    const key = merapiKey();

    const merapiFn = async () => {
      await sleep(10);
      return 'data';
    };

    await merapiClient.prefetchMerapi(key, merapiFn);
    const query = merapiCache.find(key)!;

    query.fetch({
      options: {
        merapiKey: key,
        merapiFn,
      },
    });

    // Force promise to undefined
    // because no use case have been identified
    query.promise = undefined;

    // Spy on private dispatch method
    const dispatchOriginal = query.dispatch;
    const dispatchSpy = vi.fn();
    query.dispatch = dispatchSpy;

    query.fetch({
      options: {
        merapiKey: key,
        merapiFn,
      },
    });

    // Should call dispatch with type set to fetch
    expect(dispatchSpy).toHaveBeenCalledWith({
      meta: undefined,
      type: 'fetch',
    });

    // Clean-up
    await sleep(20);
    query.dispatch = dispatchOriginal;
  });

  test('constructor should call initialDataUpdatedAt if defined as a function', async () => {
    const key = merapiKey();

    const initialDataUpdatedAtSpy = vi.fn();

    await merapiClient.prefetchMerapi({
      merapiKey: key,
      merapiFn: () => 'data',
      initialData: 'initial',
      initialDataUpdatedAt: initialDataUpdatedAtSpy,
    });

    expect(initialDataUpdatedAtSpy).toHaveBeenCalled();
  });

  test('queries should be garbage collected even if they never fetched', async () => {
    const key = merapiKey();

    merapiClient.setMerapiDefaults(key, { cacheTime: 10 });

    const fn = vi.fn();

    const unsubscribe = merapiClient.getMerapiCache().subscribe(fn);

    merapiClient.setMerapiData(key, 'data');

    await waitFor(() =>
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'removed',
        }),
      ),
    );

    expect(merapiClient.getMerapiCache().findAll()).toHaveLength(0);

    unsubscribe();
  });
});
