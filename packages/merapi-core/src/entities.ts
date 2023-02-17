import { type MutationCache } from './mutation-cache';
import { type MerapiCache } from './merapi-cache';
import { type MutationState } from './mutation';
import { type MerapiFilters, type MerapiTypeFilter } from './utils';
import { type Merapi, type MerapiBehavior } from './merapi';
import { type RetryDelayValue, type RetryValue } from './retryer';
import { type Logger } from './logger';

export type MerapiKey = readonly unknown[];

export type MerapiFunction<
  T = unknown,
  TMerapiKey extends MerapiKey = MerapiKey,
> = (context: MerapiFunctionContext<TMerapiKey>) => T | Promise<T>;

export interface MerapiFunctionContext<
  TMerapiKey extends MerapiKey = MerapiKey,
  TPageParam = any,
> {
  merapiKey: TMerapiKey;
  signal?: AbortSignal;
  pageParam?: TPageParam;
  meta: MerapiMeta | undefined;
}

export type InitialDataFunction<T> = () => T | undefined;

export type PlaceholderDataFunction<TResult> = () => TResult | undefined;

export type MerapiKeyHashFunction<TMerapiKey extends MerapiKey> = (
  merapiKey: TMerapiKey,
) => string;

export type GetPreviousPageParamFunction<TMerapiFnData = unknown> = (options: {
  firstPage: TMerapiFnData;
  allPages: TMerapiFnData[];
}) => unknown;

export type GetNextPageParamFunction<TMerapiFnData = unknown> = (options: {
  lastPage: TMerapiFnData;
  allPages: TMerapiFnData[];
}) => unknown;

export interface InfiniteData<TData> {
  pages: TData[];
  pageParams: unknown[];
}

export interface MerapiMeta {
  [index: string]: unknown;
}

export type NetworkMode = 'online' | 'always' | 'offlineFirst';

export interface MerapiOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> {
  /**
   * If `false`, failed merapis will not retry by default.
   * If `true`, failed merapis will retry infinitely., failureCount: num
   * If set to an integer number, e.g. 3, failed merapis will retry until the failed merapi count meets that number.
   * If set to a function `(failureCount, error) => boolean` failed merapis will retry until the function returns false.
   */
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
  networkMode?: NetworkMode;
  cacheTime?: number;
  isDataEqual?: (oldData: TData | undefined, newData: TData) => boolean;
  merapiFn?: MerapiFunction<TMerapiFnData, TMerapiKey>;
  merapiHash?: string;
  merapiKey?: TMerapiKey;
  merapiKeyHashFn?: MerapiKeyHashFunction<TMerapiKey>;
  initialData?: TData | InitialDataFunction<TData>;
  initialDataUpdatedAt?: number | (() => number | undefined);
  behavior?: MerapiBehavior<TMerapiFnData, TError, TData>;
  /**
   * Set this to `false` to disable structural sharing between merapi results.
   * Set this to a function which accepts the old and new data and returns resolved data of the same type to implement custom structural sharing logic.
   * Defaults to `true`.
   */
  structuralSharing?:
  | boolean
  | ((oldData: TData | undefined, newData: TData) => TData);
  /**
   * This function can be set to automatically get the previous cursor for infinite merapis.
   * The result will also be used to determine the value of `hasPreviousPage`.
   */
  getPreviousPageParam?: GetPreviousPageParamFunction<TMerapiFnData>;
  /**
   * This function can be set to automatically get the next cursor for infinite merapis.
   * The result will also be used to determine the value of `hasNextPage`.
   */
  getNextPageParam?: GetNextPageParamFunction<TMerapiFnData>;
  _defaulted?: boolean;
  /**
   * Additional payload to be stored on each merapi.
   * Use this property to pass information that can be used in other places.
   */
  meta?: MerapiMeta;
}

export type UseErrorBoundary<
  TMerapiFnData,
  TError,
  TMerapiData,
  TMerapiKey extends MerapiKey,
> =
  | boolean
  | ((options: {
    error: TError;
    merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>;
  }) => boolean);

