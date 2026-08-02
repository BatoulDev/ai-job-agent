import BrandMark from "@/components/BrandMark";
import OnboardingProgress from "./OnboardingProgress";

export default function OnboardingShell({
  currentStep,
  children,
}: {
  currentStep: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-20 lg:px-8">
        <OnboardingProgress currentStep={currentStep} />
        <div className="mt-10">{children}</div>
      </main>
    </div>
  );
}
