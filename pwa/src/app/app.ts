import { Component }        from '@angular/core';
import { RouterOutlet }     from '@angular/router';
import { NavComponent }     from './shared/components/nav/nav';

@Component({
  selector:    'app-root',
  standalone:  true,
  imports:     [RouterOutlet, NavComponent],
  template: `
    <div class="app-shell">
      <app-nav />
      <main class="page-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    .app-shell {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      background: var(--bg-primary);
    }
    .page-content {
      flex: 1;
      padding-bottom: calc(var(--nav-height) + env(safe-area-inset-bottom));
      overflow-x: hidden;
    }
    @media (min-width: 1024px) {
      .app-shell      { flex-direction: row; }
      .page-content   { padding-bottom: 0; padding-left: var(--sidebar-width); }
    }
  `],
})
export class App {}
