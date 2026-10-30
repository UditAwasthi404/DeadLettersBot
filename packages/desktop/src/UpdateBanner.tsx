export function UpdateBanner({ ready, onRestart }: { ready: boolean; onRestart: () => void }) {
  if (!ready) return null;
  return (
    <div className="update-banner">
      <span>Update available — restart to install</span>
      <button type="button" onClick={onRestart}>
        Restart
      </button>
    </div>
  );
}
