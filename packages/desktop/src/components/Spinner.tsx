export type SpinnerProps = { label?: string; className?: string };
export function Spinner({ label = "Loading", className = "" }: SpinnerProps) {
  return <span role="status" aria-label={label} className={`aos-spinner ${className}`}>
    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </span>;
}
export default Spinner;
