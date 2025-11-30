/**
 * ════════════════════════════════════════════
 * TELEGRAM FORMATTER - Giao diện Mobile đẹp
 * ════════════════════════════════════════════
 * Sử dụng HTML format (parse_mode: HTML)
 * Tối ưu cho màn hình mobile Telegram
 */

import { AnalysisResult, TradingSignal } from "../types/mail";
import { convertEdgeScoreTo100 } from "../config/scoringRules";

// ════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

// Emoji theo hướng giao dịch
const getDirectionInfo = (direction: string): { emoji: string; vi: string; color: string } => {
  switch (direction) {
    case "LONG": return { emoji: "🟢", vi: "MUA", color: "green" };
    case "SHORT": return { emoji: "🔴", vi: "BÁN", color: "red" };
    case "STAY_OUT": return { emoji: "⚪", vi: "CHỜ", color: "gray" };
    default: return { emoji: "⚫", vi: direction, color: "black" };
  }
};

// Emoji và label theo điểm (thang 100)
const getScoreDisplay = (score: number): { emoji: string; label: string } => {
  if (score >= 90) return { emoji: "🔥🔥🔥", label: "CỰC TỐT" };
  if (score >= 80) return { emoji: "⭐⭐⭐", label: "RẤT TỐT" };
  if (score >= 70) return { emoji: "⭐⭐", label: "TỐT" };
  if (score >= 55) return { emoji: "⭐", label: "KHÁ" };
  if (score >= 40) return { emoji: "⚠️", label: "TB" };
  return { emoji: "❌", label: "YẾU" };
};

// Format giá gọn gàng
const formatPrice = (price: string | number | undefined): string => {
  if (!price || price === "-") return "-";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return String(price);
  
  if (num >= 10000) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (num >= 1000) return num.toFixed(1);
  if (num >= 1) return num.toFixed(3);
  return num.toFixed(5);
};

// ════════════════════════════════════════════
// FORMAT SIGNAL - Gọn gàng cho mobile
// ════════════════════════════════════════════

