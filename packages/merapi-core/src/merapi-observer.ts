import { isBoolean, isDefined, isFunction, isUndefined } from '@vinicunca/js-utilities';

import { type Action, type FetchOptions, type Merapi, type MerapiState } from './merapi';
import { type DefaultedMerapiObserverOptions, type MerapiKey, type MerapiObserverBaseResult, type MerapiObserverOptions, type MerapiObserverResult, type MerapiOptions, type PlaceholderDataFunction, type RefetchOptions, type RefetchPageFilters } from './entities';
import { focusManager } from './focus-manager';
import { type MerapiClient } from './merapi-client';
import { canFetch, isCancelledError } from './retryer';
import { Subscribable } from './subscribable';
import { isServer, isValidTimeout, noop, replaceData, shallowEqualObjects, timeUntilStale } from './utils';
import { notifyManager } from './notify-manager';

type MerapiObserverListener<TData, TError> = (
  result: MerapiObserverResult<TData, TError>,
) => void;

export interface NotifyOptions {
  cache?: boolean;
  listeners?: boolean;
  onError?: boolean;
  onSuccess?: boolean;
}

export interface ObserverFetchOptions extends FetchOptions {
  throwOnError?: boolean;
}

export class MerapiObserver<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends Subscribable<MerapiObserverListener<TData, TError>> {
  options: MerapiObserverOptions<
    TMerapiFnData,
    TError,
    TData,
    TMerapiData,
    TMerapiKey
  >;

  private client: MerapiClient;
  private currentMerapi!: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>;
  private currentMerapiInitialState!: MerapiState<TMerapiData, TError>;
  private currentResult!: MerapiObserverResult<TData, TError>;
  private currentResultState?: MerapiState<TMerapiData, TError>;
  private currentResultOptions?: MerapiObserverOptions<
    TMerapiFnData,
    TError,
    TData,
    TMerapiData,
    TMerapiKey
  >;

  private previousMerapiResult?: MerapiObserverResult<TData, TError>;
  private selectError: TError | null;
  private selectFn?: (data: TMerapiData) => TData;
  private selectResult?: TData;
  private staleTimeoutId?: ReturnType<typeof setTimeout>;
  private refetchIntervalId?: ReturnType<typeof setInterval>;
  private currentRefetchInterval?: number | false;
  private trackedProps!: Set<keyof MerapiObserverResult>;

  constructor(
    { client, options }:
    {
      client: MerapiClient;
      options: MerapiObserverOptions<
        TMerapiFnData,
        TError,
        TData,
        TMerapiData,
        TMerapiKey
      >;
    },
  ) {
    super();

    this.client = client;
    this.options = options;
    this.trackedProps = new Set();
    this.selectError = null;
    this.bindMethods();
    this.setOptions(options);
  }

  protected bindMethods(): void {
    this.remove = this.remove.bind(this);
    this.refetch = this.refetch.bind(this);
  }

  protected onSubscribe(): void {
    if (this.listeners.length === 1) {
      this.currentMerapi.addObserver(this);

      if (shouldFetchOnMount({ merapi: this.currentMerapi, options: this.options })) {
        this.executeFetch();
      }

      this.updateTimers();
    }
  }

  protected onUnsubscribe(): void {
    if (!this.listeners.length) {
      this.destroy();
    }
  }

  shouldFetchOnReconnect(): boolean {
    return shouldFetchOn({
      merapi: this.currentMerapi,
      options: this.options,
      field: this.options.refetchOnReconnect,
    });
  }

  shouldFetchOnWindowFocus(): boolean {
    return shouldFetchOn({
      merapi: this.currentMerapi,
      options: this.options,
      field: this.options.refetchOnWindowFocus,
    });
  }

  destroy(): void {
    this.listeners = [];
    this.clearStaleTimeout();
    this.clearRefetchInterval();
    this.currentMerapi.removeObserver(this);
  }

