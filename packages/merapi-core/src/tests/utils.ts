import { type SpyInstance } from 'vitest';
import { vi } from 'vitest';

import { type MutationOptions } from '../entities';
import { MerapiClient } from '../merapi-client';
import * as utils from '../utils';

/**
 * This monkey-patches the isServer-value from utils,
 * so that we can pretend to be in a server environment
 */
export function setIsServer(isServer: boolean) {
  const original = utils.isServer;
  Object.defineProperty(utils, 'isServer', {
    get: () => isServer,
  });

  return () => {
    Object.defineProperty(utils, 'isServer', {
      get: () => original,
    });
  };
}

let merapiKeyCount = 0;
export function merapiKey(): Array<string> {
  merapiKeyCount++;
  return [`merapi_${merapiKeyCount}`];
}

export function createMerapiClient(config?: MerapiClientConfig): MerapiClient {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  return new MerapiClient({ logger: mockLogger, ...config });
}

export function mockNavigatorOnLine(value: boolean): SpyInstance {
  return vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

export const executeMutation = (
  merapiClient: MerapiClient,
  options: MutationOptions<any, any, any, any>,
): Promise<unknown> => {
  return merapiClient.getMutationCache().build(merapiClient, options).execute();
};
