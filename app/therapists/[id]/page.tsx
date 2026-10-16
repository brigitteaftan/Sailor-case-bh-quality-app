import { notFound } from "next/navigation";
import TherapistView from "@/components/TherapistView";
import { getActivePatients, getSummary, getTherapist, namesFor } from "@/lib/data";

export function generateStaticParams() {
  return getSummary().therapists.map((t: any) => ({ id: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = getTherapist((await params).id);
  return { title: t ? `${t.name} · Pod Quality Console` : "Not found" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = getTherapist(id);
  if (!t) notFound();
  const summary = getSummary();
  const patients = getActivePatients(id);
  const flagIds = summary.case_flags.filter((f: any) => f.therapist_id === id).map((f: any) => f.patient_id);
  const { denials, ...rest } = summary;
  return <TherapistView summary={rest} tid={id} patients={patients} names={namesFor(flagIds)} />;
}