  setOptions(
    options?: MerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
    notifyOptions?: NotifyOptions,
  ): void {
    const prevOptions = this.options;
    const prevMerapi = this.currentMerapi;

    this.options = this.client.defaultMerapiOptions(options);

    // ! TODO: handle this
    if (
      process.env.NODE_ENV !== 'production'
      && isDefined(options?.isDataEqual)
    ) {
      this.client
        .getLogger()
        .error(
          'The isDataEqual option has been deprecated and will be removed in the next major version. You can achieve the same functionality by passing a function as the structuralSharing option',
        );
    }

    if (!shallowEqualObjects(prevOptions, this.options)) {
      this.client.getMerapiCache().notify({
        type: 'observerOptionsUpdated',
        merapi: this.currentMerapi,
        observer: this,
      });
    }

    if (isDefined(this.options.enabled) && !isBoolean(this.options.enabled)) {
      throw new Error('Expected enabled to be a boolean');
    }

    // Keep previous Merapi key if the user does not supply one
    if (!this.options.merapiKey) {
      this.options.merapiKey = prevOptions.merapiKey;
    }

    this.updateMerapi();

    const mounted = this.hasListeners();

    // Fetch if there are subscribers
    if (
      mounted
      && shouldFetchOptionally({
        merapi: this.currentMerapi,
        prevMerapi,
        options: this.options,
        prevOptions,
      })
    ) {
      this.executeFetch();
    }

    // Update result
    this.updateResult(notifyOptions);

    // Update stale interval if needed
    if (
      mounted
      && (
        this.currentMerapi !== prevMerapi
        || this.options.enabled !== prevOptions.enabled
        || this.options.staleTime !== prevOptions.staleTime
      )
    ) {
      this.updateStaleTimeout();
    }

    const nextRefetchInterval = this.computeRefetchInterval();

    // Update refetch interval if needed
    if (
      mounted
      && (
        this.currentMerapi !== prevMerapi
        || this.options.enabled !== prevOptions.enabled
        || nextRefetchInterval !== this.currentRefetchInterval
      )
    ) {
      this.updateRefetchInterval(nextRefetchInterval);
    }
  }

  getOptimisticResult(
    options: DefaultedMerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
  ): MerapiObserverResult<TData, TError> {
    const merapi = this.client.getMerapiCache().build({ client: this.client, options });

    return this.createResult({ merapi, options });
  }

  getCurrentResult(): MerapiObserverResult<TData, TError> {
    return this.currentResult;
  }

  trackResult(
    result: MerapiObserverResult<TData, TError>,
  ): MerapiObserverResult<TData, TError> {
    const trackedResult = {} as MerapiObserverResult<TData, TError>;

    Object.keys(result).forEach((key) => {
      Object.defineProperty(trackedResult, key, {
        configurable: false,
        enumerable: true,
        get: () => {
          this.trackedProps.add(key as keyof MerapiObserverResult);
          return result[key as keyof MerapiObserverResult];
        },
      });
    });

    return trackedResult;
  }

  getCurrentMerapi(): Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey> {
    return this.currentMerapi;
  }

  remove(): void {
    this.client.getMerapiCache().remove(this.currentMerapi);
  }

  refetch<TPageData>({
    refetchPage,
    ...options
  }: RefetchOptions & RefetchPageFilters<TPageData> = {}): Promise<
    MerapiObserverResult<TData, TError>
  > {
    return this.fetch({
      ...options,
      meta: { refetchPage },
    });
  }

  fetchOptimistic(
    options: MerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
  ): Promise<MerapiObserverResult<TData, TError>> {
    const defaultedOptions = this.client.defaultMerapiOptions(options);

    const merapi = this.client
      .getMerapiCache()
      .build({ client: this.client, options: defaultedOptions });
    merapi.isFetchingOptimistic = true;

    return merapi.fetch().then(() => this.createResult({ merapi, options: defaultedOptions }));
  }

  protected fetch(
    fetchOptions: ObserverFetchOptions,
  ): Promise<MerapiObserverResult<TData, TError>> {
    return this.executeFetch({
      ...fetchOptions,
      cancelRefetch: fetchOptions.cancelRefetch ?? true,
    }).then(() => {
      this.updateResult();
      return this.currentResult;
    });
  }

  private executeFetch(
    fetchOptions?: ObserverFetchOptions,
  ): Promise<TMerapiData | undefined> {
    // Make sure we reference the latest query as the current one might have been removed
    this.updateMerapi();

    // Fetch
    let promise: Promise<TMerapiData | undefined> = this.currentMerapi.fetch(
      this.options as MerapiOptions<TMerapiFnData, TError, TMerapiData, TMerapiKey>,
      fetchOptions,
    );

    if (!fetchOptions?.throwOnError) {
      promise = promise.catch(noop);
    }

    return promise;
  }

