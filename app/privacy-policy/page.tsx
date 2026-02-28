import Link from "next/link";

export default function PrivacyPolicyPage() {
  const updatedOn = "February 27, 2026";

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white border rounded-2xl shadow-sm p-6 md:p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-600 mb-6">Last updated: {updatedOn}</p>

        <div className="space-y-5 text-gray-800 leading-7">
          <section>
            <h2 className="text-xl font-semibold mb-2">What We Collect</h2>
            <p>
              We collect account details you provide, such as your name, email, team join code requests,
              role selections, and scouting entries you submit in the app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">How We Use Data</h2>
            <p>
              We use your data to create and maintain your account, route you to your team dashboards,
              process team join requests, and provide scouting analytics and team management features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">External Data Sources</h2>
            <p>
              Event and match data may include information from The Blue Alliance (TBA) and the official
              FIRST API. Their own terms and privacy practices apply to their services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Data Sharing</h2>
            <p>
              We do not sell your personal information. Data is shared only as needed to operate the
              service, including trusted infrastructure providers used to authenticate users and store data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Retention and Access</h2>
            <p>
              Account and scouting records are kept while your team uses the platform, unless removed by
              administrators or required by law. Team admins can manage access and role assignments.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Contact</h2>
            <p>
              For privacy questions, contact your team administrator or the CompSocrates maintainer.
            </p>
          </section>
        </div>

        <div className="mt-8 text-sm text-gray-600">
          <Link href="/terms-of-service" className="underline">
            View Terms of Service
          </Link>
        </div>
      </div>
    </main>
  );
}
