import type { ReactNode } from "react";
import { TONE_CLASS, TONE_DOT, type StatusPresentation, type Tone } from "@/util/evidence";

/**
 * A small status chip.
 *
 * `tone` carries meaning, so the chip is never decorative: it is always given a
 * text label as well as a colour, and the full explanation rides on `title` for
 * pointer users and on the accessible name for assistive technology.
 */
export function Chip({
  tone = "neutral",
  children,
  title,
  dot = false,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
      title={title}
    >
      {dot ? <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A chip built straight from a `StatusPresentation`. */
export function StatusChip({ status, className = "" }: { status: StatusPresentation; className?: string }) {
  return (
    <Chip tone={status.tone} title={status.help} className={className}>
      {status.label}
    </Chip>
  );
}
