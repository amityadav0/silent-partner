// Themed 404 (Y8): the site's layout, header and colors, and a way back.
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex flex-col items-start gap-4 py-16" data-testid="not-found">
      <span className="chip">404</span>
      <h1>This page doesn&apos;t exist</h1>
      <p className="muted max-w-xl text-lg">The link may be old or mistyped. The leaderboard and every vault are one click away.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/leaderboard/" className="btn">Leaderboard</Link>
      </div>
    </section>
  );
}
