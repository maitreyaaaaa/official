import { useRef, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, CheckCircle2, CircleDashed, Inbox, type LucideIcon } from 'lucide-react';

export type ReviewFilter = 'all' | 'review' | 'supported' | 'unchecked';

export type ReviewFilterTab = {
  value: ReviewFilter;
  label: string;
  count: number;
  icon: LucideIcon;
};

type AppleMailTabsProps = {
  tabs: ReviewFilterTab[];
  value: ReviewFilter;
  onValueChange: (value: ReviewFilter) => void;
};

const closedWidth = 44;
const spring = { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.8 };

/** A compact, status-aware filter inspired by Skecher UI's Apple Mail tabs. */
export function AppleMailTabs({ tabs, value, onValueChange }: AppleMailTabsProps) {
  const reduceMotion = useReducedMotion();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const forward = event.key === 'ArrowRight';
    const backward = event.key === 'ArrowLeft';
    if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (forward ? 1 : -1) + tabs.length) % tabs.length;
    buttonRefs.current[nextIndex]?.focus();
    onValueChange(tabs[nextIndex].value);
  }

  return (
    <div className="review-tabs-scroll">
      <div className="review-tabs" role="tablist" aria-label="Filter drafts by review status">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const active = tab.value === value;
          const activeWidth = 78 + tab.label.length * 5.2 + Math.max(0, String(tab.count).length - 1) * 5;
          return (
            <motion.button
              key={tab.value}
              id={`draft-filter-${tab.value}`}
              ref={(element) => { buttonRefs.current[index] = element; }}
              type="button"
              role="tab"
              aria-label={`${tab.label}, ${tab.count} ${tab.count === 1 ? 'draft' : 'drafts'}`}
              aria-controls="draft-list"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tab.label}
              className={`review-tab${active ? ' active' : ''}`}
              animate={{ width: active ? activeWidth : closedWidth }}
              transition={reduceMotion ? { duration: 0 } : spring}
              onClick={() => onValueChange(tab.value)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              {active && <motion.span className="review-tab-highlight" layoutId="review-tab-highlight" transition={reduceMotion ? { duration: 0 } : spring} />}
              <span className="review-tab-icon"><Icon aria-hidden="true" size={16} strokeWidth={1.8} /></span>
              <motion.span className="review-tab-label" animate={{ opacity: active ? 1 : 0, x: active ? 0 : 8 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }} aria-hidden={!active}>
                <span>{tab.label}</span><span className="review-tab-count">{tab.count}</span>
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export const reviewFilterIcons = {
  all: Inbox,
  review: AlertCircle,
  supported: CheckCircle2,
  unchecked: CircleDashed,
};
