import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'inr', standalone: true })
export class InrPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-IN', {
      style:                 'currency',
      currency:              'INR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
}