export interface MerapiObserverOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends MerapiOptions<TMerapiFnData, TError, TMerapiData, TMerapiKey> {
  /**
   * Set this to `false` to disable automatic refetching when the merapi mounts or changes merapi keys.
   * To refetch the merapi, use the `refetch` method returned from the `useMerapi` instance.
   * Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * The time in milliseconds after data is considered stale.
   * If set to `Infinity`, the data will never be considered stale.
   */
  staleTime?: number;
  /**
   * If set to a number, the merapi will continuously refetch at this frequency in milliseconds.
   * If set to a function, the function will be executed with the latest data and merapi to compute a frequency
   * Defaults to `false`.
   */
  refetchInterval?:
  | number
  | false
  | ((options: {
    data: TData | undefined;
    merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>;
  }) => number | false);
  /**
   * If set to `true`, the merapi will continue to refetch while their tab/window is in the background.
   * Defaults to `false`.
   */
  refetchIntervalInBackground?: boolean;
  /**
   * If set to `true`, the merapi will refetch on window focus if the data is stale.
   * If set to `false`, the merapi will not refetch on window focus.
   * If set to `'always'`, the merapi will always refetch on window focus.
   * If set to a function, the function will be executed with the latest data and merapi to compute the value.
   * Defaults to `true`.
   */
  refetchOnWindowFocus?:
  | boolean
  | 'always'
  | ((
    merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>,
  ) => boolean | 'always');
  /**
   * If set to `true`, the merapi will refetch on reconnect if the data is stale.
   * If set to `false`, the merapi will not refetch on reconnect.
   * If set to `'always'`, the merapi will always refetch on reconnect.
   * If set to a function, the function will be executed with the latest data and merapi to compute the value.
   * Defaults to the value of `networkOnline` (`true`)
   */
  refetchOnReconnect?:
  | boolean
  | 'always'
  | ((
    merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>,
  ) => boolean | 'always');
  /**
   * If set to `true`, the merapi will refetch on mount if the data is stale.
   * If set to `false`, will disable additional instances of a merapi to trigger background refetches.
   * If set to `'always'`, the merapi will always refetch on mount.
   * If set to a function, the function will be executed with the latest data and merapi to compute the value
   * Defaults to `true`.
   */
  refetchOnMount?:
  | boolean
  | 'always'
  | ((
    merapi: Merapi<TMerapiFnData, TError, TMerapiData, TMerapiKey>,
  ) => boolean | 'always');
  /**
   * If set to `false`, the merapi will not be retried on mount if it contains an error.
   * Defaults to `true`.
   */
  retryOnMount?: boolean;
  /**
   * If set, the component will only re-render if any of the listed properties change.
   * When set to `['data', 'error']`, the component will only re-render when the `data` or `error` properties change.
   * When set to `'all'`, the component will re-render whenever a merapi is updated.
   * By default, access to properties will be tracked, and the component will only re-render when one of the tracked properties change.
   */
  notifyOnChangeProps?: Array<keyof InfiniteMerapiObserverResult> | 'all';
  /**
   * This callback will fire any time the merapi successfully fetches new data.
   */
  onSuccess?: (data: TData) => void;
  /**
   * This callback will fire if the merapi encounters an error and will be passed the error.
   */
  onError?: (err: TError) => void;
  /**
   * This callback will fire any time the merapi is either successfully fetched or errors and be passed either the data or error.
   */
  onSettled?: (options: { data: TData | undefined; error: TError | null }) => void;
  /**
   * Whether errors should be thrown instead of setting the `error` property.
   * If set to `true` or `suspense` is `true`, all errors will be thrown to the error boundary.
   * If set to `false` and `suspense` is `false`, errors are returned as state.
   * If set to a function, it will be passed the error and the merapi, and it should return a boolean indicating whether to show the error in an error boundary (`true`) or return the error as state (`false`).
   * Defaults to `false`.
   */
  useErrorBoundary?: UseErrorBoundary<
    TMerapiFnData,
    TError,
    TMerapiData,
    TMerapiKey
  >;
  /**
   * This option can be used to transform or select a part of the data returned by the merapi function.
   */
  select?: (data: TMerapiData) => TData;
  /**
   * If set to `true`, the merapi will suspend when `status === 'loading'`
   * and throw errors when `status === 'error'`.
   * Defaults to `false`.
   */
  suspense?: boolean;
  /**
   * Set this to `true` to keep the previous `data` when fetching based on a new merapi key.
   * Defaults to `false`.
   */
  keepPreviousData?: boolean;
  /**
   * If set, this value will be used as the placeholder data for this particular merapi observer while the merapi is still in the `loading` data and no initialData has been provided.
   */
  placeholderData?: TMerapiData | PlaceholderDataFunction<TMerapiData>;

