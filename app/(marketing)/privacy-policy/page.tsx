import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

// Text ported from CS app/privacy-policy/page.tsx.
const SECTIONS: LegalSection[] = [
  {
    heading: "What We Collect",
    body: "We collect account details you provide, such as your name, email, team join code requests, role selections, and scouting entries you submit in the app.",
  },
  {
    heading: "How We Use Data",
    body: "We use your data to create and maintain your account, route you to your team dashboards, process team join requests, and provide scouting analytics and team management features.",
  },
  {
    heading: "External Data Sources",
    body: "Event and match data may include information from The Blue Alliance (TBA) and the official FIRST API. Their own terms and privacy practices apply to their services.",
  },
  {
    heading: "Data Sharing",
    body: "We do not sell your personal information. Data is shared only as needed to operate the service, including trusted infrastructure providers used to authenticate users and store data.",
  },
  {
    heading: "Retention and Access",
    body: "Account and scouting records are kept while your team uses the platform, unless removed by administrators or required by law. Team admins can manage access and role assignments.",
  },
  {
    heading: "Contact",
    body: "For privacy questions, contact your team administrator or the CompSocrates maintainer.",
  },
];

export default function PrivacyPolicyPage() {
  return <LegalPage title="Privacy Policy" updatedOn="February 27, 2026" sections={SECTIONS} otherHref="/terms-of-service" otherLabel="View Terms of Service" />;
}
