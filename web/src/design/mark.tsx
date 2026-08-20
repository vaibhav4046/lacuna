/**
 * The two things the design repeats verbatim in more than one place.
 *
 * Neither is an invented component. The spiral markup is byte-identical at
 * 21px in the landing header, 19px in the footer, 17px in the sidebar and 15px
 * beside HYDRADB, and the mono stack is one string written out a few hundred
 * times. Writing the same markup once is not a refactor of the design, it is
 * the same markup.
 *
 * The centre of the spiral never closes. That is the mark.
 */

export const MONO = "'JetBrains Mono', ui-monospace, monospace";

export function Mark({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g transform="translate(-1.2 1.475)">
        <path
          d="M12 2.6A8.4 8.4 0 0 1 12 19.4A6 6 0 0 1 12 7.4A3.7 3.7 0 0 1 12 14.8"
          fill="none"
          stroke="#8052FF"
          strokeOpacity="0.42"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
        <path
          d="M12 2.6A8.4 8.4 0 0 1 12 19.4A6 6 0 0 1 12 7.4A3.7 3.7 0 0 1 12 14.8"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
        <circle cx="12" cy="2.6" r="2.25" fill="#080808" stroke="#FFB829" strokeWidth="1.25" />
        <circle cx="12" cy="2.6" r="0.85" fill="#FFB829" />
      </g>
    </svg>
  );
}
