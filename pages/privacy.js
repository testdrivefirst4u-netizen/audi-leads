import Head from "next/head";

// Public privacy policy — required by Meta before an app that receives Lead
// Ads data can be published (App settings → Basic → Privacy Policy URL), and
// good practice for a CRM that stores customer contact details regardless.
// No login: this page must be reachable by Meta's reviewers and by the
// people whose data the CRM holds.
//
// The wording below is a reasonable default for a dealership CRM that
// receives leads from Facebook/Instagram lead forms, Google Sheets exports
// and partner portals. Review it with whoever owns compliance at
// Broaddcast / the dealership and adjust the contact details.

const LAST_UPDATED = "17 September 2026";
const CONTACT_EMAIL = "broaddcast@gmail.com";

export default function PrivacyPolicyPage() {
  return (
    <>
      <Head>
        <title>Privacy Policy — Broadcast CRM</title>
        <meta name="robots" content="index,follow" />
      </Head>
      <main className="mx-auto max-w-3xl px-5 py-10 text-[15px] leading-relaxed text-ink">
        <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
        <p className="hint mb-8">Broadcast CRM (sales.broaddcast.com) · Last updated {LAST_UPDATED}</p>

        <Section title="Who we are">
          Broadcast CRM is a lead-management system operated by BroaddCast Business Solutions on behalf of the automotive
          dealerships (&ldquo;the dealership&rdquo;) that use it to follow up enquiries about their vehicles and services.
        </Section>

        <Section title="What information we collect">
          When you submit an enquiry — through a Facebook or Instagram lead form, a website form, a partner portal such as
          CarDekho or CarWale, or directly with a dealership — we receive the details you provided: typically your name, phone
          number, email address, city or preferred showroom, the vehicle model you are interested in, and your answers to any
          other questions on the form. From Meta (Facebook/Instagram) lead forms we also receive technical identifiers of the
          form, ad and campaign the enquiry came from, and the time it was submitted.
        </Section>

        <Section title="How we use it">
          The information is used only to respond to your enquiry: to contact you about the vehicle or service you asked
          about, schedule test drives or appointments, record follow-up notes, and measure which advertising campaigns
          generate enquiries. It is not sold, and it is not used for purposes unrelated to your enquiry.
        </Section>

        <Section title="Meta (Facebook and Instagram) lead ads">
          If you submit a lead form on Facebook or Instagram, Meta delivers that submission to Broadcast CRM through Meta&rsquo;s
          Lead Ads webhook and Graph API, in accordance with{" "}
          <a className="text-accent underline" href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">
            Meta&rsquo;s Privacy Policy
          </a>
          . We use the data only as described above and do not use it to build profiles for other purposes. You can manage
          the information Facebook shares with businesses in your Facebook and Instagram settings.
        </Section>

        <Section title="Who can see it">
          Your enquiry is visible only to the dealership you enquired with — its administrators and the sales agent assigned
          to you — and to BroaddCast staff who maintain the system. The CRM is hosted on Vercel and stores data in MongoDB
          Atlas; access is protected by individual logins, and integration credentials are stored encrypted.
        </Section>

        <Section title="How long we keep it">
          Enquiries are kept for as long as the dealership needs them to manage the customer relationship and its sales
          records, after which they may be archived or deleted. You can ask for your details to be removed at any time.
        </Section>

        <Section title="Your rights">
          You may ask us to tell you what information we hold about you, correct it, or delete it. To do so, contact the
          dealership you enquired with, or email{" "}
          <a className="text-accent underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          . Requests are handled within 30 days.
        </Section>

        <Section title="Changes to this policy">
          We may update this page from time to time; the date at the top shows the current version.
        </Section>
      </main>
    </>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="text-[17px] font-bold mb-1.5">{title}</h2>
      <p className="text-muted m-0">{children}</p>
    </section>
  );
}
