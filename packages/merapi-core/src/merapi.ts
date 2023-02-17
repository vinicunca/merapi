import { isDefined, isFunction, isUndefined } from '@vinicunca/js-utilities';

import { type Retryer } from './retryer';
import {
  type CancelOptions,
  type FetchStatus,
  type InitialDataFunction,
  type MerapiFunctionContext,
  type MerapiKey,
  type MerapiMeta,
  type MerapiOptions,
  type MerapiStatus,
  type SetDataOptions,
} from './entities';
import { type MerapiCache } from './merapi-cache';
import { type MerapiObserver } from './merapi-observer';
import { type Logger } from './logger';
import { defaultLogger } from './logger';
import { notifyManager } from './notify-manager';
import { getAbortController, noop, replaceData, timeUntilStale } from './utils';
import { canFetch, createRetryer, isCancelledError } from './retryer';
import { Removable } from './removable';

interface MerapiConfig<
  TMerapiFnData,
  TError,
  TData,
  TMerapiKey extends MerapiKey = MerapiKey,
> {
  cache: MerapiCache;
  merapiKey: TMerapiKey;
  merapiHash: string;
  logger?: Logger;
  options?: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
  defaultOptions?: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
  state?: MerapiState<TData, TError>;
}

export interface MerapiState<TData = unknown, TError = unknown> {
  data: TData | undefined;
  dataUpdateCount: number;
  dataUpdatedAt: number;
  error: TError | null;
  errorUpdateCount: number;
  errorUpdatedAt: number;
  fetchFailureCount: number;
  fetchFailureReason: TError | null;
  fetchMeta: any;
  isInvalidated: boolean;
  status: MerapiStatus;
  fetchStatus: FetchStatus;
}

export interface FetchContext<
  TMerapiFnData,
  TError,
  TData,
  TMerapiKey extends MerapiKey = MerapiKey,
> {
  fetchFn: () => unknown | Promise<unknown>;
  fetchOptions?: FetchOptions;
  signal?: AbortSignal;
  options: MerapiOptions<TMerapiFnData, TError, TData, any>;
  merapiKey: TMerapiKey;
  state: MerapiState<TData, TError>;
}

export interface MerapiBehavior<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> {
  onFetch: (
    context: FetchContext<TMerapiFnData, TError, TData, TMerapiKey>,
  ) => void;
}

export interface FetchOptions {
  cancelRefetch?: boolean;
  meta?: any;
}

interface FailedAction<TError> {
  type: 'failed';
  failureCount: number;
  error: TError;
}

interface FetchAction {
  type: 'fetch';
  meta?: any;
}

interface SuccessAction<TData> {
  data: TData | undefined;
  type: 'success';
  dataUpdatedAt?: number;
  manual?: boolean;
}

interface ErrorAction<TError> {
  type: 'error';
  error: TError;
}

interface InvalidateAction {
  type: 'invalidate';
}

interface PauseAction {
  type: 'pause';
}

interface ContinueAction {
  type: 'continue';
}

interface SetStateAction<TData, TError> {
  type: 'setState';
  state: MerapiState<TData, TError>;
  setStateOptions?: SetStateOptions;
}

export type Action<TData, TError> =
  | ContinueAction
  | ErrorAction<TError>
  | FailedAction<TError>
  | FetchAction
  | InvalidateAction
  | PauseAction
  | SetStateAction<TData, TError>
  | SuccessAction<TData>;

export interface SetStateOptions {
  meta?: any;
}

export class Merapi<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends Removable {
  merapiKey: TMerapiKey;
  merapiHash: string;
  options!: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
  initialState: MerapiState<TData, TError>;
  revertState?: MerapiState<TData, TError>;
  state: MerapiState<TData, TError>;
  isFetchingOptimistic?: boolean;

  private cache: MerapiCache;
  private logger: Logger;
  private promise?: Promise<TData>;
  private retryer?: Retryer<TData>;
  private observers: MerapiObserver<any, any, any, any, any>[];
  private defaultOptions?: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
  private abortSignalConsumed: boolean;

