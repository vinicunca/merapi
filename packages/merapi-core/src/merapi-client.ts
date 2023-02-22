import { isUndefined } from '@vinicunca/js-utilities';

import {
  type CancelOptions,
  type DefaultOptions,
  type DefaultedMerapiObserverOptions,
  type FetchInfiniteMerapiOptions,
  type FetchMerapiOptions,
  type InfiniteData,
  type InvalidateMerapiFilters,
  type InvalidateOptions,
  type MerapiClientConfig,
  type MerapiFunction,
  type MerapiKey,
  type MerapiObserverOptions,
  type MerapiOptions,
  type MutationKey,
  type MutationObserverOptions,
  type MutationOptions,
  type RefetchMerapiFilters,
  type RefetchOptions,
  type ResetMerapiFilters,
  type ResetOptions,
  type SetDataOptions, type WithRequired,
} from './entities';
import { type MerapiFilters, type MutationFilters, type Updater } from './utils';
import {
  functionalUpdate,
  hashMerapiKey,
  hashMerapiKeyByOptions,
  noop,
  parseFilterArgs,
  parseMerapiArgs,
  partialMatchKey,
} from './utils';
import { type MerapiState } from './merapi';
import { MerapiCache } from './merapi-cache';
import { MutationCache } from './mutation-cache';
import { focusManager } from './focus-manager';
import { onlineManager } from './online-manager';
import { notifyManager } from './notify-manager';
import { infiniteMerapiBehavior } from './infinite-merapi-behavior';
import { type Logger } from './logger';
import { defaultLogger } from './logger';

interface MerapiDefaults {
  merapiKey: MerapiKey;
  defaultOptions: MerapiOptions<any, any, any>;
}

interface MutationDefaults {
  mutationKey: MutationKey;
  defaultOptions: MutationOptions<any, any, any, any>;
}

export class MerapiClient {
  private merapiCache: MerapiCache;
  private mutationCache: MutationCache;
  private logger: Logger;
  private defaultOptions: DefaultOptions;
  private merapiDefaults: MerapiDefaults[];
  private mutationDefaults: MutationDefaults[];
  private mountCount: number;
  private unsubscribeFocus?: () => void;
  private unsubscribeOnline?: () => void;

  constructor(config: MerapiClientConfig = {}) {
    this.merapiCache = config.merapiCache || new MerapiCache();
    this.mutationCache = config.mutationCache || new MutationCache();
    this.logger = config.logger || defaultLogger;
    this.defaultOptions = config.defaultOptions || {};
    this.merapiDefaults = [];
    this.mutationDefaults = [];
    this.mountCount = 0;

    if (process.env.NODE_ENV !== 'production' && config.logger) {
      this.logger.error(
        'Passing a custom logger has been deprecated and will be removed in the next major version.',
      );
    }
  }

  mount(): void {
    this.mountCount++;
    if (this.mountCount !== 1) {
      return;
    }

    this.unsubscribeFocus = focusManager.subscribe(() => {
      if (focusManager.isFocused()) {
        this.resumePausedMutations();
        this.merapiCache.onFocus();
      }
    });
    this.unsubscribeOnline = onlineManager.subscribe(() => {
      if (onlineManager.isOnline()) {
        this.resumePausedMutations();
        this.merapiCache.onOnline();
      }
    });
  }

  unmount(): void {
    this.mountCount--;
    if (this.mountCount !== 0) {
      return;
    }

    this.unsubscribeFocus?.();
    this.unsubscribeFocus = undefined;

    this.unsubscribeOnline?.();
    this.unsubscribeOnline = undefined;
  }

  isFetching(filters?: MerapiFilters): number;
  isFetching(merapiKey?: MerapiKey, filters?: MerapiFilters): number;
  isFetching(arg1?: MerapiKey | MerapiFilters, arg2?: MerapiFilters): number {
    const [filters] = parseFilterArgs(arg1, arg2);
    filters.fetchStatus = 'fetching';
    return this.merapiCache.findAll(filters).length;
  }

  isMutating(filters?: MutationFilters): number {
    return this.mutationCache.findAll({ ...filters, fetching: true }).length;
  }

  getMerapiData<TMerapiFnData = unknown>(
    merapiKey: MerapiKey,
    filters?: MerapiFilters,
  ): TMerapiFnData | undefined {
    return this.merapiCache.find<TMerapiFnData>(merapiKey, filters)?.state.data;
  }

