import { describe, expect, it } from "vitest";
import { accountTemplate } from "./support.ts";

describe("cost budget", () => {
  const template = accountTemplate();

  it("alerts by email on the monthly cost budget, at 80% actual and 100% forecast", () => {
    const budgets = Object.values(template.findResources("AWS::Budgets::Budget"));
    expect(budgets).toHaveLength(1);
    const { Budget, NotificationsWithSubscribers } = budgets[0]!.Properties;
    expect(Budget).toMatchObject({ BudgetType: "COST", TimeUnit: "MONTHLY", BudgetLimit: { Amount: 150, Unit: "USD" } });
    expect(NotificationsWithSubscribers).toEqual(
      [
        { NotificationType: "ACTUAL", Threshold: 80 },
        { NotificationType: "FORECASTED", Threshold: 100 },
      ].map((when) => ({
        Notification: { ...when, ComparisonOperator: "GREATER_THAN", ThresholdType: "PERCENTAGE" },
        Subscribers: [{ SubscriptionType: "EMAIL", Address: { Ref: "BudgetAlertEmail" } }],
      })),
    );
  });

  it("takes the alert email at deploy time, so it is never in the repo or the template", () => {
    const parameter = template.toJSON().Parameters.BudgetAlertEmail;
    expect(parameter).toMatchObject({ Type: "String", NoEcho: true });
    expect(parameter).not.toHaveProperty("Default");
  });
});
