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
  owner?: string | undefined;
  dueDate?: string | undefined;
  priority?: string | undefined;
};

export type TradingSignal = {
  symbol: string;
  direction: "LONG" | "SHORT" | "NEUTRAL" | "STAY_OUT";
  entry?: string | undefined;
  stopLoss?: string | undefined;
  takeProfits?: string[];
  reason?: string | undefined;
  timeframe?: string | undefined; // Ví dụ: 1h, 4h, 15m
  entryScore?: number | undefined; // Điểm đánh giá vào lệnh (0-100) - càng cao càng tốt
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
