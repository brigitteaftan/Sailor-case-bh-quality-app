import { getPatient } from "@/lib/data";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = getPatient((await params).id);
  return p ? Response.json(p) : Response.json({ error: "Patient not found" }, { status: 404 });
}
