import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle with only the node_modules it actually
   * imports. The production image copies that instead of installing anything,
   * which is what keeps it small and makes the container start immediately.
   */
  output: "standalone",

  // A second copy of the app can run beside the usual one — for checking a
  // change without stopping the server someone is working in — by giving it
  // its own build directory: NEXT_DIST_DIR=.next-verify next dev -p 3101.
  // globals.css keeps Tailwind from reading class names out of that directory,
  // and out of .next-build, where a production build can be tried the same way
  // (NEXT_DIST_DIR=.next-build next build). Saving this file restarts a running `next dev`, which then loads a regenerated Prisma client (as after a migration — touch this file then).
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // The Lightsail host sits behind nothing; Caddy terminates TLS and forwards
  // on the private network, so the app must trust the forwarded headers to
  // build correct absolute URLs and read the real client address.
  poweredByHeader: false,

  // The admin console and every company space are served on their own
  // subdomain, in development too (admin.localhost, <space>.localhost). Next's
  // dev server only answers the hostname it started on unless told otherwise.
  allowedDevOrigins: ["*.localhost"],

  // Reports and certificates are uploaded through server actions, which Next
  // caps at 1 MB unless told otherwise. One file may be 25 MB
  // (src/lib/files.ts), and a record can carry several.
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
