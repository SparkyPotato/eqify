import React from 'react';
import type { FilterType } from '../types/eq';

interface FilterIconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Peak / Peaking Bell Curve Icon
 */
export const PeakFilterIcon: React.FC<FilterIconProps> = ({
  size = 16,
  className = '',
  strokeWidth = 2,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Subtle 0dB reference guideline */}
    <line x1="2" y1="17" x2="22" y2="17" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 2" />
    {/* Smooth resonant peak / bell curve */}
    <path d="M 3 17 H 6 C 9 17, 9.5 5, 12 5 C 14.5 5, 15 17, 18 17 H 21" />
  </svg>
);

/**
 * Low Shelf Filter Icon
 */
export const LowShelfFilterIcon: React.FC<FilterIconProps> = ({
  size = 16,
  className = '',
  strokeWidth = 2,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Subtle 0dB reference guideline */}
    <line x1="2" y1="17" x2="22" y2="17" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 2" />
    {/* Low shelf curve: boosted on left, sloping down to 0dB baseline on right */}
    <path d="M 3 7 H 7 C 10 7, 11 17, 15 17 H 21" />
  </svg>
);

/**
 * High Shelf Filter Icon
 */
export const HighShelfFilterIcon: React.FC<FilterIconProps> = ({
  size = 16,
  className = '',
  strokeWidth = 2,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Subtle 0dB reference guideline */}
    <line x1="2" y1="17" x2="22" y2="17" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 2" />
    {/* High shelf curve: flat on left at 0dB, sloping up to shelf on right */}
    <path d="M 3 17 H 9 C 13 17, 14 7, 17 7 H 21" />
  </svg>
);

/**
 * Unified Filter Icon that selects the appropriate icon based on FilterType
 */
export const FilterTypeIcon: React.FC<{
  type: FilterType | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}> = ({ type, size = 16, className = '', strokeWidth = 2 }) => {
  switch (type.toUpperCase()) {
    case 'PK':
    case 'PEAK':
      return <PeakFilterIcon size={size} className={className} strokeWidth={strokeWidth} />;
    case 'LSC':
    case 'LS':
    case 'LOWSHELF':
      return <LowShelfFilterIcon size={size} className={className} strokeWidth={strokeWidth} />;
    case 'HSC':
    case 'HS':
    case 'HIGHSHELF':
      return <HighShelfFilterIcon size={size} className={className} strokeWidth={strokeWidth} />;
    default:
      return <PeakFilterIcon size={size} className={className} strokeWidth={strokeWidth} />;
  }
};
