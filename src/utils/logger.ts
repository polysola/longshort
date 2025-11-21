type LogPayload = Record<string, unknown> | undefined;

const formatPayload = (payload?: LogPayload): string => {
  if (!payload) {
    return "";
  }

  try {
    return ` | data=${JSON.stringify(payload)}`;
  } catch {
    return " | data=[unserializable]";
  }
};

const log = (level: "INFO" | "ERROR" | "WARN" | "DEBUG", message: string, payload?: LogPayload) => {
  const text = `${new Date().toISOString()} [${level}] ${message}${formatPayload(payload)}`;

  if (level === "ERROR") {
    console.error(text);
    return;
  }

  if (level === "WARN") {
    console.warn(text);
    return;
  }

  if (level === "DEBUG") {
    console.debug(text);
    return;
  }

  console.info(text);
};

export const logInfo = (message: string, payload?: LogPayload) => log("INFO", message, payload);
export const logWarn = (message: string, payload?: LogPayload) => log("WARN", message, payload);
export const logError = (message: string, payload?: LogPayload) => log("ERROR", message, payload);
export const logDebug = (message: string, payload?: LogPayload) => log("DEBUG", message, payload);

