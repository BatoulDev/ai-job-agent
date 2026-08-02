import Link from "next/link";

export default function BrandMark() {
  return (
    <Link href="/" className="flex w-fit items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent">
        <span className="h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-text">
        AI Job Agent
      </span>
    </Link>
  );
}
