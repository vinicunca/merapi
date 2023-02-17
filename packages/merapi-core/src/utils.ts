import { isBoolean, isBrowser, isDefined, isFunction, isNumber, isObject, isPlainArray, isPlainObject, sleep } from '@vinicunca/js-utilities';

import { type FetchStatus, type MerapiFunction, type MerapiKey, type MerapiOptions, type MutationFunction, type MutationKey, type MutationOptions } from './entities';
import { type Mutation } from './mutation';
import { type Merapi } from './merapi';

export interface MerapiFilters {
  /**
   * Filter to active queries, inactive queries or all queries
   */
  type?: MerapiTypeFilter;
  /**
   * Match merapi key exactly
   */
  exact?: boolean;
  /**
   * Include queries matching this predicate function
   */
  predicate?: (merapi: Merapi) => boolean;
  /**
   * Include queries matching this merapi key
   */
  merapiKey?: MerapiKey;
  /**
   * Include or exclude stale queries
   */
  stale?: boolean;
  /**
   * Include queries matching their fetchStatus
   */
  fetchStatus?: FetchStatus;
}

export interface MutationFilters {
  /**
   * Match mutation key exactly
   */
  exact?: boolean;
  /**
   * Include mutations matching this predicate function
   */
  predicate?: (mutation: Mutation<any, any, any>) => boolean;
  /**
   * Include mutations matching this mutation key
   */
  mutationKey?: MutationKey;
  /**
   * Include or exclude fetching mutations
   */
  fetching?: boolean;
}

export type DataUpdateFunction<TInput, TOutput> = (input: TInput) => TOutput;

export type Updater<TInput, TOutput> =
  | TOutput
  | DataUpdateFunction<TInput, TOutput>;

export type MerapiTypeFilter = 'all' | 'active' | 'inactive';

export const isServer = !isBrowser || 'Deno' in window;

export function noop(): undefined {
  return undefined;
}

export function isValidTimeout(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value !== Infinity;
}

export function timeUntilStale({ updatedAt, staleTime }: { updatedAt: number; staleTime?: number }): number {
  return Math.max(updatedAt + (staleTime || 0) - Date.now(), 0);
}

export function functionalUpdate<TInput, TOutput>(
  { updater, input }:
  {
    updater: Updater<TInput, TOutput>;
    input: TInput;
  },
): TOutput {
  return isFunction(updater)
    ? (updater as DataUpdateFunction<TInput, TOutput>)(input)
    : updater;
}

export function parseMerapiArgs<
  TOptions extends MerapiOptions<any, any, any, TMerapiKey>,
  TMerapiKey extends MerapiKey = MerapiKey,
>(
  arg1: TMerapiKey | TOptions,
  arg2?: MerapiFunction<any, TMerapiKey> | TOptions,
  arg3?: TOptions,
): TOptions {
  if (!isMerapiKey(arg1)) {
    return arg1 as TOptions;
  }

  if (isFunction(arg2)) {
    return { ...arg3, merapiKey: arg1, merapiFn: arg2 } as TOptions;
  }

  return { ...arg2, merapiKey: arg1 } as TOptions;
}

export function parseMutationArgs<
  TOptions extends MutationOptions<any, any, any, any>,
>(
  arg1: MutationKey | MutationFunction<any, any> | TOptions,
  arg2?: MutationFunction<any, any> | TOptions,
  arg3?: TOptions,
): TOptions {
  if (isMerapiKey(arg1)) {
    if (typeof arg2 === 'function') {
      return { ...arg3, mutationKey: arg1, mutationFn: arg2 } as TOptions;
    }
    return { ...arg2, mutationKey: arg1 } as TOptions;
  }

  if (typeof arg1 === 'function') {
    return { ...arg2, mutationFn: arg1 } as TOptions;
  }

  return { ...arg1 } as TOptions;
}

export function parseFilterArgs<
  TFilters extends MerapiFilters,
  TOptions = unknown,
>(
  arg1?: MerapiKey | TFilters,
  arg2?: TFilters | TOptions,
  arg3?: TOptions,
): [TFilters, TOptions | undefined] {
  return (
    isMerapiKey(arg1) ? [{ ...arg2, queryKey: arg1 }, arg3] : [arg1 || {}, arg2]
  ) as [TFilters, TOptions];
}

export function parseMutationFilterArgs<
  TFilters extends MutationFilters,
  TOptions = unknown,
>(
  arg1?: MerapiKey | TFilters,
  arg2?: TFilters | TOptions,
  arg3?: TOptions,
): [TFilters, TOptions | undefined] {
  return (
    isMerapiKey(arg1)
      ? [{ ...arg2, mutationKey: arg1 }, arg3]
      : [arg1 || {}, arg2]
  ) as [TFilters, TOptions];
}

