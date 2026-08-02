"use client";

import { useState } from "react";

const FAQS = [
  {
    question: "Does it apply on LinkedIn automatically?",
    answer:
      "No. We never auto-apply on LinkedIn and we don't scrape LinkedIn. For LinkedIn roles, we show you the job link along with your prepared materials so you can apply yourself.",
  },
  {
    question: "Can I approve before sending?",
    answer:
      "Yes. Every match and every application waits for your approval. Nothing is sent on your behalf without you reviewing it first.",
  },
  {
    question: "Can I edit the cover letter?",
    answer:
      "Always. The AI generates a first draft based on your CV and the job, and you can edit it freely before it's sent.",
  },
  {
    question: "Is my CV private?",
    answer:
      "Yes. Your CV is used only to find and explain your matches. You control your data and can remove it at any time.",
  },
  {
    question: "Who is this for?",
    answer:
      "Students and fresh graduates in Lebanon looking for their first roles, with support for remote and MENA opportunities as we expand.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            FAQ
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Common questions
          </h2>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={faq.question}
                className="rounded-2xl border border-slate-200 bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-base font-semibold text-text">
                    {faq.question}
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`shrink-0 text-muted transition-transform duration-200 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {isOpen && (
                  <p className="px-6 pb-5 text-sm leading-relaxed text-muted">
                    {faq.answer}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