  private updateStaleTimeout(): void {
    this.clearStaleTimeout();

    if (
      isServer
      || this.currentResult.isStale
      || !isValidTimeout(this.options.staleTime)
    ) {
      return;
    }

    const time = timeUntilStale({
      updatedAt: this.currentResult.dataUpdatedAt,
      staleTime: this.options.staleTime,
    });

    // The timeout is sometimes triggered 1 ms before the stale time expiration.
    // To mitigate this issue we always add 1 ms to the timeout.
    const timeout = time + 1;

    this.staleTimeoutId = setTimeout(() => {
      if (!this.currentResult.isStale) {
        this.updateResult();
      }
    }, timeout);
  }

  private computeRefetchInterval() {
    return isFunction(this.options.refetchInterval)
      ? this.options.refetchInterval({ data: this.currentResult.data, merapi: this.currentMerapi })
      : this.options.refetchInterval ?? false;
  }

  private updateRefetchInterval(nextInterval: number | false): void {
    this.clearRefetchInterval();

    this.currentRefetchInterval = nextInterval;

    if (
      isServer
      || this.options.enabled === false
      || !isValidTimeout(this.currentRefetchInterval)
      || this.currentRefetchInterval === 0
    ) {
      return;
    }

    this.refetchIntervalId = setInterval(() => {
      if (
        this.options.refetchIntervalInBackground
        || focusManager.isFocused()
      ) {
        this.executeFetch();
      }
    }, this.currentRefetchInterval);
  }

  private updateTimers(): void {
    this.updateStaleTimeout();
    this.updateRefetchInterval(this.computeRefetchInterval());
  }

  private clearStaleTimeout(): void {
    if (this.staleTimeoutId) {
      clearTimeout(this.staleTimeoutId);
      this.staleTimeoutId = undefined;
    }
  }

  private clearRefetchInterval(): void {
    if (this.refetchIntervalId) {
      clearInterval(this.refetchIntervalId);
      this.refetchIntervalId = undefined;
    }
  }

