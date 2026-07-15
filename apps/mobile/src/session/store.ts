// session/store.ts — the single source of truth for role-based routing + KYC gate.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KycStatus } from '../api/kyc';

export type Role = 'consumer' | 'organizer' | 'staff';
export type Mode = 'consumer' | 'organizer';

const KYC_REF_KEY = 'zora.kyc.ref'; // survives app restarts so status keeps resolving

interface SessionState {
  role: Role | null;              // privilege from the authenticated JWT
  activeMode: Mode;               // which face of the app is showing
  verified: boolean;              // KYC identity verification — gates payouts/withdrawals
  kycPending: boolean;            // ID submitted, awaiting review
  kycRef: string | null;          // reference of the live submission (for status polling)
  kycRejection: string | null;    // user-facing reason when a submission is rejected
  signInAs: (role: Role) => void;
  setVerified: (v: boolean) => void;                       // real path: mirrored from profiles.kyc_verified
  beginKyc: (ref: string) => void;                         // called after a real submit to /api/kyc/submit
  applyKycStatus: (status: KycStatus, reason?: string | null) => void; // maps a polled status → state
  hydrateKyc: () => Promise<void>;                         // reload a persisted ref on app start
  toggleMode: () => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  role: null,
  activeMode: 'consumer',
  verified: false,
  kycPending: false,
  kycRef: null,
  kycRejection: null,

  // Land on the surface that matches the role. Organizers open the dashboard;
  // fans open the marketplace. (Staff is routed by role in RootNavigator, so
  // activeMode is irrelevant for them.)
  signInAs: (role) => set({ role, activeMode: role === 'organizer' ? 'organizer' : 'consumer' }),

  // Source of truth is the Supabase profile (see auth.resolveProfile); this
  // setter is how bindAuth mirrors it into the session.
  setVerified: (v) => set({ verified: v, kycPending: v ? false : get().kycPending }),

  // After the phone POSTs documents to /api/kyc/submit, remember the ref so the
  // wallet can poll /api/kyc/status/:ref until an admin approves it.
  beginKyc: (ref) => {
    set({ kycRef: ref, kycPending: true, kycRejection: null, verified: false });
    AsyncStorage.setItem(KYC_REF_KEY, ref).catch(() => {});
  },

  // Map a server status into gate state. Approval is the ONLY thing that unlocks
  // payouts — there is no client-side self-approval.
  applyKycStatus: (status, reason) => {
    if (status === 'approved') set({ verified: true, kycPending: false, kycRejection: null });
    else if (status === 'rejected' || status === 'expired')
      set({ verified: false, kycPending: false, kycRejection: reason ?? (status === 'expired' ? 'Your ID expired — please re-verify.' : 'Please resubmit.') });
    else set({ verified: false, kycPending: true, kycRejection: null }); // submitted | in_review
  },

  hydrateKyc: async () => {
    try { const ref = await AsyncStorage.getItem(KYC_REF_KEY); if (ref) set({ kycRef: ref }); } catch { /* ignore */ }
  },

  toggleMode: () => {
    const { role, activeMode } = get();
    if (role === 'staff') return;                                              // HARD LOCK — staff can never switch
    if (role === 'consumer') { set({ role: 'organizer', activeMode: 'organizer' }); return; } // demo self-promote (real: KYC onboarding)
    set({ activeMode: activeMode === 'consumer' ? 'organizer' : 'consumer' });
  },

  signOut: () => {
    AsyncStorage.removeItem(KYC_REF_KEY).catch(() => {});
    set({ role: null, activeMode: 'consumer', verified: false, kycPending: false, kycRef: null, kycRejection: null });
  },
}));
