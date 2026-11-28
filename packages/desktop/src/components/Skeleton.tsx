export type SkeletonProps = { lines?: number; shape?: "text" | "circle" | "block"; label?: string; className?: string };
export function Skeleton({ lines = 3, shape = "text", label = "Loading content", className = "" }: SkeletonProps) {
  const count = shape === "text" ? Math.max(1, Math.min(12, Math.floor(lines) || 1)) : 1;
  return <div role="status" aria-label={label} className={`aos-skeleton aos-skeleton--${shape} ${className}`}>
    {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" />)}
  </div>;
}
export default Skeleton;