  protected createResult(
    { merapi, options }:
    {
      merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>;
      options: MerapiObserverOptions<
        TMerapiFnData,
        TError,
        TData,
        TMerapiData,
        TMerapiKey
      >;
    },
  ): MerapiObserverResult<TData, TError> {
    const prevMerapi = this.currentMerapi;
    const prevOptions = this.options;
    const prevResult = this.currentResult as
      | MerapiObserverResult<TData, TError>
      | undefined;
    const prevResultState = this.currentResultState;
    const prevResultOptions = this.currentResultOptions;
    const merapiChange = merapi !== prevMerapi;
    const merapiInitialState = merapiChange
      ? merapi.state
      : this.currentMerapiInitialState;
    const prevMerapiResult = merapiChange
      ? this.currentResult
      : this.previousMerapiResult;

    const { state } = merapi;
    let { dataUpdatedAt, error, errorUpdatedAt, fetchStatus, status } = state;
    let isPreviousData = false;
    let isPlaceholderData = false;
    let data: TData | undefined;

    // Optimistically set result in fetching state if needed
    if (options._optimisticResults) {
      const mounted = this.hasListeners();

      const fetchOnMount = !mounted && shouldFetchOnMount({ merapi, options });

      const fetchOptionally
        = mounted && shouldFetchOptionally({ merapi, prevMerapi, options, prevOptions });

      if (fetchOnMount || fetchOptionally) {
        fetchStatus = canFetch(merapi.options.networkMode)
          ? 'fetching'
          : 'paused';
        if (!dataUpdatedAt) {
          status = 'loading';
        }
      }
      if (options._optimisticResults === 'isRestoring') {
        fetchStatus = 'idle';
      }
    }

    // Keep previous data if needed
    if (
      options.keepPreviousData
      && !state.dataUpdatedAt
      && prevMerapiResult?.isSuccess
      && status !== 'error'
    ) {
      data = prevMerapiResult.data;
      dataUpdatedAt = prevMerapiResult.dataUpdatedAt;
      status = prevMerapiResult.status;
      isPreviousData = true;
    } else if (options.select && isDefined(state.data)) {
      // Select data if needed
      // Memoize select result
      if (
        prevResult
        && state.data === prevResultState?.data
        && options.select === this.selectFn
      ) {
        data = this.selectResult;
      } else {
        try {
          this.selectFn = options.select;
          data = options.select(state.data);
          data = replaceData({ prevData: prevResult?.data, data, options });
          this.selectResult = data;
          this.selectError = null;
        } catch (selectError) {
          if (process.env.NODE_ENV !== 'production') {
            this.client.getLogger().error(selectError);
          }
          this.selectError = selectError as TError;
        }
      }
    } else {
      // Use query data
      data = state.data as unknown as TData;
    }

    // Show placeholder data if needed
    if (
      isDefined(options.placeholderData)
      && isUndefined(data)
      && status === 'loading'
    ) {
      let placeholderData;

      // Memoize placeholder data
      if (
        prevResult?.isPlaceholderData
        && options.placeholderData === prevResultOptions?.placeholderData
      ) {
        placeholderData = prevResult.data;
      } else {
        placeholderData
          = isFunction(options.placeholderData)
            ? (options.placeholderData as PlaceholderDataFunction<TMerapiData>)()
            : options.placeholderData;
        if (options.select && isDefined(placeholderData)) {
          try {
            placeholderData = options.select(placeholderData);
            this.selectError = null;
          } catch (selectError) {
            if (process.env.NODE_ENV !== 'production') {
              this.client.getLogger().error(selectError);
            }
            this.selectError = selectError as TError;
          }
        }
      }

      if (isDefined(placeholderData)) {
        status = 'success';
        data = replaceData({
          prevData: prevResult?.data,
          data: placeholderData,
          options,
        }) as TData;
        isPlaceholderData = true;
      }
    }

    if (this.selectError) {
      error = this.selectError as any;
      data = this.selectResult;
      errorUpdatedAt = Date.now();
      status = 'error';
    }

    const isFetching = fetchStatus === 'fetching';
    const isLoading = status === 'loading';
    const isError = status === 'error';

    const result: MerapiObserverBaseResult<TData, TError> = {
      status,
      fetchStatus,
      isLoading,
      isSuccess: status === 'success',
      isError,
      isInitialLoading: isLoading && isFetching,
      data,
      dataUpdatedAt,
      error,
      errorUpdatedAt,
      failureCount: state.fetchFailureCount,
      failureReason: state.fetchFailureReason,
      errorUpdateCount: state.errorUpdateCount,
      isFetched: state.dataUpdateCount > 0 || state.errorUpdateCount > 0,
      isFetchedAfterMount:
        state.dataUpdateCount > merapiInitialState.dataUpdateCount
        || state.errorUpdateCount > merapiInitialState.errorUpdateCount,
      isFetching,
      isRefetching: isFetching && !isLoading,
      isLoadingError: isError && state.dataUpdatedAt === 0,
      isPaused: fetchStatus === 'paused',
      isPlaceholderData,
      isPreviousData,
      isRefetchError: isError && state.dataUpdatedAt !== 0,
      isStale: isStale({ merapi, options }),
      refetch: this.refetch,
      remove: this.remove,
    };

    return result as MerapiObserverResult<TData, TError>;
  }

  updateResult(notifyOptions?: NotifyOptions): void {
    const prevResult = this.currentResult as
      | MerapiObserverResult<TData, TError>
      | undefined;

    const nextResult = this.createResult({ merapi: this.currentMerapi, options: this.options });
    this.currentResultState = this.currentMerapi.state;
    this.currentResultOptions = this.options;

    // Only notify and update result if something has changed
    if (shallowEqualObjects(nextResult, prevResult)) {
      return;
    }

    this.currentResult = nextResult;

    // Determine which callbacks to trigger
    const defaultNotifyOptions: NotifyOptions = { cache: true };

    const shouldNotifyListeners = (): boolean => {
      if (!prevResult) {
        return true;
      }

      const { notifyOnChangeProps } = this.options;

      if (
        notifyOnChangeProps === 'all'
        || (!notifyOnChangeProps && !this.trackedProps.size)
      ) {
        return true;
      }

      const includedProps = new Set(notifyOnChangeProps ?? this.trackedProps);

      if (this.options.useErrorBoundary) {
        includedProps.add('error');
      }

      return Object.keys(this.currentResult).some((key) => {
        const typedKey = key as keyof MerapiObserverResult;
        const changed = this.currentResult[typedKey] !== prevResult[typedKey];
        return changed && includedProps.has(typedKey);
      });
    };

    if (notifyOptions?.listeners !== false && shouldNotifyListeners()) {
      defaultNotifyOptions.listeners = true;
    }

    this.notify({ ...defaultNotifyOptions, ...notifyOptions });
  }

