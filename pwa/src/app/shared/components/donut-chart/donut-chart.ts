import {
  Component, Input, OnChanges, ViewChild,
  ElementRef, AfterViewInit, OnDestroy,
} from '@angular/core';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector:   'app-donut-chart',
  standalone: true,
  template: `
    <div class="donut-wrap">
      <canvas #canvas></canvas>
      <div class="donut-legend">
        @for (s of slices; track s.label) {
          <div class="legend-item">
            <span class="legend-dot" [style.background]="s.color"></span>
            <span class="legend-label">{{ s.label }}</span>
            <span class="legend-pct">{{ pct(s) }}%</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .donut-wrap { display: flex; flex-direction: column; gap: 16px; align-items: center; }
    canvas { max-width: 180px; max-height: 180px; }
    .donut-legend { width: 100%; display: flex; flex-direction: column; gap: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .legend-label { flex: 1; color: var(--text-secondary); text-transform: capitalize; }
    .legend-pct { font-weight: 600; color: var(--text-primary); font-feature-settings: "tnum"; }
    @media (min-width: 600px) {
      .donut-wrap { flex-direction: row; align-items: flex-start; }
      canvas { max-width: 160px; max-height: 160px; flex-shrink: 0; }
    }
  `],
})
export class DonutChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() slices: DonutSlice[] = [];
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  private ctx: CanvasRenderingContext2D | null = null;
  private total = 0;

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d');
    this.draw();
  }

  ngOnChanges() {
    this.total = this.slices.reduce((s, x) => s + x.value, 0);
    if (this.ctx) this.draw();
  }

  ngOnDestroy() {}

  pct(s: DonutSlice) {
    return this.total ? ((s.value / this.total) * 100).toFixed(1) : '0.0';
  }

  private draw() {
    if (!this.ctx || !this.slices.length) return;
    const canvas = this.canvasRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const size = 180;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = this.ctx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, r = 70, hole = 45;
    let angle = -Math.PI / 2;

    for (const slice of this.slices) {
      const sweep = this.total ? (slice.value / this.total) * Math.PI * 2 : 0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      angle += sweep;
    }

    // hollow center
    ctx.beginPath();
    ctx.arc(cx, cy, hole, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1523';
    ctx.fill();
  }
}
