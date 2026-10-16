import Link from "next/link";
import { getSummary, searchPatients } from "@/lib/data";

export const metadata = { title: "Find a patient · Pod Quality Console" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q ?? "";
  const results = searchPatients(q, 50);
  const T = Object.fromEntries(getSummary().therapists.map((t: any) => [t.id, t.name]));
  return (
    <div className="page-narrow">
      <div className="crumbs-bar"><Link href="/">Dashboard</Link><span>/</span><span>Find a patient</span></div>
      <div className="sec-head"><div><h2>Patients matching “{q}”</h2></div><div className="right"><span className="sub">{results.length} found</span></div></div>
      <div className="tablebox">
        <table className="ptable">
          <thead><tr><th>Patient</th><th>Age</th><th>Therapist</th><th>Status</th></tr></thead>
          <tbody>
            {results.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/patients/${p.id}`} style={{ fontWeight: 700 }}>{p.name}</Link> <span className="mono muted">{p.id}</span></td>
                <td>{p.age}</td><td>{T[p.t]}</td><td>{p.status}</td>
              </tr>
            ))}
            {!results.length && <tr><td colSpan={4} className="muted">No patients match. Try a first name or an ID like P-2023.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