  constructor(config: MerapiConfig<TMerapiFnData, TError, TData, TMerapiKey>) {
    super();

    this.abortSignalConsumed = false;
    this.defaultOptions = config.defaultOptions;
    this.setOptions(config.options);
    this.observers = [];
    this.cache = config.cache;
    this.logger = config.logger || defaultLogger;
    this.merapiKey = config.merapiKey;
    this.merapiHash = config.merapiHash;
    this.initialState = config.state || getDefaultState(this.options);
    this.state = this.initialState;
    this.scheduleGc();
  }

  get meta(): MerapiMeta | undefined {
    return this.options.meta;
  }

  private setOptions(
    options?: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
  ): void {
    this.options = { ...this.defaultOptions, ...options };

    this.updateCacheTime(this.options.cacheTime);
  }

  protected optionalRemove() {
    if (!this.observers.length && this.state.fetchStatus === 'idle') {
      this.cache.remove(this);
    }
  }

  setData(
    newData: TData,
    options?: SetDataOptions & { manual: boolean },
  ): TData {
    const data = replaceData({ prevData: this.state.data, data: newData, options: this.options });

    // Set data and mark it as cached
    this.dispatch({
      data,
      type: 'success',
      dataUpdatedAt: options?.updatedAt,
      manual: options?.manual,
    });

    return data;
  }

  setState(
    state: MerapiState<TData, TError>,
    setStateOptions?: SetStateOptions,
  ): void {
    this.dispatch({ type: 'setState', state, setStateOptions });
  }

  cancel(options?: CancelOptions): Promise<void> {
    const promise = this.promise;
    this.retryer?.cancel(options);
    return promise ? promise.then(noop).catch(noop) : Promise.resolve();
  }

  destroy(): void {
    super.destroy();

    this.cancel({ silent: true });
  }

  reset(): void {
    this.destroy();
    this.setState(this.initialState);
  }

  isActive(): boolean {
    return this.observers.some((observer) => observer.options.enabled !== false);
  }

  isDisabled(): boolean {
    return this.getObserversCount() > 0 && !this.isActive();
  }

  isStale(): boolean {
    return (
      this.state.isInvalidated
      || !this.state.dataUpdatedAt
      || this.observers.some((observer) => observer.getCurrentResult().isStale)
    );
  }

  isStaleByTime(staleTime = 0): boolean {
    return (
      this.state.isInvalidated
      || !this.state.dataUpdatedAt
      || !timeUntilStale({ updatedAt: this.state.dataUpdatedAt, staleTime })
    );
  }

  onFocus(): void {
    const observer = this.observers.find((x) => x.shouldFetchOnWindowFocus());

    if (observer) {
      observer.refetch({ cancelRefetch: false });
    }

    // Continue fetch if currently paused
    this.retryer?.continue();
  }

  onOnline(): void {
    const observer = this.observers.find((x) => x.shouldFetchOnReconnect());

    if (observer) {
      observer.refetch({ cancelRefetch: false });
    }

    // Continue fetch if currently paused
    this.retryer?.continue();
  }

  addObserver(observer: MerapiObserver<any, any, any, any, any>): void {
    if (!this.observers.includes(observer)) {
      this.observers.push(observer);

      // Stop the merapi from being garbage collected
      this.clearGcTimeout();

      this.cache.notify({ type: 'observerAdded', merapi: this, observer });
    }
  }

  removeObserver(observer: MerapiObserver<any, any, any, any, any>): void {
    if (this.observers.includes(observer)) {
      this.observers = this.observers.filter((x) => x !== observer);

      if (!this.observers.length) {
        // If the transport layer does not support cancellation
        // we'll let the merapi continue so the result can be cached
        if (this.retryer) {
          if (this.abortSignalConsumed) {
            this.retryer.cancel({ revert: true });
          } else {
            this.retryer.cancelRetry();
          }
        }

        this.scheduleGc();
      }

      this.cache.notify({ type: 'observerRemoved', merapi: this, observer });
    }
  }

