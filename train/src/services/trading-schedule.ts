/**
 * Trading Schedule Parser - 类似crontab的交易时间表达式解析器
 *
 * 格式: "分钟 小时 日 月 星期"
 * - 分钟: 0-59
 * - 小时: 0-23 (UTC)
 * - 日: 1-31
 * - 月: 1-12
 * - 星期: 0-6 (0=周日, 1-6=周一到周六)
 *
 * 特殊字符:
 * - * : 任意值
 * - - : 范围 (例如: 9-17表示9点到17点)
 * - , : 列表 (例如: 1,2,3表示周一、周二、周三)
 * - / : 步长 (例如: *\/2表示每2个单位)
 *
 * 预设模式:
 * - "ALWAYS"          : 总是允许 (等同于 "* * * * *")
 * - "WEEKDAYS"        : 工作日全天 (等同于 "* * * * 1-5")
 * - "AVOID_SPREAD"    : 避开高点差时段 (等同于 "* 0-19 * * 1-5")
 * - "ASIA_HOURS"      : 亚洲交易时段 (等同于 "* 0-8 * * 1-5")
 * - "EUROPE_HOURS"    : 欧洲交易时段 (等同于 "* 7-16 * * 1-5")
 * - "US_HOURS"        : 美国交易时段 (等同于 "* 13-21 * * 1-5")
 * - "OVERLAP_HOURS"   : 欧美重叠时段 (等同于 "* 13-16 * * 1-5")
 */

export type SchedulePreset =
  | 'ALWAYS'
  | 'WEEKDAYS'
  | 'AVOID_SPREAD'
  | 'ASIA_HOURS'
  | 'EUROPE_HOURS'
  | 'US_HOURS'
  | 'OVERLAP_HOURS'
  | 'NO_SPREAD';

interface ParsedSchedule {
  readonly minute: readonly number[];
  readonly hour: readonly number[];
  readonly day: readonly number[];
  readonly month: readonly number[];
  readonly weekday: readonly number[];
}

export class TradingSchedule {
  private readonly schedule: string;
  private readonly parsed: ParsedSchedule;

  constructor(schedule: string | SchedulePreset = 'ALWAYS') {
    this.schedule = schedule;
    this.parsed = this.parseSchedule(schedule);
  }

  /**
   * 解析时间表达式
   */
  private parseSchedule(schedule: string): ParsedSchedule {
    // 预设模式
    const presets: Record<SchedulePreset, string> = {
      ALWAYS: '* * * * *',
      WEEKDAYS: '* * * * 1-5',
      AVOID_SPREAD: '* 0-19 * * 1-5', // 避开UTC 20-23点
      ASIA_HOURS: '* 0-8 * * 1-5',
      EUROPE_HOURS: '* 7-16 * * 1-5',
      US_HOURS: '* 13-21 * * 1-5',
      OVERLAP_HOURS: '* 13-16 * * 1-5',
      NO_SPREAD: '* 0-19 * * 1-5' // 同AVOID_SPREAD
    };

    const expr = presets[schedule as SchedulePreset] ?? schedule;
    const parts = expr.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(
        `Invalid schedule format: ${schedule}. Expected "minute hour day month weekday"`
      );
    }

