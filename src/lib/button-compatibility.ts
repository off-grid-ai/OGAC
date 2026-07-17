export type LegacyButtonSize =
  'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

export type SharedButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const sharedSizeByLegacySize: Record<LegacyButtonSize, SharedButtonSize> = {
  default: 'default',
  xs: 'sm',
  sm: 'sm',
  lg: 'lg',
  icon: 'icon',
  'icon-xs': 'icon',
  'icon-sm': 'icon',
  'icon-lg': 'icon',
};

// These classes preserve the Console's established density while the shared
// primitive remains the only owner of visuals, focus, disabled and loading behavior.
const compatibilityClassByLegacySize: Record<LegacyButtonSize, string> = {
  default: 'h-11 sm:h-9 sm:min-h-9',
  xs: "h-6 min-h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: 'h-8 min-h-8 gap-1.5 px-3',
  lg: 'h-10 min-h-10 px-6',
  icon: 'size-11 min-h-11 p-0 sm:size-9 sm:min-h-9',
  'icon-xs': "size-6 min-h-6 p-0 [&_svg:not([class*='size-'])]:size-3",
  'icon-sm': 'size-11 min-h-11 p-0 sm:size-8 sm:min-h-8',
  'icon-lg': 'size-11 min-h-11 p-0 sm:size-10 sm:min-h-10',
};

export function sharedButtonSize(size: LegacyButtonSize): SharedButtonSize {
  return sharedSizeByLegacySize[size];
}

export function legacyButtonSizeClass(size: LegacyButtonSize): string {
  return compatibilityClassByLegacySize[size];
}
