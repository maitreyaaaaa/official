import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import './marketing-site.css';
import type { MarketingPage } from './routes.js';
import { ScrollRevealText } from './ScrollRevealText.js';

const pageDetails: Record<MarketingPage, { title: string; description: string }> = {
  home: {
    title: 'official: Know what your launch can safely say',
    description: 'Check a campaign promise against reviewed product, rollout, test, and audience records. Follow each finding to its source.',
  },
  review: {
    title: 'Campaign review | official',
    description: 'See how official compares a campaign promise with reviewed product and rollout records.',
  },
  method: {
    title: 'How it works | official',
    description: 'Follow a campaign promise to its product, rollout, and test records.',
  },
  guardrails: {
    title: 'Human control | official',
    description: 'See what official checks, what it leaves to a reviewer, and what the demo cannot change.',
  },
  notFound: {
    title: 'Page not found | official',
    description: 'This page is not available. Return to official or open the review workspace.',
  },
};

const navigationItems: Array<{ label: string; page: MarketingPage; href: string }> = [
  { label: 'What it does', page: 'review', href: '/review' },
  { label: 'How it works', page: 'method', href: '/method' },
  { label: 'Human control', page: 'guardrails', href: '/guardrails' },
];

function Brand() {
  return <a className="marketing-brand" href="/" aria-label="official home"><span aria-hidden="true" />official</a>;
}

function Navigation({ page, open, onClose }: { page: MarketingPage; open: boolean; onClose: () => void }) {
  return (
    <>
      <nav id="marketing-menu" className={`marketing-links${open ? ' is-open' : ''}`} aria-label="Main navigation">
        {navigationItems.map((item) => (
          <a key={item.page} href={item.href} aria-current={page === item.page ? 'page' : undefined} onClick={onClose}>
            {item.label}
          </a>
        ))}
        <a className="mobile-demo-link" href="/app" onClick={onClose}>Open review workspace <span aria-hidden="true">↗</span></a>
      </nav>
      <a className="nav-demo" href="/app">Open review workspace <span aria-hidden="true">↗</span></a>
    </>
  );
}