    return {
      minute: this.parseField(parts[0]!, 0, 59),
      hour: this.parseField(parts[1]!, 0, 23),
      day: this.parseField(parts[2]!, 1, 31),
      month: this.parseField(parts[3]!, 1, 12),
      weekday: this.parseField(parts[4]!, 0, 6)
    };
  }

  /**
   * 解析单个字段 (支持 *, -, ,, /)
   */
  private parseField(field: string, min: number, max: number): readonly number[] {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    }

    const values: number[] = [];

    // 处理逗号分隔的列表
    field.split(',').forEach(part => {
      // 处理范围 (例如: 9-17)
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = Number(startStr);
        const end = Number(endStr);
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max) {
            values.push(i);
          }
        }
      }
      // 处理步长 (例如: */2)
      else if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = Number(stepStr);
        const rangeValues =
          range === '*'
            ? Array.from({ length: max - min + 1 }, (_, i) => i + min)
            : [Number(range)];

        rangeValues.forEach((v, idx) => {
          if (idx % step === 0 && v >= min && v <= max) {
            values.push(v);
          }
        });
      }
      // 单个数值
      else {
        const num = Number(part);
        if (num >= min && num <= max) {
          values.push(num);
        }
      }
    });

    return [...new Set(values)].sort((a, b) => a - b);
  }

  /**
   * 检查给定时间是否允许交易
   */
  isAllowed(date: Date): boolean {
    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const day = date.getUTCDate();
    const month = date.getUTCMonth() + 1; // getUTCMonth()返回0-11
    const weekday = date.getUTCDay();

    return (
      this.parsed.minute.includes(minute) &&
      this.parsed.hour.includes(hour) &&
      this.parsed.day.includes(day) &&
      this.parsed.month.includes(month) &&
      this.parsed.weekday.includes(weekday)
    );
  }

  /**
   * 获取时间表达式的可读描述
   */
  getDescription(): string {
    const presetDescriptions: Record<SchedulePreset, string> = {
      ALWAYS: '任何时间都允许交易',
      WEEKDAYS: '周一到周五全天',
      AVOID_SPREAD: '周一到周五 UTC 00:00-19:59 (避开高点差时段)',
      ASIA_HOURS: '周一到周五亚洲交易时段 (UTC 00:00-08:59)',
      EUROPE_HOURS: '周一到周五欧洲交易时段 (UTC 07:00-16:59)',
      US_HOURS: '周一到周五美国交易时段 (UTC 13:00-21:59)',
      OVERLAP_HOURS: '周一到周五欧美重叠时段 (UTC 13:00-16:59)',
      NO_SPREAD: '周一到周五 UTC 00:00-19:59 (避开高点差时段)'
    };

    const description = presetDescriptions[this.schedule as SchedulePreset];
    if (description) {
      return description;
    }

    // 生成自定义表达式的描述
    const parts: string[] = [];

    if (this.parsed.weekday.length < 7) {
      const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const days = this.parsed.weekday.map(d => weekdayNames[d]!).join('、');
      parts.push(days);
    }

    if (this.parsed.hour.length < 24) {
      const hours = this.formatRange(this.parsed.hour);
      parts.push(`UTC ${hours}点`);
    }

    if (this.parsed.month.length < 12) {
      const months = this.formatRange(this.parsed.month);
      parts.push(`${months}月`);
    }

    return parts.length > 0 ? parts.join(', ') : '任何时间';
  }

  /**
   * 格式化数字范围为可读字符串
   */
  private formatRange(arr: readonly number[]): string {
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0]!.toString();

    const ranges: string[] = [];
    let start = arr[0]!;
    let prev = arr[0]!;

    for (let i = 1; i < arr.length; i++) {
      const current = arr[i]!;
      if (current === prev + 1) {
        prev = current;
      } else {
        ranges.push(start === prev ? start.toString() : `${start}-${prev}`);
        start = current;
        prev = current;
      }
    }
    ranges.push(start === prev ? start.toString() : `${start}-${prev}`);

    return ranges.join(', ');
  }

  /**
   * 获取下一个允许交易的时间
   */
  getNextAllowedTime(fromDate: Date, maxMinutes: number = 1440): Date | null {
    const date = new Date(fromDate);

    for (let i = 0; i < maxMinutes; i++) {
      date.setUTCMinutes(date.getUTCMinutes() + 1);
      if (this.isAllowed(date)) {
        return date;
      }
    }

    return null;
  }
}

/**
 * 便捷函数: 创建交易时间表
 */
export function createTradingSchedule(schedule: string | SchedulePreset): TradingSchedule {
  return new TradingSchedule(schedule);
}

/**
 * 便捷函数: 检查时间是否允许交易
 */
export function isTradingAllowed(schedule: string | SchedulePreset, date: Date): boolean {
  const ts = new TradingSchedule(schedule);
  return ts.isAllowed(date);
}
