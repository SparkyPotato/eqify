export type FilterType = 'PK' | 'LSC' | 'HSC';

export interface FilterBand {
  id: string;
  enabled: boolean;
  filter_type: FilterType;
  freq: number;       // 20 - 20000 Hz
  gain: number;       // -20 to +20 dB
  q: number;          // 0.1 to 10.0
  color?: string;
}

export interface EqProfile {
  name: string;
  preamp: number;
  filters: FilterBand[];
  updated_at?: {
    secs_since_epoch: number;
    nanos_since_epoch: number;
  } | number | string;
}

export interface ApoStatus {
  installed: boolean;
  config_file: string;
  target_file: string;
  is_included: boolean;
  can_write: boolean;
}

export interface ToneGeneratorState {
  isPlaying: boolean;
  freq: number;
  volumeDb: number;
  waveType: 'sine' | 'pink';
  octStep: 'full' | '1' | '1/3';
  channel: 'L' | 'Both' | 'R';
}
