
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobStatus } from '../renderer.d';

const JOB_STATUS_QUERY_KEY = ['job-status'];

export function useJobManager() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<JobStatus>({
    queryKey: JOB_STATUS_QUERY_KEY,
    queryFn: () => window.electronAPI.getStatus(),
    refetchInterval: 2000, // 2 seconds
  });

  const { mutate: start, isPending: isStarting } = useMutation<void, Error>({
    mutationFn: () => window.electronAPI.startMonitoring(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOB_STATUS_QUERY_KEY });
    },
  });

  const { mutate: stop, isPending: isStopping } = useMutation<void, Error>({
    mutationFn: () => window.electronAPI.stopMonitoring(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOB_STATUS_QUERY_KEY });
    },
  });

  return {
    status,
    isLoading,
    start,
    isStarting,
    stop,
    isStopping,
  };
}
