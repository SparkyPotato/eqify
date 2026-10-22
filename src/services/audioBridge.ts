import { invoke } from '@tauri-apps/api/core';
import type { ApoStatus, EqProfile, FilterBand, ToneGeneratorState } from '../types/eq';

export interface FrequencyResponseResult {
  freqs: number[];
  total_curve: number[];
  filter_curves: number[][];
  max_boost_db: number;
  recommended_preamp_db: number;
}

export async function calculateFrequencyResponse(
  filters: FilterBand[],
  preamp: number,
  numPoints = 400
): Promise<FrequencyResponseResult> {
  try {
    return await invoke<FrequencyResponseResult>('calculate_frequency_response', {
      filters,
      preamp,
      numPoints,
    });
  } catch (err) {
    console.error('Failed to calculate frequency response in Rust:', err);
    throw err;
  }
}

export async function startToneGenerator(state: ToneGeneratorState): Promise<void> {
  try {
    await invoke('start_tone_generator', {
      params: {
        freq: state.freq,
        volume_db: state.volumeDb,
        wave_type: state.waveType,
        channel: state.channel,
      },
    });
  } catch (err) {
    console.error('Failed to start tone generator in Rust:', err);
  }
}

export async function updateToneGenerator(state: ToneGeneratorState): Promise<void> {
  try {
    await invoke('update_tone_generator', {
      params: {
        freq: state.freq,
        volume_db: state.volumeDb,
        wave_type: state.waveType,
        channel: state.channel,
      },
    });
  } catch (err) {
    console.error('Failed to update tone generator in Rust:', err);
  }
}

export async function stopToneGenerator(): Promise<void> {
  try {
    await invoke('stop_tone_generator');
  } catch (err) {
    console.error('Failed to stop tone generator in Rust:', err);
  }
}

export async function checkEqualizerApoStatus(targetFile?: string): Promise<ApoStatus> {
  try {
    return await invoke<ApoStatus>('check_equalizer_apo_status', { targetFile });
  } catch (err) {
    console.error('Failed to check EqualizerAPO status:', err);
    return {
      installed: false,
      config_file: '',
      target_file: targetFile || 'eqify.txt',
      is_included: false,
      can_write: false,
    };
  }
}

export async function configureEqualizerApoInclude(targetFile?: string): Promise<string> {
  return await invoke<string>('configure_equalizer_apo_include', { targetFile });
}

export async function setEqualizerApoInclude(enabled: boolean, targetFile?: string): Promise<boolean> {
  return await invoke<boolean>('set_equalizer_apo_include', { targetFile, enabled });
}

export async function listApoTxtFiles(): Promise<string[]> {
  try {
    return await invoke<string[]>('list_apo_txt_files');
  } catch (err) {
    console.error('Failed to list APO txt files:', err);
    return [];
  }
}

export async function parseApoConfigContent(content: string, name?: string): Promise<EqProfile> {
  return await invoke<EqProfile>('parse_apo_config_content', { content, name });
}

export async function applyEqConfig(
  filters: FilterBand[],
  preamp: number,
  bypass: boolean,
  targetFile?: string
): Promise<string> {
  return await invoke<string>('apply_eq_config', {
    filters,
    preamp,
    bypass,
    targetFile,
  });
}

export async function readCurrentApoConfig(targetFile?: string): Promise<EqProfile> {
  return await invoke<EqProfile>('read_current_apo_config', { targetFile });
}

export async function getProfiles(): Promise<EqProfile[]> {
  try {
    return await invoke<EqProfile[]>('get_profiles');
  } catch (err) {
    console.error('Failed to fetch profiles from Rust:', err);
    return [];
  }
}

export async function saveProfile(profile: EqProfile): Promise<string> {
  return await invoke<string>('save_profile', { profile });
}

export async function deleteProfile(name: string): Promise<boolean> {
  return await invoke<boolean>('delete_profile', { name });
}

export async function getLastPreset(): Promise<string | null> {
  try {
    return await invoke<string | null>('get_last_preset');
  } catch (err) {
    console.warn('Failed to get last preset from Rust:', err);
    return null;
  }
}

export async function setLastPreset(name: string): Promise<void> {
  try {
    await invoke('set_last_preset', { name });
  } catch (err) {
    console.warn('Failed to set last preset in Rust:', err);
  }
}