export function matchMerapi(
  filters: MerapiFilters,
  merapi: Merapi<any, any, any, any>,
): boolean {
  const {
    type = 'all',
    exact,
    fetchStatus,
    predicate,
    merapiKey,
    stale,
  } = filters;

  if (isMerapiKey(merapiKey)) {
    if (exact) {
      if (merapi.merapiHash !== hashMerapiKeyByOptions(merapiKey, merapi.options)) {
        return false;
      }
    } else if (!partialMatchKey(merapi.merapiKey, merapiKey)) {
      return false;
    }
  }

  if (type !== 'all') {
    const isActive = merapi.isActive();

    if (type === 'active' && !isActive) {
      return false;
    }

    if (type === 'inactive' && isActive) {
      return false;
    }
  }

  if (isBoolean(stale) && merapi.isStale() !== stale) {
    return false;
  }

  if (
    isDefined(fetchStatus)
    && fetchStatus !== merapi.state.fetchStatus
  ) {
    return false;
  }

  if (predicate && !predicate(merapi)) {
    return false;
  }

  return true;
}

export function matchMutation(
  { filters, mutation }:
  {
    filters: MutationFilters;
    mutation: Mutation<any, any>;
  },
): boolean {
  const { exact, fetching, predicate, mutationKey } = filters;
  if (isMerapiKey(mutationKey)) {
    if (!mutation.options.mutationKey) {
      return false;
    }
    if (exact) {
      if (
        hashMerapiKey(mutation.options.mutationKey) !== hashMerapiKey(mutationKey)
      ) {
        return false;
      }
    } else if (!partialMatchKey(mutation.options.mutationKey, mutationKey)) {
      return false;
    }
  }

  if (
    isBoolean(fetching)
    && (mutation.state.status === 'loading') !== fetching
  ) {
    return false;
  }

  if (predicate && !predicate(mutation)) {
    return false;
  }

  return true;
}

export function hashMerapiKeyByOptions<TMerapiKey extends MerapiKey = MerapiKey>(
  merapiKey: TMerapiKey,
  options?: MerapiOptions<any, any, any, TMerapiKey>,
): string {
  const hashFn = options?.merapiKeyHashFn || hashMerapiKey;
  return hashFn(merapiKey);
}

/**
 * Default merapi keys hash function.
 * Hashes the value into a stable hash.
 */
export function hashMerapiKey(merapiKey: MerapiKey): string {
  return JSON.stringify(merapiKey, (_, val) =>
    isPlainObject(val)
      ? Object.keys(val)
        .sort()
        .reduce((result, key) => {
          result[key] = val[key];
          return result;
        }, {} as any)
      : val,
  );
}

/**
 * Checks if key `b` partially matches with key `a`.
 */
export function partialMatchKey(a: MerapiKey, b: MerapiKey): boolean {
  return partialDeepEqual(a, b);
}

/**
 * Checks if `b` partially matches with `a`.
 */
export function partialDeepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (a && b && isObject(a) && isObject(b)) {
    return !Object.keys(b).some((key) => !partialDeepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * This function returns `a` if `b` is deeply equal.
 * If not, it will replace any deeply equal children of `b` with those of `a`.
 * This can be used for structural sharing between JSON values for example.
 */
export function replaceEqualDeep<T>(a: unknown, b: T): T;
export function replaceEqualDeep(a: any, b: any): any {
  if (a === b) {
    return a;
  }

  const array = isPlainArray(a) && isPlainArray(b);

  if (array || (isPlainObject(a) && isPlainObject(b))) {
    const aSize = array ? a.length : Object.keys(a).length;
    const bItems = array ? b : Object.keys(b);
    const bSize = bItems.length;
    const copy: any = array ? [] : {};

    let equalItems = 0;

    for (let i = 0; i < bSize; i++) {
      const key = array ? i : bItems[i];
      copy[key] = replaceEqualDeep(a[key], b[key]);
      if (copy[key] === a[key]) {
        equalItems++;
      }
    }

    return aSize === bSize && equalItems === aSize ? a : copy;
  }

  return b;
}

/**
 * Shallow compare objects. Only works with objects that always have the same properties.
 */
export function shallowEqualObjects<T>(a: T, b: T): boolean {
  if ((a && !b) || (b && !a)) {
    return false;
  }

  for (const key in a) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}

export function isMerapiKey(value: unknown): value is MerapiKey {
  return Array.isArray(value);
}

export function isError(value: any): value is Error {
  return value instanceof Error;
}

/**
 * Schedules a microtask.
 * This can be useful to schedule state updates after rendering.
 */
export function scheduleMicrotask(callback: () => void) {
  sleep(0).then(callback);
}

export function getAbortController(): AbortController | undefined {
  if (isFunction(AbortController)) {
    return new AbortController();
  }

  return undefined;
}

export function replaceData<
  TData,
  TOptions extends MerapiOptions<any, any, any, any>,
>(
  { prevData, data, options }:
  {
    prevData: TData | undefined;
    data: TData;
    options: TOptions;
  }): TData {
  // Use prev data if an isDataEqual function is defined and returns `true`
  if (options.isDataEqual?.(prevData, data)) {
    return prevData as TData;
  } else if (isFunction(options.structuralSharing)) {
    return options.structuralSharing(prevData, data);
  } else if (options.structuralSharing !== false) {
    // Structurally share data between prev and new data if needed
    return replaceEqualDeep(prevData, data);
  }
  return data;
}
