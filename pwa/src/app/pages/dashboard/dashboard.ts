import { Component, inject, signal, computed } from '@angular/core';
import { UpperCasePipe }                       from '@angular/common';
import { RouterLink }                          from '@angular/router';
import { toSignal }                            from '@angular/core/rxjs-interop';
import { catchError, of, forkJoin }            from 'rxjs';
import { ApiService }                          from '../../core/services/api.service';
import { MetricCardComponent }                 from '../../shared/components/metric-card/metric-card';
import { DonutChartComponent, DonutSlice }     from '../../shared/components/donut-chart/donut-chart';
import { InrPipe }                             from '../../shared/pipes/inr.pipe';
import type { PortfolioSummary, MarketSnapshot, Recommendation, NewsArticle } from '../../core/models';

const TYPE_COLORS: Record<string, string> = {
  equity:      '#6366f1',
  mutual_fund: '#22d3ee',
  etf:         '#a78bfa',
  bond:        '#34d399',
  fd:          '#fbbf24',
  nps:         '#f472b6',
  crypto:      '#fb923c',
  us_stock:    '#60a5fa',
  other:       '#94a3b8',
};

@Component({
  selector:   'app-dashboard',
  standalone: true,
  imports:    [UpperCasePipe, InrPipe, RouterLink, MetricCardComponent, DonutChartComponent],
  templateUrl: './dashboard.html',
  styleUrl:    './dashboard.scss',
})
export class DashboardPage {
  private api = inject(ApiService);

  loading  = signal(true);
  error    = signal<string | null>(null);

  summary  = signal<PortfolioSummary | null>(null);
  market   = signal<MarketSnapshot | null>(null);
  recs     = signal<Recommendation[]>([]);
  news     = signal<NewsArticle[]>([]);

  donutSlices = computed<DonutSlice[]>(() => {
    const s = this.summary();
    if (!s) return [];
    return Object.entries(s.byType)
      .filter(([, v]) => v.current > 0)
      .sort(([, a], [, b]) => b.current - a.current)
      .map(([type, v]) => ({
        label: type.replace('_', ' '),
        value: v.current,
        color: TYPE_COLORS[type] ?? '#94a3b8',
      }));
  });

  pnlClass = computed(() => {
    const s = this.summary();
    if (!s) return '';
    return s.pnlPercent >= 0 ? 'positive' : 'negative';
  });

  pnlSign = computed(() => {
    const s = this.summary();
    if (!s) return '';
    return s.pnlPercent >= 0 ? '+' : '';
  });

  indices = computed(() => {
    const m = this.market();
    if (!m) return [];
    return [
      { label: 'NIFTY 50',   value: m.nifty50,    key: 'nifty50' },
      { label: 'SENSEX',     value: m.sensex,      key: 'sensex' },
      { label: 'BANK NIFTY', value: m.nifty_bank,  key: 'nifty_bank' },
      { label: 'DOW',        value: m.dow_jones,   key: 'dow_jones' },
      { label: 'NASDAQ',     value: m.nasdaq,      key: 'nasdaq' },
      { label: 'S&P 500',    value: m.sp500,       key: 'sp500' },
      { label: 'USD/INR',    value: m.usd_inr,     key: 'usd_inr' },
      { label: 'GOLD',       value: m.gold_mcx,    key: 'gold_mcx' },
    ].filter(i => i.value != null);
  });

  constructor() {
    forkJoin({
      summary: this.api.portfolioSummary().pipe(catchError(() => of(null))),
      market:  this.api.marketSnapshot().pipe(catchError(() => of(null))),
      recs:    this.api.recommendations(5).pipe(catchError(() => of([]))),
      news:    this.api.news(5, 24).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ summary, market, recs, news }) => {
        this.summary.set(summary);
        this.market.set(market);
        this.recs.set(recs as Recommendation[]);
        this.news.set(news as NewsArticle[]);
        this.loading.set(false);
      },
      error: err => {
        this.error.set('Failed to load dashboard data.');
        this.loading.set(false);
      },
    });
  }

  actionClass(action: string) {
    if (['buy', 'increase'].includes(action)) return 'positive';
    if (['sell', 'reduce'].includes(action))  return 'negative';
    return 'neutral';
  }

  sentimentClass(s: string | null) {
    if (s === 'positive') return 'positive';
    if (s === 'negative') return 'negative';
    return 'neutral';
  }

  formatIndex(v: number | null) {
    if (v == null) return '—';
    if (v > 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
  }
}
