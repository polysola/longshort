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
const getDirectionInfo = (direction: string): { emoji: string; label: string; bgEmoji: string } => {
  switch (direction) {
    case "LONG": return { emoji: "🟢", label: "LONG", bgEmoji: "📈" };
    case "SHORT": return { emoji: "🔴", label: "SHORT", bgEmoji: "📉" };
    case "STAY_OUT": return { emoji: "⚪", label: "STAY OUT", bgEmoji: "⏸" };
    default: return { emoji: "⚫", label: direction, bgEmoji: "❓" };
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
// FORMAT SIGNAL - Card riêng biệt cho mỗi coin
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal, index: number): string => {
  const dir = getDirectionInfo(signal.direction);
  
  // Chuyển EdgeScore từ thang 7 sang 100
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? 0;
  
  // Lấy display cho điểm
  const scoreDisplay = getScoreDisplay(Math.max(edgeScore100, entryScore));
  
  const lines: string[] = [];
  
  // Header với emoji nổi bật
  lines.push(``);
  lines.push(`${dir.bgEmoji}${dir.emoji} <b>${index}. ${escapeHtml(signal.symbol)}</b> • <b>${dir.label}</b>`);
  
  // Điểm số inline
  const scoreText = `📊 <code>${edgeScore100}</code>/100 ${scoreDisplay.emoji}`;
  lines.push(`   ${scoreText}`);
  
  // Setup info (nếu có) - gọn 1 dòng
  if (signal.scenario || signal.entryType || signal.timeframe) {
    const parts = [
      signal.timeframe ? `⏱${signal.timeframe}` : null,
      signal.scenario ? `S${signal.scenario}` : null,
      signal.entryType ? signal.entryType : null
    ].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`   📋 ${parts.join(" • ")}`);
    }
  }
  
  // Giá Entry
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`   📥 Entry: <code>${formatPrice(entryPrice)}</code>`);
  }
  
  // SL
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`   🛑 SL: <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  // TPs - gọn 1 dòng
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const tps = signal.takeProfits
      .filter(tp => tp && tp !== "-")
      .slice(0, 3)
      .map((tp, i) => `<code>${formatPrice(tp)}</code>`)
      .join(" → ");
    if (tps) {
      lines.push(`   🎯 TP: ${tps}`);
    }
  }
  
  // R:R
  if (signal.rr && signal.rr !== "-") {
    lines.push(`   📈 R:R ${escapeHtml(signal.rr)}`);
  }
  
  // Reason/Notes - MÔ TẢ QUAN TRỌNG
  if (signal.reason) {
    lines.push(`   💡 <i>${escapeHtml(signal.reason)}</i>`);
  }
  
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
  lines.push(`📊 <b>BÁO CÁO TÍN HIỆU</b>`);
  
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
  lines.push(`📈 <b>THỐNG KÊ</b>`);
  lines.push(`Tổng: <b>${total}</b> tín hiệu`);
  lines.push(`🟢 LONG: <b>${longSignals.length}</b>  •  🔴 SHORT: <b>${shortSignals.length}</b>`);
  if (stayOutSignals.length > 0) {
    lines.push(`⚪ STAY OUT: <b>${stayOutSignals.length}</b>`);
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
      .join("  ");
    lines.push(`🏆 Top: ${topList}`);
  }
  lines.push(``);
  
  // ════════════════════════════════════════════
  // TỔNG QUAN
  // ════════════════════════════════════════════
  if (analysis.summary) {
    lines.push(`📌 <b>TỔNG QUAN</b>`);
    lines.push(`<i>${escapeHtml(analysis.summary.substring(0, 250))}${analysis.summary.length > 250 ? '...' : ''}</i>`);
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // DANH SÁCH LONG
  // ════════════════════════════════════════════
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>LONG</b> (${longSignals.length})`);
    longSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // DANH SÁCH SHORT
  // ════════════════════════════════════════════
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>SHORT</b> (${shortSignals.length})`);
    shortSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // Không có tín hiệu
  if (total === 0) {
    lines.push(`⚠️ <b>KHÔNG CÓ TÍN HIỆU</b>`);
    lines.push(`<i>Thị trường đang sideway hoặc chưa có setup tốt.</i>`);
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════
  lines.push(`🔖 ID: <code>${analysis.mailId?.substring(0, 8) || '-'}...</code>`);
  lines.push(`<i>⚠️ Chỉ tham khảo. DYOR!</i>`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// SHORT NOTIFICATION
// ════════════════════════════════════════════

export const formatShortNotification = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const total = longSignals.length + shortSignals.length;
  
  if (total === 0) {
    return `📊 <b>Báo cáo mới</b>\n⚠️ Không có tín hiệu LONG/SHORT`;
  }
  
  const allSignals = [...longSignals, ...shortSignals]
    .sort((a, b) => (b.entryScore ?? 0) - (a.entryScore ?? 0))
    .slice(0, 3);
  
  const topList = allSignals
    .map(s => `${getDirectionInfo(s.direction).emoji}${s.symbol}`)
    .join("  ");
  
  return `📊 <b>Báo cáo mới</b> - ${total} tín hiệu\n🟢 ${longSignals.length} LONG  •  🔴 ${shortSignals.length} SHORT\n🏆 ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionInfo(signal.direction);
  const edgeScore100 = convertEdgeScoreTo100(signal.edgeScore ?? 0);
  const display = getScoreDisplay(edgeScore100);
  
  const lines: string[] = [];
  lines.push(`${dir.emoji} <b>${signal.symbol}</b> ${signal.timeframe || "4h"}`);
  lines.push(`   📊 ${edgeScore100}/100 ${display.emoji}`);
  
  const entry = signal.trigger || signal.entry;
  if (entry && entry !== "-") {
    lines.push(`   📥 Entry: <code>${formatPrice(entry)}</code>`);
  }
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`   🛑 SL: <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  // Thêm reason
  if (signal.reason) {
    lines.push(`   💡 <i>${escapeHtml(signal.reason.substring(0, 50))}${signal.reason.length > 50 ? '...' : ''}</i>`);
  }
  
  return lines.join("\n");
};
