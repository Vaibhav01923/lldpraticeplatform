import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttemptDto } from '../../../shared/contracts';
import { api } from './api';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity });
export const useProblems = () => useQuery({ queryKey: ['problems'], queryFn: api.problems });
export const useProblem = (id: string) => useQuery({ queryKey: ['problem', id], queryFn: () => api.problem(id), staleTime: Infinity });
export const useProgress = (problemId: string) => useQuery({ queryKey: ['progress', problemId], queryFn: () => api.progress(problemId) });
export const useAttempts = () => useQuery({ queryKey: ['attempts'], queryFn: api.attempts });

const IN_FLIGHT = new Set(['SUBMITTED', 'EVALUATING']);

/**
 * Polls while the attempt is being evaluated, then stops. It keeps polling in a background tab on purpose:
 * a learner will often switch away during a slow AI review, and should return to a finished page (the tab
 * title also reports progress). The polling is short-lived and ends at any terminal status.
 */
export const useAttempt = (id: string) =>
  useQuery({
    queryKey: ['attempt', id],
    queryFn: () => api.attempt(id),
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      const status = (q.state.data as AttemptDto | undefined)?.status;
      return status && IN_FLIGHT.has(status) ? 1500 : false;
    },
  });

/** Common approaches unlock after a first submission; the server answers 403 until then. */
export const useApproaches = (problemId: string, enabled: boolean) =>
  useQuery({ queryKey: ['approaches', problemId], queryFn: () => api.approaches(problemId), enabled, retry: false, staleTime: Infinity });

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { problemId: string; basedOnAttemptId?: string }) => api.startAttempt(v.problemId, v.basedOnAttemptId),
    onSuccess: (attempt) => {
      qc.setQueryData(['attempt', attempt.id], attempt);
      void qc.invalidateQueries({ queryKey: ['problems'] });
      void qc.invalidateQueries({ queryKey: ['attempts'] });
    },
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.submit(id),
    onSuccess: (attempt) => {
      qc.setQueryData(['attempt', attempt.id], attempt);
      void qc.invalidateQueries({ queryKey: ['problems'] });
      void qc.invalidateQueries({ queryKey: ['attempts'] });
      void qc.invalidateQueries({ queryKey: ['progress', attempt.problemId] });
    },
  });
}

export function useRetryEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.retry(id),
    onSuccess: (attempt) => qc.setQueryData(['attempt', attempt.id], attempt),
  });
}

export function useDiscardAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.discard(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}
