export interface Faq {
  question: string;
  answer: string;
}

/** Single source of truth: rendered in the on-page FAQ and emitted as FAQPage schema. */
export const FAQS: Faq[] = [
  {
    question: 'Is brainlodestones.com available right now?',
    answer:
      'Yes. The domain is listed for sale, is in good standing with a clean title, and is ready for immediate transfer to your registrar.',
  },
  {
    question: 'How does buying a premium domain work?',
    answer:
      'We agree on terms, you place funds with an escrow service such as Escrow.com, you approve the transfer, the domain moves into your registrar account, and the seller is released. Most transfers complete within a few business days of cleared funds.',
  },
  {
    question: 'Can I pay in installments or structure the deal differently?',
    answer:
      'Flexible terms are available for qualified buyers, including staged payments arranged through escrow. Describe your preferred structure in your inquiry and we will confirm what is possible.',
  },
  {
    question: 'What is included with the domain?',
    answer:
      'The domain itself, plus the brand identity assets presented on this page — the logo suite, color system, and usage guidelines — delivered as part of the transfer.',
  },
  {
    question: 'Who is the right buyer for this name?',
    answer:
      'Multi-site TMS and mental health clinic networks, neurotechnology platform and device companies, digital brain health products, and research consortia building infrastructure across multiple locations.',
  },
  {
    question: 'How quickly will I hear back after inquiring?',
    answer:
      'Every inquiry is reviewed by an acquisitions specialist with a response within 24 hours — often the same business day. Confidentiality is the default.',
  },
];
