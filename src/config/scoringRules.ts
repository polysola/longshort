/**
 * ════════════════════════════════════════════════════════════════════════════════
 * HỆ THỐNG CHẤM ĐIỂM THỐNG NHẤT - THANG 100
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * 2 LOẠI ĐIỂM:
 * 1. EdgeScore (0-100): Điểm tín hiệu kỹ thuật thuần túy
 * 2. EntryScore (0-100): Điểm vào lệnh tổng hợp (Edge + R:R + Trend + Market)
 * 
 * QUAN TRỌNG: Đây là hệ thống duy nhất - dùng cho cả Report và Chat
 */

// ════════════════════════════════════════════════════════════════════════════════
// SCORING LEVELS - Thang đánh giá mức độ
// ════════════════════════════════════════════════════════════════════════════════

export type ScoreLevel = {
  min: number;
  max: number;
  label: string;
  labelVi: string;
  emoji: string;
  description: string;
};

export const SCORE_LEVELS: ScoreLevel[] = [
  { min: 90, max: 100, label: "EXCELLENT", labelVi: "CỰC TỐT", emoji: "🔥", description: "Cơ hội vàng - Vào lệnh mạnh tay" },
  { min: 80, max: 89, label: "VERY GOOD", labelVi: "RẤT TỐT", emoji: "⚡", description: "Tín hiệu mạnh - Nên vào lệnh" },
  { min: 70, max: 79, label: "GOOD", labelVi: "TỐT", emoji: "✨", description: "Tín hiệu khá - Cân nhắc vào lệnh" },
  { min: 55, max: 69, label: "FAIR", labelVi: "KHÁ", emoji: "👍", description: "Tín hiệu trung bình - Cẩn thận" },
  { min: 40, max: 54, label: "WEAK", labelVi: "TRUNG BÌNH", emoji: "📊", description: "Tín hiệu yếu - Rủi ro cao" },
  { min: 0, max: 39, label: "POOR", labelVi: "YẾU", emoji: "⬇️", description: "Không nên vào lệnh" },
];

// Default level để tránh undefined
const DEFAULT_LEVEL: ScoreLevel = { min: 0, max: 39, label: "POOR", labelVi: "YẾU", emoji: "⬇️", description: "Không nên vào lệnh" };

/**
 * Lấy thông tin mức độ từ điểm số
 */
export const getScoreLevel = (score: number): ScoreLevel => {
  for (const level of SCORE_LEVELS) {
    if (score >= level.min && score <= level.max) {
      return level;
    }
  }
  return DEFAULT_LEVEL;
};

/**
 * Format điểm với mức độ
 * VD: "85 ⚡ RẤT TỐT" hoặc "72 ✨ TỐT"
 */
export const formatScoreWithLevel = (score: number): string => {
  const level = getScoreLevel(score);
  return `${score} ${level.emoji} ${level.labelVi}`;
};

/**
 * Lấy emoji từ điểm
 */
export const getScoreEmoji = (score: number): string => {
  return getScoreLevel(score).emoji;
};

// ════════════════════════════════════════════════════════════════════════════════
// EDGE SCORE - Điểm tín hiệu kỹ thuật (chuyển từ thang 7 → 100)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Bảng chuyển đổi EdgeScore từ thang 7 sang thang 100
 * Edge 7 rất hiếm gặp - là tín hiệu hoàn hảo
 */
const EDGE_SCORE_MAP: Record<number, { score100: number; level: string }> = {
  7: { score100: 100, level: "EXCELLENT" },  // Cực hiếm - Tín hiệu hoàn hảo
  6: { score100: 88, level: "VERY GOOD" },   // Rất tốt
  5: { score100: 73, level: "GOOD" },        // Tốt
  4: { score100: 58, level: "FAIR" },        // Khá
  3: { score100: 43, level: "WEAK" },        // Trung bình
  2: { score100: 28, level: "POOR" },        // Yếu
  1: { score100: 13, level: "POOR" },        // Rất yếu
  0: { score100: 0, level: "POOR" },         // Không có tín hiệu
};

