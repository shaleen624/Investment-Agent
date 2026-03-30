import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError }   from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError(err => {
      console.error('[HTTP]', req.url, err.status, err.error?.error || err.message);
      return throwError(() => err);
    })
  );
};
