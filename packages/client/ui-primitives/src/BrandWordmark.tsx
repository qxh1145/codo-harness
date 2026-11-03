import { BRAND_NAME } from './brand.generated.ts'
import { FishLogo } from './FishLogo.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading logo mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the product name beside an optional logo mark.
 * @param props.size - line height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading logo mark.
 * @returns the wordmark (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', gap: size / 3, height: size, fontSize: size * 0.72, lineHeight: `${size}px`, whiteSpace: 'nowrap' }}
    >
      {includeMark && <FishLogo size={size} />}
      {BRAND_NAME}
    </span>
  )
}
