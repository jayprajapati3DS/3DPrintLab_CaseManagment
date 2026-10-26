"use client";

import { useActionState, useState } from "react";

import {
  createSpaceAction,
  resetSpaceAdminPasswordAction,
  type SpaceActionState,
  type SpaceAdminCredentials,
} from "@/app/(app)/spaces/actions";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/ui/styles";

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const FIELD = "border-field h-[42px] rounded-[9px] border px-3 text-sm";
const SMALL =
  "border-field text-ink-2 h-[26px] rounded-md border bg-white px-[9px] text-[11.5px] font-semibold whitespace-nowrap";

const IDLE: SpaceActionState = { ok: true };

// --- Create -------------------------------------------------------------------

export function CreateSpace({
  variant,
  baseDomain,
}: {
  variant: "primary" | "empty";
  baseDomain: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "primary"
            ? "bg-brand h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white"
            : `${BTN_SECONDARY} mt-1.5`
        }
      >
        {variant === "primary" ? "+ New company space" : "Create company space"}
      </button>
      {/* Mounted only while open, so every opening starts from a blank form. */}
      {open ? <CreateSpaceDialog baseDomain={baseDomain} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreateSpaceDialog({ baseDomain, onClose }: { baseDomain: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [state, submit, pending] = useActionState(createSpaceAction, IDLE);

  if (state.ok && state.credentials) {
    return (
      <Overlay>
        <CredentialsPanel
          title="Company space created"
          credentials={state.credentials}
          onClose={onClose}
        />
      </Overlay>
    );
  }

  const signInHost = `${slug || "your-space"}.${baseDomain}`;

  return (
    <Overlay>
      <form
        action={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-title"
        className="shadow-modal flex w-[520px] max-w-full flex-col gap-[18px] rounded-[14px] bg-white p-5 sm:p-[26px]"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="cs-title" className="m-0 text-lg font-bold tracking-[-0.3px]">
              New company space
            </h2>
            <div className="text-muted text-[13px]">An isolated workspace for one company.</div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-name" className="text-[13px] font-semibold">
            Company name
          </label>
          <input
            id="cs-name"
            name="name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Acme Orthopaedics"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-slug" className="text-[13px] font-semibold">
            Space ID
          </label>
          <div className="border-field flex h-[42px] items-center overflow-hidden rounded-[9px] border">
            <input
              id="cs-slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
              placeholder="acme-ortho"
              className="h-10 min-w-0 grow border-0 px-3 font-mono text-[13px] outline-none"
            />
            <div className="border-line bg-subtle text-muted flex h-10 items-center border-l px-3 font-mono text-xs">
              .{baseDomain}
            </div>
          </div>
          <span className="text-muted text-xs">
            Space users sign in at <b className="text-ink-2 font-mono">{signInHost}</b>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-domain" className="text-[13px] font-semibold">
            Custom domain <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            id="cs-domain"
            name="customDomain"
            placeholder="e.g. mms.acmeortho.com"
            autoCapitalize="none"
            spellCheck={false}
            className={`${FIELD} font-mono text-[13px]`}
          />
          <span className="text-muted text-xs">
            Point a CNAME record for this domain to {signInHost}.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-admin" className="text-[13px] font-semibold">
            Space admin email
          </label>
          <input
            id="cs-admin"
            name="adminEmail"
            type="email"
            placeholder="admin@company.com"
            className={FIELD}
          />
        </div>

        {!state.ok && state.message ? (
          <div role="alert" className="text-bad text-[13px]">
            {state.message}
          </div>
        ) : null}

        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Creating…" : "Create space"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// --- Row actions ----------------------------------------------------------------

/** Copy the sign-in link, or open the space's sign-in page in a new tab. */
export function SignInLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the address is on screen to select.
    }
  }

  return (
    <span className="flex gap-1.5">
      <button type="button" onClick={copy} className={SMALL}>
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <a
        href={`${url}/login`}
        target="_blank"
        rel="noreferrer"
        className={`${SMALL} flex items-center no-underline`}
      >
        Open sign-in page ↗
      </a>
    </span>
  );
}

export function ResetAdminPassword({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={SMALL}>
        Reset password
      </button>
      {open ? (
        <ResetDialog spaceId={spaceId} spaceName={spaceName} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ResetDialog({
  spaceId,
  spaceName,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  onClose: () => void;
}) {
  const [state, submit, pending] = useActionState(resetSpaceAdminPasswordAction, IDLE);

  if (state.ok && state.credentials) {
    return (
      <Overlay>
        <CredentialsPanel
          title="Space admin password reset"
          credentials={state.credentials}
          onClose={onClose}
        />
      </Overlay>
    );
  }

  return (
    <Overlay>
      <form
        action={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-title"
        className="shadow-modal flex w-[460px] max-w-full flex-col gap-4 rounded-[14px] bg-white p-5 sm:p-[26px]"
      >
        <input type="hidden" name="id" value={spaceId} />
        <h2 id="rp-title" className="m-0 text-lg font-bold tracking-[-0.3px]">
          Reset the space admin password?
        </h2>
        <p className="text-ink-3 m-0 text-[13.5px] leading-[1.55]">
          {spaceName}&rsquo;s admin gets a new temporary password and is signed out everywhere. The
          current password stops working at once.
        </p>
        {!state.ok && state.message ? (
          <div role="alert" className="text-bad text-[13px]">
            {state.message}
          </div>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Resetting…" : "Reset password"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// --- Shared ---------------------------------------------------------------------

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,0.55)] p-3 sm:items-center sm:p-6">
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="text-muted flex h-10 w-10 items-center justify-center rounded-lg border-0 bg-transparent"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/**
 * The one moment the temporary password exists in readable form. It is not
 * stored, so closing this is final — hence the plain warning rather than a
 * friendlier message.
 */
function CredentialsPanel({
  title,
  credentials,
  onClose,
}: {
  title: string;
  credentials: SpaceAdminCredentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text =
    `${credentials.spaceName} — Manufacturing Management\n` +
    `Sign in: ${credentials.signInUrl}\n` +
    `Email: ${credentials.email}\n` +
    `Temporary password: ${credentials.password}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The details are on screen to copy by hand.
    }
  }

  const rows: Array<[string, string]> = [
    ["Sign-in page", credentials.signInUrl],
    ["Email", credentials.email],
    ["Temporary password", credentials.password],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cred-title"
      className="shadow-modal flex w-[520px] max-w-full flex-col gap-4 rounded-[14px] bg-white p-5 sm:p-[26px]"
    >
      <div className="flex flex-col gap-1">
        <h2 id="cred-title" className="m-0 text-lg font-bold tracking-[-0.3px]">
          {title}
        </h2>
        <div className="text-muted text-[13px]">
          Send these to {credentials.spaceName}&rsquo;s admin. They sign in, then connect the space
          to the 3D Surgical Platform.
        </div>
      </div>

      <dl className="border-line m-0 grid grid-cols-[110px_minmax(0,1fr)] overflow-hidden sm:grid-cols-[150px_minmax(0,1fr)] rounded-[10px] border text-[13px]">
        {rows.map(([label, value], i) => (
          <div key={label} className="contents">
            <dt className={"text-muted bg-subtle px-3.5 py-2.5 " + (i ? "border-line-3 border-t" : "")}>
              {label}
            </dt>
            <dd
              className={
                "m-0 px-3.5 py-2.5 font-mono text-[12.5px] break-all " +
                (i ? "border-line-3 border-t" : "")
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="bg-warn-tint text-warn m-0 rounded-[10px] border border-[#FEDF89] px-3.5 py-3 text-[13px] leading-[1.45]">
        This password is shown once and is not stored. If it is lost, reset it from the space&rsquo;s
        row.
      </p>

      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={copy} className={BTN_SECONDARY}>
          {copied ? "Copied ✓" : "Copy details"}
        </button>
        <button type="button" onClick={onClose} className={BTN_PRIMARY}>
          Done
        </button>
      </div>
    </div>
  );
}
