import { Global, Module } from '@nestjs/common';
import { FileStore } from './file-store.service';

/* Global so every feature module injects the same FileStore without re-importing. */
@Global()
@Module({
  providers: [FileStore],
  exports: [FileStore],
})
export class StorageModule {}
