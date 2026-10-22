use crate::{FilterBand, FilterType};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WaveType {
    Sine,
    Pink,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioChannel {
    #[serde(rename = "L")]
    Left,
    #[serde(rename = "Both")]
    Both,
    #[serde(rename = "R")]
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToneParams {
    pub freq: f64,
    pub volume_db: f64,
    pub wave_type: WaveType,
    pub channel: AudioChannel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyResponseResult {
    pub freqs: Vec<f64>,
    pub total_curve: Vec<f64>,
    pub filter_curves: Vec<Vec<f64>>,
    pub max_boost_db: f64,
    pub recommended_preamp_db: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a0: f64,
    pub a1: f64,
    pub a2: f64,
}

pub fn calc_biquad_coeffs(
    filter_type: FilterType,
    freq: f64,
    gain_db: f64,
    q: f64,
    sample_rate: f64,
) -> BiquadCoeffs {
    let f0 = freq.clamp(10.0, sample_rate / 2.0 - 100.0);
    let q_val = q.clamp(0.1, 20.0);
    let a = 10.0f64.powf(gain_db / 40.0);
    let w0 = (2.0 * PI * f0) / sample_rate;
    let cosw0 = w0.cos();
    let sinw0 = w0.sin();
    let alpha = sinw0 / (2.0 * q_val);

    let (b0, b1, b2, a0, a1, a2) = match filter_type {
        FilterType::Peak => (
            1.0 + alpha * a,
            -2.0 * cosw0,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cosw0,
            1.0 - alpha / a,
        ),
        FilterType::LowShelf => {
            let sqrt_a = a.sqrt();
            let alpha_shelf = (sinw0 / 2.0) * ((a + 1.0 / a) * (1.0 / q_val - 1.0) + 2.0).max(0.0).sqrt();
            (
                a * ((a + 1.0) - (a - 1.0) * cosw0 + 2.0 * sqrt_a * alpha_shelf),
                2.0 * a * ((a - 1.0) - (a + 1.0) * cosw0),
                a * ((a + 1.0) - (a - 1.0) * cosw0 - 2.0 * sqrt_a * alpha_shelf),
                (a + 1.0) + (a - 1.0) * cosw0 + 2.0 * sqrt_a * alpha_shelf,
                -2.0 * ((a - 1.0) + (a + 1.0) * cosw0),
                (a + 1.0) + (a - 1.0) * cosw0 - 2.0 * sqrt_a * alpha_shelf,
            )
        }
        FilterType::HighShelf => {
            let sqrt_a = a.sqrt();
            let alpha_shelf = (sinw0 / 2.0) * ((a + 1.0 / a) * (1.0 / q_val - 1.0) + 2.0).max(0.0).sqrt();
            (
                a * ((a + 1.0) + (a - 1.0) * cosw0 + 2.0 * sqrt_a * alpha_shelf),
                -2.0 * a * ((a - 1.0) + (a + 1.0) * cosw0),
                a * ((a + 1.0) + (a - 1.0) * cosw0 - 2.0 * sqrt_a * alpha_shelf),
                (a + 1.0) - (a - 1.0) * cosw0 + 2.0 * sqrt_a * alpha_shelf,
                2.0 * ((a - 1.0) - (a + 1.0) * cosw0),
                (a + 1.0) - (a - 1.0) * cosw0 - 2.0 * sqrt_a * alpha_shelf,
            )
        }
    };

    BiquadCoeffs { b0, b1, b2, a0, a1, a2 }
}

pub fn evaluate_biquad_db(coeffs: &BiquadCoeffs, freq: f64, sample_rate: f64) -> f64 {
    let w = (2.0 * PI * freq) / sample_rate;
    let cosw = w.cos();
    let sinw = w.sin();
    let cos2w = (2.0 * w).cos();
    let sin2w = (2.0 * w).sin();

    let num_re = coeffs.b0 + coeffs.b1 * cosw + coeffs.b2 * cos2w;
    let num_im = -coeffs.b1 * sinw - coeffs.b2 * sin2w;

    let den_re = coeffs.a0 + coeffs.a1 * cosw + coeffs.a2 * cos2w;
    let den_im = -coeffs.a1 * sinw - coeffs.a2 * sin2w;

    let num_mag_sq = num_re * num_re + num_im * num_im;
    let den_mag_sq = den_re * den_re + den_im * den_im;

    if den_mag_sq <= 1e-12 {
        return 0.0;
    }
    let mag_sq = num_mag_sq / den_mag_sq;
    if mag_sq <= 1e-12 {
        return -100.0;
    }
    10.0 * mag_sq.log10()
}

pub fn compute_frequency_response(
    filters: &[FilterBand],
    _preamp_db: f64,
    points_count: usize,
    sample_rate: f64,
) -> FrequencyResponseResult {
    let count = points_count.clamp(100, 1000);
    let min_log = 20.0f64.log10();
    let max_log = 20000.0f64.log10();

    let mut freqs = Vec::with_capacity(count);
    for i in 0..count {
        let t = i as f64 / (count - 1) as f64;
        let log_f = min_log + t * (max_log - min_log);
        freqs.push(10.0f64.powf(log_f));
    }

    let filter_coeffs: Vec<Option<BiquadCoeffs>> = filters
        .iter()
        .map(|f| {
            if f.enabled {
                Some(calc_biquad_coeffs(f.filter_type, f.freq, f.gain, f.q, sample_rate))
            } else {
                None
            }
        })
        .collect();

    // Multithreaded evaluation across all frequency points using Rayon
    let point_results: Vec<(f64, Vec<f64>)> = freqs
        .par_iter()
        .map(|&freq| {
            let mut total = 0.0;
            let mut curves_for_freq = Vec::with_capacity(filter_coeffs.len());
            for opt_coeffs in &filter_coeffs {
                let filter_db = if let Some(coeffs) = opt_coeffs {
                    evaluate_biquad_db(coeffs, freq, sample_rate)
                } else {
                    0.0
                };
                curves_for_freq.push(filter_db);
                total += filter_db;
            }
            (total, curves_for_freq)
        })
        .collect();

    let mut total_curve = Vec::with_capacity(count);
    let mut filter_curves: Vec<Vec<f64>> = vec![Vec::with_capacity(count); filters.len()];
    let mut max_boost = 0.0f64;

    for (total, curves_for_freq) in point_results {
        total_curve.push(total);
        if total > max_boost {
            max_boost = total;
        }
        for (i, db) in curves_for_freq.into_iter().enumerate() {
            filter_curves[i].push(db);
        }
    }

    let recommended_preamp = if max_boost > 0.0 { -max_boost } else { 0.0 };

    FrequencyResponseResult {
        freqs,
        total_curve,
        filter_curves,
        max_boost_db: max_boost,
        recommended_preamp_db: recommended_preamp,
    }
}

struct XorShift32 {
    state: u32,
}

impl XorShift32 {
    fn new(seed: u32) -> Self {
        Self { state: if seed == 0 { 0x12345678 } else { seed } }
    }

    fn next_f32(&mut self) -> f32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        (x as f32) / (u32::MAX as f32) * 2.0 - 1.0
    }
}

struct PinkNoiseFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    b3: f32,
    b4: f32,
    b5: f32,
    b6: f32,
    rng: XorShift32,
}

impl PinkNoiseFilter {
    fn new() -> Self {
        Self {
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            b3: 0.0,
            b4: 0.0,
            b5: 0.0,
            b6: 0.0,
            rng: XorShift32::new(987654321),
        }
    }

    fn next_sample(&mut self) -> f32 {
        let white = self.rng.next_f32();
        self.b0 = 0.99886 * self.b0 + white * 0.0555179;
        self.b1 = 0.99332 * self.b1 + white * 0.0750759;
        self.b2 = 0.96900 * self.b2 + white * 0.1538520;
        self.b3 = 0.86650 * self.b3 + white * 0.3104856;
        self.b4 = 0.55000 * self.b4 + white * 0.5329522;
        self.b5 = -0.7616 * self.b5 - white * 0.0168980;
        let out = (self.b0 + self.b1 + self.b2 + self.b3 + self.b4 + self.b5 + self.b6 + white * 0.5362) * 0.11;
        self.b6 = white * 0.115926;
        out
    }
}

pub struct ToneAudioState {
    pub freq: f64,
    pub volume_linear: f32,
    pub target_volume_linear: f32,
    pub wave_type: WaveType,
    pub channel: AudioChannel,
    pub phase: f64,
    pink_filter: PinkNoiseFilter,
}

impl ToneAudioState {
    pub fn new() -> Self {
        Self {
            freq: 1000.0,
            volume_linear: 0.0,
            target_volume_linear: 0.25,
            wave_type: WaveType::Sine,
            channel: AudioChannel::Both,
            phase: 0.0,
            pink_filter: PinkNoiseFilter::new(),
        }
    }

    pub fn next_sample(&mut self, sample_rate: f64) -> (f32, f32) {
        // Smooth volume transitions
        self.volume_linear += (self.target_volume_linear - self.volume_linear) * 0.005;

        let raw = match self.wave_type {
            WaveType::Pink => self.pink_filter.next_sample(),
            WaveType::Sine => {
                let s = self.phase.sin() as f32;
                let step = (2.0 * PI * self.freq) / sample_rate;
                self.phase = (self.phase + step) % (2.0 * PI);
                s
            }
        };

        let sample = raw * self.volume_linear;

        match self.channel {
            AudioChannel::Left => (sample, 0.0),
            AudioChannel::Right => (0.0, sample),
            AudioChannel::Both => (sample, sample),
        }
    }
}

pub struct AudioEngineManager {
    _stream: Option<cpal::Stream>,
    pub state: Arc<Mutex<ToneAudioState>>,
}

impl AudioEngineManager {
    pub fn new() -> Self {
        Self {
            _stream: None,
            state: Arc::new(Mutex::new(ToneAudioState::new())),
        }
    }

    pub fn is_playing(&self) -> bool {
        self._stream.is_some()
    }

    pub fn start(&mut self, params: ToneParams) -> Result<(), String> {
        self.stop();

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device available".to_string())?;

        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get audio config: {}", e))?;

        let sample_rate = config.sample_rate() as f64;
        let channels = config.channels() as usize;
        let sample_format = config.sample_format();

        {
            let mut state = self.state.lock().unwrap();
            state.freq = params.freq;
            let target_lin = 10.0f32.powf((params.volume_db as f32) / 20.0);
            state.volume_linear = 0.0001;
            state.target_volume_linear = target_lin;
            state.wave_type = params.wave_type;
            state.channel = params.channel;
            state.phase = 0.0;
        }

        let err_fn = |err| eprintln!("Audio stream error: {}", err);
        let stream_config: cpal::StreamConfig = config.into();

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let state_clone = Arc::clone(&self.state);
                device.build_output_stream(
                    stream_config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        let mut state = state_clone.lock().unwrap();
                        for frame in data.chunks_mut(channels) {
                            let (left, right) = state.next_sample(sample_rate);
                            if frame.len() >= 2 {
                                frame[0] = left;
                                frame[1] = right;
                                for item in frame.iter_mut().skip(2) {
                                    *item = 0.0;
                                }
                            } else if !frame.is_empty() {
                                frame[0] = (left + right) * 0.5;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let state_clone = Arc::clone(&self.state);
                device.build_output_stream(
                    stream_config,
                    move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                        let mut state = state_clone.lock().unwrap();
                        for frame in data.chunks_mut(channels) {
                            let (left, right) = state.next_sample(sample_rate);
                            let left_i16 = (left.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            let right_i16 = (right.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            if frame.len() >= 2 {
                                frame[0] = left_i16;
                                frame[1] = right_i16;
                                for item in frame.iter_mut().skip(2) {
                                    *item = 0;
                                }
                            } else if !frame.is_empty() {
                                frame[0] = ((left_i16 as i32 + right_i16 as i32) / 2) as i16;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let state_clone = Arc::clone(&self.state);
                device.build_output_stream(
                    stream_config,
                    move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                        let mut state = state_clone.lock().unwrap();
                        for frame in data.chunks_mut(channels) {
                            let (left, right) = state.next_sample(sample_rate);
                            let left_u16 = ((left.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16;
                            let right_u16 = ((right.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16;
                            if frame.len() >= 2 {
                                frame[0] = left_u16;
                                frame[1] = right_u16;
                                for item in frame.iter_mut().skip(2) {
                                    *item = u16::MAX / 2;
                                }
                            } else if !frame.is_empty() {
                                frame[0] = ((left_u16 as u32 + right_u16 as u32) / 2) as u16;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            _ => return Err("Unsupported audio sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to play audio: {}", e))?;
        self._stream = Some(stream);
        Ok(())
    }

    pub fn update(&self, params: ToneParams) {
        if let Ok(mut state) = self.state.lock() {
            state.freq = params.freq;
            state.target_volume_linear = 10.0f32.powf((params.volume_db as f32) / 20.0);
            state.wave_type = params.wave_type;
            state.channel = params.channel;
        }
    }

    pub fn stop(&mut self) {
        if let Some(stream) = self._stream.take() {
            let _ = stream.pause();
            drop(stream);
        }
        if let Ok(mut state) = self.state.lock() {
            state.volume_linear = 0.0;
        }
    }
}
