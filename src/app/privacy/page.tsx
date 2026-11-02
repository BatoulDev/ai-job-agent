import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

// DRAFT privacy policy, grounded only in this codebase's actual current
// behavior (see docs/ACCOUNT_DELETION_DESIGN.md's companion audit). Makes
// no legal-framework compliance claims (GDPR/CCPA etc.) and invents no
// retention period or guarantee the system doesn't actually implement —
// recommend legal counsel review before treating this as final.
export const metadata = {
  title: "Privacy Policy — AI Job Guide",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 py-14 lg:px-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted">
            Last updated: November 2, 2026. This describes what AI Job Guide actually does today —
            it will be updated as the product changes.
          </p>

          <Section title="What we collect">
            <p>When you create an account and use AI Job Guide, we collect:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your email address and password (used only for sign-in; your password is never visible to us — it is handled by our authentication provider).</li>
              <li>Your name, country of residence, and education details you provide.</li>
              <li>The CV file you upload, and the information our AI extracts from it (skills, experience, education, summary).</li>
              <li>Your stated job preferences: target roles, locations, work arrangement, relocation willingness, and work-authorization status.</li>
              <li>The job matches, match scores and explanations, cover letters, and application records our system generates for you.</li>
              <li>Basic technical logs (such as when a password-reset or sign-in attempt happened) used only to prevent abuse of our sign-in pages.</li>
            </ul>
          </Section>

          <Section title="How we use it">
            <p>We use this information only to run the product you signed up for:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Parsing your CV and generating your AI career profile.</li>
              <li>Matching you against job listings and explaining why a job was matched.</li>
              <li>Generating a tailored cover letter when you request one.</li>
              <li>Letting you review, approve, or reject matches and applications before anything is sent anywhere.</li>
              <li>Keeping your account secure and preventing automated abuse of our login and password-reset pages.</li>
            </ul>
            <p>
              We do not use your data for advertising, and we do not sell your data to anyone.
            </p>
          </Section>

          <Section title="Who we share it with">
            <p>We rely on a small number of service providers to run AI Job Guide:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Supabase</strong> — hosts our database, handles sign-in, and stores your uploaded CV file.</li>
              <li><strong>OpenAI</strong> — our AI model provider. Your CV text, job descriptions, and your stated preferences are sent to OpenAI to generate your career profile, match explanations, and cover letters. OpenAI&rsquo;s own retention of this data is governed by its own policies, outside AI Job Guide&rsquo;s direct control (see &ldquo;How long we keep your data&rdquo; below).</li>
              <li><strong>Apify</strong> — we use this provider only to collect public job listings from job boards; it never receives any of your personal data.</li>
            </ul>
            <p>
              We never apply to a job, send an email, or submit anything on your behalf without your
              explicit approval first.
            </p>
          </Section>

          <Section title="Payments">
            <p>
              AI Job Guide does not currently process real payments. If this changes, this policy
              will be updated before any payment feature goes live, and we will name the payment
              processor used.
            </p>
          </Section>

          <Section title="How long we keep your data">
            <p>
              We keep your data for as long as your account exists, so the product can continue to
              work for you. We do not currently have a fixed automatic deletion schedule beyond that.
              You can delete your account at any time — see &ldquo;Your choices&rdquo; below.
            </p>
            <p>
              AI Job Guide does not currently process real payments, so there are no financial or
              accounting records to retain beyond your account&rsquo;s own data. If real payments are
              introduced, this policy will be updated to describe any legally required retention of
              payment records before that happens.
            </p>
            <p>
              Deleting your account removes your data from the systems AI Job Guide directly controls
              (our database and file storage). We also rely on OpenAI to process your CV and job
              information, as described above; OpenAI&rsquo;s own retention of anything already sent
              to it is governed by its own policies, and immediate deletion from systems outside our
              control cannot be guaranteed.
            </p>
          </Section>

          <Section title="Your choices">
            <p>
              You can edit your job preferences and CV at any time from your dashboard. You can
              permanently delete your account at any time from Settings → Delete account, after
              re-authenticating (your password, or a fresh Google sign-in for Google accounts) and
              confirming explicitly. Deletion happens immediately and removes your account, your
              uploaded CV file, and the records tied to your account (preferences, matches, cover
              letters, and application history). Some records containing no personal identifying
              information may be kept in anonymized form for security purposes. You can also contact
              us at <strong>[support email — to be added]</strong> if you have questions about this
              process or need help.
            </p>
          </Section>

          <Section title="Security">
            <p>
              Your data is protected by database-level access rules that ensure only you (and our
              internal systems acting on your behalf) can read or modify it, and all traffic to AI
              Job Guide is encrypted in transit.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data can be sent to{" "}
              <strong>[support email — to be added]</strong>.
            </p>
          </Section>
        </section>
      </main>
      <Footer />
    </>
  );
}
