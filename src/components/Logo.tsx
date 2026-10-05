/**
 * The platform's own mark: a lens bracket around a signal trace. Deliberately not any
 * company's logo - this is a portfolio demo, not a corporate page.
 */
export default function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Vision MLOps Platform" fill="none">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0b1220" stroke="#223049" strokeWidth="1.5" />
      <path d="M8 6.5H6.5V8M24 6.5h1.5V8M8 25.5H6.5V24M24 25.5h1.5V24" stroke="#8fa1bd" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 20l5-8 4 6 3-4 6 6" stroke="#39ff88" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
