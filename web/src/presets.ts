export type WidthPreset = {
  name: string;
  width: number;
  label: string;
};

export type RatioPreset = {
  name: string;
  width: number;
  height: number;
  ratio: string;
  label: string;
};

/** Mirrors src/Shared/Presets.cs. Width presets preserve the original ratio. */
export const WIDTH_PRESETS: WidthPreset[] = [
  { name: 'sm', width: 320, label: 'Phones' },
  { name: 'md', width: 480, label: 'Large phones' },
  { name: 'lg', width: 768, label: 'Tablets' },
  { name: 'xl', width: 1024, label: 'Tablets, landscape' },
  { name: '2xl', width: 1280, label: 'Laptops' },
  { name: '3xl', width: 1600, label: 'Desktop' },
  { name: '4xl', width: 1920, label: 'Wide desktop' },
];

export const RATIO_PRESETS: RatioPreset[] = [
  { name: 'thumb', width: 160, height: 160, ratio: '1:1', label: 'Thumbnail' },
  { name: 'card', width: 480, height: 320, ratio: '3:2', label: 'Card' },
  { name: 'hero', width: 1920, height: 1080, ratio: '16:9', label: 'Hero' },
];

export function presetUrl(imageBase: string, publicId: string, name: string): string {
  return imageBase + '/i/' + publicId + '/' + name + '.webp';
}

export function buildSrcSet(imageBase: string, publicId: string): string {
  return WIDTH_PRESETS.map(
    (preset) => presetUrl(imageBase, publicId, preset.name) + ' ' + preset.width + 'w',
  ).join(', ');
}
