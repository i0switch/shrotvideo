import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '@/core/settings'; // Corrected import path
import mergeWith from 'lodash.mergewith';

const SETTINGS_QUERY_KEY = ['settings'];

/**
 * Customizer for lodash.mergeWith to handle array replacements.
 * If the source value is an array, it replaces the destination value.
 * Otherwise, it returns undefined to let mergeWith handle it.
 */
function arrayReplacementCustomizer<T>(objValue: unknown, srcValue: unknown): T | undefined {
  if (Array.isArray(srcValue)) {
  return srcValue as T;
  }
  // Return undefined to fallback to default merge behavior
  return undefined;
}

// Mock settings for non-electron environments based on main.ts defaults
const mockSettings: AppSettings = {
  general: {
    outputPath: '/mock/path', // A mock path
  },
  platforms: {
    x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000 },
    tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000 },
    instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000 },
    youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000 },
  },
  render: {
    resolution: { width: 1080, height: 1920 },
    durationSec: 15,
    bgmPath: '',
    backgroundVideoPath: '',
    captions: { top: '', bottom: '' },
    scale: 0.8,
    teleTextBg: '#000000',
    qualityPreset: 'standard',
    overlayPosition: 'center',
    topCaptionHeight: 120,
    bottomCaptionHeight: 160,
    captionBgOpacity: 1.0,
  },
};


export function useSettings() {
  const queryClient = useQueryClient();
  const isElectron = !!window.electronAPI;

  const { data: settings, isLoading, isError, error } = useQuery<AppSettings>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => {
      if (!isElectron) {
        // In a non-electron environment, return mock data.
        return Promise.resolve(mockSettings);
      }
      const result = await window.electronAPI.getSettings();
      if (!result) {
        throw new Error("Settings could not be loaded from the main process.");
      }
      return result;
    },
    // Use initialData to prevent loading state flashes and ensure data is always available
    initialData: mockSettings,
    refetchOnWindowFocus: false,
  });

  const { mutate: updateSettings, isPending: isUpdating } = useMutation<void, Error, Partial<AppSettings>>({
    // 楽観的更新: 先にキャッシュを更新してUIを即時反映
    onMutate: async (newSettingsPatch: Partial<AppSettings>) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY);
      if (previous) {
        const optimistic = mergeWith({}, previous, newSettingsPatch, arrayReplacementCustomizer);
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, optimistic);
      }
      return { previous } as { previous?: AppSettings };
    },
    mutationFn: async (newSettingsPatch: Partial<AppSettings>) => {
      if (!isElectron) {
        // In a non-electron environment, we can simulate the update for optimistic UI
        // or just do nothing. For now, we do nothing.
        return Promise.resolve();
      }
      const currentSettings = queryClient.getQueryData<AppSettings>(SETTINGS_QUERY_KEY);
      if (!currentSettings) {
        throw new Error("Cannot update settings: current settings not available.");
      }
      const newSettings = mergeWith({}, currentSettings, newSettingsPatch, arrayReplacementCustomizer);
      await window.electronAPI.setSettings(newSettings);
    },
    onSuccess: () => {
      if (isElectron) {
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      }
    },
  onError: (error, _vars, context: { previous?: AppSettings } | undefined) => {
      // 失敗時は前の設定にロールバック
      if (context?.previous) {
        queryClient.setQueryData<AppSettings>(SETTINGS_QUERY_KEY, context.previous);
      }
      console.error("Failed to update settings:", error);
    },
  });

  return {
    // Return isLoading as false if not in electron, because we are using initialData
    settings: settings || mockSettings,
    isLoading: isElectron && isLoading,
    isError,
    error,
    updateSettings,
    isUpdating,
  };
}