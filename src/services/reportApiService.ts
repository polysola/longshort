/**
 * Report API Service
 * Lấy data từ https://first.fsignal.xyz/api/reports
 * Workflow: 
 *   1. Gọi API list để lấy _id mới nhất
 *   2. Gọi API chi tiết /api/reports/{id} để lấy markdown đầy đủ
 */

import { logDebug, logError, logInfo, logWarn } from "../utils/logger";
import { ExternalServiceError } from "../lib/errors";
import type { RawReport, RawReportListItem, RawReportDetail, NormalizedReport } from "../types/mail";

const API_BASE_URL = "https://first.fsignal.xyz/api/reports";
const FETCH_TIMEOUT = 30_000; // 30 giây

/**
 * Fetch danh sách reports từ API (chỉ lấy _id và metadata cơ bản)
 */
export const fetchReportList = async (): Promise<RawReportListItem[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    logInfo("Đang fetch danh sách reports từ API...", { url: API_BASE_URL });

    const response = await fetch(API_BASE_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FutureCoin-Bot/1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ExternalServiceError(`API trả về status ${response.status}`, {
        status: response.status,
        statusText: response.statusText,
      });
    }

    const json = await response.json();
    const reports: RawReportListItem[] = json.data || json;

    logInfo("Đã fetch danh sách reports.", {
      totalReports: reports.length,
      latestReportId: reports[0]?._id,
    });

    return reports;
  } catch (error) {
    clearTimeout(timeoutId);

    if ((error as Error).name === "AbortError") {
      throw new ExternalServiceError("API request timeout.", { timeout: FETCH_TIMEOUT });
    }

    logError("Lỗi khi fetch danh sách reports.", { error: (error as Error).message });
    throw new ExternalServiceError("Không thể lấy danh sách reports từ API.", {
      cause: (error as Error).message,
    });
  }
};

/**
 * Fetch chi tiết report từ API (có markdown đầy đủ)
 */
export const fetchReportDetail = async (reportId: string): Promise<RawReportDetail> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const url = `${API_BASE_URL}/${reportId}`;

  try {
    logInfo("Đang fetch chi tiết report...", { url, reportId });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FutureCoin-Bot/1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ExternalServiceError(`API trả về status ${response.status}`, {
        status: response.status,
        statusText: response.statusText,
        reportId,
      });
    }

    const json = await response.json();
    const report: RawReportDetail = json.data || json;

    logInfo("Đã fetch chi tiết report.", {
      reportId: report._id,
      markdownLength: report.markdown?.length || 0,
    });

    return report;
  } catch (error) {
    clearTimeout(timeoutId);

    if ((error as Error).name === "AbortError") {
      throw new ExternalServiceError("API request timeout.", { timeout: FETCH_TIMEOUT, reportId });
    }

    logError("Lỗi khi fetch chi tiết report.", { error: (error as Error).message, reportId });
    throw new ExternalServiceError("Không thể lấy chi tiết report từ API.", {
      cause: (error as Error).message,
      reportId,
    });
  }
};

/**
 * Lấy report mới nhất từ API (workflow đầy đủ)
 * 1. Fetch list để lấy _id mới nhất
 * 2. Fetch chi tiết để lấy markdown
 */
export const getLatestReport = async (): Promise<NormalizedReport | null> => {
  try {
    // Bước 1: Lấy danh sách reports
    const reportList = await fetchReportList();

    if (reportList.length === 0) {
      logWarn("API không trả về report nào.");
      return null;
    }

    // Sắp xếp theo created_at giảm dần (mới nhất lên đầu)
    const sortedReports = reportList.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    const latestItem = sortedReports[0];
    if (!latestItem) {
      logWarn("Không tìm thấy report sau khi sắp xếp.");
      return null;
    }
    
    const latestId = latestItem._id;
    logInfo("Report mới nhất từ list:", { latestId, createdAt: latestItem.created_at });

    // Bước 2: Lấy chi tiết report
    const reportDetail = await fetchReportDetail(latestId);

    if (!reportDetail.markdown) {
      logWarn("Report không có markdown.", { reportId: latestId });
      return null;
    }

    // Bước 3: Normalize report
    const normalized = normalizeReport(reportDetail, latestItem);

    logInfo("Đã lấy và normalize report mới nhất.", {
      reportId: normalized.id,
      createdAt: normalized.date,
      symbolCount: normalized.symbols.length,
      markdownLength: normalized.sectionsMarkdown[0]?.length || 0,
    });

    return normalized;
  } catch (error) {
    logError("Không thể lấy report mới nhất.", { error: (error as Error).message });
    return null;
  }
};

/**
 * Parse markdown để trích xuất symbols
 */
const extractSymbolsFromMarkdown = (markdown: string): string[] => {
  const symbols = new Set<string>();
  
  // Pattern: tìm các symbol dạng XXXUSDT trong bảng
  const symbolPattern = /\b([A-Z]{2,10}USDT)\b/g;
  let match;
  
  while ((match = symbolPattern.exec(markdown)) !== null) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }
  
  return Array.from(symbols);
};

/**
 * Parse markdown để trích xuất thời gian sampling
 */
