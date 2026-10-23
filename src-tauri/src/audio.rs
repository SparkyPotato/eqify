use crate::{FilterBand, FilterType};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::alloc::{Layout, alloc, dealloc};
use std::f32::consts::PI;
use std::fmt;
use std::ops::{Deref, DerefMut};
use std::ptr::NonNull;
use std::simd::{Select, StdFloat, cmp::SimdPartialOrd, f32x8, num::SimdFloat};
use std::sync::{Arc, Mutex};

/// A heap-allocated vector guaranteed to be aligned to `ALIGN` bytes.
/// Useful for SIMD operations requiring aligned loads/stores (e.g., 32-byte alignment for 256-bit AVX).
pub struct AlignedVec<T, const ALIGN: usize = 32> {
    ptr: NonNull<T>,
    cap: usize,
    len: usize,
}

unsafe impl<T: Send, const ALIGN: usize> Send for AlignedVec<T, ALIGN> {}
unsafe impl<T: Sync, const ALIGN: usize> Sync for AlignedVec<T, ALIGN> {}

impl<T, const ALIGN: usize> AlignedVec<T, ALIGN> {
    pub const fn new() -> Self {
        assert!(ALIGN.is_power_of_two() && ALIGN >= std::mem::align_of::<T>());
        Self {
            ptr: NonNull::dangling(),
            cap: 0,
            len: 0,
        }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        let mut vec = Self::new();
        if capacity > 0 {
            vec.reserve(capacity);
        }
        vec
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.cap
    }

    #[inline]
    pub fn as_slice(&self) -> &[T] {
        if self.len == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
        }
    }

    #[inline]
    pub fn as_slice_mut(&mut self) -> &mut [T] {
        if self.len == 0 {
            &mut []
        } else {
            unsafe { std::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len) }
        }
    }

    pub fn reserve(&mut self, additional: usize) {
        let required = self.len.checked_add(additional).expect("capacity overflow");
        if required > self.cap {
            let new_cap = (self.cap * 2).max(required).max(8);
            self.grow_to(new_cap);
        }
    }

    fn grow_to(&mut self, new_cap: usize) {
        let new_size = new_cap
            .checked_mul(std::mem::size_of::<T>())
            .expect("size overflow");
        let new_layout = Layout::from_size_align(new_size, ALIGN).expect("invalid layout");

        let new_ptr = if self.cap == 0 {
            unsafe { alloc(new_layout) as *mut T }
        } else {
            let old_size = self.cap * std::mem::size_of::<T>();
            let old_layout = Layout::from_size_align(old_size, ALIGN).unwrap();
            unsafe {
                let p = alloc(new_layout) as *mut T;
                if !p.is_null() && self.len > 0 {
                    std::ptr::copy_nonoverlapping(self.ptr.as_ptr(), p, self.len);
                    dealloc(self.ptr.as_ptr() as *mut u8, old_layout);
                }
                p
            }
        };

        self.ptr =
            NonNull::new(new_ptr).unwrap_or_else(|| std::alloc::handle_alloc_error(new_layout));
        self.cap = new_cap;
    }

    pub fn push(&mut self, value: T) {
        if self.len == self.cap {
            self.reserve(1);
        }
        unsafe {
            self.ptr.as_ptr().add(self.len).write(value);
        }
        self.len += 1;
    }

    pub fn clear(&mut self) {
        if std::mem::needs_drop::<T>() {
            for i in 0..self.len {
                unsafe {
                    std::ptr::drop_in_place(self.ptr.as_ptr().add(i));
                }
            }
        }
        self.len = 0;
    }

    #[inline]
    pub fn is_aligned(&self) -> bool {
        if self.cap == 0 {
            true
        } else {
            (self.ptr.as_ptr() as usize).is_multiple_of(ALIGN)
        }
    }
}

impl<T: Copy, const ALIGN: usize> AlignedVec<T, ALIGN> {
    pub fn resize(&mut self, new_len: usize, value: T) {
        if new_len > self.len {
            self.reserve(new_len - self.len);
            for i in self.len..new_len {
                unsafe {
                    self.ptr.as_ptr().add(i).write(value);
                }
            }
        }
        self.len = new_len;
    }

    pub fn from_slice(slice: &[T]) -> Self {
        let mut vec = Self::with_capacity(slice.len());
        for &item in slice {
            vec.push(item);
        }
        vec
    }
}

