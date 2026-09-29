/** Polite live region for decision / filter announcements (visually hidden). */
export function AdminLive({ message }: { message: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  );
}