  _optimisticResults?: 'optimistic' | 'isRestoring';
}

export type WithRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export type DefaultedMerapiObserverOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> = WithRequired<
  MerapiObserverOptions<TMerapiFnData, TError, TData, TMerapiData, TMerapiKey>,
  'useErrorBoundary' | 'refetchOnReconnect'
>;

export interface InfiniteMerapiObserverOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends MerapiObserverOptions<
    TMerapiFnData,
    TError,
    InfiniteData<TData>,
    InfiniteData<TMerapiData>,
    TMerapiKey
  > {}

export type DefaultedInfiniteMerapiObserverOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> = WithRequired<
  InfiniteMerapiObserverOptions<
    TMerapiFnData,
    TError,
    TData,
    TMerapiData,
    TMerapiKey
  >,
  'useErrorBoundary' | 'refetchOnReconnect'
>;

export interface FetchMerapiOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey> {
  /**
   * The time in milliseconds after data is considered stale.
   * If the data is fresh it will be returned from the cache.
   */
  staleTime?: number;
}

export interface FetchInfiniteMerapiOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends FetchMerapiOptions<
    TMerapiFnData,
    TError,
    InfiniteData<TData>,
    TMerapiKey
  > {}

export interface ResultOptions {
  throwOnError?: boolean;
}

export interface RefetchPageFilters<TPageData = unknown> {
  refetchPage?: (options: {
    lastPage: TPageData;
    index: number;
    allPages: TPageData[];
  }) => boolean;
}

export interface RefetchOptions extends ResultOptions {
  cancelRefetch?: boolean;
}

export interface InvalidateMerapiFilters<TPageData = unknown>
  extends MerapiFilters,
  RefetchPageFilters<TPageData> {
  refetchType?: MerapiTypeFilter | 'none';
}

export interface RefetchMerapiFilters<TPageData = unknown>
  extends MerapiFilters,
  RefetchPageFilters<TPageData> {}

export interface ResetMerapiFilters<TPageData = unknown>
  extends MerapiFilters,
  RefetchPageFilters<TPageData> {}

export interface InvalidateOptions extends RefetchOptions {}
export interface ResetOptions extends RefetchOptions {}

export interface FetchNextPageOptions extends ResultOptions {
  cancelRefetch?: boolean;
  pageParam?: unknown;
}

export interface FetchPreviousPageOptions extends ResultOptions {
  cancelRefetch?: boolean;
  pageParam?: unknown;
}

export type MerapiStatus = 'loading' | 'error' | 'success';
export type FetchStatus = 'fetching' | 'paused' | 'idle';

export interface MerapiObserverBaseResult<TData = unknown, TError = unknown> {
  data: TData | undefined;
  dataUpdatedAt: number;
  error: TError | null;
  errorUpdatedAt: number;
  failureCount: number;
  failureReason: TError | null;
  errorUpdateCount: number;
  isError: boolean;
  isFetched: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isLoadingError: boolean;
  isInitialLoading: boolean;
  isPaused: boolean;
  isPlaceholderData: boolean;
  isPreviousData: boolean;
  isRefetchError: boolean;
  isRefetching: boolean;
  isStale: boolean;
  isSuccess: boolean;
  refetch: <TPageData>(
    options?: RefetchOptions & RefetchMerapiFilters<TPageData>,
  ) => Promise<MerapiObserverResult<TData, TError>>;
  remove: () => void;
  status: MerapiStatus;
  fetchStatus: FetchStatus;
}

