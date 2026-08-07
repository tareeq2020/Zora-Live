import { Global, Module } from '@nestjs/common';
import { EntityStore } from './entity-store';
import { ScannerUserRepo } from './scanner-user.repo';
import { OrganizerRepo } from './organizer-repo';
import { SupabaseStorage } from './supabase-storage.service';

/* Global so every feature module injects the same store services. */
@Global()
@Module({
  providers: [EntityStore, OrganizerRepo, ScannerUserRepo, SupabaseStorage],
  exports: [EntityStore, OrganizerRepo, ScannerUserRepo, SupabaseStorage],
})
export class StorageModule {}
