/* Platform support contacts — the ONE source of truth for Zora's public phone,
   WhatsApp, email and Instagram. Every surface that shows a contact (help page,
   checkout dialogs, the ZBot FAB, footers, receipts, KYC/fraud copy) imports
   from here instead of inlining a literal.

   Why this file exists: before it, each surface hardcoded its own copy and they
   drifted — the support email alone had reached THREE domains (zorapass.com,
   zora.live, zora.app) across the site. These are platform-wide, not per-tenant.

   IMPORTANT — keep this file dependency-free (zero imports). It is imported by
   the API (a Node/Nest server) AND by 'use client' React components in the web
   app, whose browser bundle must never pull in the rest of @zora/core (postgres,
   pdf-lib, …). A subpath export (`@zora/core/contacts`) keeps that boundary; do
   not add an import to this module. */

/** Support inbox. Canonical domain is zorapass.com (the brand front door). */
export const SUPPORT_EMAIL = 'support@zorapass.com';

/** Human-readable phone, as shown in text. */
export const SUPPORT_PHONE = '+255 741 099 989';

/** `tel:` target — same number, no spaces (RFC 3966). */
export const SUPPORT_PHONE_HREF = 'tel:+255741099989';

/** WhatsApp deep link — the digits-only MSISDN wa.me expects. */
export const WHATSAPP_HREF = 'https://wa.me/255741099989';

/** Instagram handle without the leading '@'. */
export const INSTAGRAM_HANDLE = 'zora.pass';

/** Instagram handle as displayed. */
export const INSTAGRAM_LABEL = '@zora.pass';

/** Instagram profile URL. */
export const INSTAGRAM_URL = 'https://instagram.com/zora.pass';

/** `mailto:` target for the support inbox. */
export const SUPPORT_EMAIL_HREF = 'mailto:support@zorapass.com';
