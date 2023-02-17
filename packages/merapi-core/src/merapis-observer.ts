import { arrayDifference, arrayReplaceAt, isDefined } from '@vinicunca/js-utilities';

import {
  type DefaultedMerapiObserverOptions,
  type MerapiObserverOptions,
  type MerapiObserverResult,
} from './entities';
import { type MerapiClient } from './merapi-client';
import { type NotifyOptions } from './merapi-observer';
import { notifyManager } from './notify-manager';
import { MerapiObserver } from './merapi-observer';
import { Subscribable } from './subscribable';

type QueriesObserverListener = (result: MerapiObserverResult[]) => void;

export class QueriesObserver extends Subscribable<QueriesObserverListener> {
  private client: MerapiClient;
  private result: MerapiObserverResult[];
  private merapis: MerapiObserverOptions[];
  private observers: MerapiObserver[];
  private observersMap: Record<string, MerapiObserver>;

  constructor(
    { client, merapis }:
    {
      client: MerapiClient;
      merapis?: MerapiObserverOptions[];
    },
  ) {
    super();

    this.client = client;
    this.merapis = [];
    this.result = [];
    this.observers = [];
    this.observersMap = {};

    if (merapis) {
      this.setQueries(merapis);
    }
  }

  protected onSubscribe(): void {
    if (this.listeners.length === 1) {
      this.observers.forEach((observer) => {
        observer.subscribe((result) => {
          this.onUpdate(observer, result);
        });
      });
    }
  }

  protected onUnsubscribe(): void {
    if (!this.listeners.length) {
      this.destroy();
    }
  }

  destroy(): void {
    this.listeners = [];
    this.observers.forEach((observer) => {
      observer.destroy();
    });
  }

  setQueries(
    merapis: MerapiObserverOptions[],
    notifyOptions?: NotifyOptions,
  ): void {
    this.merapis = merapis;

    notifyManager.batch(() => {
      const prevObservers = this.observers;

      const newObserverMatches = this.findMatchingObservers(this.merapis);

      // set options for the new observers to notify of changes
      newObserverMatches.forEach((match) =>
        match.observer.setOptions(match.defaultedMerapiOptions, notifyOptions),
      );

      const newObservers = newObserverMatches.map((match) => match.observer);
      const newObserversMap = Object.fromEntries(
        newObservers.map((observer) => [observer.options.merapiHash, observer]),
      );
      const newResult = newObservers.map((observer) =>
        observer.getCurrentResult(),
      );

      const hasIndexChange = newObservers.some(
        (observer, index) => observer !== prevObservers[index],
      );
      if (prevObservers.length === newObservers.length && !hasIndexChange) {
        return;
      }

      this.observers = newObservers;
      this.observersMap = newObserversMap;
      this.result = newResult;

      if (!this.hasListeners()) {
        return;
      }

      arrayDifference(prevObservers, newObservers).forEach((observer) => {
        observer.destroy();
      });

      arrayDifference(newObservers, prevObservers).forEach((observer) => {
        observer.subscribe((result) => {
          this.onUpdate(observer, result);
        });
      });

      this.notify();
    });
  }

  getCurrentResult(): MerapiObserverResult[] {
    return this.result;
  }

  getQueries() {
    return this.observers.map((observer) => observer.getCurrentMerapi());
  }

  getObservers() {
    return this.observers;
  }

  getOptimisticResult(merapis: MerapiObserverOptions[]): MerapiObserverResult[] {
    return this.findMatchingObservers(merapis).map((match) =>
      match.observer.getOptimisticResult(match.defaultedMerapiOptions),
    );
  }

  private findMatchingObservers(
    merapis: MerapiObserverOptions[],
  ): MerapiObserverMatch[] {
    const prevObservers = this.observers;
    const defaultedMerapiOptions = merapis.map((options) =>
      this.client.defaultMerapiOptions(options),
    );

    const matchingObservers: MerapiObserverMatch[]
      = defaultedMerapiOptions.flatMap((defaultedOptions) => {
        const match = prevObservers.find(
          (observer) =>
            observer.options.merapiHash === defaultedOptions.merapiHash,
        );
        if (match != null) {
          return [{ defaultedMerapiOptions: defaultedOptions, observer: match }];
        }
        return [];
      });

    const matchedMerapiHashes = matchingObservers.map(
      (match) => match.defaultedMerapiOptions.merapiHash,
    );
    const unmatchedQueries = defaultedMerapiOptions.filter(
      (defaultedOptions) =>
        !matchedMerapiHashes.includes(defaultedOptions.merapiHash),
    );

    const unmatchedObservers = prevObservers.filter(
      (prevObserver) =>
        !matchingObservers.some((match) => match.observer === prevObserver),
    );

    const getObserver = (options: MerapiObserverOptions): MerapiObserver => {
      const defaultedOptions = this.client.defaultMerapiOptions(options);
      const currentObserver = this.observersMap[defaultedOptions.merapiHash!];
      return currentObserver ?? new MerapiObserver({ client: this.client, options: defaultedOptions });
    };

    const newOrReusedObservers: MerapiObserverMatch[] = unmatchedQueries.map(
      (options, index) => {
        if (options.keepPreviousData) {
          // return previous data from one of the observers that no longer match
          const previouslyUsedObserver = unmatchedObservers[index];
          if (isDefined(previouslyUsedObserver)) {
            return {
              defaultedMerapiOptions: options,
              observer: previouslyUsedObserver,
            };
          }
        }
        return {
          defaultedMerapiOptions: options,
          observer: getObserver(options),
        };
      },
    );

    const sortMatchesByOrderOfQueries = (
      a: MerapiObserverMatch,
      b: MerapiObserverMatch,
    ): number =>
      defaultedMerapiOptions.indexOf(a.defaultedMerapiOptions)
      - defaultedMerapiOptions.indexOf(b.defaultedMerapiOptions);

    return matchingObservers
      .concat(newOrReusedObservers)
      .sort(sortMatchesByOrderOfQueries);
  }

  private onUpdate(observer: MerapiObserver, result: MerapiObserverResult): void {
    const index = this.observers.indexOf(observer);
    if (index !== -1) {
      this.result = arrayReplaceAt({ array: this.result, index, value: result });
      this.notify();
    }
  }

  private notify(): void {
    notifyManager.batch(() => {
      this.listeners.forEach((listener) => {
        listener(this.result);
      });
    });
  }
}

interface MerapiObserverMatch {
  defaultedMerapiOptions: DefaultedMerapiObserverOptions;
  observer: MerapiObserver;
}
