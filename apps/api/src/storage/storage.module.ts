import { Global, Module } from '@nestjs/common';
import { EntityStore } from './entity-store';
import { ScannerUserRepo } from './scanner-user.repo';
import { OrganizerRepo } from './organizer-repo';
import { AuthUsersRepo } from './auth-users.repo';
import { OrgMembersRepo } from './org-members.repo';
import { SupabaseStorage } from './supabase-storage.service';

/* Global so every feature module injects the same store services. */
@Global()
@Module({
  providers: [EntityStore, OrganizerRepo, AuthUsersRepo, OrgMembersRepo, ScannerUserRepo, SupabaseStorage],
  exports: [EntityStore, OrganizerRepo, AuthUsersRepo, OrgMembersRepo, ScannerUserRepo, SupabaseStorage],
})
export class StorageModule {}
