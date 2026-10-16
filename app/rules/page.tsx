import type { Metadata } from "next";
import RulesView from "@/components/RulesView";
import rules from "@/config/rules.json";

export const metadata: Metadata = { title: "Rules · Pod Quality Console" };

export default function Page() {
  return <RulesView rules={rules} />;
}
