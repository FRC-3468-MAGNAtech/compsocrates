import Link from "next/link";

export default function TermsOfServicePage() {
  const updatedOn = "February 27, 2026";

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white border rounded-2xl shadow-sm p-6 md:p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
          Terms of Service
        </h1>
        <p className="text-sm text-gray-600 mb-6">Last updated: {updatedOn}</p>

        <div className="space-y-5 text-gray-800 leading-7">
          <section>
            <h2 className="text-xl font-semibold mb-2">Use of Service</h2>
            <p>
              CompSocrates is provided for team scouting, analysis, and coordination. You agree to use the
              service lawfully and not attempt to disrupt, misuse, or gain unauthorized access to data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Accounts and Access</h2>
            <p>
              You are responsible for account credentials and activities under your account. Team admins are
              responsible for membership approvals and role permissions within their team.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Data and Content</h2>
            <p>
              You retain responsibility for the scouting content your team submits. By using the service,
              you allow processing and storage required to operate dashboards, analytics, and assignment tools.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Third-Party APIs</h2>
            <p>
              Some event and match information is sourced from The Blue Alliance and FIRST API. Their terms
              apply to that data. FIRST API data may not be used for commercial purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">No Warranty</h2>
            <p>
              The service is provided as-is. We aim for reliability but do not guarantee uninterrupted
              availability or error-free operation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Contact</h2>
            <p>
              For policy or legal questions, contact your team administrator or the CompSocrates maintainer.
            </p>
          </section>
        </div>

        <div className="mt-8 text-sm text-gray-600">
          <Link href="/privacy-policy" className="underline">
            View Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
