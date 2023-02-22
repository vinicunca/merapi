import { isUndefined } from '@vinicunca/js-utilities';

import { type MerapiKey, type MerapiOptions, type NotifyEvent } from './entities';
import { type MerapiFilters, matchMerapi, parseFilterArgs } from './utils';
import { type MerapiClient } from './merapi-client';
import { type Action, Merapi, type MerapiState } from './merapi';
import { type MerapiObserver } from './merapi-observer';
import { Subscribable } from './subscribable';
import { hashMerapiKeyByOptions } from './utils';
import { notifyManager } from './notify-manager';

interface MerapiCacheConfig {
  onError?: (error: unknown, merapi: Merapi<unknown, unknown, unknown>) => void;
  onSuccess?: (data: unknown, merapi: Merapi<unknown, unknown, unknown>) => void;
}

interface MerapiHashMap {
  [hash: string]: Merapi<any, any, any, any>;
}

interface NotifyEventMerapiAdded extends NotifyEvent {
  type: 'added';
  merapi: Merapi<any, any, any, any>;
}

interface NotifyEventMerapiRemoved extends NotifyEvent {
  type: 'removed';
  merapi: Merapi<any, any, any, any>;
}

interface NotifyEventMerapiUpdated extends NotifyEvent {
  type: 'updated';
  merapi: Merapi<any, any, any, any>;
  action: Action<any, any>;
}

interface NotifyEventMerapiObserverAdded extends NotifyEvent {
  type: 'observerAdded';
  merapi: Merapi<any, any, any, any>;
  observer: MerapiObserver<any, any, any, any, any>;
}

interface NotifyEventMerapiObserverRemoved extends NotifyEvent {
  type: 'observerRemoved';
  merapi: Merapi<any, any, any, any>;
  observer: MerapiObserver<any, any, any, any, any>;
}

interface NotifyEventMerapiObserverResultsUpdated extends NotifyEvent {
  type: 'observerResultsUpdated';
  merapi: Merapi<any, any, any, any>;
}

interface NotifyEventMerapiObserverOptionsUpdated extends NotifyEvent {
  type: 'observerOptionsUpdated';
  merapi: Merapi<any, any, any, any>;
  observer: MerapiObserver<any, any, any, any, any>;
}

type MerapiCacheNotifyEvent =
  | NotifyEventMerapiAdded
  | NotifyEventMerapiRemoved
  | NotifyEventMerapiUpdated
  | NotifyEventMerapiObserverAdded
  | NotifyEventMerapiObserverRemoved
  | NotifyEventMerapiObserverResultsUpdated
  | NotifyEventMerapiObserverOptionsUpdated;

type MerapiCacheListener = (event: MerapiCacheNotifyEvent) => void;

export class MerapiCache extends Subscribable<MerapiCacheListener> {
  config: MerapiCacheConfig;

  private merapis: Merapi<any, any, any, any>[];
  private merapisMap: MerapiHashMap;

  constructor(config?: MerapiCacheConfig) {
    super();
    this.config = config || {};
    this.merapis = [];
    this.merapisMap = {};
  }

  build<TMerapiFnData, TError, TData, TMerapiKey extends MerapiKey>(
    { client, options, state }:
    {
      client: MerapiClient;
      options: MerapiOptions<TMerapiFnData, TError, TData, TMerapiKey>;
      state?: MerapiState<TData, TError>;
    },
  ): Merapi<TMerapiFnData, TError, TData, TMerapiKey> {
    const merapiKey = options.merapiKey!;
    const merapiHash
      = options.merapiHash ?? hashMerapiKeyByOptions(merapiKey, options);
    let merapi = this.get<TMerapiFnData, TError, TData, TMerapiKey>(merapiHash);

    if (!merapi) {
      merapi = new Merapi({
        cache: this,
        logger: client.getLogger(),
        merapiKey,
        merapiHash,
        options: client.defaultMerapiOptions(options),
        state,
        defaultOptions: client.getMerapiDefaults(merapiKey),
      });
      this.add(merapi);
    }

    return merapi;
  }

  add(merapi: Merapi<any, any, any, any>): void {
    if (!this.merapisMap[merapi.merapiHash]) {
      this.merapisMap[merapi.merapiHash] = merapi;
      this.merapis.push(merapi);
      this.notify({
        type: 'added',
        merapi,
      });
    }
  }

  remove(merapi: Merapi<any, any, any, any>): void {
    const merapiInMap = this.merapisMap[merapi.merapiHash];

    if (merapiInMap) {
      merapi.destroy();

      this.merapis = this.merapis.filter((x) => x !== merapi);

      if (merapiInMap === merapi) {
        delete this.merapisMap[merapi.merapiHash];
      }

      this.notify({ type: 'removed', merapi });
    }
  }

  clear(): void {
    notifyManager.batch(() => {
      this.merapis.forEach((merapi) => {
        this.remove(merapi);
      });
    });
  }

  get<
    TMerapiFnData = unknown,
    TError = unknown,
    TData = TMerapiFnData,
    TMerapiKey extends MerapiKey = MerapiKey,
  >(
    merapiHash: string,
  ): Merapi<TMerapiFnData, TError, TData, TMerapiKey> | undefined {
    return this.merapisMap[merapiHash];
  }

  getAll(): Merapi[] {
    return this.merapis;
  }

  find<TMerapiFnData = unknown, TError = unknown, TData = TMerapiFnData>(
    arg1: MerapiKey,
    arg2?: MerapiFilters,
  ): Merapi<TMerapiFnData, TError, TData> | undefined {
    const [filters] = parseFilterArgs(arg1, arg2);

    if (isUndefined(filters.exact)) {
      filters.exact = true;
    }

    return this.merapis.find((merapi) => matchMerapi(filters, merapi));
  }

  findAll(merapiKey?: MerapiKey, filters?: MerapiFilters): Merapi[];
  findAll(filters?: MerapiFilters): Merapi[];
  findAll(arg1?: MerapiKey | MerapiFilters, arg2?: MerapiFilters): Merapi[];
  findAll(arg1?: MerapiKey | MerapiFilters, arg2?: MerapiFilters): Merapi[] {
    const [filters] = parseFilterArgs(arg1, arg2);
    return Object.keys(filters).length > 0
      ? this.merapis.filter((merapi) => matchMerapi(filters, merapi))
      : this.merapis;
  }

  notify(event: MerapiCacheNotifyEvent) {
    notifyManager.batch(() => {
      this.listeners.forEach((listener) => {
        listener(event);
      });
    });
  }

  onFocus(): void {
    notifyManager.batch(() => {
      this.merapis.forEach((merapi) => {
        merapi.onFocus();
      });
    });
  }

  onOnline(): void {
    notifyManager.batch(() => {
      this.merapis.forEach((merapi) => {
        merapi.onOnline();
      });
    });
  }
}
