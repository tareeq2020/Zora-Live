import { Global, Module } from '@nestjs/common';
import { EntityStore } from './entity-store';
import { SupabaseStorage } from './supabase-storage.service';

/* Global so every feature module injects the same store services. */
@Global()
@Module({
  providers: [EntityStore, SupabaseStorage],
  exports: [EntityStore, SupabaseStorage],
})
export class StorageModule {}
