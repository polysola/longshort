/**
 * ════════════════════════════════════════════
 * HỆ THỐNG CHẤM ĐIỂM - THANG 100
 * ════════════════════════════════════════════
 * EdgeScore: Đánh giá độ mạnh của tín hiệu kỹ thuật (0-100)
 * EntryScore: Đánh giá tổng hợp để vào lệnh (0-100)
 */

// ════════════════════════════════════════════
// EDGE SCORE - Điểm tín hiệu kỹ thuật (0-100)
// ════════════════════════════════════════════
// Chuyển đổi từ thang 7 → thang 100
export const convertEdgeScoreTo100 = (edgeScore7: number): number => {
  // Công thức: Không linear, điểm cao khó đạt hơn
  // Edge 7 = 100 (Cực kỳ hiếm)
  // Edge 6 = 85-90
  // Edge 5 = 70-75
  // Edge 4 = 55-60
  // Edge 3 = 40-45
  // Edge 2 = 25-30
  // Edge 1 = 10-15
  // Edge 0 = 0
  
  const scoreMap: { [key: number]: number } = {
    7: 100,  // Cực hiếm - Tín hiệu hoàn hảo
    6: 88,   // Rất tốt
    5: 73,   // Tốt
    4: 58,   // Khá
    3: 43,   // Trung bình
    2: 28,   // Yếu
    1: 13,   // Rất yếu
    0: 0     // Không có tín hiệu
  };
  
  return scoreMap[Math.min(7, Math.max(0, Math.round(edgeScore7)))] ?? 0;
};

// ════════════════════════════════════════════
// ENTRY SCORE - Điểm vào lệnh tổng hợp (0-100)
// ════════════════════════════════════════════
export const ENTRY_SCORE_RULES = `
HỆ THỐNG CHẤM ĐIỂM VÀO LỆNH (0-100):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 **ĐIỂM TÍN HIỆU (EdgeScore100)** - 40 điểm tối đa
   Chuyển đổi từ EdgeScore gốc (0-7) sang thang 100:
   • Edge 7 → 100 điểm (Cực hiếm)
   • Edge 6 → 88 điểm
   • Edge 5 → 73 điểm  
   • Edge 4 → 58 điểm
   • Edge 3 → 43 điểm
   • Edge 2 → 28 điểm
   • Edge 1 → 13 điểm
   
   Điểm thành phần = EdgeScore100 × 0.4

📈 **TỶ LỆ LỢI NHUẬN/RỦI RO (R:R)** - 30 điểm tối đa
   • R:R ≥ 4.0 → 30 điểm
   • R:R 3.0-3.9 → 27 điểm
   • R:R 2.5-2.9 → 24 điểm
   • R:R 2.0-2.4 → 20 điểm
   • R:R 1.5-1.9 → 15 điểm
   • R:R 1.0-1.4 → 10 điểm
   • R:R < 1.0 → 5 điểm

🎯 **HƯỚNG ĐI & XU HƯỚNG** - 15 điểm tối đa
   • Xu hướng mạnh (ADX > 25) + Tín hiệu cùng hướng → 15 điểm
   • Xu hướng trung bình + Tín hiệu cùng hướng → 10 điểm
   • Sideway/Không rõ hướng → 5 điểm
   • Ngược xu hướng → 0 điểm

⚡ **ĐIỀU KIỆN THỊ TRƯỜNG** - 15 điểm tối đa
   • Fear-Greed phù hợp (Fear<25 cho Bán, Greed>70 cho Mua) → 10 điểm
   • Volatility phù hợp (không quá cao) → 5 điểm
   • Volatility "very_high" → -5 điểm (trừ điểm)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THANG ĐÁNH GIÁ CUỐI CÙNG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥🔥🔥 **90-100**: CỰC TỐT - Cơ hội vàng (Rất hiếm)
   → Edge 7 + R:R ≥ 4.0 + Xu hướng mạnh + Thị trường thuận lợi

⭐⭐⭐ **80-89**: RẤT TỐT - Nên vào lệnh
   → Edge 6 + R:R ≥ 3.0 + Xu hướng rõ

⭐⭐ **70-79**: TỐT - Cân nhắc vào lệnh
   → Edge 5 + R:R ≥ 2.0 + Có setup

⭐ **55-69**: KHÁ - Cẩn thận
   → Edge 4 + R:R ≥ 1.5

⚠️ **40-54**: TRUNG BÌNH - Rủi ro cao
   → Edge thấp hoặc R:R không tốt

❌ **0-39**: YẾU - Không nên vào lệnh
   → STAY_OUT hoặc điều kiện không rõ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LƯU Ý:
• Điểm 100 cực kỳ hiếm (< 1% tín hiệu)
• Điểm 90+ chỉ xuất hiện khi tất cả điều kiện hoàn hảo
• STAY_OUT luôn = 0 điểm
`;

