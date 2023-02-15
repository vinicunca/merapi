import { type MerapiFilters } from './utils';
import { type MerapiBehavior } from './merapi';
import { type RetryDelayValue, type RetryValue } from './retryer';

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

export interface MerapiOptions<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> {
  /**
   * If `false`, failed queries will not retry by default.
   * If `true`, failed queries will retry infinitely., failureCount: num
   * If set to an integer number, e.g. 3, failed queries will retry until the failed merapi count meets that number.
   * If set to a function `(failureCount, error) => boolean` failed queries will retry until the function returns false.
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
   * This function can be set to automatically get the previous cursor for infinite queries.
   * The result will also be used to determine the value of `hasPreviousPage`.
   */
  getPreviousPageParam?: GetPreviousPageParamFunction<TMerapiFnData>;
  /**
   * This function can be set to automatically get the next cursor for infinite queries.
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

export interface CancelOptions {
  revert?: boolean;
  silent?: boolean;
}

export type MerapiStatus = 'loading' | 'error' | 'success';
export type FetchStatus = 'fetching' | 'paused' | 'idle';

export interface RefetchMerapiFilters<TPageData = unknown>
  extends MerapiFilters,
  RefetchPageFilters<TPageData> {}

export interface RefetchPageFilters<TPageData = unknown> {
  refetchPage?: (options: {
    lastPage: TPageData;
    index: number;
    allPages: TPageData[];
  }) => boolean;
}
