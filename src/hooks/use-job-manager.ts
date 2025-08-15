
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobStatus } from '../renderer.d';

const JOB_STATUS_QUERY_KEY = ['job-status'];

// Provide a mock status for non-electron environments
const mockStatus: JobStatus = {
  isRunning: false,
  queueSize: 0,
};

export function useJobManager() {
  const queryClient = useQueryClient();

  // Check if electronAPI is available
  const isElectron = !!window.electronAPI;

  const { data: status, isLoading } = useQuery<JobStatus>({
    queryKey: JOB_STATUS_QUERY_KEY,
    // If not in Electron, return a mock status and do not fetch.
    queryFn: () => isElectron ? window.electronAPI.getStatus() : Promise.resolve(mockStatus),
    // Only refetch if in Electron
    refetchInterval: isElectron ? 2000 : false,
    // Initial data to prevent errors on first render
    initialData: mockStatus,
  });

  const { mutate: start, isPending: isStarting } = useMutation<void, Error>({
    // If not in Electron, do nothing
    mutationFn: () => isElectron ? window.electronAPI.startMonitoring() : Promise.resolve(),
    onSuccess: () => {
      if (isElectron) {
        queryClient.invalidateQueries({ queryKey: JOB_STATUS_QUERY_KEY });
      }
    },
  });

  const { mutate: stop, isPending: isStopping } = useMutation<void, Error>({
    // If not in Electron, do nothing
    mutationFn: () => isElectron ? window.electronAPI.stopMonitoring() : Promise.resolve(),
    onSuccess: () => {
      if (isElectron) {
        queryClient.invalidateQueries({ queryKey: JOB_STATUS_QUERY_KEY });
      }
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
