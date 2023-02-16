import { type MutationStatus } from './entities';

export interface MutationState<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> {
  context: TContext | undefined;
  data: TData | undefined;
  error: TError | null;
  failureCount: number;
  failureReason: TError | null;
  isPaused: boolean;
  status: MutationStatus;
  variables: TVariables | undefined;
}
