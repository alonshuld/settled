import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FxService } from '../fx/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { ReceiptsService } from '../uploads/receipts.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type TaskResult = Record<string, unknown>;

/**
 * Time-based jobs (design §10). The free API host sleeps when idle, so nothing here relies on the process staying up:
 * cron-job.org calls `POST /internal/cron` every 5 minutes and each task checks what is due in the database.
 */
@Injectable()
export class CronService {
  private readonly log = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly reminders: RemindersService,
    private readonly receipts: ReceiptsService,
  ) {}

  /** Runs every task that is due. One failing task never blocks the others. */
  async tick(now = new Date()): Promise<Record<string, TaskResult | { error: string }>> {
    const tasks: { name: string; every: number | null; run: () => Promise<TaskResult> }[] = [
      { name: 'reminders.autoRepeat', every: null, run: () => this.reminders.runDue(now) },
      { name: 'fx.daily', every: null, run: async () => (await this.fx.ensureToday(), {}) },
      { name: 'cleanup.idempotency', every: HOUR, run: () => this.cleanIdempotency(now) },
      { name: 'cleanup.uploads', every: DAY, run: () => this.cleanUploads() },
      { name: 'cleanup.guests', every: DAY, run: () => this.cleanGuests(now) },
    ];
    const out: Record<string, TaskResult | { error: string }> = {};
    for (const t of tasks) {
      try {
        if (t.every !== null && !(await this.claim(t.name, t.every, now))) continue;
        out[t.name] = await t.run();
      } catch (e) {
        this.log.error(`cron task ${t.name} failed: ${(e as Error).message}`);
        out[t.name] = { error: (e as Error).message };
      }
    }
    return out;
  }

  /**
   * Marks a periodic task as started if it is due. The update is conditional, so two overlapping ticks
   * cannot both claim it; a task that then fails is retried after its full interval (fine for cleanups).
   */
  private async claim(task: string, everyMs: number, now: Date): Promise<boolean> {
    const dueBefore = new Date(now.getTime() - everyMs);
    const updated = await this.prisma.cronRun.updateMany({ where: { task, lastRunAt: { lt: dueBefore } }, data: { lastRunAt: now } });
    if (updated.count > 0) return true;
    try {
      await this.prisma.cronRun.create({ data: { task, lastRunAt: now } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // row exists and is not due
      throw e;
    }
  }

  private async cleanIdempotency(now: Date) {
    const { count } = await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY) } } });
    return { deleted: count };
  }

  private async cleanUploads() {
    const deleted = await this.receipts.deleteOrphans(async (keys) => {
      const rows = await this.prisma.expense.findMany({ where: { receiptKey: { in: keys } }, select: { receiptKey: true } });
      return new Set(rows.map((r) => r.receiptKey!));
    }, DAY);
    return { deleted };
  }

  /** Guests that never joined a group and have not been seen for 30 days. */
  private async cleanGuests(now: Date) {
    const cutoff = new Date(now.getTime() - 30 * DAY);
    const { count } = await this.prisma.user.deleteMany({
      where: {
        isAnonymous: true,
        updatedAt: { lt: cutoff },
        members: { none: {} },
        sessions: { none: { updatedAt: { gte: cutoff } } },
      },
    });
    return { deleted: count };
  }
}