  getObserversCount(): number {
    return this.observers.length;
  }

  invalidate(): void {
    if (!this.state.isInvalidated) {
      this.dispatch({ type: 'invalidate' });
    }
  }

  fetch(
    { options, fetchOptions }:
    {
      options?: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
      fetchOptions?: FetchOptions;
    },
  ): Promise<TData> {
    if (this.state.fetchStatus !== 'idle') {
      if (this.state.dataUpdatedAt && fetchOptions?.cancelRefetch) {
        // Silently cancel current fetch if the user wants to cancel refetches
        this.cancel({ silent: true });
      } else if (this.promise) {
        // make sure that retries that were potentially cancelled due to unmounts can continue
        this.retryer?.continueRetry();
        // Return current promise if we are already fetching
        return this.promise;
      }
    }

    // Update config if passed, otherwise the config from the last execution is used
    if (options) {
      this.setOptions(options);
    }

    // Use the options from the first observer with a merapi function if no function is found.
    // This can happen when the merapi is hydrated or created with setMerapiData.
    if (!this.options.merapiFn) {
      const observer = this.observers.find((x) => x.options.merapiFn);
      if (observer) {
        this.setOptions(observer.options);
      }
    }

    if (!Array.isArray(this.options.merapiKey) && process.env.NODE_ENV !== 'production') {
      this.logger.error(
        'As of v4, merapiKey needs to be an Array. If you are using a string like \'repoData\', please change it to an Array, e.g. [\'repoData\']',
      );
    }

    const abortController = getAbortController();

    // Create merapi function context
    const merapiFnContext: MerapiFunctionContext<TMerapiKey> = {
      merapiKey: this.merapiKey,
      pageParam: undefined,
      meta: this.meta,
    };

    // Adds an enumerable signal property to the object that
    // which sets abortSignalConsumed to true when the signal
    // is read.
    const addSignalProperty = (object: unknown) => {
      Object.defineProperty(object, 'signal', {
        enumerable: true,
        get: () => {
          if (abortController) {
            this.abortSignalConsumed = true;
            return abortController.signal;
          }
          return undefined;
        },
      });
    };

    addSignalProperty(merapiFnContext);

    // Create fetch function
    const fetchFn = () => {
      if (!this.options.merapiFn) {
        return Promise.reject('Missing merapiFn');
      }
      this.abortSignalConsumed = false;
      return this.options.merapiFn(merapiFnContext);
    };

    // Trigger behavior hook
    const context: FetchContext<TMerapiFnData, TError, TData, TMerapiKey> = {
      fetchOptions,
      options: this.options,
      merapiKey: this.merapiKey,
      state: this.state,
      fetchFn,
    };

    addSignalProperty(context);

    this.options.behavior?.onFetch(context);

    // Store state in case the current fetch needs to be reverted
    this.revertState = this.state;

    // Set to fetching state if not already in it
    if (
      this.state.fetchStatus === 'idle'
      || this.state.fetchMeta !== context.fetchOptions?.meta
    ) {
      this.dispatch({ type: 'fetch', meta: context.fetchOptions?.meta });
    }

    const onError = (error: TError | { silent?: boolean }) => {
      // Optimistically update state if needed
      if (!(isCancelledError(error) && error.silent)) {
        this.dispatch({
          type: 'error',
          error: error as TError,
        });
      }

      if (!isCancelledError(error)) {
        // Notify cache callback
        this.cache.config.onError?.(error, this as Merapi<any, any, any, any>);

        if (process.env.NODE_ENV !== 'production') {
          this.logger.error(error);
        }
      }

      if (!this.isFetchingOptimistic) {
        // Schedule merapi gc after fetching
        this.scheduleGc();
      }
      this.isFetchingOptimistic = false;
    };

    // Try to fetch the data
    this.retryer = createRetryer({
      fn: context.fetchFn as () => TData,
      abort: abortController?.abort.bind(abortController),
      onSuccess: (data) => {
        if (isUndefined(data)) {
          if (process.env.NODE_ENV !== 'production') {
            this.logger.error(
              `Merapi data cannot be undefined. Please make sure to return a value other than undefined from your merapi function. Affected merapi key: ${this.merapiHash}`,
            );
          }
          onError(new Error('undefined') as any);
          return;
        }

        this.setData(data as TData);

        // Notify cache callback
        this.cache.config.onSuccess?.(data, this as Merapi<any, any, any, any>);

        if (!this.isFetchingOptimistic) {
          // Schedule merapi gc after fetching
          this.scheduleGc();
        }
        this.isFetchingOptimistic = false;
      },
      onError,
      onFail: (failureCount, error) => {
        this.dispatch({ type: 'failed', failureCount, error });
      },
      onPause: () => {
        this.dispatch({ type: 'pause' });
      },
      onContinue: () => {
        this.dispatch({ type: 'continue' });
      },
      retry: context.options.retry,
      retryDelay: context.options.retryDelay,
      networkMode: context.options.networkMode,
    });

    this.promise = this.retryer.promise;

    return this.promise;
  }

