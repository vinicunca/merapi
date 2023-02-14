import { isNumber } from '@vinicunca/js-utilities';

export function isValidTimeout(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value !== Infinity;
}
