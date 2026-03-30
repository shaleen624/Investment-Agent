import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector:   'app-metric-card',
  standalone: true,
  imports:    [NgClass],
  template: `
    <div class="metric-card" [class.loading]="loading">
      <div class="metric-label">{{ label }}</div>
      @if (loading) {
        <div class="skeleton" style="height:28px;width:70%;margin:6px 0"></div>
        <div class="skeleton" style="height:14px;width:40%"></div>
      } @else {
        <div class="metric-value">{{ value }}</div>
        @if (sub) {
          <div class="metric-sub" [ngClass]="subClass">{{ sub }}</div>
        }
      }
    </div>
  `,
  styles: [`
    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 16px;
      backdrop-filter: blur(12px);
    }
    .metric-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }
    .metric-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      font-feature-settings: "tnum";
      line-height: 1.2;
    }
    .metric-sub {
      font-size: 13px;
      font-weight: 500;
      margin-top: 4px;
      color: var(--text-muted);
      &.positive { color: var(--green); }
      &.negative { color: var(--red); }
    }
  `],
})
export class MetricCardComponent {
  @Input() label    = '';
  @Input() value    = '';
  @Input() sub      = '';
  @Input() subClass = '';
  @Input() loading  = false;
}
