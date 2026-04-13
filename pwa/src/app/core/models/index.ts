export interface Holding {
  id:              number;
  asset_type:      'equity'|'mutual_fund'|'etf'|'bond'|'fd'|'nps'|'crypto'|'us_stock'|'other';
  symbol:          string | null;
  name:            string;
  exchange:        string;
  quantity:        number;
  avg_buy_price:   number;
  current_price:   number | null;
  current_value:   number | null;
  invested_amount: number;
  unrealized_pnl:  number | null;
  pnl_percent:     number | null;
  sector:          string | null;
  broker:          string;
  last_updated:    string;
}

export interface AllocationByType {
  [type: string]: { invested: number; current: number; count: number };
}

export interface PortfolioSummary {
  totalInvested:  number;
  totalCurrent:   number;
  unrealizedPnl:  number;
  pnlPercent:     number;
  holdingsCount:  number;
  xirr:           number | null;
  byType:         AllocationByType;
  bySector:       { [sector: string]: { invested: number; current: number } };
  holdings:       Holding[];
}

export interface Goal {
  id:             number;
  type:           'short_term' | 'long_term';
  title:          string;
  description:    string | null;
  target_amount:  number | null;
  target_date:    string | null;
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  priority:       number;
  is_active:      number;
  created_at:     string;
}

export interface Brief {
  id:              number;
  type:            'morning' | 'evening';
  date:            string;
  content:         string;
  summary:         string | null;
  sent_channels:   string[];
  market_snapshot: Record<string, number>;
  created_at:      string;
}

export interface MarketSnapshot {
  id:         number;
  date:       string;
  time:       string;
  nifty50:    number | null;
  sensex:     number | null;
  nifty_bank: number | null;
  dow_jones:  number | null;
  nasdaq:     number | null;
  sp500:      number | null;
  usd_inr:    number | null;
  vix:        number | null;
  gold_mcx:   number | null;
  crude_mcx:  number | null;
  raw_data:   Record<string, { name: string; price: number; change: number; changePercent: number }>;
}

export interface NewsArticle {
  id:          number;
  source:      string;
  title:       string;
  url:         string;
  summary:     string | null;
  sentiment:   'positive' | 'negative' | 'neutral' | null;
  impact_score:number;
  published_at:string;
}

export interface Recommendation {
  id:           number;
  symbol:       string;
  name:         string;
  action:       'buy'|'sell'|'hold'|'increase'|'reduce'|'watch';
  rationale:    string;
  confidence:   number;
  time_horizon: 'intraday'|'short_term'|'long_term';
  target_price: number | null;
  stop_loss:    number | null;
  date:         string;
}

export interface NotificationLogEntry {
  id:         number;
  channel:    string;
  recipient:  string | null;
  status:     string;
  message:    string;
  error:      string | null;
  sent_at:    string;
}

export interface AgentStatus {
  ok:            boolean;
  llm:           { provider: string; available: boolean };
  notifications: { channels: string[]; telegram: boolean; email: boolean; whatsapp: boolean };
  schedule:      { morningTime: string; eveningTime: string; timezone: string };
  portfolio:     { holdings: number; totalInvested: number; totalCurrent: number; pnlPercent: number } | null;
  goals:         number;
  warnings:      string[];
  briefs:        { lastMorning: string | null; lastEvening: string | null };
}
