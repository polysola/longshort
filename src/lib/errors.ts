export class AppError extends Error {
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ConfigError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ExternalServiceError";
  }
}

export class ProcessingError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ProcessingError";
  }
}

