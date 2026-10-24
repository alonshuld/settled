/** Kept for later: phone OTP login needs an SMS provider, which costs money (design §5.1). */
export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

export class NoSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    throw new Error('No SMS provider configured');
  }
}
