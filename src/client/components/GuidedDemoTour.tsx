import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ACTIONS, EVENTS, Joyride, ORIGIN, STATUS, type Step, type TooltipRenderProps } from 'react-joyride';
import './guided-demo-tour.css';

const seenStorageKey = 'official-guided-demo-tour-seen-v1';

function hasSeenTour(): boolean {
  try { return window.sessionStorage.getItem(seenStorageKey) === 'true'; }
  catch { return false; }
}

function markTourSeen(): void {
  try { window.sessionStorage.setItem(seenStorageKey, 'true'); }
  catch { /* The tour still works when browser storage is unavailable. */ }
}

function TourTooltip({ index, size, isLastStep, step, backProps, closeProps, primaryProps, skipProps, tooltipProps }: TooltipRenderProps) {
  return <section className="guided-tour-card" {...tooltipProps}>
    <div className="guided-tour-topline">
      <span className="guided-tour-step">WORKSPACE TOUR <span aria-hidden="true">·</span> {index + 1} OF {size}</span>
      <button className="guided-tour-close" type="button" {...closeProps}>×</button>
    </div>
    <div className="guided-tour-message">
      <img key={index} className="guided-tour-mascot" src="/brand/official-mascot.png" alt="" aria-hidden="true" />
      <div className="guided-tour-copy">
        {step.title && <h2>{step.title}</h2>}
        <div className="guided-tour-body">{step.content}</div>
      </div>
    </div>
    <div className="guided-tour-progress" aria-hidden="true"><span style={{ width: `${((index + 1) / size) * 100}%` }} /></div>
    <div className="guided-tour-actions">
      {index > 0 ? <button className="guided-tour-back" type="button" {...backProps}>Back</button> : <span />}
      <button className="guided-tour-skip" type="button" {...skipProps}>Skip tour</button>
      <button className="guided-tour-next" type="button" {...primaryProps}>{isLastStep ? 'Finish' : 'Next'} <span aria-hidden="true">→</span></button>
    </div>
  </section>;
}

type GuidedDemoTourProps = {
  requestId: number;
  suppressWelcome?: boolean;
  onStart: () => void;
  onPrepareStep: (hash: string, showSidebar: boolean) => Promise<void>;
  onFinish: () => void;
};

