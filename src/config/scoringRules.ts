/**
 * ════════════════════════════════════════════
 * ENTRY SCORE RULES - HỆ THỐNG CHẤM ĐIỂM THỐNG NHẤT
 * ════════════════════════════════════════════
 * Dùng chung cho cả analyzeMail (email tự động) và chatbot (hỏi đáp)
 */

export const ENTRY_SCORE_RULES = `
QUAN TRỌNG - CÁCH TÍNH entryScore (0-100):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
entryScore đánh giá độ TỐT của tín hiệu dựa trên CHÍNH XÁC dữ liệu email:

**BƯỚC 1: TÍNH R:R (Risk:Reward) - 35 điểm**
   Công thức: R:R = (Entry - TP) / (SL - Entry)
   - R:R >= 3.0 (VD: 1.3/2.5/4.0, hoặc RR=4.0) → 35 điểm
   - R:R 2.0-2.9 → 30 điểm
   - R:R 1.5-1.9 → 25 điểm
   - R:R 1.0-1.4 → 15 điểm
   - R:R < 1.0 → 5 điểm

**BƯỚC 2: EDGE SCORE / TREND STRENGTH - 30 điểm**
   Nếu email có "Edge Score" (VD: "Edge = 7", "Edge Score* = 7"):
   - Edge Score 7 → 30 điểm
   - Edge Score 6 → 25 điểm
   - Edge Score 5 → 20 điểm
   - Edge Score 3-4 → 15 điểm
   - Edge Score ≤ 2 → 10 điểm
   
   Nếu KHÔNG có Edge Score, dựa vào Trend:
   - "Down-trend strong" / "Up-trend strong" + "ADX > 25" → 30 điểm
   - "Down-trend" / "Up-trend" (không strong) → 20 điểm
   - "Sideways" → 10 điểm

**BƯỚC 3: MARKET CONTEXT - 20 điểm**
   Dựa vào Fear-Greed Index, Volatility, Market Overview:
   - Xu hướng rõ + điều kiện thuận lợi (VD: Fear=11 cho SHORT, Greed>70 cho LONG) → 20 điểm
   - Volatility "high" + Regime "trending" → 15 điểm
   - Volatility "very_high" + Regime "volatile" → 5 điểm (rủi ro cao)
   - Sideway market → 10 điểm

**BƯỚC 4: CLASSIFICATION & DECISION - 15 điểm**
   - Classification = "decrease" hoặc "increase" (có hướng rõ) + Decision = SHORT/LONG → 15 điểm
   - Classification = "decrease"/"increase" nhưng confidence < 0.5 → 10 điểm
   - Classification = "chaos" hoặc Decision = "STAY_OUT" → 0 điểm

**THANG ĐIỂM CUỐI CÙNG:**
- **90-100**: Tín hiệu CỰC TỐT (Highly Recommended) 🔥🔥🔥
  * Edge Score 7 + RR >= 3.0 + Market thuận lợi + Classification rõ ràng
- **75-89**: Tín hiệu TỐT (Recommended) ⭐⭐
  * Edge Score 5-6 + RR >= 2.0 + Trend strong
- **60-74**: Tín hiệu KHÁ (Consider) ⭐
  * Edge Score 3-4 + RR >= 1.5 + Có setup
- **40-59**: Tín hiệu TRUNG BÌNH (Caution) ⚠️
  * Edge Score thấp hoặc RR < 1.5
- **0-39**: Tín hiệu YẾU (Not Recommended) ❌
  * STAY_OUT, chaos, hoặc điều kiện không rõ ràng

**LƯU Ý QUAN TRỌNG:**
- Nếu email ghi "STAY_OUT" → entryScore = 0-20 (không vào lệnh)
- Nếu có "Edge Score" trong email → ƯU TIÊN dùng để chấm điểm
- RR thường ở cột "RR (TP-SL)" (VD: "1.3 / 2.5 / 4.0" → lấy 4.0)
- Fear-Greed Index < 20 → TỐT cho SHORT, > 70 → TỐT cho LONG

**VÍ DỤ CHẤM ĐIỂM TỪ EMAIL THỰC TẾ:**

Email nói: "BTCUSDT - Edge Score = 7, RR = 1.3/2.5/4.0, Down-trend strong, ADX > 25, Fear-Greed = 11"
→ entryScore = 35 (RR 4.0) + 30 (Edge 7) + 20 (Fear=11 tốt cho SHORT) + 15 (decrease) = **100 điểm** 🔥🔥🔥

Email nói: "ASTERUSDT - STAY OUT - Edge Score = 4, không có 4h strong"
→ entryScore = 0 (STAY_OUT) ❌

Email nói: "DYMUSDT - LONG, Edge Score không rõ, Up-trend strong, ADX=52, RR TP1≈1.3"
→ entryScore = 15 (RR 1.3) + 30 (trend strong + ADX>25) + 15 (up-trend) + 15 (increase) = **75 điểm** ⭐⭐

**CÁCH HIỂN THỊ SCORE:**
- JSON (analyzeMail): "entryScore": 85
- Text (chatbot): "📊 **Gợi ý vào lệnh: 85/100** ⭐⭐ _TỐT_"
`;

