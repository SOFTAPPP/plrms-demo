import type { MachineType } from '../../../shared/types';
import { Truck, Shovel, Construction, Tractor, Drill, Droplets, Car, Forklift, type LucideIcon } from 'lucide-react';

export const TYPE_ICON: Record<MachineType, LucideIcon> = {
  truck: Truck, shovel: Shovel, excavator: Construction, loader: Forklift, dozer: Tractor, drill: Drill, water: Droplets, lv: Car,
};

/** Top-down machine silhouette for the map, pointing east, roughly 24 units long. */
export function MachineGlyph({ type, fill, stroke, swing = 0 }: { type: MachineType; fill: string; stroke: string; swing?: number }) {
  const sw = 1.4;
  switch (type) {
    case 'truck':
      return (
        <g>
          <path d="M-12,-7 H5 L7,-5 V5 L5,7 H-12 Z" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M-10,-4.5 H3 M-10,0 H3 M-10,4.5 H3" stroke={stroke} strokeOpacity="0.35" strokeWidth="0.9" />
          <rect x="7.5" y="-6" width="4.5" height="5.5" rx="1" fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      );
    case 'water':
      return (
        <g>
          <rect x="-12" y="-6.5" width="19" height="13" rx="6" fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x="7.5" y="-5.5" width="4.5" height="11" rx="1.2" fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      );
    case 'shovel':
    case 'excavator':
      return (
        <g>
          <rect x="-9" y="-9" width="18" height="4.5" rx="1.5" fill={stroke} opacity="0.65" />
          <rect x="-9" y="4.5" width="18" height="4.5" rx="1.5" fill={stroke} opacity="0.65" />
          <g transform={`rotate(${swing})`}>
            <circle r="7.5" fill={fill} stroke={stroke} strokeWidth={sw} />
            <path d={type === 'shovel' ? 'M5,0 L17,0' : 'M5,-1 L13,-1 L18,2'} stroke={stroke} strokeWidth="3.2" strokeLinecap="round" fill="none" />
            <rect x="16" y="-3.5" width="4" height="7" rx="1" fill={fill} stroke={stroke} strokeWidth="1" />
          </g>
        </g>
      );
    case 'loader':
      return (
        <g>
          <rect x="-11" y="-6" width="10" height="12" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x="0" y="-5.5" width="9" height="11" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x="10" y="-8" width="3" height="16" rx="1" fill={stroke} opacity="0.8" />
        </g>
      );
    case 'dozer':
      return (
        <g>
          <rect x="-10" y="-7" width="16" height="14" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M9,-10 Q11.5,0 9,10" stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'drill':
      return (
        <g>
          <rect x="-9" y="-8" width="16" height="16" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x="5" y="-2.5" width="9" height="5" rx="1" fill={stroke} opacity="0.75" />
          <circle cx="12" cy="0" r="2" fill={fill} stroke={stroke} strokeWidth="1" />
        </g>
      );
    case 'lv':
      return (
        <g>
          <rect x="-7" y="-4" width="14" height="8" rx="2.5" fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x="1" y="-3" width="3.5" height="6" rx="0.8" fill={stroke} opacity="0.45" />
        </g>
      );
  }
}