function SiteHeader({ page }: { page: MarketingPage }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="marketing-header">
      <div className="marketing-nav-wrap">
        <Brand />
        <Navigation page={page} open={open} onClose={() => setOpen(false)} />
        <button className="menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="marketing-menu" onClick={() => setOpen(!open)}>
          <span /><span />
        </button>
      </div>
    </header>
  );
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.62, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function HeroArtwork() {
  const reduceMotion = useReducedMotion();
  const artworkRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: artworkRef,
    offset: ['start end', 'end start'],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], [34, -34]);
  return (
    <motion.div
      ref={artworkRef}
      className="mascot-display"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.96, rotateY: -7 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1, rotateY: 0 }}
      style={reduceMotion ? undefined : { y: parallaxY }}
      transition={{ duration: 0.85, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.img
        className="evidence-mascot"
        src="/brand/official-mascot.png"
        alt="Official's purple mascot waving"
        animate={reduceMotion ? undefined : { y: [0, -9, 0], rotateZ: [0, 1.2, 0] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

const workflow = [
  { number: '01', title: 'Choose the promise', text: 'Start with a campaign sentence and name the audience it addresses.' },
  { number: '02', title: 'Follow its evidence', text: 'Read the reviewed product, rollout, and test records linked to that promise. FalkorDB keeps those records connected.' },
  { number: '03', title: 'Review the finding', text: 'See the source behind the result. If a change is needed, a reviewer can prepare an internal proposal.' },
];

const workspaceAreas = [
  { number: '01', title: 'Campaign review', text: 'Check a launch promise against the current release, rollout, test, and intended audience.' },
  { number: '02', title: 'Agent memory', text: 'Carry approved instructions and reviewer feedback into the next writing session.' },
  { number: '03', title: 'Company Brain', text: 'Keep people, operating guides, decisions, and source notes together for a clearer handover.' },
];

const reviewStates = [
  { name: 'Supported', color: 'supported', text: 'Reviewed evidence matches the promise for this audience.' },
  { name: 'Contradicted', color: 'contradicted', text: 'A current source conflicts with the promise.' },
  { name: 'Unknown', color: 'unknown', text: 'Sources are missing, stale, or disagree.' },
  { name: 'Not checked', color: 'not-checked', text: 'No connected promise was found for this draft.' },
];

function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero content-width">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> TRACK 1 <i>·</i> LAUNCH ASSURANCE</p>
          <h1>Know what your launch can <em>safely say.</em></h1>
          <p className="hero-intro">Check a campaign promise against reviewed product, rollout, test, and audience records. official shows the source behind each finding so a reviewer can decide what to change.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="/app">Open review workspace <span aria-hidden="true">↗</span></a>
            <a className="text-link" href="#how-it-works">See the review steps <span aria-hidden="true">↓</span></a>
          </div>
          <p className="hero-note"><span aria-hidden="true">✳</span> Working demo · Fictional Alder &amp; Finch records · No external campaign actions</p>
        </div>
        <HeroArtwork />
      </section>

      <section className="intro-strip">
        <ScrollRevealText
          className="launch-statement-reveal"
          lines={[
            'A feature can work in production,',
            'while its rollout still excludes',
            'the people your campaign',
            'promises.',
          ]}
          scrollLength={172}
          scrollHint="THE PROBLEM · SCROLL TO REVEAL"
          revealColor="#111026"
          mutedColor="#4b498f"
        />
      </section>

      <section className="workflow-section content-width" id="how-it-works">
        <Reveal className="section-heading">
          <p className="eyebrow">HOW OFFICIAL WORKS</p>
          <h2>From a sentence<br />to its <em>source.</em></h2>
          <p>Each check covers one promise and the audience it names.</p>
        </Reveal>
        <div className="workflow-grid">
          {workflow.map((step, index) => (
            <Reveal className="workflow-card" delay={index * 0.08} key={step.number}>
              <span className="card-index">{step.number}<i> / 03</i></span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="example-section">
        <div className="content-width example-layout">
          <Reveal className="example-copy">
            <p className="eyebrow">FICTIONAL CAMPAIGN · ALDER &amp; FINCH</p>
            <h2>“Every account”<br />meets <em>testers only.</em></h2>
            <p>Alder &amp; Finch promises CSV export to every account. The reviewed rollout covers internal testers only. official links both records and marks the audience mismatch as Contradicted.</p>
            <a className="light-link" href="/review">Read the example <span aria-hidden="true">↗</span></a>
          </Reveal>
          <Reveal className="evidence-chain" delay={0.12}>
            <div className="chain-heading"><span>CONNECTED EVIDENCE</span><span>SPRING REPORTING RELEASE</span></div>
            <div className="chain-flow">
              <div className="chain-node"><span>CAMPAIGN</span><strong>“Every account”</strong><small>Landing page</small></div>
              <span className="chain-connector" aria-hidden="true">→</span>
              <div className="chain-node"><span>PRODUCT</span><strong>CSV export</strong><small>Production · R17</small></div>
              <span className="chain-connector" aria-hidden="true">→</span>
              <div className="chain-node chain-node-conflict"><span>ROLLOUT</span><strong>Testers only</strong><small>Reviewed setting</small></div>
            </div>
            <div className="chain-result"><span className="result-dot" /><span><strong>CONTRADICTED</strong><small>The audience in the claim is wider than the rollout.</small></span></div>
            <p className="chain-disclosure">The page is illustrative. The working app reads the connected demo graph.</p>
          </Reveal>
        </div>
      </section>

      <section className="workspace-section content-width">
        <Reveal className="section-heading section-heading-wide">
          <p className="eyebrow">ONE CONNECTED WORKSPACE</p>
          <h2>Give each team<br />the same release <em>context.</em></h2>
          <p>Campaign review, agent memory, and Company Brain use the same fictional Alder &amp; Finch release.</p>
        </Reveal>
        <div className="workspace-grid">
          {workspaceAreas.map((area, index) => (
            <Reveal className="workspace-card" delay={index * 0.07} key={area.number}>
              <span className="card-index">{area.number}</span>
              <h3>{area.title}</h3>
              <p>{area.text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="status-section content-width">
        <Reveal className="status-intro">
          <p className="eyebrow">CLEAR RESULTS</p>
          <h2>See what the sources<br /><em>can support.</em></h2>
          <p>Missing, stale, or conflicting evidence stays visible. A claim cannot be marked Supported without reviewed evidence.</p>
        </Reveal>
        <div className="status-list">
          {reviewStates.map((state) => (
            <div className="status-row" key={state.name}>
              <span className={`status-symbol status-symbol-${state.color}`} aria-hidden="true" />
              <strong>{state.name}</strong>
              <p>{state.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="content-width control-layout">
          <Reveal className="control-copy">
            <p className="eyebrow">A PERSON MAKES THE CALL</p>
            <h2>official shows the evidence.<br /><em>Your reviewer decides.</em></h2>
          </Reveal>
          <Reveal className="control-points" delay={0.1}>
            <p><span>01</span> No reviewed source means no Supported result.</p>
            <p><span>02</span> Every finding names one promise and its audience.</p>
            <p><span>03</span> A reviewer must approve each proposed change.</p>
            <p className="control-boundary">The demo does not publish campaigns or change live product settings.</p>
          </Reveal>
        </div>
      </section>

      <section className="closing-cta content-width">
        <div><p className="eyebrow">ALDER &amp; FINCH · FICTIONAL RELEASE</p><h2>Follow a claim<br />to its <em>source.</em></h2><p>Open the campaign, inspect the linked records, and see where a reviewer must approve a change.</p></div>
        <a className="button button-dark" href="/app">Open review workspace <span aria-hidden="true">↗</span></a>
      </section>
    </main>
  );
}

function ReviewPage() {
  return (
    <main className="inner-page content-width">
      <div className="page-lead"><p className="eyebrow">WHAT OFFICIAL DOES</p><h1>Check the promise<br />against <em>the release.</em></h1><p>official compares campaign copy with reviewed product and rollout records, then shows why a promise is Supported, Contradicted, or still Unknown.</p></div>
      <section className="review-layout" aria-label="Example launch claim review">
        <article className="claim-sheet"><div className="sheet-top"><span>ALDER &amp; FINCH / SPRING REPORTING RELEASE</span><span>LANDING PAGE</span></div><p className="claim-label">THE CLAIM</p><blockquote>“CSV export is available to every account.”</blockquote><div className="claim-footer"><span>Named audience<strong>All customer accounts</strong></span><span>Feature<strong>CSV export</strong></span></div></article>
        <article className="finding-card"><div className="finding-top"><span className="status status-contradicted"><i /> CONTRADICTED</span><span className="review-id">REVIEW / AF-2026-04</span></div><h2>The rollout doesn’t reach<br />the promised audience.</h2><div className="fact-row"><span className="fact-index">01</span><div><small>PRODUCTION · REVISION R17</small><strong>CSV export is included</strong></div><span className="fact-ok">REVIEWED</span></div><div className="fact-row"><span className="fact-index">02</span><div><small>CURRENT ROLLOUT</small><strong>Internal testers only</strong></div><span className="fact-ok">REVIEWED</span></div><div className="finding-reason"><span>WHY IT CONFLICTS</span><p>The product runs. Access is limited to internal testers, not every customer.</p></div></article>
      </section>
      <section className="action-strip"><div><span className="eyebrow">A REVIEWER CONTROLS THE NEXT STEP</span><h2>Pause or revise the internal draft?</h2><p>The proposal stays pending until a reviewer approves or rejects it.</p></div><a className="button button-dark" href="/app">Open this review <span aria-hidden="true">↗</span></a></section>
      <p className="page-footnote">Alder &amp; Finch is fictional. The app runs the review against a connected demo graph.</p>
    </main>
  );
}

function MethodPage() {
  return (
    <main className="inner-page content-width method-page">
      <div className="page-lead"><p className="eyebrow">HOW IT WORKS</p><h1>Follow a claim<br />to the <em>facts.</em></h1><p>official links one campaign sentence to product, rollout, and test records, then reports what those records support.</p></div>
      <section className="method-board" aria-label="Connected evidence chain"><div className="method-board-head"><span>FROM CAMPAIGN COPY TO EVIDENCE</span><span>FICTIONAL SPRING RELEASE</span></div><div className="trace-chain"><div className="trace-item"><span className="trace-index">01</span><small>CAMPAIGN</small><strong>Landing page</strong><span className="trace-detail">“Every account”</span></div><span className="trace-arrow">→</span><div className="trace-item"><span className="trace-index">02</span><small>PRODUCT</small><strong>CSV export</strong><span className="trace-detail">Production · R17</span></div><span className="trace-arrow">→</span><div className="trace-item"><span className="trace-index">03</span><small>ROLLOUT</small><strong>Testers only</strong><span className="trace-detail">Reviewed setting</span></div><span className="trace-arrow">→</span><div className="trace-item trace-emphasis"><span className="trace-index">04</span><small>FINDING</small><strong>Contradicted</strong><span className="trace-detail">Audience mismatch</span></div></div></section>
      <section className="steps-grid">{workflow.map((step) => <article key={step.number}><span>{step.number} <i>·</i> STEP</span><h2>{step.title}</h2><p>{step.text}</p></article>)}</section>
      <section className="closing-cta"><div><p className="eyebrow">TRY THE WORKING DEMO</p><h2>Inspect the full<br /><em>evidence path.</em></h2><p>Open a campaign finding and follow its linked sources in the review workspace.</p></div><a className="button button-dark" href="/app">Open review workspace <span aria-hidden="true">↗</span></a></section>
    </main>
  );
}

const questions = [
  { question: 'Does Supported approve a whole campaign?', answer: 'No. It describes only the promise and audience that were checked. A person reviews the campaign and decides what to do.' },
  { question: 'Can official publish campaign copy?', answer: 'No. official can prepare a change to an internal draft. A reviewer must approve the proposal. The demo has no publishing action.' },
  { question: 'What happens when evidence is missing or conflicts?', answer: 'The finding stays Unknown until a person resolves the gap. Unreviewed or stale information cannot become proof.' },
];

function GuardrailsPage() {
  return (
    <main className="inner-page content-width guardrails-page">
      <div className="page-lead"><p className="eyebrow">HUMAN CONTROL</p><h1>A reviewer<br /><em>stays in control.</em></h1><p>official shows where evidence comes from and what it supports. It does not publish campaigns or change live product settings.</p></div>
      <section className="principles" aria-label="Product guardrails"><article><span>01</span><h2>Reviewed sources<br /><em>support each result.</em></h2><p>A finding needs reviewed evidence to be Supported.</p></article><article><span>02</span><h2>Each result<br /><em>covers one promise.</em></h2><p>A result describes its named audience, not a whole campaign.</p></article><article><span>03</span><h2>A reviewer<br /><em>approves each change.</em></h2><p>A proposal stays pending until a person acts.</p></article></section>
      <section className="faq-section"><div className="faq-heading"><p className="eyebrow">PLAIN ANSWERS</p><h2>What happens<br />after a <em>finding?</em></h2></div><div className="faq-list">{questions.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></section>
      <section className="closing-cta"><div><p className="eyebrow">TRACK 1 · FICTIONAL RELEASE</p><h2>See the review<br />for <em>yourself.</em></h2><p>Follow one claim from campaign copy to reviewed evidence.</p></div><a className="button button-dark" href="/app">Open review workspace <span aria-hidden="true">↗</span></a></section>
    </main>
  );
}

function SiteFooter() {
  return <footer className="marketing-footer"><div className="content-width footer-inner"><Brand /><span>Fictional Alder &amp; Finch release</span><a href="/app">Open review workspace <span aria-hidden="true">↗</span></a></div></footer>;
}

function NotFoundPage() {
  return <main className="not-found-page content-width" aria-labelledby="not-found-title"><p className="eyebrow">OFF THE MAP · 404</p><h1 id="not-found-title">This page isn’t<br /><em>in the graph.</em></h1><p>The address may have changed, or this page may not be part of official.</p><div className="hero-actions"><a className="button button-dark" href="/">Back to official <span aria-hidden="true">↗</span></a><a className="text-link" href="/app">Open review workspace <span aria-hidden="true">→</span></a></div></main>;
}

export function MarketingSite({ page }: { page: MarketingPage }) {
  useEffect(() => {
    document.title = pageDetails[page].title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', pageDetails[page].description);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffd500');
  }, [page]);

  useEffect(() => {
    document.documentElement.classList.add('marketing-scroll-smooth');
    return () => document.documentElement.classList.remove('marketing-scroll-smooth');
  }, []);

  return (
    <div className="marketing-site">
      <SiteHeader page={page} />
      {page === 'home' && <HomePage />}
      {page === 'review' && <ReviewPage />}
      {page === 'method' && <MethodPage />}
      {page === 'guardrails' && <GuardrailsPage />}
      {page === 'notFound' && <NotFoundPage />}
      <SiteFooter />
    </div>
  );
}