const extractSamplingTime = (markdown: string): string | null => {
  // Pattern: "sampling start time: 2025-11-30 19:20:14"
  const timeMatch = markdown.match(/sampling start time:\s*([0-9-]+\s+[0-9:]+)/i);
  return timeMatch?.[1] ?? null;
};

/**
 * Normalize report từ API chi tiết
 */
export const normalizeReport = (
  detail: RawReportDetail, 
  listItem?: RawReportListItem
): NormalizedReport => {
  const markdown = detail.markdown || "";
  
  // Trích xuất symbols từ markdown
  const symbols = extractSymbolsFromMarkdown(markdown);
  
  // Trích xuất thời gian sampling
  const samplingTime = extractSamplingTime(markdown);
  
  // Format date
  const rawDate = listItem?.created_at || detail.created_at || new Date().toISOString();
  const date = new Date(rawDate).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Tạo subject
  const subject = detail.metadata?.mail_title || 
    (listItem?.report_type ? `${listItem.report_type} Report` : `Trading Report ${detail._id}`);

  logDebug("Normalizing report.", {
    reportId: detail._id,
    markdownLength: markdown.length,
    symbolCount: symbols.length,
    samplingTime,
  });

  return {
    id: detail._id,
    subject,
    from: "FutureSignal API",
    date,
    rawDate,
    symbols,
    sectionsMarkdown: [markdown], // Toàn bộ markdown là 1 section
    symbolIndicators: [], // Không dùng nữa, dùng markdown thay thế
    reportType: listItem?.report_type || detail.report_type || "unknown",
    metadata: detail.metadata,
    // Tương thích với NormalizedMail
    plainText: markdown,
    htmlText: markdown,
    snippet: symbols.length > 0
      ? `${symbols.length} symbols: ${symbols.slice(0, 5).join(", ")}${symbols.length > 5 ? "..." : ""}`
      : "Không có symbols",
  };
};

/**
 * Lấy thông tin về một symbol cụ thể từ report
 */
export const getSymbolInfo = (report: NormalizedReport, symbol: string): string | null => {
  const upperSymbol = symbol.toUpperCase();
  const markdown = report.sectionsMarkdown[0] || "";

  // Tìm tất cả các dòng liên quan đến symbol trong bảng
  const lines = markdown.split("\n");
  const relevantLines: string[] = [];
  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    // Detect table header
    if (line.includes("| Symbol |") || line.includes("|Symbol|")) {
      inTable = true;
      headers.push(line);
      continue;
    }
    
    // Skip separator line
    if (inTable && line.match(/^\|[\s-|]+\|$/)) {
      headers.push(line);
      continue;
    }

    // Check if line contains our symbol
    if (inTable && line.includes(upperSymbol)) {
      if (relevantLines.length === 0) {
        relevantLines.push(...headers);
      }
      relevantLines.push(line);
    }
  }

  return relevantLines.length > 0 ? relevantLines.join("\n") : null;
};

/**
 * Lấy danh sách symbols có tín hiệu LONG/SHORT từ report
 */
export const getActiveSignals = (
  report: NormalizedReport
): { symbol: string; direction: "LONG" | "SHORT"; timeframe: string; entry?: string; sl?: string; tp1?: string }[] => {
  const signals: { symbol: string; direction: "LONG" | "SHORT"; timeframe: string; entry?: string; sl?: string; tp1?: string }[] = [];
  const markdown = report.sectionsMarkdown[0] || "";

  // Parse markdown table để tìm signals
  const lines = markdown.split("\n");
  
  for (const line of lines) {
    // Tìm dòng có LONG hoặc SHORT trong cột Decision
    if (!line.startsWith("|")) continue;
    
    const cells = line.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length < 8) continue;

    // Format: | Symbol | TF | Decision | PlanSide | EntryType | Price | ...
    const symbol = cells[0];
    const tf = cells[1];
    const decision = cells[2];
    
    if (!symbol || !symbol.match(/[A-Z]+USDT/)) continue;
    
    if (decision === "LONG" || decision === "SHORT") {
      // Tìm Entry, SL, TP từ các cột
      const price = cells[5] || "";
      const sl = cells[7] || "";
      const tp1 = cells[8] || "";
      
      signals.push({
        symbol,
        direction: decision,
        timeframe: tf || "",
        entry: price,
        sl,
        tp1,
      });
    }
  }

  // Loại bỏ duplicates (giữ lại timeframe đầu tiên cho mỗi symbol)
  const unique = signals.filter(
    (sig, index, self) => index === self.findIndex((s) => s.symbol === sig.symbol)
  );

  return unique;
};

// ═══════════════════════════════════════════════════════════
// Legacy functions (backward compatible)
// ═══════════════════════════════════════════════════════════

/**
 * @deprecated Dùng fetchReportList + fetchReportDetail thay thế
 */
export const fetchReportsFromApi = async (): Promise<RawReport[]> => {
  const list = await fetchReportList();
  
  // Chuyển đổi sang format cũ
  return list.map(item => ({
    _id: item._id,
    created_at: item.created_at,
    report_type: item.report_type,
    symbols: item.symbols || [],
    status: item.status || "unknown",
    completed_at: item.completed_at || "",
  }));
};
