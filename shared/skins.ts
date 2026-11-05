export type FaceStyle = 'round' | 'sleepy' | 'cyclops' | 'visor' | 'fangs' | 'stars';
export type MoonStyle = 'crater' | 'ringed' | 'gem' | 'eyeball' | 'ember' | 'ice';

export interface Skin {
  id: number;
  name: string;
  /** Body fill */
  body: string;
  /** Outline / shadow tone */
  dark: string;
  /** Highlight tone */
  light: string;
  /** Moon fill */
  moon: string;
  /** Moon detail tone */
  moonDark: string;
  face: FaceStyle;
  moonStyle: MoonStyle;
  unlock: { kind: 'free' } | { kind: 'level'; level: number } | { kind: 'coins'; price: number };
  /** Hue-cycling body. */
  animated?: boolean;
}

/**
 * Hand-tuned palette. Every skin is built from a body/outline/highlight triad so the
 * art reads as one family (sticker style: flat fills, thick ink outline).
 */
export const SKINS: readonly Skin[] = [
  { id: 0, name: 'Mochi', body: '#FF8FB1', dark: '#B4436C', light: '#FFD3E1', moon: '#FFE9A8', moonDark: '#D9A94A', face: 'round', moonStyle: 'crater', unlock: { kind: 'free' } },
  { id: 1, name: 'Tangerine', body: '#FF9F43', dark: '#B85C10', light: '#FFD29E', moon: '#FFF1D6', moonDark: '#CFA87A', face: 'round', moonStyle: 'crater', unlock: { kind: 'free' } },
  { id: 2, name: 'Mint', body: '#5EE6B0', dark: '#1F8A68', light: '#C2FBE3', moon: '#F2FFF9', moonDark: '#86BFA8', face: 'sleepy', moonStyle: 'crater', unlock: { kind: 'free' } },
  { id: 3, name: 'Blueberry', body: '#6C8CFF', dark: '#2E3FA8', light: '#C4D1FF', moon: '#E4E9FF', moonDark: '#8E9AD6', face: 'round', moonStyle: 'ringed', unlock: { kind: 'level', level: 2 } },
  { id: 4, name: 'Lemon', body: '#FFE066', dark: '#B39200', light: '#FFF6C4', moon: '#FFFFFF', moonDark: '#C9C2A0', face: 'stars', moonStyle: 'crater', unlock: { kind: 'level', level: 3 } },
  { id: 5, name: 'Grape Soda', body: '#B57BFF', dark: '#5B2BA6', light: '#E6D2FF', moon: '#7CF5E9', moonDark: '#2C9C91', face: 'cyclops', moonStyle: 'gem', unlock: { kind: 'level', level: 5 } },
  { id: 6, name: 'Ember', body: '#FF5A4E', dark: '#8F1B14', light: '#FFB3A6', moon: '#FFC94A', moonDark: '#C2560E', face: 'fangs', moonStyle: 'ember', unlock: { kind: 'coins', price: 300 } },
  { id: 7, name: 'Glacier', body: '#9BE7FF', dark: '#2A84A6', light: '#E6FAFF', moon: '#FFFFFF', moonDark: '#9BC8DA', face: 'sleepy', moonStyle: 'ice', unlock: { kind: 'coins', price: 300 } },
  { id: 8, name: 'Toxic', body: '#B8F23A', dark: '#4E7A00', light: '#E7FFB0', moon: '#2B2140', moonDark: '#B8F23A', face: 'visor', moonStyle: 'eyeball', unlock: { kind: 'level', level: 8 } },
  { id: 9, name: 'Abyss', body: '#2B2140', dark: '#0B0714', light: '#5A4A7A', moon: '#62F2FF', moonDark: '#1A8FA0', face: 'visor', moonStyle: 'gem', unlock: { kind: 'coins', price: 800 } },
  { id: 10, name: 'Bubblegum', body: '#FF7AE0', dark: '#9E1F86', light: '#FFD0F5', moon: '#7AD3FF', moonDark: '#2C83B0', face: 'stars', moonStyle: 'ringed', unlock: { kind: 'level', level: 12 } },
  { id: 11, name: 'Royal', body: '#4C3BCF', dark: '#20146E', light: '#9D93F5', moon: '#FFD65A', moonDark: '#B8860B', face: 'round', moonStyle: 'ringed', unlock: { kind: 'coins', price: 1500 } },
  { id: 12, name: 'Bone', body: '#F4EDE1', dark: '#8A7F6E', light: '#FFFFFF', moon: '#F4EDE1', moonDark: '#8A7F6E', face: 'cyclops', moonStyle: 'eyeball', unlock: { kind: 'level', level: 16 } },
  { id: 13, name: 'Sunflare', body: '#FFC93C', dark: '#A35F00', light: '#FFF0B8', moon: '#FF6B3D', moonDark: '#A3290A', face: 'fangs', moonStyle: 'ember', unlock: { kind: 'coins', price: 2500 } },
  { id: 14, name: 'Void Kitten', body: '#141018', dark: '#000000', light: '#3D3350', moon: '#FF4D8D', moonDark: '#8E1446', face: 'sleepy', moonStyle: 'gem', unlock: { kind: 'level', level: 22 } },
  { id: 15, name: 'Prism', body: '#FF6B9D', dark: '#3A1F5C', light: '#FFFFFF', moon: '#FFFFFF', moonDark: '#7A6A9C', face: 'stars', moonStyle: 'gem', unlock: { kind: 'level', level: 30 }, animated: true },
];

export const BOT_SKIN_POOL: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function skinById(id: number): Skin {
  return SKINS[id] ?? SKINS[0];
}

export function isValidSkin(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < SKINS.length;
}
