/**
 * HUDStandard — Tank-grade 5-section HUD renderer
 * Staggered reveal animation per section.
 */
'use client';

import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

const SECTION_DELAY = ['0ms', '60ms', '120ms', '180ms', '240ms'];

function Section({
  label,
  labelColor,
  children,
  delay,
}: {
  label: string;
  labelColor: string;
  children: React.ReactNode;
  delay: string;
}) {
  return (
    <div
      className="animate-fade-in-up"
      style={{ animationDelay: delay, animationFillMode: 'both' }}
    >
      <span className={`text-xs font-semibold uppercase tracking-wider ${labelColor}`}>{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export default function HUDStandard({ parsed }: { parsed: HUDParsed }) {
  let sectionIdx = 0;

  return (
    <div className="space-y-3">
      {parsed.motive && (
        <Section label="Motive" labelColor="text-zinc-500" delay={SECTION_DELAY[sectionIdx++]}>
          <p className="text-sm text-zinc-300 leading-snug">{parsed.motive}</p>
        </Section>
      )}
      {parsed.delivery && (
        <Section label="Delivery" labelColor="text-amber-500" delay={SECTION_DELAY[sectionIdx++]}>
          <p className="text-sm text-amber-200 italic leading-snug">{parsed.delivery}</p>
        </Section>
      )}
      {parsed.move && (
        <Section label="The Move" labelColor="text-green-400" delay={SECTION_DELAY[sectionIdx++]}>
          <RenderSegments segments={parseSegments(parsed.move)} className="mt-1" />
        </Section>
      )}
      {parsed.bait && (
        <Section label="The Bait" labelColor="text-blue-400" delay={SECTION_DELAY[sectionIdx++]}>
          <p className="text-sm text-blue-200 leading-snug">{parsed.bait}</p>
        </Section>
      )}
      {parsed.diagnostic && (
        <Section label="Diagnostic" labelColor="text-zinc-600" delay={SECTION_DELAY[sectionIdx++]}>
          <RenderSegments segments={parseSegments(parsed.diagnostic)} className="mt-1 text-zinc-400" />
        </Section>
      )}
    </div>
  );
}
