import type { MotionValue } from 'motion/react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import type { ReactNode, RefObject } from 'react';
import { useRef } from 'react';

export type ScrollRevealPhysics = {
  bounce?: number;
  damping?: number;
  mass?: number;
  stiffness?: number;
  visualDuration?: number;
};

export type ScrollRevealRange = {
  end?: number;
  start?: number;
};

export type ScrollRevealTextProps = {
  className?: string;
  lines: readonly string[];
  mutedColor?: string;
  physics?: ScrollRevealPhysics;
  revealColor?: string;
  revealRange?: ScrollRevealRange;
  scrollLength?: number;
  scrollHint?: ReactNode;
  scrollHintPosition?: 'bottom' | 'top';
  scrollContainerRef?: RefObject<HTMLElement | null>;
  showScrollHint?: boolean;
  stickyClassName?: string;
  textClassName?: string;
};

type RevealLineProps = {
  index: number;
  line: string;
  lineCount: number;
  mutedColor?: string;
  progress: MotionValue<number>;
  revealColor?: string;
  revealEnd: number;
  revealStart: number;
  shouldReduceMotion: boolean;
};

const defaultPhysics = { damping: 28, mass: 0.8, stiffness: 200 } as const;

function RevealLine({
  index,
  line,
  lineCount,
  mutedColor,
  progress,
  revealColor,
  revealEnd,
  revealStart,
  shouldReduceMotion,
}: RevealLineProps) {
  const revealRange = revealEnd - revealStart;
  const lineStart = revealStart + (index / lineCount) * revealRange;
  const lineEnd = revealStart + ((index + 1) / lineCount) * revealRange;
  const clipPath = useTransform(progress, [lineStart, lineEnd], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'], { clamp: true });

  return (
    <span className="scroll-reveal-line">
      <span className="scroll-reveal-muted" style={mutedColor ? { color: mutedColor } : undefined}>{line}</span>
      <motion.span
        aria-hidden="true"
        className="scroll-reveal-visible"
        style={{ clipPath: shouldReduceMotion ? 'inset(0 0% 0 0)' : clipPath, color: revealColor }}
      >
        {line}
      </motion.span>
    </span>
  );
}

/** Scroll-linked line reveal adapted from Skecher UI for official's custom CSS design system. */
export function ScrollRevealText({
  className,
  lines,
  mutedColor,
  physics = defaultPhysics,
  revealColor,
  revealRange,
  scrollLength,
  scrollHint = 'Scroll to reveal',
  scrollHintPosition = 'top',
  scrollContainerRef,
  showScrollHint = true,
  stickyClassName,
  textClassName,
}: ScrollRevealTextProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const resolvedLines = lines.map((line) => line.trim()).filter(Boolean);
  const safeLines = resolvedLines.length > 0 ? resolvedLines : ['Evidence first.', 'A person makes the call.'];
  const revealStart = Math.min(Math.max(revealRange?.start ?? 0.08, 0), 0.95);
  const revealEnd = Math.min(Math.max(revealRange?.end ?? 0.92, revealStart + 0.05), 1);

  const { scrollYProgress } = useScroll({
    container: scrollContainerRef,
    target: sectionRef,
    offset: ['start start', 'end end'],
  });
  const smoothProgress = useSpring(
    scrollYProgress,
    physics.visualDuration !== undefined
      ? { bounce: physics.bounce, visualDuration: physics.visualDuration }
      : {
          damping: physics.damping ?? defaultPhysics.damping,
          mass: physics.mass ?? defaultPhysics.mass,
          stiffness: physics.stiffness ?? defaultPhysics.stiffness,
        },
  );
  const scrollHintOpacity = useTransform(smoothProgress, [0, 0.12, 0.22], [1, 1, 0]);
  const scrollHintY = useTransform(smoothProgress, [0, 0.22], [0, -8]);

  return (
    <section
      ref={sectionRef}
      aria-label="Scroll-revealed launch assurance statement"
      className={`scroll-reveal ${className ?? ''}`.trim()}
      style={scrollLength ? { minHeight: `${Math.max(scrollLength, 100)}svh` } : undefined}
    >
      <div className={`scroll-reveal-stage ${stickyClassName ?? ''}`.trim()}>
        <h2 className={`scroll-reveal-text ${textClassName ?? ''}`.trim()}>
          {safeLines.map((line, index) => (
            <RevealLine
              key={`${index}-${line}`}
              index={index}
              line={line}
              lineCount={safeLines.length}
              mutedColor={mutedColor}
              progress={shouldReduceMotion ? scrollYProgress : smoothProgress}
              revealColor={revealColor}
              revealEnd={revealEnd}
              revealStart={revealStart}
              shouldReduceMotion={shouldReduceMotion}
            />
          ))}
        </h2>

        {showScrollHint && !shouldReduceMotion ? (
          <div className={`scroll-reveal-hint scroll-reveal-hint-${scrollHintPosition}`}>
            <motion.span aria-hidden="true" style={{ opacity: scrollHintOpacity, y: scrollHintY }}>{scrollHint}</motion.span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
