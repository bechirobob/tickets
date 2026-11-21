/** Velvet Rope, selected host mark from the Box Office icon review. */
export default function VelvetRope({ size = 18 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="6" r="1.3" />
    <circle cx="20" cy="6" r="1.3" />
    <path d="M4 8v12m16-12v12M2 20h4m12 0h4M4 10q8 10 16 0" />
  </svg>;
}
