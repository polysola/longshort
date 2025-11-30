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
// THUẬT NGỮ - Giữ nguyên gốc + Giải thích tiếng Việt
// ════════════════════════════════════════════
export const TRADING_TERMS: { [key: string]: string } = {
  // Hướng giao dịch - GIỮ NGUYÊN
  "LONG": "Mua lên - Đặt cược giá sẽ tăng. Lời khi giá tăng, lỗ khi giá giảm.",
  "SHORT": "Bán xuống - Đặt cược giá sẽ giảm. Lời khi giá giảm, lỗ khi giá tăng.",
  "STAY_OUT": "Đứng ngoài - Không nên vào lệnh lúc này vì điều kiện không thuận lợi.",
  
  // Các mức giá - GIỮ NGUYÊN
  "Entry": "Điểm vào lệnh - Giá mà bạn mở vị thế mua/bán.",
  "SL": "Stop Loss (Cắt lỗ) - Giá tự động đóng lệnh để giới hạn thua lỗ. VD: SL 100$ nghĩa là tối đa mất 100$.",
  "TP": "Take Profit (Chốt lời) - Giá đóng lệnh để thu lợi nhuận. TP1, TP2, TP3 là các mức chốt lời dần.",
  "Trigger": "Giá kích hoạt - Khi giá chạm mức này thì lệnh được kích hoạt.",
  
  // Chỉ số
  "EdgeScore": "Điểm tín hiệu kỹ thuật (0-100). Đánh giá độ mạnh của setup dựa trên các chỉ báo. Càng cao càng tốt.",
  "EntryScore": "Điểm vào lệnh tổng hợp (0-100). Kết hợp EdgeScore + R:R + xu hướng. ≥70 là tốt.",
  "R:R": "Risk:Reward (Rủi ro:Lợi nhuận). VD: R:R = 3.0 nghĩa là lời 3$ cho mỗi 1$ rủi ro. Càng cao càng tốt.",
  "ADX": "Chỉ số sức mạnh xu hướng. ADX > 25 = xu hướng mạnh, ADX < 20 = sideway.",
  "Fear-Greed": "Chỉ số tâm lý thị trường. 0-25 = Sợ hãi (tốt cho SHORT), 75-100 = Tham lam (tốt cho LONG).",
  
  // Khung thời gian
  "Timeframe": "Khung thời gian của biểu đồ. 15m = 15 phút, 1h = 1 giờ, 4h = 4 giờ.",
  
  // Xu hướng
  "Uptrend": "Xu hướng tăng - Giá đang tạo đỉnh cao hơn và đáy cao hơn.",
  "Downtrend": "Xu hướng giảm - Giá đang tạo đỉnh thấp hơn và đáy thấp hơn.",
  "Sideway": "Đi ngang - Giá dao động trong biên độ hẹp, không có xu hướng rõ ràng.",
  
  // Loại entry
  "Breakout": "Phá vỡ - Vào lệnh khi giá phá vỡ ngưỡng kháng cự/hỗ trợ.",
  "Pullback": "Hồi về - Vào lệnh khi giá hồi về vùng hỗ trợ/kháng cự sau khi breakout.",
  "Limit": "Lệnh giới hạn - Đặt lệnh chờ ở mức giá mong muốn.",
  
  // Scenario
  "Scenario": "Kịch bản giao dịch. A, B = tốt nhất, C, D = trung bình, F, G = rủi ro cao.",
};

// Helper function để lấy giải thích thuật ngữ
export const getTermExplanation = (term: string): string => {
  return TRADING_TERMS[term] || term;
};