// ════════════════════════════════════════════
// THUẬT NGỮ TIẾNG VIỆT
// ════════════════════════════════════════════
export const VIETNAMESE_TERMS: { [key: string]: { vi: string; explain: string } } = {
  // Hướng giao dịch
  "LONG": { vi: "MUA LÊN", explain: "Đặt cược giá sẽ tăng" },
  "SHORT": { vi: "BÁN XUỐNG", explain: "Đặt cược giá sẽ giảm" },
  "STAY_OUT": { vi: "ĐỨNG NGOÀI", explain: "Không nên vào lệnh lúc này" },
  
  // Các mức giá
  "Entry": { vi: "Điểm vào", explain: "Giá để mở lệnh" },
  "Stop Loss": { vi: "Cắt lỗ", explain: "Giá tự động đóng lệnh để giới hạn thua lỗ" },
  "Take Profit": { vi: "Chốt lời", explain: "Giá đóng lệnh để thu lợi nhuận" },
  "Trigger": { vi: "Kích hoạt", explain: "Giá kích hoạt lệnh" },
  
  // Chỉ số
  "EdgeScore": { vi: "Điểm tín hiệu", explain: "Đánh giá độ mạnh tín hiệu kỹ thuật (0-100)" },
  "EntryScore": { vi: "Điểm vào lệnh", explain: "Đánh giá tổng hợp để vào lệnh (0-100)" },
  "R:R": { vi: "Lợi nhuận/Rủi ro", explain: "Tỷ lệ tiền có thể lời so với tiền có thể mất" },
  "ADX": { vi: "Chỉ số xu hướng", explain: "Đo sức mạnh xu hướng (>25 = mạnh)" },
  "Fear-Greed": { vi: "Chỉ số Sợ hãi-Tham lam", explain: "Tâm lý thị trường (0=Sợ hãi, 100=Tham lam)" },
  
  // Khung thời gian
  "Timeframe": { vi: "Khung giờ", explain: "Khoảng thời gian của mỗi nến" },
  "1h": { vi: "1 giờ", explain: "Khung 1 giờ" },
  "4h": { vi: "4 giờ", explain: "Khung 4 giờ" },
  "15m": { vi: "15 phút", explain: "Khung 15 phút" },
  
  // Xu hướng
  "Up-trend": { vi: "Xu hướng tăng", explain: "Giá đang có xu hướng đi lên" },
  "Down-trend": { vi: "Xu hướng giảm", explain: "Giá đang có xu hướng đi xuống" },
  "Sideway": { vi: "Đi ngang", explain: "Giá dao động trong biên độ hẹp" },
  
  // Loại entry
  "Breakout": { vi: "Phá vỡ", explain: "Vào lệnh khi giá phá vỡ ngưỡng" },
  "Pullback": { vi: "Hồi về", explain: "Vào lệnh khi giá hồi về vùng hỗ trợ/kháng cự" },
  "Reversal": { vi: "Đảo chiều", explain: "Vào lệnh khi có dấu hiệu đảo chiều" },
};

// Helper function để lấy thuật ngữ tiếng Việt
export const getVietnameseTerm = (term: string): string => {
  const entry = VIETNAMESE_TERMS[term];
  return entry ? entry.vi : term;
};

// Helper function để lấy giải thích
export const getTermExplanation = (term: string): string => {
  const entry = VIETNAMESE_TERMS[term];
  return entry ? `${entry.vi} (${entry.explain})` : term;
};