/**
 * Chuyển đổi EdgeScore từ thang 7 → thang 100
 */
export const convertEdgeScoreTo100 = (edgeScore7: number): number => {
  const rounded = Math.min(7, Math.max(0, Math.round(edgeScore7)));
  return EDGE_SCORE_MAP[rounded]?.score100 ?? 0;
};

/**
 * Lấy mức độ từ EdgeScore (thang 7)
 */
export const getEdgeScoreLevel = (edgeScore7: number): string => {
  const rounded = Math.min(7, Math.max(0, Math.round(edgeScore7)));
  return EDGE_SCORE_MAP[rounded]?.level ?? "POOR";
};

// ════════════════════════════════════════════════════════════════════════════════
// ENTRY SCORE RULES - Quy tắc tính điểm vào lệnh
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Prompt hệ thống chấm điểm - DÙNG CHUNG CHO REPORT VÀ CHAT
 */
export const UNIFIED_SCORING_PROMPT = `
═══════════════════════════════════════════════════════════════════════════════
📊 HỆ THỐNG CHẤM ĐIỂM GIAO DỊCH - THANG 100
═══════════════════════════════════════════════════════════════════════════════

2 LOẠI ĐIỂM (ĐỀU DÙNG THANG 100):

┌─────────────────────────────────────────────────────────────────────────────┐
│ 📊 EdgeScore (0-100): Điểm tín hiệu kỹ thuật thuần túy                     │
│    • Đánh giá độ mạnh của setup dựa trên indicators                         │
│    • Nguồn: Chuyển đổi từ EdgeScore gốc (0-7) trong report                  │
│    • Edge 7 → 100 (Cực hiếm)                                                │
│    • Edge 6 → 88                                                            │
│    • Edge 5 → 73                                                            │
│    • Edge 4 → 58                                                            │
│    • Edge 3 → 43                                                            │
│    • Edge 2 → 28                                                            │
│    • Edge 1 → 13                                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎯 EntryScore (0-100): Điểm vào lệnh tổng hợp                              │
│    • Kết hợp EdgeScore + R:R + Xu hướng + Điều kiện thị trường              │
│    • Đây là điểm QUAN TRỌNG NHẤT để quyết định vào lệnh                     │
└─────────────────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CÁCH TÍNH EntryScore (0-100):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 THÀNH PHẦN 1: EdgeScore100 (40% = 40 điểm tối đa)
   • Chuyển đổi EdgeScore gốc (0-7) sang thang 100
   • Điểm thành phần = EdgeScore100 × 0.4
   • VD: Edge 6 → 88 → 88 × 0.4 = 35.2 điểm

📈 THÀNH PHẦN 2: R:R - Risk:Reward (30% = 30 điểm tối đa)
   • R:R ≥ 4.0 → 30 điểm
   • R:R 3.0-3.9 → 27 điểm
   • R:R 2.5-2.9 → 24 điểm
   • R:R 2.0-2.4 → 20 điểm
   • R:R 1.5-1.9 → 15 điểm
   • R:R 1.0-1.4 → 10 điểm
   • R:R < 1.0 → 5 điểm
   • LƯU Ý: Nếu có nhiều R:R (1.3/2.5/4.0), lấy giá trị CAO NHẤT

🎯 THÀNH PHẦN 3: Xu hướng & Hướng đi (15% = 15 điểm tối đa)
   • ADX > 25 + LONG/SHORT cùng hướng trend → 15 điểm
   • Trend rõ (Up/Down-trend) + LONG/SHORT → 10 điểm
   • Sideway / Không rõ hướng → 5 điểm
   • Ngược xu hướng → 0 điểm

⚡ THÀNH PHẦN 4: Điều kiện thị trường (15% = 15 điểm tối đa)
   • Fear-Greed phù hợp (Fear < 25 → tốt cho SHORT, Greed > 70 → tốt cho LONG) → 10 điểm
   • Volatility phù hợp (không quá cao) → 5 điểm
   • Volatility "very_high" → -5 điểm (trừ điểm)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THANG MỨC ĐỘ ĐIỂM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 90-100: CỰC TỐT (EXCELLENT)
   • Cơ hội vàng - Vào lệnh mạnh tay
   • Edge 7 + R:R ≥ 4.0 + Trend mạnh + Market thuận lợi

⚡ 80-89: RẤT TỐT (VERY GOOD)
   • Tín hiệu mạnh - Nên vào lệnh
   • Edge 6 + R:R ≥ 3.0 + Trend rõ

✨ 70-79: TỐT (GOOD)
   • Tín hiệu khá - Cân nhắc vào lệnh
   • Edge 5 + R:R ≥ 2.0 + Có setup

👍 55-69: KHÁ (FAIR)
   • Tín hiệu trung bình - Cẩn thận
   • Edge 4 + R:R ≥ 1.5

📊 40-54: TRUNG BÌNH (WEAK)
   • Tín hiệu yếu - Rủi ro cao
   • Edge thấp hoặc R:R không tốt

⬇️ 0-39: YẾU (POOR)
   • Không nên vào lệnh
   • STAY_OUT hoặc điều kiện không rõ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VÍ DỤ CHẤM ĐIỂM THỰC TẾ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VD1: BTCUSDT - Edge 6, R:R 4.0, Down-trend strong, Fear=11
   • EdgeScore100: 88 → 88 × 0.4 = 35.2
   • R:R: 4.0 → 30
   • Xu hướng: ADX strong + SHORT → 15
   • Market: Fear=11 tốt cho SHORT → 15
   → EntryScore = 35 + 30 + 15 + 15 = 95 🔥 CỰC TỐT

VD2: ETHUSDT - Edge 5, R:R 2.5, Up-trend, Greed=45
   • EdgeScore100: 73 → 73 × 0.4 = 29.2
   • R:R: 2.5 → 24
   • Xu hướng: Trend + LONG → 10
   • Market: Greed trung bình → 8
   → EntryScore = 29 + 24 + 10 + 8 = 71 ✨ TỐT

VD3: SOLUSDT - Edge 3, R:R 1.2, Sideway
   • EdgeScore100: 43 → 43 × 0.4 = 17.2
   • R:R: 1.2 → 10
   • Xu hướng: Sideway → 5
   • Market: Bình thường → 5
   → EntryScore = 17 + 10 + 5 + 5 = 37 ⬇️ YẾU

VD4: BNBUSDT - STAY_OUT
   → EntryScore = 0-20 ⬇️ (Không vào lệnh)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CÁCH HIỂN THỊ ĐIỂM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Luôn hiển thị CẢ điểm số VÀ mức độ:

📊 Edge \`88\` ⚡ RẤT TỐT  │  🎯 Entry \`95\` 🔥 CỰC TỐT

Hoặc format ngắn:
📊 Edge \`88\`⚡  │  🎯 Entry \`95\`🔥

LƯU Ý QUAN TRỌNG:
• Điểm 100 cực kỳ hiếm (< 0.5% tín hiệu)
• Điểm 90+ chỉ khi TẤT CẢ điều kiện hoàn hảo
• STAY_OUT luôn có EntryScore ≤ 20
• KHÔNG bịa điểm - chỉ tính từ dữ liệu thực
═══════════════════════════════════════════════════════════════════════════════
`;

