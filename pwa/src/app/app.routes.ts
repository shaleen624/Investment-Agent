import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '',          redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardPage) },
  { path: 'holdings',  loadComponent: () => import('./pages/holdings/holdings').then(m => m.HoldingsPage) },
  { path: 'sip',       loadComponent: () => import('./pages/sip/sip').then(m => m.SipPage) },
  { path: 'briefs',    loadComponent: () => import('./pages/briefs/briefs').then(m => m.BriefsPage) },
  { path: 'goals',     loadComponent: () => import('./pages/goals/goals').then(m => m.GoalsPage) },
  { path: 'market',    loadComponent: () => import('./pages/market/market').then(m => m.MarketPage) },
  { path: 'settings',  loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsPage) },
  { path: '**',        redirectTo: 'dashboard' },
];
