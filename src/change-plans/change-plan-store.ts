export interface ChangePlan<T> {
  id: string;
  kind: "development" | "business";
  systemId: string;
  target: string;
  createdAt: string;
  expiresAt: string;
  expectedHash?: string;
  expectedEtag?: string;
  request: T;
}

export class ChangePlanStore {
  private readonly plans = new Map<string, ChangePlan<unknown>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  put<T>(plan: ChangePlan<T>): ChangePlan<T> {
    if (this.plans.has(plan.id)) {
      throw new Error(`Change plan already exists: ${plan.id}`);
    }
    const createdAt = Date.parse(plan.createdAt);
    const expiresAt = Date.parse(plan.expiresAt);
    if (
      !Number.isFinite(createdAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= createdAt
    ) {
      throw new Error("Change plan timestamps are invalid");
    }
    this.plans.set(plan.id, plan as ChangePlan<unknown>);
    return plan;
  }

  get<T = unknown>(id: string): ChangePlan<T> {
    const plan = this.plans.get(id);
    if (!plan) {
      throw new Error(`Change plan not found or already consumed: ${id}`);
    }
    if (this.now().getTime() >= Date.parse(plan.expiresAt)) {
      this.plans.delete(id);
      throw new Error(`Change plan expired: ${id}`);
    }
    return plan as ChangePlan<T>;
  }

  consume<T = unknown>(id: string): ChangePlan<T> {
    const plan = this.get<T>(id);
    this.plans.delete(id);
    return plan;
  }

  delete(id: string): boolean {
    return this.plans.delete(id);
  }

  clear(): void {
    this.plans.clear();
  }
}
