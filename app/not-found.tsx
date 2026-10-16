import Link from "next/link";

export default function NotFound() {
  return (
    <div className="notfound">
      <h2 style={{ fontFamily: "var(--f-display)" }}>We couldn’t find that page</h2>
      <p className="ink2">The therapist or patient ID may be wrong, or they may no longer be in this pod.</p>
      <p><Link className="btn" href="/">Back to the dashboard</Link></p>
    </div>
  );
}
