import { Component, inject, signal, computed } from '@angular/core';
import { NgClass }                             from '@angular/common';
import { ApiService }                          from '../../core/services/api.service';
import type { MarketSnapshot, Recommendation, NewsArticle } from '../../core/models';
import { catchError, of, forkJoin }            from 'rxjs';

@Component({
  selector:    'app-market',
  standalone:  true,
  imports:     [NgClass],
  templateUrl: './market.html',
  styleUrl:    './market.scss',
})
export class MarketPage {
  private api = inject(ApiService);

  snapshot  = signal<MarketSnapshot | null>(null);
  recs      = signal<Recommendation[]>([]);
  news      = signal<NewsArticle[]>([]);
  loading   = signal(true);
  refreshing = signal(false);
  newsHours  = signal(24);
  newsFilter = signal<'all'|'positive'|'negative'|'neutral'>('all');

  filteredNews = computed(() => {
    const f = this.newsFilter();
    if (f === 'all') return this.news();
    return this.news().filter(n => n.sentiment === f);
  });

  indices = computed(() => {
    const m = this.snapshot();
    if (!m) return [];
    const raw = m.raw_data ?? {};
    const entries = Object.entries(raw).map(([key, v]) => ({
      key, label: v.name, price: v.price,
      change: v.change, pct: v.changePercent,
    }));
    if (entries.length) return entries;
    // fallback to known fields
    return [
      { key: 'nifty50',   label: 'NIFTY 50',   price: m.nifty50,   change: 0, pct: 0 },
      { key: 'sensex',    label: 'SENSEX',      price: m.sensex,    change: 0, pct: 0 },
      { key: 'niftybank', label: 'BANK NIFTY',  price: m.nifty_bank,change: 0, pct: 0 },
      { key: 'dow',       label: 'DOW JONES',   price: m.dow_jones, change: 0, pct: 0 },
      { key: 'nasdaq',    label: 'NASDAQ',       price: m.nasdaq,   change: 0, pct: 0 },
      { key: 'sp500',     label: 'S&P 500',      price: m.sp500,    change: 0, pct: 0 },
      { key: 'usdinr',    label: 'USD/INR',      price: m.usd_inr,  change: 0, pct: 0 },
      { key: 'gold',      label: 'GOLD MCX',     price: m.gold_mcx, change: 0, pct: 0 },
      { key: 'crude',     label: 'CRUDE MCX',    price: m.crude_mcx,change: 0, pct: 0 },
      { key: 'vix',       label: 'VIX',          price: m.vix,      change: 0, pct: 0 },
    ].filter(i => i.price != null);
  });

  constructor() { this.loadAll(); }

  loadAll() {
    this.loading.set(true);
    forkJoin({
      snapshot: this.api.marketSnapshot().pipe(catchError(() => of(null))),
      recs:     this.api.recommendations(20).pipe(catchError(() => of([]))),
      news:     this.api.news(50, this.newsHours()).pipe(catchError(() => of([]))),
    }).subscribe(({ snapshot, recs, news }) => {
      this.snapshot.set(snapshot);
      this.recs.set(recs as Recommendation[]);
      this.news.set(news as NewsArticle[]);
      this.loading.set(false);
    });
  }

  refreshMarket() {
    this.refreshing.set(true);
    this.api.refreshMarket().subscribe({
      next: () => { this.refreshing.set(false); this.loadAll(); },
      error: () => this.refreshing.set(false),
    });
  }

  fetchNews() {
    this.api.fetchNews().subscribe(() => {
      this.api.news(50, this.newsHours()).pipe(catchError(() => of([]))).subscribe(n => this.news.set(n));
    });
  }

  formatNum(v: number | null | undefined) {
    if (v == null) return '—';
    if (Math.abs(v) > 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  formatPct(v: number | null | undefined) {
    if (v == null || v === 0) return '';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  }

  pctClass(v: number | null | undefined) {
    if (!v) return '';
    return v > 0 ? 'positive' : 'negative';
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

  timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 23) return `${Math.floor(h/24)}d ago`;
    if (h > 0)  return `${h}h ago`;
    if (m > 0)  return `${m}m ago`;
    return 'just now';
  }
}
