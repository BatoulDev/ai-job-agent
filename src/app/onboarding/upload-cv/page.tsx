"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import GiftModal from "@/components/onboarding/GiftModal";
import { createClient } from "@/lib/supabase/client";

const ACCEPTED_FORMATS = ".pdf,.doc,.docx";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return "Please upload a PDF, DOC, or DOCX file.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "File is too large. Maximum size is 5MB.";
  }
  return null;
}

// Keeps the storage path readable while stripping anything that could
// break the "{userId}/{unique-id}-{name}" convention the RLS policies and
// the cvs_storage_path_owned_by_user check constraint both require.
function sanitizeFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.slice(lastDot) : "";
  const safeBase =
    base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").slice(0, 60) ||
    "cv";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  return `${safeBase}${safeExt}`;
}

function UploadCvPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(
    () => searchParams.get("gift") === "1"
  );

  // "Not now" and the popup's X button both call this — dismissing the gift
  // offer sends the user back to the landing page, not deeper into
  // onboarding, and never to /news (that's the "Claim free gift" link only).
  const closeGiftModal = () => {
    setShowGiftModal(false);
    router.push("/");
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadError(null);
    setSelectedFile(file);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleContinue = async () => {
    if (!selectedFile) {
      router.push("/onboarding/preferences");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setIsUploading(false);
      router.push("/login?next=/onboarding/upload-cv");
      return;
    }

    // Read the current active CV row (if any) so its storage object can be
    // cleaned up after a successful replace — never before, so a failed
    // upload never leaves the user without a working CV. Scoped to
    // is_active: a user may now have historical (inactive) cvs rows too
    // (see replace_cv()), so this must not match more than one row.
    const { data: existingCv } = await supabase
      .from("cvs")
      .select("storage_path")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const storagePath = `${user.id}/${crypto.randomUUID()}-${sanitizeFileName(
      selectedFile.name
    )}`;

    const { error: storageError } = await supabase.storage
      .from("cvs")
      .upload(storagePath, selectedFile, {
        contentType: selectedFile.type,
        upsert: false,
      });

    if (storageError) {
      setUploadError(`Upload failed: ${storageError.message}`);
      setIsUploading(false);
      return;
    }

    // replace_cv() is the sanctioned write path (see
    // supabase/migrations/20260809090010_resolve_cvs_versioning_conflict.sql):
    // it atomically deactivates any existing active CV and inserts this one
    // as the new active version, deriving the owning user from the session
    // server-side rather than trusting a client-supplied user_id. Direct
    // client inserts/updates on cvs are no longer permitted.
    const { error: dbError } = await supabase.rpc("replace_cv", {
      p_storage_path: storagePath,
      p_file_name: selectedFile.name,
      p_file_size_bytes: selectedFile.size,
      p_mime_type: selectedFile.type,
    });

    if (dbError) {
      const { error: cleanupError } = await supabase.storage
        .from("cvs")
        .remove([storagePath]);

      setUploadError(
        cleanupError
          ? `Upload could not be saved (${dbError.message}). Cleanup of the uploaded file also failed — please contact support.`
          : `Upload could not be saved: ${dbError.message}`
      );
      setIsUploading(false);
      return;
    }

    // The cvs row now points at the new object — only now is it safe to
    // remove the previous one.
    if (existingCv?.storage_path && existingCv.storage_path !== storagePath) {
      await supabase.storage.from("cvs").remove([existingCv.storage_path]);
    }

    setIsUploading(false);
    router.push("/onboarding/preferences");
  };

  const handleSkip = () => {
    router.push("/onboarding/preferences");
  };

  return (
    <OnboardingShell currentStep={2}>
      <div className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Upload your CV
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Your AI Job Agent uses your CV to understand your skills,
          experience, education, and target roles.
        </p>
      </div>

      <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <label
          htmlFor="cv-upload"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFiles(event.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-slate-300 hover:border-primary/40 hover:bg-primary/5"
          }`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>

          <p className="text-sm font-medium text-text">
            Drop your CV here or{" "}
            <span className="text-primary">click to browse</span>
          </p>
          <p className="text-xs text-muted">
            Accepted formats: PDF, DOC, DOCX
          </p>
          <p className="text-xs text-muted">Max file size: 5MB</p>

          <input
            ref={fileInputRef}
            id="cv-upload"
            type="file"
            accept={ACCEPTED_FORMATS}
            onChange={(event) => handleFiles(event.target.files)}
            className="hidden"
          />
        </label>

        {uploadError && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {uploadError}
          </div>
        )}

        {selectedFile && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-bg px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M14 3v5h5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-muted">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveFile}
              className="shrink-0 text-xs font-medium text-muted hover:text-text"
            >
              Remove
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          Your CV stays private. Nothing is sent to employers without your
          approval.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={handleContinue}
            disabled={isUploading}
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Uploading..." : "Continue"}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={isUploading}
            className="text-sm font-medium text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip for now
          </button>
          <Link
            href="/news"
            className="text-sm font-medium text-primary hover:text-primary-dark"
          >
            Explore AI/Tech News first
          </Link>
        </div>
      </div>

      <GiftModal open={showGiftModal} onClose={closeGiftModal} />
    </OnboardingShell>
  );
}

export default function UploadCvPage() {
  return (
    <Suspense fallback={null}>
      <UploadCvPageContent />
    </Suspense>
  );
}
