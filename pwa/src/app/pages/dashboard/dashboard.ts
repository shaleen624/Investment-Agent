import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { UpperCasePipe }       from '@angular/common';
import { RouterLink }          from '@angular/router';
import { catchError, of, forkJoin } from 'rxjs';
import { ApiService }          from '../../core/services/api.service';
import { MetricCardComponent } from '../../shared/components/metric-card/metric-card';
import { DonutChartComponent, DonutSlice } from '../../shared/components/donut-chart/donut-chart';
import { InrPipe }             from '../../shared/pipes/inr.pipe';
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

interface IndexRow {
  key:           string;
  label:         string;
  value:         number | null;
  change:        number | null;
  changePercent: number | null;
  prevClose:     number | null;
  isUp:          boolean;
  isDown:        boolean;
}

@Component({
  selector:   'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports:    [UpperCasePipe, InrPipe, RouterLink, MetricCardComponent, DonutChartComponent],
  templateUrl: './dashboard.html',
  styleUrl:    './dashboard.scss',
})
export class DashboardPage {
  private api = inject(ApiService);

  loading = signal(true);
  error   = signal<string | null>(null);

  summary = signal<PortfolioSummary | null>(null);
  market  = signal<MarketSnapshot | null>(null);
  recs    = signal<Recommendation[]>([]);
  news    = signal<NewsArticle[]>([]);

  donutSlices = computed<DonutSlice[]>(() => {
    const s = this.summary();
    if (!s?.byType) return [];
    return Object.entries(s.byType)
      .filter(([, v]) => v.current > 0)
      .sort(([, a], [, b]) => b.current - a.current)
      .map(([type, v]) => ({
        label: type.replace('_', ' '),
        value: v.current,
        color: TYPE_COLORS[type] ?? '#94a3b8',
      }));
  });

  pnlClass = computed(() => (this.summary()?.pnlPercent ?? 0) >= 0 ? 'positive' : 'negative');
  pnlSign  = computed(() => (this.summary()?.pnlPercent ?? 0) >= 0 ? '+' : '');

  indices = computed<IndexRow[]>(() => {
    const m = this.market();
    if (!m) return [];
    const rd = m.raw_data ?? {};

    const build = (key: string, label: string, value: number | null): IndexRow => {
      // raw_data keys use camelCase from Yahoo Finance
      const rawKey = {
        nifty50:   'nifty50',   sensex:    'sensex',   nifty_bank: 'niftyBank',
        dow_jones: 'dowJones',  nasdaq:    'nasdaq',   sp500:      'sp500',
        usd_inr:   'usdInr',    gold_mcx:  'goldMcx',  crude_mcx: 'crudeMcx',
        vix:       'vix',
      }[key] ?? key;
      const raw = rd[rawKey] ?? rd[key] ?? {} as any;
      const chg  = raw.change        ?? null;
      const pct  = raw.changePercent ?? null;
      const prev = raw.prevClose      ?? null;
      return { key, label, value, change: chg, changePercent: pct, prevClose: prev,
               isUp: (pct ?? 0) > 0, isDown: (pct ?? 0) < 0 };
    };

    return [
      build('nifty50',   'NIFTY 50',   m.nifty50),
      build('sensex',    'SENSEX',     m.sensex),
      build('nifty_bank','BANK NIFTY', m.nifty_bank),
      build('dow_jones', 'DOW JONES',  m.dow_jones),
      build('nasdaq',    'NASDAQ',     m.nasdaq),
      build('sp500',     'S&P 500',    m.sp500),
      build('usd_inr',   'USD / INR',  m.usd_inr),
      build('gold_mcx',  'GOLD',       m.gold_mcx),
      build('crude_mcx', 'CRUDE OIL',  m.crude_mcx),
      build('vix',       'INDIA VIX',  m.vix),
    ].filter(i => i.value != null);
  });

  marketWarning = computed(() => (this.market() as any)?._warning as string | undefined);
  marketDate    = computed(() => this.market()?.date ?? null);

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
      error: () => {
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

  formatValue(idx: IndexRow): string {
    const v = idx.value;
    if (v == null) return '—';
    if (v > 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  formatChange(idx: IndexRow): string {
    const pct = idx.changePercent;
    if (pct == null) return '';
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
  }

  formatAbsChange(idx: IndexRow): string {
    const c = idx.change;
    if (c == null) return '';
    const sign = c >= 0 ? '+' : '';
    if (Math.abs(c) >= 1000) return `${sign}${c.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    return `${sign}${c.toFixed(2)}`;
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
