type Severity = "INFO" | "WARNING" | "ERROR";

interface LogEntry {
  severity: Severity;
  message: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  if (entry.severity === "ERROR") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>) =>
    emit({ severity: "INFO", message, ...data }),

  warn: (message: string, data?: Record<string, unknown>) =>
    emit({ severity: "WARNING", message, ...data }),

  error: (message: string, data?: Record<string, unknown>) =>
    emit({ severity: "ERROR", message, ...data }),
};
