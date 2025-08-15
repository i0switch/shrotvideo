import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '@/core/settings'; // Corrected import path
import mergeWith from 'lodash.mergewith';

const SETTINGS_QUERY_KEY = ['settings'];

/**
 * Customizer for lodash.mergeWith to handle array replacements.
 * If the source value is an array, it replaces the destination value.
 * Otherwise, it returns undefined to let mergeWith handle it.
 */
function arrayReplacementCustomizer(objValue: any, srcValue: any) {
  if (Array.isArray(srcValue)) {
    return srcValue;
  }
  // Return undefined to fallback to default merge behavior
  return undefined;
}

export function useSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading, isError, error } = useQuery<AppSettings>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const result = await window.electronAPI.getSettings(); // Assuming electronAPI is on window
      if (!result) {
        throw new Error("Settings could not be loaded from the main process.");
      }
      return result;
    },
    refetchOnWindowFocus: false,
  });

  const { mutate: updateSettings, isPending: isUpdating } = useMutation<void, Error, Partial<AppSettings>>({
    mutationFn: async (newSettingsPatch: Partial<AppSettings>) => {
      const currentSettings = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY);
      if (!currentSettings) {
        throw new Error("Cannot update settings: current settings not available.");
      }

      // Deep merge current settings with the patch
      const newSettings = mergeWith({}, currentSettings, newSettingsPatch, arrayReplacementCustomizer);

      await window.electronAPI.setSettings(newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
    onError: (error) => {
      console.error("Failed to update settings:", error);
      // Consider showing a toast notification here
    },
  });

  return {
    settings,
    isLoading,
    isError,
    error,
    updateSettings,
    isUpdating,
  };
}