export interface MerapiObserverLoadingResult<TData = unknown, TError = unknown>
  extends MerapiObserverBaseResult<TData, TError> {
  data: undefined;
  error: null;
  isError: false;
  isLoading: true;
  isLoadingError: false;
  isRefetchError: false;
  isSuccess: false;
  status: 'loading';
}

export interface MerapiObserverLoadingErrorResult<
  TData = unknown,
  TError = unknown,
> extends MerapiObserverBaseResult<TData, TError> {
  data: undefined;
  error: TError;
  isError: true;
  isLoading: false;
  isLoadingError: true;
  isRefetchError: false;
  isSuccess: false;
  status: 'error';
}

export interface MerapiObserverRefetchErrorResult<
  TData = unknown,
  TError = unknown,
> extends MerapiObserverBaseResult<TData, TError> {
  data: TData;
  error: TError;
  isError: true;
  isLoading: false;
  isLoadingError: false;
  isRefetchError: true;
  isSuccess: false;
  status: 'error';
}

export interface MerapiObserverSuccessResult<TData = unknown, TError = unknown>
  extends MerapiObserverBaseResult<TData, TError> {
  data: TData;
  error: null;
  isError: false;
  isLoading: false;
  isLoadingError: false;
  isRefetchError: false;
  isSuccess: true;
  status: 'success';
}

export type DefinedMerapiObserverResult<TData = unknown, TError = unknown> =
  | MerapiObserverRefetchErrorResult<TData, TError>
  | MerapiObserverSuccessResult<TData, TError>;

export type MerapiObserverResult<TData = unknown, TError = unknown> =
  | DefinedMerapiObserverResult<TData, TError>
  | MerapiObserverLoadingErrorResult<TData, TError>
  | MerapiObserverLoadingResult<TData, TError>;

export interface InfiniteMerapiObserverBaseResult<
  TData = unknown,
  TError = unknown,
> extends MerapiObserverBaseResult<InfiniteData<TData>, TError> {
  fetchNextPage: (
    options?: FetchNextPageOptions,
  ) => Promise<InfiniteMerapiObserverResult<TData, TError>>;
  fetchPreviousPage: (
    options?: FetchPreviousPageOptions,
  ) => Promise<InfiniteMerapiObserverResult<TData, TError>>;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  isFetchingNextPage: boolean;
  isFetchingPreviousPage: boolean;
}

export interface InfiniteMerapiObserverLoadingResult<
  TData = unknown,
  TError = unknown,
> extends InfiniteMerapiObserverBaseResult<TData, TError> {
  data: undefined;
  error: null;
  isError: false;
  isLoading: true;
  isLoadingError: false;
  isRefetchError: false;
  isSuccess: false;
  status: 'loading';
}

export interface InfiniteMerapiObserverLoadingErrorResult<
  TData = unknown,
  TError = unknown,
> extends InfiniteMerapiObserverBaseResult<TData, TError> {
  data: undefined;
  error: TError;
  isError: true;
  isLoading: false;
  isLoadingError: true;
  isRefetchError: false;
  isSuccess: false;
  status: 'error';
}

export interface InfiniteMerapiObserverRefetchErrorResult<
  TData = unknown,
  TError = unknown,
> extends InfiniteMerapiObserverBaseResult<TData, TError> {
  data: InfiniteData<TData>;
  error: TError;
  isError: true;
  isLoading: false;
  isLoadingError: false;
  isRefetchError: true;
  isSuccess: false;
  status: 'error';
}

export interface InfiniteMerapiObserverSuccessResult<
  TData = unknown,
  TError = unknown,
> extends InfiniteMerapiObserverBaseResult<TData, TError> {
  data: InfiniteData<TData>;
  error: null;
  isError: false;
  isLoading: false;
  isLoadingError: false;
  isRefetchError: false;
  isSuccess: true;
  status: 'success';
}