// Legacy export để backward compatible
export const ENTRY_SCORE_RULES = UNIFIED_SCORING_PROMPT;

// ════════════════════════════════════════════════════════════════════════════════
// THUẬT NGỮ TRADING - Giữ nguyên gốc + Giải thích tiếng Việt
// ════════════════════════════════════════════════════════════════════════════════

export const TRADING_TERMS: Record<string, string> = {
  // Hướng giao dịch
  "LONG": "Mua lên - Đặt cược giá sẽ tăng. Lời khi giá tăng, lỗ khi giá giảm.",
  "SHORT": "Bán xuống - Đặt cược giá sẽ giảm. Lời khi giá giảm, lỗ khi giá tăng.",
  "STAY_OUT": "Đứng ngoài - Không nên vào lệnh lúc này vì điều kiện không thuận lợi.",
  
  // Các mức giá
  "Entry": "Điểm vào lệnh - Giá mà bạn mở vị thế mua/bán.",
  "SL": "Stop Loss (Cắt lỗ) - Giá tự động đóng lệnh để giới hạn thua lỗ.",
  "TP": "Take Profit (Chốt lời) - Giá đóng lệnh để thu lợi nhuận. TP1, TP2, TP3 là các mức chốt lời dần.",
  "Trigger": "Giá kích hoạt - Khi giá chạm mức này thì lệnh được kích hoạt.",
  
  // Chỉ số điểm
  "EdgeScore": "Điểm tín hiệu kỹ thuật (0-100). Đánh giá độ mạnh của setup dựa trên indicators. ≥70 là tốt.",
  "EntryScore": "Điểm vào lệnh tổng hợp (0-100). Kết hợp EdgeScore + R:R + Trend + Market. ≥70 là tốt.",
  "R:R": "Risk:Reward (Rủi ro:Lợi nhuận). VD: R:R = 3.0 nghĩa là lời 3$ cho mỗi 1$ rủi ro. ≥2.0 là tốt.",
  
  // Chỉ báo kỹ thuật
  "ADX": "Chỉ số sức mạnh xu hướng. ADX > 25 = xu hướng mạnh, ADX < 20 = sideway.",
  "Fear-Greed": "Chỉ số tâm lý thị trường. 0-25 = Sợ hãi (tốt cho SHORT), 75-100 = Tham lam (tốt cho LONG).",
  "RSI": "Relative Strength Index. RSI > 70 = quá mua (tốt cho SHORT), RSI < 30 = quá bán (tốt cho LONG).",
  "MACD": "Moving Average Convergence Divergence. MACD cắt lên = tín hiệu LONG, cắt xuống = SHORT.",
  
  // Khung thời gian
  "Timeframe": "Khung thời gian của biểu đồ. 15m = 15 phút, 1h = 1 giờ, 4h = 4 giờ.",
  "4h": "Khung 4 giờ - Phổ biến cho swing trade.",
  "1h": "Khung 1 giờ - Phổ biến cho day trade.",
  "15m": "Khung 15 phút - Dành cho scalping.",
  
  // Xu hướng
  "Uptrend": "Xu hướng tăng - Giá đang tạo đỉnh cao hơn và đáy cao hơn.",
  "Downtrend": "Xu hướng giảm - Giá đang tạo đỉnh thấp hơn và đáy thấp hơn.",
  "Sideway": "Đi ngang - Giá dao động trong biên độ hẹp, không có xu hướng rõ ràng.",
  
  // Loại entry
  "stop_breakout": "BREAKOUT - Vào lệnh khi giá phá vỡ ngưỡng kháng cự/hỗ trợ.",
  "limit_pullback": "LIMIT - Đặt lệnh chờ ở mức giá mong muốn khi giá hồi về.",
  "market_now": "MARKET - Vào lệnh ngay tại giá hiện tại.",
  
  // Scenario
  "Scenario A": "Setup hoàn hảo - Tất cả điều kiện đều thuận lợi.",
  "Scenario B": "Breakout rõ ràng - Phá vỡ mức quan trọng với volume.",
  "Scenario C": "Compression - Giá nén chặt, chuẩn bị bùng nổ.",
  "Scenario D": "Cần xác nhận - Chờ thêm tín hiệu để vào lệnh.",
  "Scenario F": "Pullback - Hồi về vùng hỗ trợ/MA/Fibo.",
  "Scenario G": "Rủi ro cao - Cần quản lý vốn chặt chẽ.",
};

/**
 * Lấy giải thích thuật ngữ
 */
export const getTermExplanation = (term: string): string => {
  return TRADING_TERMS[term] || term;
};
