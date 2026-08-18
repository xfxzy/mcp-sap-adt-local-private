export class SapHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "SAP_HTTP_ERROR",
  ) {
    super(message);
    this.name = "SapHttpError";
  }
}
