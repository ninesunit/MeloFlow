import "server-only";

/** An error whose message is safe to show to the signed-in admin. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
