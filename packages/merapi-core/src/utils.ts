import { hasOwn, isBoolean, isBrowser, isDefined, isFunction, isNumber, isObject } from '@vinicunca/js-utilities';

import { type FetchStatus, type MerapiKey, type MerapiOptions } from './entities';
import { type Merapi } from './merapi';

export function noop(): undefined {
  return undefined;
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

export type MerapiTypeFilter = 'all' | 'active' | 'inactive';

export function isValidTimeout(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value !== Infinity;
}

export function sleep(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

/**
 * Schedules a microtask.
 * This can be useful to schedule state updates after rendering.
 */
export function scheduleMicrotask(callback: () => void) {
  sleep(0).then(callback);
}

export const isServer = !isBrowser || 'Deno' in window;

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

export function hashMerapiKeyByOptions<TMerapiKey extends MerapiKey = MerapiKey>(
  queryKey: TMerapiKey,
  options?: MerapiOptions<any, any, any, TMerapiKey>,
): string {
  const hashFn = options?.merapiKeyHashFn || hashMerapiKey;
  return hashFn(queryKey);
}

/**
 * Default query keys hash function.
 * Hashes the value into a stable hash.
 */
export function hashMerapiKey(queryKey: MerapiKey): string {
  return JSON.stringify(queryKey, (_, val) =>
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

export function isMerapiKey(value: unknown): value is MerapiKey {
  return Array.isArray(value);
}

// Copied from: https://github.com/jonschlinkert/is-plain-object
export function isPlainObject(o: any): o is Object {
  if (!isObject(o)) {
    return false;
  }

  // If has modified constructor
  const ctor = o.constructor;
  if (typeof ctor === 'undefined') {
    return true;
  }

  // If has modified prototype
  const prot = ctor.prototype;
  if (!isObject(prot)) {
    return false;
  }

  // If constructor does not have an Object-specific method
  // eslint-disable-next-line sonarjs/prefer-single-boolean-return
  if (!hasOwn(prot, 'isPrototypeOf')) {
    return false;
  }

  // Most likely a plain Object
  return true;
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

export function timeUntilStale({ updatedAt, staleTime }: { updatedAt: number; staleTime?: number }): number {
  return Math.max(updatedAt + (staleTime || 0) - Date.now(), 0);
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

  // eslint-disable-next-line sonarjs/prefer-single-boolean-return
  if (predicate && !predicate(merapi)) {
    return false;
  }

  return true;
}

export function isPlainArray(value: unknown) {
  return Array.isArray(value) && value.length === Object.keys(value).length;
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
