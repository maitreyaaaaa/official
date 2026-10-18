import iconMarkup from '../iconsax-icons.json';

export type IconsaxName = keyof typeof iconMarkup;

/** Local 24px Iconsax Linear SVGs sourced from the Iconsax npm package. */
export function IconsaxIcon({ name, size = 18 }: { name: IconsaxName; size?: number }) {
  return <span
    className="iconsax-mark"
    aria-hidden="true"
    style={{ width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: iconMarkup[name] }}
  />;
}
