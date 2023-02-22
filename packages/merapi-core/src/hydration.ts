import { isObject } from '@vinicunca/js-utilities';

import { type MerapiClient } from './merapi-client';
import { type Merapi, type MerapiState } from './merapi';
import {
  type MerapiKey,
  type MerapiOptions,
  type MutationKey,
  type MutationOptions,
} from './entities';
import { type Mutation, type MutationState } from './mutation';

export interface DehydrateOptions {
  dehydrateMutations?: boolean;
  dehydrateQueries?: boolean;
  shouldDehydrateMutation?: ShouldDehydrateMutationFunction;
  shouldDehydrateMerapi?: ShouldDehydrateMerapiFunction;
}

export interface HydrateOptions {
  defaultOptions?: {
    merapis?: MerapiOptions;
    mutations?: MutationOptions;
  };
}

interface DehydratedMutation {
  mutationKey?: MutationKey;
  state: MutationState;
}

interface DehydratedMerapi {
  merapiHash: string;
  merapiKey: MerapiKey;
  state: MerapiState;
}

export interface DehydratedState {
  mutations: DehydratedMutation[];
  merapis: DehydratedMerapi[];
}

export type ShouldDehydrateMerapiFunction = (merapi: Merapi) => boolean;

export type ShouldDehydrateMutationFunction = (mutation: Mutation) => boolean;

function dehydrateMutation(mutation: Mutation): DehydratedMutation {
  return {
    mutationKey: mutation.options.mutationKey,
    state: mutation.state,
  };
}

/**
 * Most config is not dehydrated but instead meant to configure again when
 * consuming the de/rehydrated data, typically with useMerapi on the client.
 * Sometimes it might make sense to prefetch data on the server and include
 * in the html-payload, but not consume it on the initial render.
 */

function dehydrateMerapi(merapi: Merapi): DehydratedMerapi {
  return {
    state: merapi.state,
    merapiKey: merapi.merapiKey,
    merapiHash: merapi.merapiHash,
  };
}

export function defaultShouldDehydrateMutation(mutation: Mutation) {
  return mutation.state.isPaused;
}

export function defaultShouldDehydrateMerapi(merapi: Merapi) {
  return merapi.state.status === 'success';
}

export function dehydrate(
  { client, options = {} }:
  {
    client: MerapiClient;
    options?: DehydrateOptions;
  },
): DehydratedState {
  const mutations: DehydratedMutation[] = [];
  const merapis: DehydratedMerapi[] = [];

  if (options.dehydrateMutations !== false) {
    const shouldDehydrateMutation
      = options.shouldDehydrateMutation || defaultShouldDehydrateMutation;

    client
      .getMutationCache()
      .getAll()
      .forEach((mutation) => {
        if (shouldDehydrateMutation(mutation)) {
          mutations.push(dehydrateMutation(mutation));
        }
      });
  }

  if (options.dehydrateQueries !== false) {
    const shouldDehydrateMerapi
      = options.shouldDehydrateMerapi || defaultShouldDehydrateMerapi;

    client
      .getMerapiCache()
      .getAll()
      .forEach((merapi) => {
        if (shouldDehydrateMerapi(merapi)) {
          merapis.push(dehydrateMerapi(merapi));
        }
      });
  }

  return { mutations, merapis };
}

export function hydrate(
  { client, dehydratedState, options }:
  {
    client: MerapiClient;
    dehydratedState: unknown;
    options?: HydrateOptions;
  },
): void {
  if (!isObject(dehydratedState) || dehydratedState === null) {
    return;
  }

  const mutationCache = client.getMutationCache();
  const merapiCache = client.getMerapiCache();

  const mutations = (dehydratedState as DehydratedState).mutations || [];

  const merapis = (dehydratedState as DehydratedState).merapis || [];

  mutations.forEach((dehydratedMutation) => {
    mutationCache.build(
      client,
      {
        ...options?.defaultOptions?.mutations,
        mutationKey: dehydratedMutation.mutationKey,
      },
      dehydratedMutation.state,
    );
  });

  merapis.forEach((dehydratedMerapi) => {
    const merapi = merapiCache.get(dehydratedMerapi.merapiHash);

    /**
     * Reset fetch status to idle in the dehydrated state to avoid
     * query being stuck in fetching state upon hydration
     */
    const dehydratedMerapiState = {
      ...dehydratedMerapi.state,
      fetchStatus: 'idle' as const,
    };

    // Do not hydrate if an existing merapi exists with newer data
    if (merapi) {
      if (merapi.state.dataUpdatedAt < dehydratedMerapiState.dataUpdatedAt) {
        merapi.setState(dehydratedMerapiState);
      }
      return;
    }

    // Restore merapi
    merapiCache.build({
      client,
      options: {
        ...options?.defaultOptions?.merapis,
        merapiKey: dehydratedMerapi.merapiKey,
        merapiHash: dehydratedMerapi.merapiHash,
      },
      state: dehydratedMerapiState,
    });
  });
}