  private updateMerapi(): void {
    const merapi = this.client.getMerapiCache().build({ client: this.client, options: this.options });

    if (merapi === this.currentMerapi) {
      return;
    }

    const prevMerapi = this.currentMerapi as
      | Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>
      | undefined;
    this.currentMerapi = merapi;
    this.currentMerapiInitialState = merapi.state;
    this.previousMerapiResult = this.currentResult;

    if (this.hasListeners()) {
      prevMerapi?.removeObserver(this);
      merapi.addObserver(this);
    }
  }

  onMerapiUpdate(action: Action<TData, TError>): void {
    const notifyOptions: NotifyOptions = {};

    if (action.type === 'success') {
      notifyOptions.onSuccess = !action.manual;
    } else if (action.type === 'error' && !isCancelledError(action.error)) {
      notifyOptions.onError = true;
    }

    this.updateResult(notifyOptions);

    if (this.hasListeners()) {
      this.updateTimers();
    }
  }

  private notify(notifyOptions: NotifyOptions): void {
    notifyManager.batch(() => {
      // First trigger the configuration callbacks
      if (notifyOptions.onSuccess) {
        this.options.onSuccess?.(this.currentResult.data!);
        this.options.onSettled?.({ data: this.currentResult.data!, error: null });
      } else if (notifyOptions.onError) {
        this.options.onError?.(this.currentResult.error!);
        this.options.onSettled?.({ data: undefined, error: this.currentResult.error! });
      }

      // Then trigger the listeners
      if (notifyOptions.listeners) {
        this.listeners.forEach((listener) => {
          listener(this.currentResult);
        });
      }

      // Then the cache listeners
      if (notifyOptions.cache) {
        this.client.getMerapiCache().notify({
          merapi: this.currentMerapi,
          type: 'observerResultsUpdated',
        });
      }
    });
  }
}

function shouldLoadOnMount(
  { merapi, options }:
  {
    merapi: Merapi<any, any, any, any>;
    options: MerapiObserverOptions<any, any, any, any>;
  },
): boolean {
  return (
    options.enabled !== false
    && !merapi.state.dataUpdatedAt
    && !(merapi.state.status === 'error' && options.retryOnMount === false)
  );
}

function shouldFetchOnMount(
  { merapi, options }:
  {
    merapi: Merapi<any, any, any, any>;
    options: MerapiObserverOptions<any, any, any, any, any>;
  },
): boolean {
  return (
    shouldLoadOnMount({ merapi, options })
    || (merapi.state.dataUpdatedAt > 0
      && shouldFetchOn({ merapi, options, field: options.refetchOnMount }))
  );
}

function shouldFetchOn(
  { merapi, options, field }:
  {
    merapi: Merapi<any, any, any, any>;
    options: MerapiObserverOptions<any, any, any, any, any>;
    field: typeof options['refetchOnMount'] &
      typeof options['refetchOnWindowFocus'] &
      typeof options['refetchOnReconnect'];
  },
) {
  if (options.enabled !== false) {
    const value = isFunction(field) ? field(merapi) : field;

    return value === 'always' || (value !== false && isStale({ merapi, options }));
  }
  return false;
}

function shouldFetchOptionally(
  { merapi, prevMerapi, options, prevOptions }:
  {
    merapi: Merapi<any, any, any, any>;
    prevMerapi: Merapi<any, any, any, any>;
    options: MerapiObserverOptions<any, any, any, any, any>;
    prevOptions: MerapiObserverOptions<any, any, any, any, any>;
  },
): boolean {
  return (
    options.enabled !== false
    && (merapi !== prevMerapi || prevOptions.enabled === false)
    && (!options.suspense || merapi.state.status !== 'error')
    && isStale({ merapi, options })
  );
}

function isStale(
  { merapi, options }:
  {
    merapi: Merapi<any, any, any, any>;
    options: MerapiObserverOptions<any, any, any, any, any>;
  },
): boolean {
  return merapi.isStaleByTime(options.staleTime);
}
