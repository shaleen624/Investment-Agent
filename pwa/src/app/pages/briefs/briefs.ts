import { Component, inject, signal, computed } from '@angular/core';
import { UpperCasePipe }                       from '@angular/common';
import { ApiService }                          from '../../core/services/api.service';
import type { Brief, Recommendation }          from '../../core/models';
import { catchError, of }                       from 'rxjs';

@Component({
  selector:    'app-briefs',
  standalone:  true,
  imports:     [UpperCasePipe],
  templateUrl: './briefs.html',
  styleUrl:    './briefs.scss',
})
export class BriefsPage {
  private api = inject(ApiService);

  tab       = signal<'morning'|'evening'>('morning');
  briefs    = signal<Brief[]>([]);
  selected  = signal<Brief | null>(null);
  recs      = signal<Recommendation[]>([]);
  loading   = signal(true);
  recsLoading = signal(false);
  generating  = signal(false);
  genError    = signal<string|null>(null);

  filtered = computed(() =>
    this.briefs().filter(b => b.type === this.tab())
  );

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.briefs(undefined, 30).pipe(catchError(() => of([]))).subscribe(b => {
      this.briefs.set(b);
      this.loading.set(false);
      if (!this.selected() && this.filtered().length) {
        this.selectBrief(this.filtered()[0]);
      }
    });
  }

  switchTab(t: 'morning'|'evening') {
    this.tab.set(t);
    this.selected.set(null);
    this.recs.set([]);
    if (this.filtered().length) this.selectBrief(this.filtered()[0]);
  }

  selectBrief(b: Brief) {
    this.selected.set({ ...b, content: b.content || '' });
    this.recs.set([]);
    this.recsLoading.set(true);

    this.api.brief(b.id).pipe(catchError(() => of(null))).subscribe(full => {
      if (full) this.selected.set(full);
    });

    this.api.briefRecommendations(b.id).pipe(catchError(() => of([]))).subscribe(r => {
      this.recs.set(r);
      this.recsLoading.set(false);
    });
  }

  generate() {
    this.generating.set(true);
    this.genError.set(null);
    this.api.generateBrief(this.tab(), true).subscribe({
      next: () => { this.generating.set(false); this.load(); },
      error: () => {
        this.generating.set(false);
        this.genError.set('Failed to generate brief. Is the LLM configured?');
      },
    });
  }

  renderMarkdown(md?: string | null): string {
    const text = (md || '').toString();
    if (!text.trim()) return '<p class="muted">No brief content available.</p>';

    // Simple markdown → HTML (no dependency)
    return text
      .replace(/^### (.+)$/gm,   '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,    '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,     '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>')
      .replace(/^\s*[-*] (.+)$/gm,'<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
      .replace(/\n\n/g,           '<br><br>')
      .replace(/\n/g,             '<br>');
  }

  formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  actionClass(action: string) {
    if (['buy', 'increase'].includes(action)) return 'positive';
    if (['sell', 'reduce'].includes(action))  return 'negative';
    return 'neutral';
  }
}
