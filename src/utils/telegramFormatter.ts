/**
 * TELEGRAM FORMATTER - High-tech Professional Design
 * HTML format (parse_mode: HTML)
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

const getDirectionStyle = (direction: string): { icon: string; label: string; color: string } => {
  switch (direction) {
    case "LONG": return { icon: "▲", label: "LONG", color: "🟢" };
    case "SHORT": return { icon: "▼", label: "SHORT", color: "🔴" };
    case "STAY_OUT": return { icon: "◆", label: "WAIT", color: "⚪" };
    default: return { icon: "●", label: direction, color: "⚫" };
  }
};

const getScoreBar = (score: number): string => {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

const getScoreLabel = (score: number): string => {
  if (score >= 90) return "🔥 XUẤT SẮC";
  if (score >= 80) return "⚡ RẤT TỐT";
  if (score >= 70) return "✨ TỐT";
  if (score >= 55) return "👍 KHÁ";
  if (score >= 40) return "📊 TB";
  return "⬇️ YẾU";
};

const formatPrice = (price: string | number | undefined): string => {
  if (!price || price === "-") return "—";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return String(price);
  
  if (num >= 10000) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (num >= 100) return num.toFixed(2);
  if (num >= 1) return num.toFixed(4);
  return num.toFixed(6);
};

// Tạo mô tả chi tiết
const generateDescription = (signal: TradingSignal): string => {
  const parts: string[] = [];
  
  const scenarioDesc: { [key: string]: string } = {
    "A": "Perfect setup",
    "B": "Clear breakout", 
    "C": "Compression",
    "D": "Need confirm",
    "F1": "Pullback support",
    "F2": "Pullback MA",
    "F3": "Pullback Fibo",
    "G": "High risk"
  };
  
  const entryDesc: { [key: string]: string } = {
    "stop_breakout": "Breakout entry",
    "limit_pullback": "Pullback entry",
    "market_now": "Market entry"
  };
  
  if (signal.scenario) {
    const desc = scenarioDesc[signal.scenario];
    if (desc) parts.push(desc);
  }
  if (signal.entryType) {
    const desc = entryDesc[signal.entryType];
    if (desc) parts.push(desc);
  }
  if (signal.reason) {
    parts.push(signal.reason);
  }
  
  return parts.join(" • ") || "—";
};

// ════════════════════════════════════════════
// FORMAT SIGNAL CARD - 2 SCORES RIÊNG BIỆT
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  
  // 2 điểm riêng biệt
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? 0;
  
  const lines: string[] = [];
  
  // HEADER
  lines.push(``);
  lines.push(`┌─────────────────────────────┐`);
  lines.push(`│ ${dir.color} <b>${escapeHtml(signal.symbol)}</b>  ${dir.icon} <b>${dir.label}</b>  ⏱ ${signal.timeframe || "4h"}`);
  lines.push(`└─────────────────────────────┘`);
  
  // 2 SCORES RIÊNG BIỆT
  lines.push(``);
  lines.push(`  📊 EdgeScore    <code>${getScoreBar(edgeScore100)}</code> <b>${edgeScore100}</b>`);
  lines.push(`                  ${getScoreLabel(edgeScore100)}`);
  lines.push(``);
  if (entryScore > 0) {
    lines.push(`  🎯 EntryScore   <code>${getScoreBar(entryScore)}</code> <b>${entryScore}</b>`);
    lines.push(`                  ${getScoreLabel(entryScore)}`);
    lines.push(``);
  }
  
  // PRICE INFO
  if (signal.price && signal.price !== "-") {
    lines.push(`  💰 Price        <code>${formatPrice(signal.price)}</code>`);
  }
  
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`  📥 Entry        <code>${formatPrice(entryPrice)}</code>`);
  }
  
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`  🛑 SL           <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const validTPs = signal.takeProfits.filter(tp => tp && tp !== "-").slice(0, 3);
    if (validTPs.length > 0) {
      lines.push(`  🎯 TP           <code>${validTPs.map(tp => formatPrice(tp)).join("</code> → <code>")}</code>`);
    }
  }
  
  if (signal.rr && signal.rr !== "-") {
    lines.push(`  📈 R:R          <code>${escapeHtml(signal.rr)}</code>`);
  }
  
  // DESCRIPTION
  lines.push(``);
  const desc = generateDescription(signal);
  lines.push(`  💡 <i>${escapeHtml(desc.substring(0, 50))}${desc.length > 50 ? '...' : ''}</i>`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// MAIN FORMATTER
// ════════════════════════════════════════════

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const stayOutCount = analysis.signals?.filter(s => s.direction === "STAY_OUT").length || 0;
  const total = longSignals.length + shortSignals.length;
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  longSignals.sort(sortByScore);
  shortSignals.sort(sortByScore);

  const lines: string[] = [];
  
  // HEADER
  const now = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  
  lines.push(`╔═══════════════════════════════╗`);
  lines.push(`║   📊 <b>TRADING SIGNALS</b>         ║`);
  lines.push(`║   ⏰ ${now}              ║`);
  lines.push(`╚═══════════════════════════════╝`);
  lines.push(``);
  
  // STATS
  lines.push(`<b>📈 OVERVIEW</b>`);
  lines.push(`   Total: <b>${total}</b> signals`);
  lines.push(`   🟢 LONG <b>${longSignals.length}</b>  │  🔴 SHORT <b>${shortSignals.length}</b>${stayOutCount > 0 ? `  │  ⚪ WAIT <b>${stayOutCount}</b>` : ''}`);
  
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    const topStr = top3.map(s => {
      const dir = getDirectionStyle(s.direction);
      const score = s.entryScore ?? convertEdgeScoreTo100(s.edgeScore ?? 0);
      return `${dir.color}${s.symbol}(<code>${score}</code>)`;
    }).join("  ");
    lines.push(`   🏆 ${topStr}`);
  }
  lines.push(``);
  
  // Summary
  if (analysis.summary) {
    lines.push(`<b>📌 MARKET</b>`);
    lines.push(`   <i>${escapeHtml(analysis.summary.substring(0, 100))}${analysis.summary.length > 100 ? '...' : ''}</i>`);
    lines.push(``);
  }
  
  // LONG SIGNALS
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>LONG POSITIONS</b> (${longSignals.length})`);
    lines.push(`═══════════════════════════════`);
    longSignals.forEach(signal => {
      lines.push(formatSignalCard(signal));
    });
    lines.push(``);
  }
  
  // SHORT SIGNALS
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>SHORT POSITIONS</b> (${shortSignals.length})`);
    lines.push(`═══════════════════════════════`);
    shortSignals.forEach(signal => {
      lines.push(formatSignalCard(signal));
    });
    lines.push(``);
  }
  
  // No signals
  if (total === 0) {
    lines.push(`┌─────────────────────────────┐`);
    lines.push(`│  ⚠️ <b>NO SIGNALS</b>              │`);
    lines.push(`│  Market sideways / No setup │`);
    lines.push(`└─────────────────────────────┘`);
    lines.push(``);
  }
  
  // FOOTER
  lines.push(`───────────────────────────────`);
  lines.push(`🔖 <code>${analysis.mailId?.substring(0, 12) || '-'}</code>  ⚠️ <i>DYOR</i>`);
  
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
    return `📊 <b>New Report</b>\n⚠️ No LONG/SHORT signals`;
  }
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  
  const top3 = [...longSignals, ...shortSignals].sort(sortByScore).slice(0, 3);
  const topList = top3.map(s => `${getDirectionStyle(s.direction).color}${s.symbol}`).join(" ");
  
  return `📊 <b>NEW SIGNALS</b> │ ${total} total\n\n🟢 ${longSignals.length} LONG  │  🔴 ${shortSignals.length} SHORT\n\n🏆 ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  const edgeScore100 = convertEdgeScoreTo100(signal.edgeScore ?? 0);
  const entryScore = signal.entryScore ?? 0;
  
  const lines: string[] = [];
  lines.push(`${dir.color} <b>${signal.symbol}</b> ${dir.icon}${dir.label}`);
  lines.push(`   📊 Edge: <code>${edgeScore100}</code>  🎯 Entry: <code>${entryScore}</code>`);
  
  if (signal.price && signal.price !== "-") {
    lines.push(`   💰 <code>${formatPrice(signal.price)}</code>`);
  }
  
  return lines.join("\n");
};
