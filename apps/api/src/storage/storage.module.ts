import { Global, Module } from '@nestjs/common';
import { EntityStore } from './entity-store';
import { OrganizerRepo } from './organizer-repo';
import { SupabaseStorage } from './supabase-storage.service';

/* Global so every feature module injects the same store services. */
@Global()
@Module({
  providers: [EntityStore, OrganizerRepo, SupabaseStorage],
  exports: [EntityStore, OrganizerRepo, SupabaseStorage],
})
export class StorageModule {}
