import { describe, expect, test, vi } from 'vitest';
import { sleep } from '@vinicunca/js-utilities';

import {
  createMerapiClient,
  executeMutation,
  mockNavigatorOnLine,
} from './utils';
import { MerapiCache } from '../merapi-cache';
import { dehydrate, hydrate } from '../hydration';

async function fetchData<TData>(value: TData, ms?: number): Promise<TData> {
  await sleep(ms || 0);
  return value;
}

describe('dehydration and rehydration', () => {
  test.only('should work with serializeable values', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () => fetchData('string'));
    await merapiClient.prefetchMerapi(['number'], () => fetchData(1));
    await merapiClient.prefetchMerapi(['boolean'], () => fetchData(true));
    await merapiClient.prefetchMerapi(['null'], () => fetchData(null));
    await merapiClient.prefetchMerapi(['array'], () => fetchData(['string', 0]));
    await merapiClient.prefetchMerapi(['nested'], () =>
      fetchData({ key: [{ nestedKey: 1 }] }),
    );
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({
      merapiCache: hydrationCache,
    });
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    // expect(hydrationCache.find(['string'])?.state.data).toBe('string');
    // expect(hydrationCache.find(['number'])?.state.data).toBe(1);
    // expect(hydrationCache.find(['boolean'])?.state.data).toBe(true);
    // expect(hydrationCache.find(['null'])?.state.data).toBe(null);
    // expect(hydrationCache.find(['array'])?.state.data).toEqual(['string', 0]);
    // expect(hydrationCache.find(['nested'])?.state.data).toEqual({
    //   key: [{ nestedKey: 1 }],
    // });

    // const fetchDataAfterHydration = vi.fn<unknown, unknown[]>();
    // await hydrationClient.prefetchMerapi(['string'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // await hydrationClient.prefetchMerapi(['number'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // await hydrationClient.prefetchMerapi(['boolean'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // await hydrationClient.prefetchMerapi(['null'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // await hydrationClient.prefetchMerapi(['array'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // await hydrationClient.prefetchMerapi(['nested'], fetchDataAfterHydration, {
    //   staleTime: 1000,
    // });
    // expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0);

    // merapiClient.clear();
    // hydrationClient.clear();
  });

  test('should not dehydrate merapis if dehydrateQueries is set to false', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () => fetchData('string'));

    const dehydrated = dehydrate({ client: merapiClient, options: { dehydrateQueries: false } });

    expect(dehydrated.merapis.length).toBe(0);

    merapiClient.clear();
  });

  test('should use the cache time from the client', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () => fetchData('string'), {
      cacheTime: 50,
    });
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    await sleep(20);

    // ---

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(hydrationCache.find(['string'])?.state.data).toBe('string');
    await sleep(100);
    expect(hydrationCache.find(['string'])).toBeTruthy();

    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should be able to provide default options for the hydrated merapis', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () => fetchData('string'));
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);
    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({
      client: hydrationClient,
      dehydratedState: parsed,
      options: {
        defaultOptions: { merapis: { retry: 10 } },
      },
    });
    expect(hydrationCache.find(['string'])?.options.retry).toBe(10);
    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should work with complex keys', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(
      ['string', { key: ['string'], key2: 0 }],
      () => fetchData('string'),
    );
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    // ---

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(
      hydrationCache.find(['string', { key: ['string'], key2: 0 }])?.state.data,
    ).toBe('string');

    const fetchDataAfterHydration = vi.fn<unknown, unknown[]>();
    await hydrationClient.prefetchMerapi(
      ['string', { key: ['string'], key2: 0 }],
      fetchDataAfterHydration,
      { staleTime: 100 },
    );
    expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0);

    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should only hydrate successful merapis by default', async () => {
    const consoleMock = vi.spyOn(console, 'error');
    consoleMock.mockImplementation(() => undefined);

    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['success'], () => fetchData('success'));
    merapiClient.prefetchMerapi(['loading'], () => fetchData('loading', 10000));
    await merapiClient.prefetchMerapi(['error'], () => {
      throw new Error();
    });
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    // ---

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({ client: hydrationClient, dehydratedState: parsed });

    expect(hydrationCache.find(['success'])).toBeTruthy();
    expect(hydrationCache.find(['loading'])).toBeFalsy();
    expect(hydrationCache.find(['error'])).toBeFalsy();

    merapiClient.clear();
    hydrationClient.clear();
    consoleMock.mockRestore();
  });

  test('should filter merapis via shouldDehydrateMerapi', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () => fetchData('string'));
    await merapiClient.prefetchMerapi(['number'], () => fetchData(1));
    const dehydrated = dehydrate({
      client: merapiClient,
      options: {
        shouldDehydrateMerapi: (merapi) => merapi.merapiKey[0] !== 'string',
      },
    });

    // This is testing implementation details that can change and are not
    // part of the public API, but is important for keeping the payload small
    const dehydratedMerapi = dehydrated.merapis.find(
      (merapi) => merapi.merapiKey[0] === 'string',
    );
    expect(dehydratedMerapi).toBeUndefined();

    const stringified = JSON.stringify(dehydrated);

    // ---

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(hydrationCache.find(['string'])).toBeUndefined();
    expect(hydrationCache.find(['number'])?.state.data).toBe(1);

    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should not overwrite merapi in cache if hydrated merapi is older', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () =>
      fetchData('string-older', 5),
    );
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    // ---

    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    await hydrationClient.prefetchMerapi(['string'], () =>
      fetchData('string-newer', 5),
    );

    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(hydrationCache.find(['string'])?.state.data).toBe('string-newer');

    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should overwrite merapi in cache if hydrated merapi is newer', async () => {
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    await hydrationClient.prefetchMerapi(['string'], () =>
      fetchData('string-older', 5),
    );

    // ---

    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });
    await merapiClient.prefetchMerapi(['string'], () =>
      fetchData('string-newer', 5),
    );
    const dehydrated = dehydrate({ client: merapiClient });
    const stringified = JSON.stringify(dehydrated);

    // ---

    const parsed = JSON.parse(stringified);
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(hydrationCache.find(['string'])?.state.data).toBe('string-newer');

    merapiClient.clear();
    hydrationClient.clear();
  });

  test('should be able to dehydrate mutations and continue on hydration', async () => {
    const consoleMock = vi.spyOn(console, 'error');
    consoleMock.mockImplementation(() => undefined);
    const onlineMock = mockNavigatorOnLine(false);

    const serverAddTodo = vi
      .fn()
      .mockImplementation(() => Promise.reject('offline'));
    const serverOnMutate = vi.fn().mockImplementation((variables) => {
      const optimisticTodo = { id: 1, text: variables.text };
      return { optimisticTodo };
    });
    const serverOnSuccess = vi.fn();

    const serverClient = createMerapiClient();

    serverClient.setMutationDefaults(['addTodo'], {
      mutationFn: serverAddTodo,
      onMutate: serverOnMutate,
      onSuccess: serverOnSuccess,
      retry: 3,
      retryDelay: 10,
    });

    executeMutation(serverClient, {
      mutationKey: ['addTodo'],
      variables: { text: 'text' },
    }).catch(() => undefined);

    await sleep(50);

    const dehydrated = dehydrate({ client: serverClient });
    const stringified = JSON.stringify(dehydrated);

    serverClient.clear();

    // ---

    onlineMock.mockReturnValue(true);

    const parsed = JSON.parse(stringified);
    const client = createMerapiClient();

    const clientAddTodo = vi.fn().mockImplementation((variables) => {
      return { id: 2, text: variables.text };
    });
    const clientOnMutate = vi.fn().mockImplementation((variables) => {
      const optimisticTodo = { id: 1, text: variables.text };
      return { optimisticTodo };
    });
    const clientOnSuccess = vi.fn();

    client.setMutationDefaults(['addTodo'], {
      mutationFn: clientAddTodo,
      onMutate: clientOnMutate,
      onSuccess: clientOnSuccess,
      retry: 3,
      retryDelay: 10,
    });

    hydrate({ client, dehydratedState: parsed });

    await client.resumePausedMutations();

    expect(clientAddTodo).toHaveBeenCalledTimes(1);
    expect(clientOnMutate).not.toHaveBeenCalled();
    expect(clientOnSuccess).toHaveBeenCalledTimes(1);
    expect(clientOnSuccess).toHaveBeenCalledWith(
      { id: 2, text: 'text' },
      { text: 'text' },
      { optimisticTodo: { id: 1, text: 'text' } },
    );

    client.clear();
    consoleMock.mockRestore();
    onlineMock.mockRestore();
  });

  test('should not dehydrate mutations if dehydrateMutations is set to false', async () => {
    const consoleMock = vi.spyOn(console, 'error');
    consoleMock.mockImplementation(() => undefined);

    const serverAddTodo = vi
      .fn()
      .mockImplementation(() => Promise.reject('offline'));

    const merapiClient = createMerapiClient();

    merapiClient.setMutationDefaults(['addTodo'], {
      mutationFn: serverAddTodo,
      retry: false,
    });

    executeMutation(merapiClient, {
      mutationKey: ['addTodo'],
      variables: { text: 'text' },
    }).catch(() => undefined);

    await sleep(1);
    const dehydrated = dehydrate({ client: merapiClient, options: { dehydrateMutations: false } });

    expect(dehydrated.mutations.length).toBe(0);

    merapiClient.clear();
    consoleMock.mockRestore();
  });

  test('should not dehydrate mutation if mutation state is set to pause', async () => {
    const consoleMock = vi.spyOn(console, 'error');
    consoleMock.mockImplementation(() => undefined);

    const serverAddTodo = vi
      .fn()
      .mockImplementation(() => Promise.reject('offline'));

    const merapiClient = createMerapiClient();

    merapiClient.setMutationDefaults(['addTodo'], {
      mutationFn: serverAddTodo,
      retry: 1,
      retryDelay: 20,
    });

    executeMutation(merapiClient, {
      mutationKey: ['addTodo'],
      variables: { text: 'text' },
    }).catch(() => undefined);

    // Dehydrate mutation between retries
    await sleep(1);
    const dehydrated = dehydrate({ client: merapiClient });

    expect(dehydrated.mutations.length).toBe(0);

    await sleep(30);
    merapiClient.clear();
    consoleMock.mockRestore();
  });

  test('should not hydrate if the hydratedState is null or is not an object', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });

    expect(() => hydrate({ client: merapiClient, dehydratedState: null })).not.toThrow();
    expect(() => hydrate({ client: merapiClient, dehydratedState: 'invalid' })).not.toThrow();

    merapiClient.clear();
  });

  test('should support hydratedState with undefined merapis and mutations', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });

    expect(() => hydrate({ client: merapiClient, dehydratedState: {} })).not.toThrow();
    expect(() => hydrate({ client: merapiClient, dehydratedState: {} })).not.toThrow();

    merapiClient.clear();
  });

  test('should set the fetchStatus to idle in all cases when dehydrating', async () => {
    const merapiCache = new MerapiCache();
    const merapiClient = createMerapiClient({ merapiCache });

    let isInitialFetch = true;
    let resolvePromise: (value: unknown) => void = () => undefined;

    const customFetchData = () => {
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      // Resolve the promise in initial fetch
      // because we are awaiting the query first time
      if (isInitialFetch) {
        resolvePromise('string');
      }
      isInitialFetch = false;
      return promise;
    };

    await merapiClient.prefetchMerapi(['string'], () => customFetchData());

    merapiClient.refetchMerapis(['string']);

    const dehydrated = dehydrate({ client: merapiClient });
    resolvePromise('string');
    expect(
      dehydrated.merapis.find((q) => q.merapiHash === '["string"]')?.state
        .fetchStatus,
    ).toBe('fetching');
    const stringified = JSON.stringify(dehydrated);

    // ---
    const parsed = JSON.parse(stringified);
    const hydrationCache = new MerapiCache();
    const hydrationClient = createMerapiClient({ merapiCache: hydrationCache });
    hydrate({ client: hydrationClient, dehydratedState: parsed });
    expect(hydrationCache.find(['string'])?.state.fetchStatus).toBe('idle');
  });
});
