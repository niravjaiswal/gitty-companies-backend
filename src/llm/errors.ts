export class LlmResponseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "LlmResponseError";
  }
}

export class JsonParseError extends LlmResponseError {
  constructor(rawResponse: string, cause?: Error) {
    super("Failed to parse LLM response as JSON after retry", rawResponse, cause);
    this.name = "JsonParseError";
  }
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly zodErrors: unknown,
    public readonly rawParsed: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export class CoherenceValidationError extends Error {
  constructor(
    message: string,
    public readonly coherenceErrors: string[],
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = "CoherenceValidationError";
  }
}
