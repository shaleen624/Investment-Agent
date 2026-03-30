import { Component, inject, signal, computed } from '@angular/core';
import { NgClass, UpperCasePipe }             from '@angular/common';
import { FormsModule }                         from '@angular/forms';
import { ApiService }                          from '../../core/services/api.service';
import { InrPipe }                             from '../../shared/pipes/inr.pipe';
import type { Holding }                        from '../../core/models';
import { catchError, of }                      from 'rxjs';

type AssetType = Holding['asset_type'];

const ASSET_TYPES: AssetType[] = [
  'equity','mutual_fund','etf','bond','fd','nps','crypto','us_stock','other'
];

@Component({
  selector:    'app-holdings',
  standalone:  true,
  imports:     [NgClass, UpperCasePipe, FormsModule, InrPipe],
  templateUrl: './holdings.html',
  styleUrl:    './holdings.scss',
})
export class HoldingsPage {
  private api = inject(ApiService);

  holdings  = signal<Holding[]>([]);
  loading   = signal(true);
  error     = signal<string | null>(null);
  filter    = signal<string>('all');
  search    = signal('');
  showModal = signal(false);
  saving    = signal(false);
  importing = signal(false);
  importMode = signal<'text'|'file'>('text');
  importText = signal('');
  importError = signal<string|null>(null);
  showImport  = signal(false);

  editingHolding = signal<Partial<Holding>>({});
  isEditing      = signal(false);

  assetTypes = ASSET_TYPES;

  filtered = computed(() => {
    let list = this.holdings();
    if (this.filter() !== 'all') list = list.filter(h => h.asset_type === this.filter());
    const q = this.search().toLowerCase();
    if (q) list = list.filter(h =>
      h.name.toLowerCase().includes(q) ||
      (h.symbol ?? '').toLowerCase().includes(q)
    );
    return list;
  });

  totalInvested = computed(() => this.filtered().reduce((s, h) => s + h.invested_amount, 0));
  totalCurrent  = computed(() => this.filtered().reduce((s, h) => s + (h.current_value ?? 0), 0));
  totalPnl      = computed(() => this.totalCurrent() - this.totalInvested());

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.holdings().pipe(catchError(() => of([]))).subscribe(h => {
      this.holdings.set(h);
      this.loading.set(false);
    });
  }

  openAdd() {
    this.editingHolding.set({ asset_type: 'equity', broker: '', exchange: 'NSE' });
    this.isEditing.set(false);
    this.showModal.set(true);
  }

  openEdit(h: Holding) {
    this.editingHolding.set({ ...h });
    this.isEditing.set(true);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingHolding.set({});
  }

  save() {
    const h = this.editingHolding();
    if (!h.name || !h.quantity || !h.avg_buy_price) return;
    this.saving.set(true);
    const obs = this.isEditing() && h.id
      ? this.api.updateHolding(h.id, h)
      : this.api.addHolding(h);
    obs.subscribe({
      next: () => { this.saving.set(false); this.closeModal(); this.load(); },
      error: () => this.saving.set(false),
    });
  }

  delete(h: Holding) {
    if (!confirm(`Delete ${h.name}?`)) return;
    this.api.deleteHolding(h.id).subscribe(() => this.load());
  }

  refreshPrices() {
    this.loading.set(true);
    this.api.refreshPrices().subscribe({ next: () => this.load(), error: () => this.loading.set(false) });
  }

  doImportText() {
    if (!this.importText()) return;
    this.importing.set(true);
    this.importError.set(null);
    this.api.importText(this.importText()).subscribe({
      next: res => {
        this.importing.set(false);
        this.showImport.set(false);
        this.importText.set('');
        this.load();
        alert(`Imported ${res.parsed} holdings`);
      },
      error: () => { this.importing.set(false); this.importError.set('Import failed'); },
    });
  }

  doImportFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.importing.set(true);
    this.importError.set(null);
    this.api.importFile(file).subscribe({
      next: res => {
        this.importing.set(false);
        this.showImport.set(false);
        this.load();
        alert(`Imported ${res.parsed} holdings`);
      },
      error: () => { this.importing.set(false); this.importError.set('Import failed'); },
    });
  }

  pnlClass(h: Holding) {
    if (h.unrealized_pnl == null) return '';
    return h.unrealized_pnl >= 0 ? 'positive' : 'negative';
  }

  pnlSign(h: Holding) {
    return (h.unrealized_pnl ?? 0) >= 0 ? '+' : '';
  }

  set editField(pair: { key: keyof Holding, value: any }) {
    this.editingHolding.update(h => ({ ...h, [pair.key]: pair.value }));
  }
}
