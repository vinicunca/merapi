import { isDefined, isUndefined } from '@vinicunca/js-utilities';

import { type InfiniteData, type MerapiFunctionContext, type MerapiOptions, type RefetchMerapiFilters } from './entities';
import { type MerapiBehavior } from './merapi';

export function infiniteMerapiBehavior<
  TMerapiFnData,
  TError,
  TData,
>(): MerapiBehavior<TMerapiFnData, TError, InfiniteData<TData>> {
  return {
    onFetch: (context) => {
      context.fetchFn = () => {
        const refetchPage: RefetchMerapiFilters['refetchPage'] | undefined = context.fetchOptions?.meta?.refetchPage;
        const fetchMore = context.fetchOptions?.meta?.fetchMore;
        const pageParam = fetchMore?.pageParam;
        const isFetchingNextPage = fetchMore?.direction === 'forward';
        const isFetchingPreviousPage = fetchMore?.direction === 'backward';
        const oldPages = context.state.data?.pages ?? [];
        const oldPageParams = context.state.data?.pageParams ?? [];
        let newPageParams = oldPageParams;
        let cancelled = false;

        function addSignalProperty(object: unknown) {
          Object.defineProperty(object, 'signal', {
            enumerable: true,
            get: () => {
              if (context.signal?.aborted) {
                cancelled = true;
              } else {
                context.signal?.addEventListener('abort', () => {
                  cancelled = true;
                });
              }

              return context.signal;
            },
          });
        }

        // Get merapi function
        const merapiFn = context.options.merapiFn || (() => Promise.reject('Missing merapiFn'));

        function buildNewPages(
          { pages, param, page, previous }:
          {
            pages: unknown[];
            param: unknown;
            page: unknown;
            previous?: boolean;
          },
        ) {
          newPageParams = previous
            ? [param, ...newPageParams]
            : [...newPageParams, param];
          return previous ? [page, ...pages] : [...pages, page];
        }

        // Create function to fetch a page
        function fetchPage(
          { pages, manual, param, previous }:
          {
            pages: unknown[];
            manual?: boolean;
            param?: unknown;
            previous?: boolean;
          },
        ): Promise<unknown[]> {
          if (cancelled) {
            return Promise.reject('Cancelled');
          }

          if (isUndefined(param) && !manual && pages.length) {
            return Promise.resolve(pages);
          }

          const merapiFnContext: MerapiFunctionContext = {
            merapiKey: context.merapiKey,
            pageParam: param,
            meta: context.options.meta,
          };

          addSignalProperty(merapiFnContext);

          const merapiFnResult = merapiFn(merapiFnContext);

          return Promise.resolve(merapiFnResult).then((page) =>
            buildNewPages({ pages, param, page, previous }),
          );
        }

        let promise: Promise<unknown[]>;

        // Fetch first page?
        if (!oldPages.length) {
          promise = fetchPage({ pages: [] });
        } else if (isFetchingNextPage) {
          // Fetch next page?
          const manual = isDefined(pageParam);
          const param = manual
            ? pageParam
            : getNextPageParam({ options: context.options, pages: oldPages });
          promise = fetchPage({ pages: oldPages, manual, param });
        } else if (isFetchingPreviousPage) {
          // Fetch previous page?
          const manual = isDefined(pageParam);
          const param = manual
            ? pageParam
            : getPreviousPageParam({ options: context.options, pages: oldPages });
          promise = fetchPage({ pages: oldPages, manual, param, previous: true });
        } else {
          // Refetch pages
          newPageParams = [];

          const manual = isUndefined(context.options.getNextPageParam);

          const shouldFetchFirstPage
            = refetchPage && oldPages[0]
              ? refetchPage({ lastPage: oldPages[0], index: 0, allPages: oldPages })
              : true;

          // Fetch first page
          promise = shouldFetchFirstPage
            ? fetchPage({ pages: [], manual, param: oldPageParams[0] })
            : Promise.resolve(buildNewPages({ pages: [], param: oldPageParams[0], page: oldPages[0] }));

          // Fetch remaining pages
          for (let i = 1; i < oldPages.length; i++) {
            promise = promise.then((pages) => {
              const shouldFetchNextPage
                  = refetchPage && oldPages[i]
                    ? refetchPage({ lastPage: oldPages[i], index: i, allPages: oldPages })
                    : true;

              if (shouldFetchNextPage) {
                const param = manual
                  ? oldPageParams[i]
                  : getNextPageParam({ options: context.options, pages });
                return fetchPage({ pages, manual, param });
              }
              return Promise.resolve(
                buildNewPages({ pages, param: oldPageParams[i], page: oldPages[i] }),
              );
            });
          }
        }

        return promise.then((pages) => ({
          pages,
          pageParams: newPageParams,
        }));
      };
    },
  };
}

export function getNextPageParam(
  { options, pages }:
  {
    options: MerapiOptions<any, any>;
    pages: unknown[];
  },
): unknown | undefined {
  return options.getNextPageParam?.({ lastPage: pages[pages.length - 1], allPages: pages });
}

export function getPreviousPageParam(
  { options, pages }:
  {
    options: MerapiOptions<any, any>;
    pages: unknown[];
  },
): unknown | undefined {
  return options.getPreviousPageParam?.({ firstPage: pages[0], allPages: pages });
}

/**
 * Checks if there is a next page.
 * Returns `undefined` if it cannot be determined.
 */
export function hasNextPage(
  { options, pages }:
  {
    options: MerapiOptions<any, any, any, any>;
    pages?: unknown;
  },
): boolean | undefined {
  if (options.getNextPageParam && Array.isArray(pages)) {
    const nextPageParam = getNextPageParam({ options, pages });
    return (
      isDefined(nextPageParam)
      && nextPageParam !== null
      && nextPageParam !== false
    );
  }

  return undefined;
}

/**
 * Checks if there is a previous page.
 * Returns `undefined` if it cannot be determined.
 */
export function hasPreviousPage(
  { options, pages }:
  {
    options: MerapiOptions<any, any, any, any>;
    pages?: unknown;
  },
): boolean | undefined {
  if (options.getPreviousPageParam && Array.isArray(pages)) {
    const previousPageParam = getPreviousPageParam({ options, pages });
    return (
      isDefined(previousPageParam)
      && previousPageParam !== null
      && previousPageParam !== false
    );
  }

  return undefined;
}

