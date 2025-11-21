export type GmailHeaderMap = Record<string, string>;

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

export type ActionItem = {
  title: string;
  owner?: string;
  dueDate?: string;
  priority?: string;
};

export type TradingSignal = {
  symbol: string;
  direction: "LONG" | "SHORT" | "NEUTRAL" | "STAY_OUT";
  entry?: string;
  stopLoss?: string;
  takeProfits?: string[];
  reason?: string;
  timeframe?: string; // Ví dụ: 1h, 4h, 15m
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