  private dispatch(action: Action<TData, TError>): void {
    const reducer = (
      state: MerapiState<TData, TError>,
    ): MerapiState<TData, TError> => {
      switch (action.type) {
        case 'failed':
          return {
            ...state,
            fetchFailureCount: action.failureCount,
            fetchFailureReason: action.error,
          };
        case 'pause':
          return {
            ...state,
            fetchStatus: 'paused',
          };
        case 'continue':
          return {
            ...state,
            fetchStatus: 'fetching',
          };
        case 'fetch':
          return {
            ...state,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: action.meta ?? null,
            fetchStatus: canFetch(this.options.networkMode)
              ? 'fetching'
              : 'paused',
            ...(!state.dataUpdatedAt && {
              error: null,
              status: 'loading',
            }),
          };
        case 'success':
          return {
            ...state,
            data: action.data,
            dataUpdateCount: state.dataUpdateCount + 1,
            dataUpdatedAt: action.dataUpdatedAt ?? Date.now(),
            error: null,
            isInvalidated: false,
            status: 'success',
            ...(!action.manual && {
              fetchStatus: 'idle',
              fetchFailureCount: 0,
              fetchFailureReason: null,
            }),
          };
        case 'error':
          const error = action.error as unknown;

          if (isCancelledError(error) && error.revert && this.revertState) {
            return { ...this.revertState };
          }

          return {
            ...state,
            error: error as TError,
            errorUpdateCount: state.errorUpdateCount + 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: state.fetchFailureCount + 1,
            fetchFailureReason: error as TError,
            fetchStatus: 'idle',
            status: 'error',
          };
        case 'invalidate':
          return {
            ...state,
            isInvalidated: true,
          };
        case 'setState':
          return {
            ...state,
            ...action.state,
          };
      }
    };

    this.state = reducer(this.state);

    notifyManager.batch(() => {
      this.observers.forEach((observer) => {
        observer.onMerapiUpdate(action);
      });

      this.cache.notify({ merapi: this, type: 'updated', action });
    });
  }
}

function getDefaultState<
  TMerapiFnData,
  TError,
  TData,
  TMerapiKey extends MerapiKey,
>(
  options: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>,
): MerapiState<TData, TError> {
  const data
    = isFunction(options.initialData)
      ? (options.initialData as InitialDataFunction<TData>)()
      : options.initialData;

  const hasData = isDefined(data);

  const initialDataUpdatedAt = hasData
    ? isFunction(options.initialDataUpdatedAt)
      ? (options.initialDataUpdatedAt as () => number | undefined)()
      : options.initialDataUpdatedAt
    : 0;

  return {
    data,
    dataUpdateCount: 0,
    dataUpdatedAt: hasData ? initialDataUpdatedAt ?? Date.now() : 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: hasData ? 'success' : 'loading',
    fetchStatus: 'idle',
  };
}