export function GuidedDemoTour({ requestId, suppressWelcome = false, onStart, onPrepareStep, onFinish }: GuidedDemoTourProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasFinishedRef = useRef(false);
  const lastRequestRef = useRef(0);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !suppressWelcome && !hasSeenTour());
  const [running, setRunning] = useState(false);
  const [tourSession, setTourSession] = useState(0);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 680px)').matches);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const layoutQuery = window.matchMedia('(max-width: 680px)');
    const updateLayout = () => setCompactLayout(layoutQuery.matches);
    layoutQuery.addEventListener('change', updateLayout);
    return () => layoutQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (welcomeOpen && !dialog.open) dialog.showModal();
    if (!welcomeOpen && dialog.open) dialog.close();
  }, [welcomeOpen]);

  const startTour = useCallback(() => {
    markTourSeen();
    hasFinishedRef.current = false;
    setWelcomeOpen(false);
    onStart();
    setTourSession((session) => session + 1);
    setRunning(true);
  }, [onStart]);

  useEffect(() => {
    if (requestId > 0 && requestId !== lastRequestRef.current) {
      lastRequestRef.current = requestId;
      startTour();
    }
  }, [requestId, startTour]);

  const steps = useMemo<Step[]>(() => {
    const showSidebar = (hash: string) => hash === '#overview' ? !compactLayout : window.innerWidth > 920;
    const before = (hash: string) => () => onPrepareStep(hash, showSidebar(hash));
    return [
      {
        id: 'workspace-navigation',
        target: () => document.querySelector<HTMLElement>(compactLayout ? '.app-dock' : '[data-tour="workspace-navigation"]'),
        placement: compactLayout ? 'auto' : 'right',
        title: 'Your workspace, at a glance',
        content: compactLayout
          ? 'Use the bottom dock to move between Overview, Launch review, Writing brief, Company records, and Plugins. The company switcher keeps each fictional workspace separate.'
          : 'Use this sidebar to move between Overview, Launch review, Writing brief, Company records, and Plugins. The company switcher keeps each fictional workspace separate.',
        before: before('#overview'),
      },
      {
        id: 'launch-review', target: '[data-tour="launch-review"]', placement: compactLayout ? 'auto' : 'bottom',
        title: 'Start with the launch check',
        content: 'This summary shows how many draft claims are supported, conflict with current evidence, need evidence, or have not been checked.',
        before: before('#campaign'),
      },
      {
        id: 'evidence-trail', target: '[data-tour="evidence-trail"] .detail-card-heading', placement: compactLayout ? 'auto' : 'left',
        title: 'Follow the evidence',
        content: 'Choose a draft to see its linked promise and source records here. The trail helps explain why a claim received its current status.',
        before: before('#campaign'),
      },
      {
        id: 'approval-queue', target: '[data-tour="approval-queue"] .section-heading', placement: compactLayout ? 'auto' : 'left',
        title: 'Keep people in control',
        content: 'Internal proposals wait in this queue. Creating a proposal does not change the draft; a person must approve it before the change is applied.',
        before: before('#approvals'),
      },
      {
        id: 'writing-handoff', target: '[data-tour="writing-handoff"]', placement: compactLayout ? 'auto' : 'bottom',
        title: 'Carry approved context forward',
        content: 'Writing brief gives the next writer the current approved guidance and shows what changed since the earlier handoff.',
        before: before('#memory'),
      },
      {
        id: 'company-records', target: '[data-tour="company-records"]', placement: compactLayout ? 'auto' : 'bottom',
        title: 'Explore company records',
        content: 'Start with reviewed notes. Open the graph when you want to explore how notes and decisions connect, or check Coverage to see who can carry the review.',
        before: before('#brain-notes'),
      },
      {
        id: 'plugins', target: '[data-tour="plugins"] h1', placement: compactLayout ? 'auto' : 'bottom',
        title: 'Preview possible connections',
        content: 'The plugin catalog shows where future integrations could fit. In this demo, connecting a plugin only saves a local selection; it does not sign in or import provider data.',
        before: before('#plugins'),
      },
    ];
  }, [compactLayout, onPrepareStep]);

  const handleTourEvent = useCallback((data: Parameters<NonNullable<React.ComponentProps<typeof Joyride>['onEvent']>>[0], controls: Parameters<NonNullable<React.ComponentProps<typeof Joyride>['onEvent']>>[1]) => {
    if (data.type === EVENTS.STEP_AFTER && data.action === ACTIONS.CLOSE && data.origin === ORIGIN.KEYBOARD) {
      controls.skip();
    }
    if (data.type === EVENTS.TARGET_NOT_FOUND) {
      controls.skip();
    }
    if (!hasFinishedRef.current && (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED)) {
      hasFinishedRef.current = true;
      setRunning(false);
      onFinish();
    }
  }, [onFinish]);

  const dismissWelcome = () => {
    markTourSeen();
    setWelcomeOpen(false);
  };

  return <>
    <dialog
      className="guided-tour-welcome"
      ref={dialogRef}
      aria-labelledby="guided-tour-welcome-title"
      aria-describedby="guided-tour-welcome-description"
      onCancel={(event) => { event.preventDefault(); dismissWelcome(); }}
      onClose={() => setWelcomeOpen(false)}
    >
      <button className="guided-tour-welcome-close" type="button" aria-label="Close tour introduction" onClick={dismissWelcome}>×</button>
      <div className="guided-tour-welcome-mark"><img src="/brand/official-mascot.png" alt="" aria-hidden="true" /></div>
      <span className="guided-tour-eyebrow">A QUICK LOOK AROUND</span>
      <h1 id="guided-tour-welcome-title">Take a tour of this workspace?</h1>
      <p id="guided-tour-welcome-description">I’ll point out how launch reviews, evidence, approvals, the writing brief, company records, and demo connections fit together. This tour only navigates the fictional workspace.</p>
      <div className="guided-tour-welcome-actions">
        <button className="guided-tour-later" type="button" onClick={dismissWelcome}>Maybe later</button>
        <button className="guided-tour-start" type="button" onClick={startTour}>Start the tour <span aria-hidden="true">→</span></button>
      </div>
    </dialog>
    <Joyride
      key={tourSession}
      run={running}
      steps={steps}
      continuous
      scrollToFirstStep
      onEvent={handleTourEvent}
      tooltipComponent={TourTooltip}
      floatingOptions={{ strategy: 'fixed', shiftOptions: { padding: 12 } }}
      options={{
        buttons: ['back', 'skip', 'close', 'primary'],
        blockTargetInteraction: true,
        closeButtonAction: 'skip',
        dismissKeyAction: 'close',
        overlayClickAction: false,
        overlayColor: 'rgba(15, 27, 24, 0.72)',
        primaryColor: '#2f755f',
        scrollDuration: reduceMotion ? 0 : 300,
        skipBeacon: true,
        spotlightPadding: 8,
        spotlightRadius: 14,
        targetWaitTimeout: 7000,
        textColor: '#20342e',
        zIndex: 1200,
      }}
      styles={{ spotlight: { filter: 'drop-shadow(0 0 7px rgba(194, 164, 99, 0.88))' } }}
    />
  </>;
}
