import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

// Text ported from CS app/terms-of-service/page.tsx.
const SECTIONS: LegalSection[] = [
  {
    heading: "Use of Service",
    body: "CompSocrates is provided for team scouting, analysis, and coordination. You agree to use the service lawfully and not attempt to disrupt, misuse, or gain unauthorized access to data.",
  },
  {
    heading: "Accounts and Access",
    body: "You are responsible for account credentials and activities under your account. Team admins are responsible for membership approvals and role permissions within their team.",
  },
  {
    heading: "Data and Content",
    body: "You retain responsibility for the scouting content your team submits. By using the service, you allow processing and storage required to operate dashboards, analytics, and assignment tools.",
  },
  {
    heading: "Third-Party APIs",
    body: "Some event and match information is sourced from The Blue Alliance and FIRST API. Their terms apply to that data. FIRST API data may not be used for commercial purposes.",
  },
  {
    heading: "No Warranty",
    body: "The service is provided as-is. We aim for reliability but do not guarantee uninterrupted availability or error-free operation.",
  },
  {
    heading: "Contact",
    body: "For policy or legal questions, contact your team administrator or the CompSocrates maintainer.",
  },
];

export default function TermsOfServicePage() {
  return <LegalPage title="Terms of Service" updatedOn="February 27, 2026" sections={SECTIONS} otherHref="/privacy-policy" otherLabel="View Privacy Policy" />;
}
