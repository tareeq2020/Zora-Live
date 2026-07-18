import { Global, Module } from '@nestjs/common';
import { FileStore } from './file-store.service';
import { EntityStore } from './entity-store';

/* Global so every feature module injects the same FileStore / EntityStore. */
@Global()
@Module({
  providers: [FileStore, EntityStore],
  exports: [FileStore, EntityStore],
})
export class StorageModule {}
