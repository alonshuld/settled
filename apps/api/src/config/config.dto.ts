import { z } from 'zod';

/** GET /config: what the client needs before sign-in (design §9.0). */
export const ConfigDto = z
  .object({
    auth: z.object({
      google: z.boolean(),
      emailOtp: z.boolean(),
      phoneOtp: z.boolean(),
      guest: z.boolean(),
    }),
    /** `vapidPublicKey` is null when web push is off. */
    push: z.object({ vapidPublicKey: z.string().nullable() }),
    reminderChannels: z.array(z.enum(['push', 'email', 'whatsapp', 'sms'])),
  })
  .meta({ id: 'Config' });
export type ConfigDto = z.infer<typeof ConfigDto>;