const formatSignalMobile = (signal: TradingSignal, index: number): string => {
  const dir = getDirectionInfo(signal.direction);
  
  // Chuyển EdgeScore từ thang 7 sang 100
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? 0;
  
  // Lấy display cho điểm
  const edgeDisplay = getScoreDisplay(edgeScore100);
  const entryDisplay = getScoreDisplay(entryScore);
  
  const lines: string[] = [];
  
  // Header: Symbol + Direction
  lines.push(`┌─────────────────────`);
  lines.push(`│ ${dir.emoji} <b>${index}. ${escapeHtml(signal.symbol)}</b>`);
  lines.push(`│ ${dir.vi} • ${signal.timeframe || "4h"}`);
  lines.push(`├─────────────────────`);
  
  // Điểm số - 2 cột
  lines.push(`│ 📊 <b>Tín hiệu:</b> <code>${edgeScore100}</code>/100 ${edgeDisplay.emoji}`);
  if (entryScore > 0) {
    lines.push(`│ 🎯 <b>Vào lệnh:</b> <code>${entryScore}</code>/100 ${entryDisplay.emoji}`);
  }
  
  // Setup info (nếu có)
  if (signal.scenario || signal.entryType) {
    const setup = [signal.scenario, signal.entryType].filter(Boolean).join(" • ");
    lines.push(`│ 📋 ${escapeHtml(setup)}`);
  }
  
  lines.push(`├─────────────────────`);
  
  // Giá Entry
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`│ 📥 <b>Vào:</b> <code>${formatPrice(entryPrice)}</code>`);
  }
  
  // Stop Loss
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`│ 🛑 <b>Cắt lỗ:</b> <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  // Take Profits - gọn 1 dòng
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const tps = signal.takeProfits
      .filter(tp => tp && tp !== "-")
      .slice(0, 3)
      .map((tp, i) => `${i + 1}: <code>${formatPrice(tp)}</code>`)
      .join(" ");
    if (tps) {
      lines.push(`│ 🎯 <b>Chốt lời</b> ${tps}`);
    }
  }
  
  // R:R
  if (signal.rr && signal.rr !== "-") {
    lines.push(`│ 📈 <b>L/R:</b> ${escapeHtml(signal.rr)}`);
  }
  
  lines.push(`└─────────────────────`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// MAIN FORMATTER - Báo cáo đầy đủ
// ════════════════════════════════════════════

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const stayOutSignals = analysis.signals?.filter(s => s.direction === "STAY_OUT") || [];
  const total = longSignals.length + shortSignals.length;
  
  // Sort theo EntryScore giảm dần
  const sortByScore = (a: TradingSignal, b: TradingSignal) => 
    (b.entryScore ?? 0) - (a.entryScore ?? 0);
  longSignals.sort(sortByScore);
  shortSignals.sort(sortByScore);

  const lines: string[] = [];
  
  // ════════════════════════════════════════════
  // HEADER
  // ════════════════════════════════════════════
  lines.push(`╔═══════════════════════╗`);
  lines.push(`║  📊 <b>BÁO CÁO TÍN HIỆU</b>  ║`);
  lines.push(`╚═══════════════════════╝`);
  lines.push(``);
  
  // Thời gian
  const now = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  lines.push(`⏰ ${now}`);
  lines.push(``);
  
  // ════════════════════════════════════════════
  // THỐNG KÊ NHANH
  // ════════════════════════════════════════════
  lines.push(`┌─ 📈 <b>THỐNG KÊ</b> ──────────`);
  lines.push(`│ Tổng: <b>${total}</b> tín hiệu`);
  lines.push(`│ 🟢 Mua: <b>${longSignals.length}</b> │ 🔴 Bán: <b>${shortSignals.length}</b>`);
  if (stayOutSignals.length > 0) {
    lines.push(`│ ⚪ Chờ: <b>${stayOutSignals.length}</b>`);
  }
  
  // Top 3 điểm cao nhất
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    const topList = top3
      .map(s => {
        const dir = getDirectionInfo(s.direction);
        return `${dir.emoji}${s.symbol}`;
      })
      .join(" ");
    lines.push(`│ 🏆 Top: ${topList}`);
  }
  lines.push(`└─────────────────────`);
  lines.push(``);
  
  // ════════════════════════════════════════════
  // TỔNG QUAN
  // ════════════════════════════════════════════
  if (analysis.summary) {
    lines.push(`📌 <b>TỔNG QUAN</b>`);
    lines.push(`<i>${escapeHtml(analysis.summary.substring(0, 200))}${analysis.summary.length > 200 ? '...' : ''}</i>`);
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // DANH SÁCH MUA (LONG)
  // ════════════════════════════════════════════
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>DANH SÁCH MUA</b> (${longSignals.length})`);
    lines.push(`═══════════════════════`);
    longSignals.forEach((signal, index) => {
      lines.push(formatSignalMobile(signal, index + 1));
    });
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // DANH SÁCH BÁN (SHORT)
  // ════════════════════════════════════════════
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>DANH SÁCH BÁN</b> (${shortSignals.length})`);
    lines.push(`═══════════════════════`);
    shortSignals.forEach((signal, index) => {
      lines.push(formatSignalMobile(signal, index + 1));
    });
    lines.push(``);
  }
  
  // Không có tín hiệu
  if (total === 0) {
    lines.push(`┌─────────────────────`);
    lines.push(`│ ⚠️ <b>KHÔNG CÓ TÍN HIỆU</b>`);
    lines.push(`│ Thị trường đang đi ngang`);
    lines.push(`│ hoặc chưa có setup tốt.`);
    lines.push(`└─────────────────────`);
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════
  lines.push(`───────────────────────`);
  lines.push(`🔖 ID: <code>${analysis.mailId?.substring(0, 8) || '-'}...</code>`);
  lines.push(`<i>⚠️ Chỉ tham khảo. Tự nghiên cứu!</i>`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// SHORT NOTIFICATION - Thông báo ngắn
// ════════════════════════════════════════════

export const formatShortNotification = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const total = longSignals.length + shortSignals.length;
  
  if (total === 0) {
    return `📊 <b>Báo cáo mới</b>\n⚠️ Không có tín hiệu Mua/Bán`;
  }
  
  const allSignals = [...longSignals, ...shortSignals]
    .sort((a, b) => (b.entryScore ?? 0) - (a.entryScore ?? 0))
    .slice(0, 3);
  
  const topList = allSignals
    .map(s => `${getDirectionInfo(s.direction).emoji}${s.symbol}`)
    .join(" ");
  
  return `📊 <b>Báo cáo mới</b> - ${total} tín hiệu\n🟢 ${longSignals.length} Mua │ 🔴 ${shortSignals.length} Bán\n🏆 ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL - Cho tin nhắn chia nhỏ
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionInfo(signal.direction);
  const edgeScore100 = convertEdgeScoreTo100(signal.edgeScore ?? 0);
  const display = getScoreDisplay(edgeScore100);
  
  const lines: string[] = [];
  lines.push(`${dir.emoji} <b>${signal.symbol}</b> [${signal.timeframe || "4h"}]`);
  lines.push(`   📊 Điểm: ${edgeScore100}/100 ${display.emoji}`);
  
  const entry = signal.trigger || signal.entry;
  if (entry && entry !== "-") {
    lines.push(`   📥 Vào: <code>${formatPrice(entry)}</code>`);
  }
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`   🛑 Cắt lỗ: <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  return lines.join("\n");
};

