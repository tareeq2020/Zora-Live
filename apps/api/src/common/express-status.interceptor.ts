import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/* Express returns 200 for POST handlers that send a body; Nest defaults them to
   201 Created. The legacy server never returns 201, so for byte-for-byte parity
   we normalize the framework's implicit POST-201 back to 200.

   Only the *implicit* 201 flips: handlers using @Res set their own status, thrown
   HttpExceptions carry their own code, and an explicit @HttpCode(201) would still
   land as 201 (none exist today). Applied globally in main.ts. */
@Injectable()
export class ExpressStatusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => {
        if (res.statusCode === 201) res.statusCode = 200;
      }),
    );
  }
}
