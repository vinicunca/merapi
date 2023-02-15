import { isNumber } from '@vinicunca/js-utilities';

import { type FetchStatus, type MerapiKey } from './entities';
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

export type MerapiTypeFilter = 'all' | 'active' | 'inactive';

export function isValidTimeout(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value !== Infinity;
}

export function sleep(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}