impl<const ALIGN: usize> AlignedVec<f32, ALIGN> {
    #[inline]
    pub fn as_simd_slices(&self) -> (&[f32x8], &[f32]) {
        assert!(ALIGN >= 32);
        let simd_count = self.len / 8;
        let simd_slice =
            unsafe { std::slice::from_raw_parts(self.ptr.as_ptr() as *const f32x8, simd_count) };
        let remainder = &self.as_slice()[simd_count * 8..];
        (simd_slice, remainder)
    }

    #[inline]
    pub fn as_simd_slices_mut(&mut self) -> (&mut [f32x8], &mut [f32]) {
        assert!(ALIGN >= 32);
        let simd_count = self.len / 8;
        let simd_slice =
            unsafe { std::slice::from_raw_parts_mut(self.ptr.as_ptr() as *mut f32x8, simd_count) };
        let remainder = &mut self.as_slice_mut()[simd_count * 8..];
        (simd_slice, remainder)
    }
}

impl<T, const ALIGN: usize> Default for AlignedVec<T, ALIGN> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T, const ALIGN: usize> Deref for AlignedVec<T, ALIGN> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &Self::Target {
        self.as_slice()
    }
}

impl<T, const ALIGN: usize> DerefMut for AlignedVec<T, ALIGN> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.as_slice_mut()
    }
}

impl<T: Clone, const ALIGN: usize> Clone for AlignedVec<T, ALIGN> {
    fn clone(&self) -> Self {
        let mut new_vec = Self::with_capacity(self.len);
        for item in self.as_slice() {
            new_vec.push(item.clone());
        }
        new_vec
    }
}

impl<T, const ALIGN: usize> Drop for AlignedVec<T, ALIGN> {
    fn drop(&mut self) {
        if self.cap > 0 {
            self.clear();
            let layout =
                Layout::from_size_align(self.cap * std::mem::size_of::<T>(), ALIGN).unwrap();
            unsafe {
                dealloc(self.ptr.as_ptr() as *mut u8, layout);
            }
        }
    }
}

impl<T: fmt::Debug, const ALIGN: usize> fmt::Debug for AlignedVec<T, ALIGN> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.as_slice().fmt(f)
    }
}

impl<T: PartialEq, const ALIGN: usize> PartialEq for AlignedVec<T, ALIGN> {
    fn eq(&self, other: &Self) -> bool {
        self.as_slice() == other.as_slice()
    }
}

impl<T: Serialize, const ALIGN: usize> Serialize for AlignedVec<T, ALIGN> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_seq(self.as_slice())
    }
}

impl<'de, T: Deserialize<'de> + Copy, const ALIGN: usize> Deserialize<'de>
    for AlignedVec<T, ALIGN>
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let std_vec = Vec::<T>::deserialize(deserializer)?;
        Ok(Self::from_slice(&std_vec))
    }
}

impl<T: Clone, const ALIGN: usize> From<&[T]> for AlignedVec<T, ALIGN> {
    fn from(slice: &[T]) -> Self {
        let mut vec = Self::with_capacity(slice.len());
        for item in slice {
            vec.push(item.clone());
        }
        vec
    }
}

impl<T: Clone, const ALIGN: usize> From<Vec<T>> for AlignedVec<T, ALIGN> {
    fn from(v: Vec<T>) -> Self {
        Self::from(v.as_slice())
    }
}

