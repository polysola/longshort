export type GmailHeaderMap = Record<string, string>;

// ═══════════════════════════════════════════════════════════
// LEGACY: Gmail types (giữ lại để backward compatible)
// ═══════════════════════════════════════════════════════════
export type NormalizedMail = {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  to: string;
  date: string;
  plainText: string;
  htmlText: string;
  headers: GmailHeaderMap;
};

// ═══════════════════════════════════════════════════════════
// NEW: API Report types (từ https://first.fsignal.xyz/api/reports)
// ═══════════════════════════════════════════════════════════

/**
 * Symbol snapshot từ API (chứa indicators, plan, etc.)
 */
export type SymbolSnapshot = {
  symbol: string;
  timeframe: string;
  timestamp: string;
  price: number;
  state: {
    trend: string;
    momentum: string;
    volatility: string;
    bb_position: string;
    volume_trend: string;
    signal: string;
    bias: string;
    regime: string;
    ichimoku_state: string;
  };
  indicators: {
    rsi: number;
    macd_hist: number;
    adx: number;
    "+di": number;
    "-di": number;
    atr: number;
    bb_bw: number;
    kdj_j: number;
    cmf: number;
    vwap: number;
    supertrend: number;
  };
  classification: {
    label: string;
    confidence: number;
  };
  sr: {
    fractal_high: number;
    fractal_low: number;
  };
  flags: {
    adx_is_strong: boolean;
    trend_momentum_aligned: boolean;
    trend_momentum_conflict: boolean;
    plus_di_stronger: boolean;
    minus_di_stronger: boolean;
  };
  plan: {
    side: string;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    rr1: number;
    rr2: number;
    rr3: number;
    entry_source: string;
    classification_label: string;
    classification_confidence: number;
  };
  entry_analysis: {
    entry_price: number;
    entry_type: string;
    distance_atr: number;
    is_far_from_price: boolean;
  };
};

export type SymbolIndicator = {
  symbol: string;
  snapshots: SymbolSnapshot[];
};

/**
 * Raw report từ API list (/api/reports)
 */
export type RawReportListItem = {
  _id: string;
  created_at: string;
  report_type: string;
  symbols?: string[];
  status?: string;
  completed_at?: string;
};

/**
 * Raw report chi tiết từ API (/api/reports/{id})
 * Chứa trường markdown với đầy đủ thông tin
 */
export type RawReportDetail = {
  _id: string;
  markdown: string; // Full markdown với tables chi tiết
  created_at?: string;
  report_type?: string;
  symbols?: string[];
  metadata?: {
    mail_title?: string;
    start_time?: string;
    num_symbol_lists?: number;
  };
};

/**
 * Raw report từ API (backward compatible)
 */
export type RawReport = {
  _id: string;
  created_at: string;
  markdown?: string; // Từ API chi tiết
  sections_markdown?: string[];
  symbol_indicators?: SymbolIndicator[];
  symbols?: string[];
  report_type: string;
  metadata?: {
    mail_title?: string;
    start_time?: string;
    num_symbol_lists?: number;
  };
  content_length?: number;
  status?: string;
  completed_at?: string;
};

/**
 * Normalized report để dùng trong app
 * Tương thích với NormalizedMail để code cũ vẫn hoạt động
 */
export type NormalizedReport = {
  id: string;
  subject: string;
  from: string;
  date: string;
  rawDate: string; // ISO string gốc
  symbols: string[];
  sectionsMarkdown: string[];
  symbolIndicators: SymbolIndicator[];
  reportType: string;
  metadata?: RawReport["metadata"];
  // Các field tương thích với NormalizedMail
  plainText: string;
  htmlText: string;
  snippet: string;
};

// ═══════════════════════════════════════════════════════════
// Trading Signal types
// ═══════════════════════════════════════════════════════════

export type ActionItem = {
  title: string;
  owner?: string | undefined;
  dueDate?: string | undefined;
  priority?: string | undefined;
};

export type TradingSignal = {
  symbol: string;
  direction: "LONG" | "SHORT" | "NEUTRAL" | "STAY_OUT";
  entry?: string | undefined;       // Giá Entry (Trigger hoặc Price)
  stopLoss?: string | undefined;    // Stop Loss
  takeProfits?: string[];           // [TP1, TP2, TP3]
  reason?: string | undefined;      // Lý do / Notes
  timeframe?: string | undefined;   // 1h, 4h, 15m
  entryScore?: number | undefined;  // Điểm đánh giá vào lệnh (0-100)
  // Thông tin chi tiết từ API
  price?: string | undefined;       // Giá hiện tại
  trigger?: string | undefined;     // Giá trigger
  entryType?: string | undefined;   // limit_pullback, stop_breakout, market_now
  scenario?: string | undefined;    // A, B, C, D, F1, F2, F3, G
  edgeScore?: number | undefined;   // EdgeScore từ API (0-7)
  rr?: string | undefined;          // Risk:Reward ratio (VD: "1.30/2.50/4.00")
  nearestSupport?: string | undefined;  // Nearest support levels
  nearestResist?: string | undefined;   // Nearest resistance levels
};

export type AnalysisResult = {
  mailId: string;
  subject: string;
  sender: string;
  summary: string;
  actionItems: ActionItem[];
  dueDate?: string;
  confidence: number;
  signals: TradingSignal[]; // Danh sách tín hiệu cho nhiều coin
};
