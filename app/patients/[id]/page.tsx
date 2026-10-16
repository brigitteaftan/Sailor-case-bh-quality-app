import { notFound } from "next/navigation";
import PatientView from "@/components/PatientView";
import { getPatient, getSummary, getTherapist } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = getPatient((await params).id);
  return { title: p ? `${p.name} · Pod Quality Console` : "Not found" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPatient(id);
  if (!p) notFound();
  const flags = getSummary().case_flags.filter((f: any) => f.patient_id === id);
  return <PatientView p={p} therapist={getTherapist(p.t)} flags={flags} />;
}