impl<T: Clone, const ALIGN: usize> From<AlignedVec<T, ALIGN>> for Vec<T> {
    fn from(v: AlignedVec<T, ALIGN>) -> Self {
        v.as_slice().to_vec()
    }
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
    pub freq: f32,
    pub volume_db: f32,
    pub channel: AudioChannel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyResponseResult {
    pub freqs: AlignedVec<f32, 32>,
    pub total_curve: AlignedVec<f32, 32>,
    pub filter_curves: Vec<AlignedVec<f32, 32>>,
    pub max_boost_db: f32,
    pub recommended_preamp_db: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a0: f32,
    pub a1: f32,
    pub a2: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct SimdBiquadCoeffs {
    pub b0: f32x8,
    pub b1: f32x8,
    pub b2: f32x8,
    pub a0: f32x8,
    pub a1: f32x8,
    pub a2: f32x8,
}

impl From<BiquadCoeffs> for SimdBiquadCoeffs {
    #[inline]
    fn from(c: BiquadCoeffs) -> Self {
        Self {
            b0: f32x8::splat(c.b0),
            b1: f32x8::splat(c.b1),
            b2: f32x8::splat(c.b2),
            a0: f32x8::splat(c.a0),
            a1: f32x8::splat(c.a1),
            a2: f32x8::splat(c.a2),
        }
    }
}

pub fn calc_biquad_coeffs(
    filter_type: FilterType,
    freq: f32,
    gain_db: f32,
    q: f32,
    sample_rate: f32,
) -> BiquadCoeffs {
    let f0 = freq.clamp(10.0, sample_rate / 2.0 - 100.0);
    let q_val = q.clamp(0.1, 20.0);
    let a = 10.0f32.powf(gain_db / 40.0);
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
            let alpha_shelf =
                (sinw0 / 2.0) * ((a + 1.0 / a) * (1.0 / q_val - 1.0) + 2.0).max(0.0).sqrt();
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
            let alpha_shelf =
                (sinw0 / 2.0) * ((a + 1.0 / a) * (1.0 / q_val - 1.0) + 2.0).max(0.0).sqrt();
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

    BiquadCoeffs {
        b0,
        b1,
        b2,
        a0,
        a1,
        a2,
    }
}

pub fn evaluate_biquad_db(coeffs: &BiquadCoeffs, freq: f32, sample_rate: f32) -> f32 {
    let w = (2.0 * PI * freq) / sample_rate;
    let cosw = w.cos();
    let sinw = w.sin();
    let cos2w = 2.0 * cosw * cosw - 1.0;
    let sin2w = 2.0 * sinw * cosw;

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

#[inline]
pub fn evaluate_biquad_db_simd(coeffs: &SimdBiquadCoeffs, freqs: f32x8, sample_rate: f32) -> f32x8 {
    let w = (f32x8::splat(2.0 * PI) * freqs) / f32x8::splat(sample_rate);
    let cosw = StdFloat::cos(w);
    let sinw = StdFloat::sin(w);
    let two = f32x8::splat(2.0);
    let one = f32x8::splat(1.0);
    let cos2w = two * cosw * cosw - one;
    let sin2w = two * sinw * cosw;

    let num_re = coeffs.b0 + coeffs.b1 * cosw + coeffs.b2 * cos2w;
    let num_im = -coeffs.b1 * sinw - coeffs.b2 * sin2w;

    let den_re = coeffs.a0 + coeffs.a1 * cosw + coeffs.a2 * cos2w;
    let den_im = -coeffs.a1 * sinw - coeffs.a2 * sin2w;

    let num_mag_sq = num_re * num_re + num_im * num_im;
    let den_mag_sq = den_re * den_re + den_im * den_im;

    let eps = f32x8::splat(1e-12);
    let mag_sq = num_mag_sq / den_mag_sq;

    let db = f32x8::splat(10.0) * StdFloat::log10(mag_sq);

    let mag_too_small = mag_sq.simd_le(eps);
    let db_clamped = mag_too_small.select(f32x8::splat(-100.0), db);

    let den_too_small = den_mag_sq.simd_le(eps);
    den_too_small.select(f32x8::splat(0.0), db_clamped)
}

pub fn compute_frequency_response(
    filters: &[FilterBand],
    _preamp_db: f32,
    points_count: usize,
    sample_rate: f32,
) -> FrequencyResponseResult {
    let count = points_count.clamp(100, 1000);
    let min_log = 20.0f32.log10();
    let max_log = 20000.0f32.log10();

    let mut freqs = AlignedVec::<f32, 32>::with_capacity(count);
    for i in 0..count {
        let t = i as f32 / (count - 1) as f32;
        let log_f = min_log + t * (max_log - min_log);
        freqs.push(10.0f32.powf(log_f));
    }

    let filter_coeffs: Vec<Option<BiquadCoeffs>> = filters
        .iter()
        .map(|f| {
            if f.enabled {
                Some(calc_biquad_coeffs(
                    f.filter_type,
                    f.freq as f32,
                    f.gain as f32,
                    f.q as f32,
                    sample_rate,
                ))
            } else {
                None
            }
        })
        .collect();

    let simd_coeffs: Vec<Option<SimdBiquadCoeffs>> = filter_coeffs
        .iter()
        .map(|opt| opt.map(SimdBiquadCoeffs::from))
        .collect();

    let mut total_curve = AlignedVec::<f32, 32>::with_capacity(count);
    total_curve.resize(count, 0.0);

    let mut filter_curves: Vec<AlignedVec<f32, 32>> = (0..filters.len())
        .map(|_| {
            let mut v = AlignedVec::<f32, 32>::with_capacity(count);
            v.resize(count, 0.0);
            v
        })
        .collect();

    let (simd_freqs, rem_freqs) = freqs.as_simd_slices();
    let simd_blocks = simd_freqs.len();

    let mut max_boost = 0.0f32;

    for (chunk_idx, &freq_chunk) in simd_freqs.iter().enumerate() {
        let offset = chunk_idx * 8;
        let mut total_simd = f32x8::splat(0.0);

        for (filter_idx, opt_simd) in simd_coeffs.iter().enumerate() {
            let filter_db = if let Some(coeffs) = opt_simd {
                evaluate_biquad_db_simd(coeffs, freq_chunk, sample_rate)
            } else {
                f32x8::splat(0.0)
            };
            filter_db.copy_to_slice(&mut filter_curves[filter_idx][offset..offset + 8]);
            total_simd += filter_db;
        }

        total_simd.copy_to_slice(&mut total_curve[offset..offset + 8]);
        let chunk_max = total_simd.reduce_max();
        if chunk_max > max_boost {
            max_boost = chunk_max;
        }
    }

    let rem_offset = simd_blocks * 8;
    for (i, &freq) in rem_freqs.iter().enumerate() {
        let pt_idx = rem_offset + i;
        let mut total = 0.0f32;
        for (filter_idx, opt_coeffs) in filter_coeffs.iter().enumerate() {
            let filter_db = if let Some(coeffs) = opt_coeffs {
                evaluate_biquad_db(coeffs, freq, sample_rate)
            } else {
                0.0
            };
            filter_curves[filter_idx][pt_idx] = filter_db;
            total += filter_db;
        }
        total_curve[pt_idx] = total;
        if total > max_boost {
            max_boost = total;
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

#[allow(clippy::excessive_precision)]
const SIN_COEFFS: [f32; 5] = [
    -3.1415926444234477,   // x
    2.0261194642649887,    // x^3
    -0.5240361513980939,   // x^5
    0.0751872634325299,    // x^7
    -0.006860187425683514, // x^9
];

#[inline]
/// sin(pi * x):
/// x must be in range [-1, 1].
pub fn sin_pi(x: f32x8) -> f32x8 {
    // Chebyshev sine polynomial approximation
    let x2 = x * x;
    let p9 = f32x8::splat(SIN_COEFFS[4]);
    let p7 = p9.mul_add(x2, f32x8::splat(SIN_COEFFS[3]));
    let p5 = p7.mul_add(x2, f32x8::splat(SIN_COEFFS[2]));
    let p3 = p5.mul_add(x2, f32x8::splat(SIN_COEFFS[1]));
    let p1 = p3.mul_add(x2, f32x8::splat(SIN_COEFFS[0]));

    (x - f32x8::splat(1.0)) * (x + f32x8::splat(1.0)) * p1 * x
}

#[inline]
pub fn phase_to_sin_input(x: f32x8) -> f32x8 {
    x.mul_add(f32x8::splat(2.0), f32x8::splat(-1.0))
}

pub struct ToneAudioState {
    pub freq: f32,
    pub volume_linear: f32,
    pub target_volume_linear: f32,
    pub channel: AudioChannel,
    pub phase: f32,
}

impl Default for ToneAudioState {
    fn default() -> Self {
        Self::new()
    }
}

impl ToneAudioState {
    pub fn new() -> Self {
        Self {
            freq: 1000.0,
            volume_linear: 0.0,
            target_volume_linear: 0.25,
            channel: AudioChannel::Both,
            phase: 0.0,
        }
    }

    #[inline]
    pub fn generate_samples_simd(&mut self, sample_rate: f32) -> (f32x8, f32x8) {
        let step = self.freq / sample_rate;
        let offsets = f32x8::from_array([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
        let phase_vec = offsets.mul_add(f32x8::splat(step), f32x8::splat(self.phase));
        let norm_phase = phase_vec - StdFloat::floor(phase_vec);
        self.phase = (self.phase + 8.0 * step).fract();

        let sin_input = phase_to_sin_input(norm_phase);
        let raw = sin_pi(sin_input);

        // Smooth volume transitions across the 8 samples
        let mut vols = [0.0f32; 8];
        let mut v = self.volume_linear;
        for item in &mut vols {
            v += (self.target_volume_linear - v) * 0.005;
            *item = v;
        }
        self.volume_linear = v;
        let vol_vec = f32x8::from_array(vols);

        let samples = raw * vol_vec;

        match self.channel {
            AudioChannel::Left => (samples, f32x8::splat(0.0)),
            AudioChannel::Right => (f32x8::splat(0.0), samples),
            AudioChannel::Both => (samples, samples),
        }
    }

    #[inline]
    pub fn next_sample(&mut self, sample_rate: f32) -> (f32, f32) {
        self.volume_linear += (self.target_volume_linear - self.volume_linear) * 0.005;

        let step = self.freq / sample_rate;
        let phase = self.phase;
        self.phase = (self.phase + step).fract();

        let sin_input = phase * 2.0 - 1.0;
        let raw = sin_pi(f32x8::splat(sin_input))[0];
        let sample = raw * self.volume_linear;

        match self.channel {
            AudioChannel::Left => (sample, 0.0),
            AudioChannel::Right => (0.0, sample),
            AudioChannel::Both => (sample, sample),
        }
    }

    pub fn process_f32_frames(&mut self, data: &mut [f32], channels: usize, sample_rate: f32) {
        if channels == 2 {
            let total_frames = data.len() / 2;
            let simd_blocks = total_frames / 8;
            for i in 0..simd_blocks {
                let (left, right) = self.generate_samples_simd(sample_rate);
                let (lo, hi) = left.interleave(right);
                let offset = i * 16;
                lo.copy_to_slice(&mut data[offset..offset + 8]);
                hi.copy_to_slice(&mut data[offset + 8..offset + 16]);
            }
            let tail_start = simd_blocks * 8;
            for frame in data[tail_start * 2..].chunks_exact_mut(2) {
                let (l, r) = self.next_sample(sample_rate);
                frame[0] = l;
                frame[1] = r;
            }
        } else if channels == 1 {
            let total_frames = data.len();
            let simd_blocks = total_frames / 8;
            for i in 0..simd_blocks {
                let (left, right) = self.generate_samples_simd(sample_rate);
                let mono = (left + right) * f32x8::splat(0.5);
                let offset = i * 8;
                mono.copy_to_slice(&mut data[offset..offset + 8]);
            }
            let tail_start = simd_blocks * 8;
            for item in &mut data[tail_start..] {
                let (l, r) = self.next_sample(sample_rate);
                *item = (l + r) * 0.5;
            }
        } else {
            for frame in data.chunks_mut(channels) {
                let (l, r) = self.next_sample(sample_rate);
                if frame.len() >= 2 {
                    frame[0] = l;
                    frame[1] = r;
                    for item in frame.iter_mut().skip(2) {
                        *item = 0.0;
                    }
                } else if !frame.is_empty() {
                    frame[0] = (l + r) * 0.5;
                }
            }
        }
    }

    pub fn process_i16_frames(&mut self, data: &mut [i16], channels: usize, sample_rate: f32) {
        if channels == 2 {
            let total_frames = data.len() / 2;
            let simd_blocks = total_frames / 8;
            for i in 0..simd_blocks {
                let (left, right) = self.generate_samples_simd(sample_rate);
                let (lo, hi) = left.interleave(right);
                let offset = i * 16;
                let lo_clamped = lo.simd_clamp(f32x8::splat(-1.0), f32x8::splat(1.0))
                    * f32x8::splat(i16::MAX as f32);
                let hi_clamped = hi.simd_clamp(f32x8::splat(-1.0), f32x8::splat(1.0))
                    * f32x8::splat(i16::MAX as f32);
                let lo_i32 = lo_clamped.cast::<i32>();
                let hi_i32 = hi_clamped.cast::<i32>();
                let lo_arr = lo_i32.to_array();
                let hi_arr = hi_i32.to_array();
                for (j, &val) in lo_arr.iter().enumerate() {
                    data[offset + j] = val as i16;
                }
                for (j, &val) in hi_arr.iter().enumerate() {
                    data[offset + 8 + j] = val as i16;
                }
            }
            let tail_start = simd_blocks * 8;
            for frame in data[tail_start * 2..].chunks_exact_mut(2) {
                let (l, r) = self.next_sample(sample_rate);
                frame[0] = (l.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                frame[1] = (r.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            }
        } else {
            for frame in data.chunks_mut(channels) {
                let (left, right) = self.next_sample(sample_rate);
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
        }
    }

    pub fn process_u16_frames(&mut self, data: &mut [u16], channels: usize, sample_rate: f32) {
        for frame in data.chunks_mut(channels) {
            let (left, right) = self.next_sample(sample_rate);
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
    }
}

pub struct AudioEngineManager {
    _stream: Option<cpal::Stream>,
    pub state: Arc<Mutex<ToneAudioState>>,
}

impl Default for AudioEngineManager {
    fn default() -> Self {
        Self::new()
    }
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

        let sample_rate = config.sample_rate() as f32;
        let channels = config.channels() as usize;
        let sample_format = config.sample_format();

        {
            let mut state = self.state.lock().unwrap();
            state.freq = params.freq;
            let target_lin = 10.0f32.powf(params.volume_db / 20.0);
            state.volume_linear = 0.0001;
            state.target_volume_linear = target_lin;
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
                        state.process_f32_frames(data, channels, sample_rate);
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
                        state.process_i16_frames(data, channels, sample_rate);
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
                        state.process_u16_frames(data, channels, sample_rate);
                    },
                    err_fn,
                    None,
                )
            }
            _ => return Err("Unsupported audio sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("Failed to play audio: {}", e))?;
        self._stream = Some(stream);
        Ok(())
    }

    pub fn update(&self, params: ToneParams) {
        if let Ok(mut state) = self.state.lock() {
            state.freq = params.freq;
            state.target_volume_linear = 10.0f32.powf(params.volume_db / 20.0);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aligned_vec_allocation() {
        let mut v: AlignedVec<f32, 32> = AlignedVec::with_capacity(64);
        for i in 0..64 {
            v.push(i as f32);
        }
        assert!(v.is_aligned());
        assert_eq!(v.as_ptr() as usize % 32, 0);
        let (simd, rem) = v.as_simd_slices();
        assert_eq!(simd.len(), 8);
        assert_eq!(rem.len(), 0);
    }

    #[test]
    fn test_biquad_simd_matches_scalar() {
        let coeffs = calc_biquad_coeffs(FilterType::Peak, 1000.0, 6.0, 1.414, 48000.0);
        let simd_coeffs = SimdBiquadCoeffs::from(coeffs);

        let freqs = [
            100.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0, 15000.0, 20000.0,
        ];
        let freq_simd = f32x8::from_array(freqs);

        let simd_result = evaluate_biquad_db_simd(&simd_coeffs, freq_simd, 48000.0);
        let simd_array = simd_result.to_array();

        for i in 0..8 {
            let scalar_res = evaluate_biquad_db(&coeffs, freqs[i], 48000.0);
            assert!(
                (simd_array[i] - scalar_res).abs() < 1e-4,
                "Mismatch at {}: simd={}, scalar={}",
                freqs[i],
                simd_array[i],
                scalar_res
            );
        }
    }

    #[test]
    fn test_sin_pi_accuracy() {
        for i in 0..100 {
            let x = -1.0 + 2.0 * (i as f32 / 100.0);
            let approx = sin_pi(f32x8::splat(x))[0];
            let exact = (x * PI).sin();
            assert!((approx - exact).abs() < 5e-4);
        }
    }

    #[test]
    fn test_frequency_response_aligned() {
        let band = FilterBand {
            enabled: true,
            filter_type: FilterType::Peak,
            freq: 1000.0,
            gain: 6.0,
            q: 1.414,
        };
        let res = compute_frequency_response(&[band], 0.0, 400, 48000.0);
        assert!(res.freqs.is_aligned());
        assert!(res.total_curve.is_aligned());
        assert_eq!(res.filter_curves.len(), 1);
        assert!(res.filter_curves[0].is_aligned());
        assert_eq!(res.freqs.len(), 400);
        assert_eq!(res.total_curve.len(), 400);
        assert_eq!(res.filter_curves[0].len(), 400);
        assert!(res.max_boost_db > 5.5 && res.max_boost_db < 6.5);
    }
}
