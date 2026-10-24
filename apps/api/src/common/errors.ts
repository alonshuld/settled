export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'SPLIT_SUM_MISMATCH'
  | 'UNSUPPORTED_CURRENCY'
  | 'FX_RATE_UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'NOT_A_MEMBER'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'MEMBER_ALREADY_CLAIMED'
  | 'VERSION_CONFLICT'
  | 'LEAVE_WITH_OPEN_BALANCE'
  | 'GROUP_CLOSED'
  | 'GROUP_HAS_EXPENSES'
  | 'CURRENCY_LOCKED'
  | 'MEMBER_HAS_ACTIVITY'
  | 'REMINDER_CHANNEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UPLOADS_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}
