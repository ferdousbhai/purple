/**
 * The favicon artwork as an inline component, so the app headers and the
 * browser tab show the same mark. Keep in sync with
 * apps/web/public/favicon.svg (colors are fixed there too; the tile reads as
 * an app icon on both light and dark palettes).
 */
export function PurpleMark({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      <rect width="128" height="128" rx="26" fill="#0c0914" />
      <path
        d="M27 56c0-24 16-39 37-39s37 15 37 39"
        fill="none"
        stroke="#c77dff"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <ellipse cx="64" cy="49" rx="23" ry="26" fill="#b98f70" />
      <path
        d="M42 55c5 5 8 8 11 13 3-4 7-6 11-2 4-4 8-2 11 2 3-5 6-8 11-13-1 25-9 48-22 62-13-14-21-37-22-62Z"
        fill="#e6e1f2"
      />
      <path
        d="M49 49h10m10 0h10"
        stroke="#0c0914"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="m57 64 7 4 7-4"
        fill="none"
        stroke="#0c0914"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[21, 90].map((x) => (
        <rect
          key={x}
          x={x}
          y="49"
          width="17"
          height="34"
          rx="7"
          fill="#0c0914"
          stroke="#c77dff"
          strokeWidth="6"
        />
      ))}
    </svg>
  );
}
