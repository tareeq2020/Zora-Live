import { Global, Module } from '@nestjs/common';
import { FileStore } from './file-store.service';
import { EntityStore } from './entity-store';
import { SupabaseStorage } from './supabase-storage.service';

/* Global so every feature module injects the same store services. */
@Global()
@Module({
  providers: [FileStore, EntityStore, SupabaseStorage],
  exports: [FileStore, EntityStore, SupabaseStorage],
})
export class StorageModule {}
