import { useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export type DockItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
};

function DockLink({ item, pointer, reducedMotion }: { item: DockItem; pointer: ReturnType<typeof useMotionValue<number>>; reducedMotion: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [hovered, setHovered] = useState(false);
  const distance = useTransform(pointer, (x) => {
    const bounds = ref.current?.getBoundingClientRect();
    return bounds ? x - (bounds.left + bounds.width / 2) : 200;
  });
  const scale = useSpring(useTransform(distance, [-112, 0, 112], [1, 1.26, 1]), { stiffness: 330, damping: 24, mass: 0.55 });
  const lift = useSpring(useTransform(scale, (value) => (value - 1) * -5), { stiffness: 330, damping: 24, mass: 0.55 });
  const Icon = item.icon;

  return (
    <motion.a
      ref={ref}
      href={item.href}
      aria-label={item.label}
      aria-current={item.active ? 'location' : undefined}
      title={item.label}
      className={`dock-link${item.active ? ' active' : ''}`}
      style={reducedMotion ? undefined : { scale, y: lift }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      whileTap={reducedMotion ? undefined : { scale: 0.92 }}
    >
      <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
      <span className="dock-label">{item.label}</span>
      <span className={`dock-tooltip${hovered ? ' visible' : ''}`}>{item.label}</span>
      {item.active && <span className="dock-active-dot" aria-hidden="true" />}
    </motion.a>
  );
}

/** A small, palette-matched mobile dock inspired by Componentry's Magnetic Dock. */
export function MagneticDock({ items }: { items: DockItem[] }) {
  const pointer = useMotionValue(-1000);
  const reducedMotion = useReducedMotion();

  return (
    <motion.nav
      aria-label="Main navigation"
      className="magnetic-dock"
      onMouseMove={reducedMotion ? undefined : (event) => pointer.set(event.clientX)}
      onMouseLeave={() => pointer.set(-1000)}
      initial={false}
    >
      {items.map((item) => <DockLink key={item.id} item={item} pointer={pointer} reducedMotion={Boolean(reducedMotion)} />)}
    </motion.nav>
  );
}
