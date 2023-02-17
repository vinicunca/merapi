import { type Merapi } from './merapi';
import { type DefaultedInfiniteMerapiObserverOptions, type FetchNextPageOptions, type FetchPreviousPageOptions, type InfiniteData, type InfiniteMerapiObserverOptions, type InfiniteMerapiObserverResult, type MerapiKey } from './entities';
import { type NotifyOptions, type ObserverFetchOptions } from './merapi-observer';
import { type MerapiClient } from './merapi-client';
import { MerapiObserver } from './merapi-observer';
import { hasNextPage, hasPreviousPage, infiniteMerapiBehavior } from './infinite-merapi-behavior';

type InfiniteMerapiObserverListener<TData, TError> = (
  result: InfiniteMerapiObserverResult<TData, TError>,
) => void;

export class InfiniteMerapiObserver<
  TMerapiFnData = unknown,
  TError = unknown,
  TData = TMerapiFnData,
  TMerapiData = TMerapiFnData,
  TMerapiKey extends MerapiKey = MerapiKey,
> extends MerapiObserver<
  TMerapiFnData,
  TError,
  InfiniteData<TData>,
  InfiniteData<TMerapiData>,
  TMerapiKey
> {
  // Type override
  subscribe!: (
    listener?: InfiniteMerapiObserverListener<TData, TError>,
  ) => () => void;

  // Type override
  getCurrentResult!: () => InfiniteMerapiObserverResult<TData, TError>;

  // Type override
  protected fetch!: (
    fetchOptions: ObserverFetchOptions,
  ) => Promise<InfiniteMerapiObserverResult<TData, TError>>;

  constructor(
    client: MerapiClient,
    options: InfiniteMerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
  ) {
    super({ client, options });
  }

  protected bindMethods(): void {
    super.bindMethods();
    this.fetchNextPage = this.fetchNextPage.bind(this);
    this.fetchPreviousPage = this.fetchPreviousPage.bind(this);
  }

  setOptions(
    options?: InfiniteMerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
    notifyOptions?: NotifyOptions,
  ): void {
    super.setOptions(
      {
        ...options,
        behavior: infiniteMerapiBehavior(),
      },
      notifyOptions,
    );
  }

  getOptimisticResult(
    options: DefaultedInfiniteMerapiObserverOptions<
      TMerapiFnData,
      TError,
      TData,
      TMerapiData,
      TMerapiKey
    >,
  ): InfiniteMerapiObserverResult<TData, TError> {
    options.behavior = infiniteMerapiBehavior();
    return super.getOptimisticResult(options) as InfiniteMerapiObserverResult<
      TData,
      TError
    >;
  }

  fetchNextPage({ pageParam, ...options }: FetchNextPageOptions = {}): Promise<
    InfiniteMerapiObserverResult<TData, TError>
  > {
    return this.fetch({
      ...options,
      meta: {
        fetchMore: { direction: 'forward', pageParam },
      },
    });
  }

  fetchPreviousPage({
    pageParam,
    ...options
  }: FetchPreviousPageOptions = {}): Promise<
    InfiniteMerapiObserverResult<TData, TError>
  > {
    return this.fetch({
      ...options,
      meta: {
        fetchMore: { direction: 'backward', pageParam },
      },
    });
  }

  protected createResult(
    { merapi, options }:
    {
      merapi: Merapi<TMerapiFnData, TError, InfiniteData<TMerapiData>, TMerapiKey>;
      options: InfiniteMerapiObserverOptions<
        TMerapiFnData,
        TError,
        TData,
        TMerapiData,
        TMerapiKey
      >;
    },
  ): InfiniteMerapiObserverResult<TData, TError> {
    const { state } = merapi;
    const result = super.createResult({ merapi, options });

    const { isFetching, isRefetching } = result;

    const isFetchingNextPage
      = isFetching && state.fetchMeta?.fetchMore?.direction === 'forward';

    const isFetchingPreviousPage
      = isFetching && state.fetchMeta?.fetchMore?.direction === 'backward';

    return {
      ...result,
      fetchNextPage: this.fetchNextPage,
      fetchPreviousPage: this.fetchPreviousPage,
      hasNextPage: hasNextPage({ options, pages: state.data?.pages }),
      hasPreviousPage: hasPreviousPage({ options, pages: state.data?.pages }),
      isFetchingNextPage,
      isFetchingPreviousPage,
      isRefetching:
        isRefetching && !isFetchingNextPage && !isFetchingPreviousPage,
    };
  }
}