  ensureMerapiData<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    options: WithRequired<
      FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
      'merapiKey'
    >,
  ): Promise<TData>;
  ensureMerapiData<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    options?: Omit<
      FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
      'merapiKey'
    >,
  ): Promise<TData>;
  ensureMerapiData<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    merapiFn: MerapiFunction<TMerapiFnData, TMerapiKey>,
    options?: Omit<
      FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
      'merapiKey' | 'merapiFn'
    >,
  ): Promise<TData>;
  ensureMerapiData<
    TMerapiFnData,
    TError,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    arg1:
      | TMerapiKey
      | WithRequired<
          FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
          'merapiKey'
        >,
    arg2?:
      | MerapiFunction<TMerapiFnData, TMerapiKey>
      | FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg3?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<TData> {
    const parsedOptions = parseMerapiArgs(arg1, arg2, arg3);
    const cachedData = this.getMerapiData<TData>(parsedOptions.merapiKey!);

    return cachedData
      ? Promise.resolve(cachedData)
      : this.fetchMerapi(parsedOptions);
  }

  getMerapisData<TMerapiFnData = unknown>(
    merapiKey: MerapiKey,
  ): [MerapiKey, TMerapiFnData | undefined][];
  getMerapisData<TMerapiFnData = unknown>(
    filters: MerapiFilters,
  ): [MerapiKey, TMerapiFnData | undefined][];
  getMerapisData<TMerapiFnData = unknown>(
    merapiKeyOrFilters: MerapiKey | MerapiFilters,
  ): [MerapiKey, TMerapiFnData | undefined][] {
    return this.getMerapiCache()
      .findAll(merapiKeyOrFilters)
      .map(({ merapiKey, state }) => {
        const data = state.data as TMerapiFnData | undefined;
        return [merapiKey, data];
      });
  }

  setMerapiData<TMerapiFnData>(
    merapiKey: MerapiKey,
    updater: Updater<TMerapiFnData | undefined, TMerapiFnData | undefined>,
    options?: SetDataOptions,
  ): TMerapiFnData | undefined {
    const merapi = this.merapiCache.find<TMerapiFnData>(merapiKey);
    const prevData = merapi?.state.data;
    const data = functionalUpdate({ updater, input: prevData });

    if (isUndefined(data)) {
      return undefined;
    }

    const parsedOptions = parseMerapiArgs(merapiKey);
    const defaultedOptions = this.defaultMerapiOptions(parsedOptions);
    return this.merapiCache
      .build({ client: this, options: defaultedOptions })
      .setData(data, { ...options, manual: true });
  }

  setMerapisData<TMerapiFnData>(
    merapiKey: MerapiKey,
    updater: Updater<TMerapiFnData | undefined, TMerapiFnData | undefined>,
    options?: SetDataOptions,
  ): [MerapiKey, TMerapiFnData | undefined][];

  setMerapisData<TMerapiFnData>(
    filters: MerapiFilters,
    updater: Updater<TMerapiFnData | undefined, TMerapiFnData | undefined>,
    options?: SetDataOptions,
  ): [MerapiKey, TMerapiFnData | undefined][];

  setMerapisData<TMerapiFnData>(
    merapiKeyOrFilters: MerapiKey | MerapiFilters,
    updater: Updater<TMerapiFnData | undefined, TMerapiFnData | undefined>,
    options?: SetDataOptions,
  ): [MerapiKey, TMerapiFnData | undefined][] {
    return notifyManager.batch(() =>
      this.getMerapiCache()
        .findAll(merapiKeyOrFilters)
        .map(({ merapiKey }) => [
          merapiKey,
          this.setMerapiData<TMerapiFnData>(merapiKey, updater, options),
        ]),
    );
  }

  getMerapiState<TMerapiFnData = unknown, TError = undefined>(
    merapiKey: MerapiKey,
    filters?: MerapiFilters,
  ): MerapiState<TMerapiFnData, TError> | undefined {
    return this.merapiCache.find<TMerapiFnData, TError>(merapiKey, filters)?.state;
  }

  removeMerapis(filters?: MerapiFilters): void;
  removeMerapis(merapiKey?: MerapiKey, filters?: MerapiFilters): void;
  removeMerapis(arg1?: MerapiKey | MerapiFilters, arg2?: MerapiFilters): void {
    const [filters] = parseFilterArgs(arg1, arg2);
    const merapiCache = this.merapiCache;
    notifyManager.batch(() => {
      merapiCache.findAll(filters).forEach((merapi) => {
        merapiCache.remove(merapi);
      });
    });
  }

  resetMerapis<TPageData = unknown>(
    filters?: ResetMerapiFilters<TPageData>,
    options?: ResetOptions,
  ): Promise<void>;
  resetMerapis<TPageData = unknown>(
    merapiKey?: MerapiKey,
    filters?: ResetMerapiFilters<TPageData>,
    options?: ResetOptions,
  ): Promise<void>;
  resetMerapis(
    arg1?: MerapiKey | ResetMerapiFilters,
    arg2?: ResetMerapiFilters | ResetOptions,
    arg3?: ResetOptions,
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3);
    const merapiCache = this.merapiCache;

    const refetchFilters: RefetchMerapiFilters = {
      type: 'active',
      ...filters,
    };

    return notifyManager.batch(() => {
      merapiCache.findAll(filters).forEach((merapi) => {
        merapi.reset();
      });
      return this.refetchMerapis(refetchFilters, options);
    });
  }

  cancelMerapis(filters?: MerapiFilters, options?: CancelOptions): Promise<void>;
  cancelMerapis(
    merapiKey?: MerapiKey,
    filters?: MerapiFilters,
    options?: CancelOptions,
  ): Promise<void>;
  cancelMerapis(
    arg1?: MerapiKey | MerapiFilters,
    arg2?: MerapiFilters | CancelOptions,
    arg3?: CancelOptions,
  ): Promise<void> {
    const [filters, cancelOptions = {}] = parseFilterArgs(arg1, arg2, arg3);

    if (isUndefined(cancelOptions.revert)) {
      cancelOptions.revert = true;
    }

    const promises = notifyManager.batch(() =>
      this.merapiCache
        .findAll(filters)
        .map((merapi) => merapi.cancel(cancelOptions)),
    );

    return Promise.all(promises).then(noop).catch(noop);
  }

  invalidateMerapis<TPageData = unknown>(
    filters?: InvalidateMerapiFilters<TPageData>,
    options?: InvalidateOptions,
  ): Promise<void>;
  invalidateMerapis<TPageData = unknown>(
    merapiKey?: MerapiKey,
    filters?: InvalidateMerapiFilters<TPageData>,
    options?: InvalidateOptions,
  ): Promise<void>;
  invalidateMerapis(
    arg1?: MerapiKey | InvalidateMerapiFilters,
    arg2?: InvalidateMerapiFilters | InvalidateOptions,
    arg3?: InvalidateOptions,
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3);

    return notifyManager.batch(() => {
      this.merapiCache.findAll(filters).forEach((merapi) => {
        merapi.invalidate();
      });

      if (filters.refetchType === 'none') {
        return Promise.resolve();
      }
      const refetchFilters: RefetchMerapiFilters = {
        ...filters,
        type: filters.refetchType ?? filters.type ?? 'active',
      };
      return this.refetchMerapis(refetchFilters, options);
    });
  }

  refetchMerapis<TPageData = unknown>(
    filters?: RefetchMerapiFilters<TPageData>,
    options?: RefetchOptions,
  ): Promise<void>;
  refetchMerapis<TPageData = unknown>(
    merapiKey?: MerapiKey,
    filters?: RefetchMerapiFilters<TPageData>,
    options?: RefetchOptions,
  ): Promise<void>;
  refetchMerapis(
    arg1?: MerapiKey | RefetchMerapiFilters,
    arg2?: RefetchMerapiFilters | RefetchOptions,
    arg3?: RefetchOptions,
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3);

    const promises = notifyManager.batch(() =>
      this.merapiCache
        .findAll(filters)
        .filter((merapi) => !merapi.isDisabled())
        .map((merapi) =>
          merapi.fetch({
            fetchOptions: {
              ...options,
              cancelRefetch: options?.cancelRefetch ?? true,
              meta: { refetchPage: filters.refetchPage },
            },
          }),
        ),
    );

    let promise = Promise.all(promises).then(noop);

    if (!options?.throwOnError) {
      promise = promise.catch(noop);
    }

    return promise;
  }

  fetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    options: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<TData>;
  fetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    options?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<TData>;
  fetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    merapiFn: MerapiFunction<TMerapiFnData, TMerapiKey>,
    options?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<TData>;
  fetchMerapi<
    TMerapiFnData,
    TError,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    arg1: TMerapiKey | FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg2?:
      | MerapiFunction<TMerapiFnData, TMerapiKey>
      | FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg3?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<TData> {
    const parsedOptions = parseMerapiArgs(arg1, arg2, arg3);
    const defaultedOptions = this.defaultMerapiOptions(parsedOptions);

    if (isUndefined(defaultedOptions.retry)) {
      defaultedOptions.retry = false;
    }

    const merapi = this.merapiCache.build({ client: this, options: defaultedOptions });

    return merapi.isStaleByTime(defaultedOptions.staleTime)
      ? merapi.fetch({ options: defaultedOptions })
      : Promise.resolve(merapi.state.data as TData);
  }

  prefetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    options: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    options?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    merapiFn: MerapiFunction<TMerapiFnData, TMerapiKey>,
    options?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    arg1: TMerapiKey | FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg2?:
      | MerapiFunction<TMerapiFnData, TMerapiKey>
      | FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg3?: FetchMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void> {
    return this.fetchMerapi(arg1 as any, arg2 as any, arg3)
      .then(noop)
      .catch(noop);
  }

  fetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    options: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<InfiniteData<TData>>;
  fetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    options?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<InfiniteData<TData>>;
  fetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    merapiFn: MerapiFunction<TMerapiFnData, TMerapiKey>,
    options?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<InfiniteData<TData>>;
  fetchInfiniteMerapi<
    TMerapiFnData,
    TError,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    arg1:
      | TMerapiKey
      | FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg2?:
      | MerapiFunction<TMerapiFnData, TMerapiKey>
      | FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg3?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<InfiniteData<TData>> {
    const parsedOptions = parseMerapiArgs(arg1, arg2, arg3);
    parsedOptions.behavior = infiniteMerapiBehavior<
      TMerapiFnData,
      TError,
      TData
    >();
    return this.fetchMerapi(parsedOptions);
  }

  prefetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    options: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    options?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchInfiniteMerapi<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiKey: TMerapiKey,
    merapiFn: MerapiFunction<TMerapiFnData, TMerapiKey>,
    options?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void>;
  prefetchInfiniteMerapi<
    TMerapiFnData,
    TError,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    arg1:
      | TMerapiKey
      | FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg2?:
      | MerapiFunction<TMerapiFnData, TMerapiKey>
      | FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
    arg3?: FetchInfiniteMerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): Promise<void> {
    return this.fetchInfiniteMerapi(arg1 as any, arg2 as any, arg3)
      .then(noop)
      .catch(noop);
  }

  resumePausedMutations(): Promise<unknown> {
    return this.mutationCache.resumePausedMutations();
  }

  getMerapiCache(): MerapiCache {
    return this.merapiCache;
  }

  getMutationCache(): MutationCache {
    return this.mutationCache;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getDefaultOptions(): DefaultOptions {
    return this.defaultOptions;
  }

  setDefaultOptions(options: DefaultOptions): void {
    this.defaultOptions = options;
  }

  setMerapiDefaults(
    merapiKey: MerapiKey,
    options: MerapiObserverOptions<unknown, any, any, any>,
  ): void {
    const result = this.merapiDefaults.find(
      (x) => hashMerapiKey(merapiKey) === hashMerapiKey(x.merapiKey),
    );
    if (result) {
      result.defaultOptions = options;
    } else {
      this.merapiDefaults.push({ merapiKey, defaultOptions: options });
    }
  }

  getMerapiDefaults(
    merapiKey?: MerapiKey,
  ): MerapiObserverOptions<any, any, any, any, any> | undefined {
    if (!merapiKey) {
      return undefined;
    }

    // Get the first matching defaults
    const firstMatchingDefaults = this.merapiDefaults.find((x) =>
      partialMatchKey(merapiKey, x.merapiKey),
    );

    // Additional checks and error in dev mode
    if (process.env.NODE_ENV !== 'production') {
      // Retrieve all matching defaults for the given key
      const matchingDefaults = this.merapiDefaults.filter((x) =>
        partialMatchKey(merapiKey, x.merapiKey),
      );
      // It is ok not having defaults, but it is error prone to have more than 1 default for a given key
      if (matchingDefaults.length > 1) {
        this.logger.error(
          `[MerapiClient] Several merapi defaults match with key '${JSON.stringify(
            merapiKey,
          )}'. The first matching merapi defaults are used. Please check how merapi defaults are registered. Order does matter here. cf. https://react-merapi.tanstack.com/reference/MerapiClient#merapiclientsetmerapidefaults.`,
        );
      }
    }

    return firstMatchingDefaults?.defaultOptions;
  }

  setMutationDefaults(
    mutationKey: MutationKey,
    options: MutationObserverOptions<any, any, any, any>,
  ): void {
    const result = this.mutationDefaults.find(
      (x) => hashMerapiKey(mutationKey) === hashMerapiKey(x.mutationKey),
    );
    if (result) {
      result.defaultOptions = options;
    } else {
      this.mutationDefaults.push({ mutationKey, defaultOptions: options });
    }
  }

  getMutationDefaults(
    mutationKey?: MutationKey,
  ): MutationObserverOptions<any, any, any, any> | undefined {
    if (!mutationKey) {
      return undefined;
    }

    // Get the first matching defaults
    const firstMatchingDefaults = this.mutationDefaults.find((x) =>
      partialMatchKey(mutationKey, x.mutationKey),
    );

    // Additional checks and error in dev mode
    if (process.env.NODE_ENV !== 'production') {
      // Retrieve all matching defaults for the given key
      const matchingDefaults = this.mutationDefaults.filter((x) =>
        partialMatchKey(mutationKey, x.mutationKey),
      );
      // It is ok not having defaults, but it is error prone to have more than 1 default for a given key
      if (matchingDefaults.length > 1) {
        this.logger.error(
          `[MerapiClient] Several mutation defaults match with key '${JSON.stringify(
            mutationKey,
          )}'. The first matching mutation defaults are used. Please check how mutation defaults are registered. Order does matter here. cf. https://react-merapi.tanstack.com/reference/MerapiClient#merapiclientsetmutationdefaults.`,
        );
      }
    }

    return firstMatchingDefaults?.defaultOptions;
  }

  defaultMerapiOptions<
    TMerapiFnData,
    TError,
    TData,
    TMerapiData,
    TMerapiKey extends MerapiKey,
  >(
    options?:
      | MerapiObserverOptions<TMerapiFnData, TError, TData, TMerapiData, TMerapiKey>
      | DefaultedMerapiObserverOptions<
          TMerapiFnData,
          TError,
          TData,
          TMerapiData,
          TMerapiKey
        >,
  ): DefaultedMerapiObserverOptions<
    TMerapiFnData,
    TError,
    TData,
    TMerapiData,
    TMerapiKey
  > {
    if (options?._defaulted) {
      return options as DefaultedMerapiObserverOptions<
        TMerapiFnData,
        TError,
        TData,
        TMerapiData,
        TMerapiKey
      >;
    }

    const defaultedOptions = {
      ...this.defaultOptions.merapis,
      ...this.getMerapiDefaults(options?.merapiKey),
      ...options,
      _defaulted: true,
    };

    if (!defaultedOptions.merapiHash && defaultedOptions.merapiKey) {
      defaultedOptions.merapiHash = hashMerapiKeyByOptions(
        defaultedOptions.merapiKey,
        defaultedOptions,
      );
    }

    // dependent default values
    if (isUndefined(defaultedOptions.refetchOnReconnect)) {
      defaultedOptions.refetchOnReconnect
        = defaultedOptions.networkMode !== 'always';
    }
    if (isUndefined(defaultedOptions.useErrorBoundary)) {
      defaultedOptions.useErrorBoundary = !!defaultedOptions.suspense;
    }

    return defaultedOptions as DefaultedMerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >;
  }

  defaultMutationOptions<T extends MutationOptions<any, any, any, any>>(
    options?: T,
  ): T {
    if (options?._defaulted) {
      return options;
    }
    return {
      ...this.defaultOptions.mutations,
      ...this.getMutationDefaults(options?.mutationKey),
      ...options,
      _defaulted: true,
    } as T;
  }

  clear(): void {
    this.merapiCache.clear();
    this.mutationCache.clear();
  }
}