export type InfiniteMerapiObserverResult<TData = unknown, TError = unknown> =
  | InfiniteMerapiObserverLoadingErrorResult<TData, TError>
  | InfiniteMerapiObserverLoadingResult<TData, TError>
  | InfiniteMerapiObserverRefetchErrorResult<TData, TError>
  | InfiniteMerapiObserverSuccessResult<TData, TError>;

export type MutationKey = readonly unknown[];

export type MutationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface MutationMeta {
  [index: string]: unknown;
}

export type MutationFunction<TData = unknown, TVariables = unknown> = (
  variables: TVariables,
) => Promise<TData>;

export interface MutationOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> {
  mutationFn?: MutationFunction<TData, TVariables>;
  mutationKey?: MutationKey;
  variables?: TVariables;
  onMutate?: (
    variables: TVariables,
  ) => Promise<TContext | undefined> | TContext | undefined;
  onSuccess?: (options: {
    data: TData;
    variables: TVariables;
    context: TContext | undefined;
  }) => Promise<unknown> | unknown;
  onError?: (options: {
    error: TError;
    variables: TVariables;
    context: TContext | undefined;
  }) => Promise<unknown> | unknown;
  onSettled?: (options: {
    data?: TData | undefined;
    error: TError | null;
    variables: TVariables;
    context: TContext | undefined;
  }) => Promise<unknown> | unknown;
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
  networkMode?: NetworkMode;
  cacheTime?: number;
  _defaulted?: boolean;
  meta?: MutationMeta;
}

export interface MutationObserverOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationOptions<TData, TError, TVariables, TContext> {
  useErrorBoundary?: boolean | ((error: TError) => boolean);
}

export interface MutateOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> {
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void;
  onError?: (
    error: TError,
    variables: TVariables,
    context: TContext | undefined,
  ) => void;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined,
  ) => void;
}

export type MutateFunction<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> = (
  variables: TVariables,
  options?: MutateOptions<TData, TError, TVariables, TContext>,
) => Promise<TData>;

export interface MutationObserverBaseResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationState<TData, TError, TVariables, TContext> {
  isError: boolean;
  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  mutate: MutateFunction<TData, TError, TVariables, TContext>;
  reset: () => void;
}

export interface MutationObserverIdleResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationObserverBaseResult<TData, TError, TVariables, TContext> {
  data: undefined;
  error: null;
  isError: false;
  isIdle: true;
  isLoading: false;
  isSuccess: false;
  status: 'idle';
}

export interface MutationObserverLoadingResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationObserverBaseResult<TData, TError, TVariables, TContext> {
  data: undefined;
  error: null;
  isError: false;
  isIdle: false;
  isLoading: true;
  isSuccess: false;
  status: 'loading';
}

export interface MutationObserverErrorResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationObserverBaseResult<TData, TError, TVariables, TContext> {
  data: undefined;
  error: TError;
  isError: true;
  isIdle: false;
  isLoading: false;
  isSuccess: false;
  status: 'error';
}

export interface MutationObserverSuccessResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> extends MutationObserverBaseResult<TData, TError, TVariables, TContext> {
  data: TData;
  error: null;
  isError: false;
  isIdle: false;
  isLoading: false;
  isSuccess: true;
  status: 'success';
}

export type MutationObserverResult<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> =
  | MutationObserverIdleResult<TData, TError, TVariables, TContext>
  | MutationObserverLoadingResult<TData, TError, TVariables, TContext>
  | MutationObserverErrorResult<TData, TError, TVariables, TContext>
  | MutationObserverSuccessResult<TData, TError, TVariables, TContext>;

export interface MerapiClientConfig {
  merapiCache?: MerapiCache;
  mutationCache?: MutationCache;
  logger?: Logger;
  defaultOptions?: DefaultOptions;
}

export interface DefaultOptions<TError = unknown> {
  merapis?: MerapiObserverOptions<unknown, TError>;
  mutations?: MutationObserverOptions<unknown, TError, unknown, unknown>;
}

export interface CancelOptions {
  revert?: boolean;
  silent?: boolean;
}

export interface SetDataOptions {
  updatedAt?: number;
}
