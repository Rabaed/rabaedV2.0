import { CfnParameter, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ses from "aws-cdk-lib/aws-ses";
import { resourceNames, type EnvironmentConfig } from "./config.ts";

/**
 * How the services send email through Amazon SES (packages/mailer).
 *
 * The sender, a verified address until Rabaed has a domain, is verified by the
 * setup wizard, outside CloudFormation; its address is the MailFromAddress
 * deploy-time parameter (the wizard records it as a GitHub variable), so it
 * is never in the repo. Empty until then: the grant then matches no sender.
 *
 * Every email goes through one configuration set, which publishes bounces and
 * complaints to CloudWatch, by template, and suppresses addresses that
 * bounced or complained.
 */
export class MailSending {
  /** The environment a sending service needs (packages/mailer, mailerFromEnv). */
  readonly environment: Record<string, string>;
  private readonly fromAddress: CfnParameter;
  private readonly configurationSet: ses.ConfigurationSet;

  constructor(stack: Stack, config: EnvironmentConfig) {
    const names = resourceNames(config);
    this.fromAddress = new CfnParameter(stack, "MailFromAddress", {
      type: "String",
      default: "",
      allowedPattern: String.raw`^$|^[^@\s]+@[^@\s]+\.[^@\s]+$`,
      description: "The verified SES sender every email comes from (setup wizard); empty until it is verified",
    });
    this.configurationSet = new ses.ConfigurationSet(stack, "MailConfigurationSet", {
      configurationSetName: names.mailConfigurationSet,
      reputationMetrics: true,
      sendingEnabled: true,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
    });
    this.configurationSet.addEventDestination("BouncesAndComplaints", {
      destination: ses.EventDestination.cloudWatchDimensions([
        { name: "template", source: ses.CloudWatchDimensionSource.MESSAGE_TAG, defaultValue: "none" },
      ]),
      events: [ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.COMPLAINT],
    });
    this.environment = {
      MAIL_FROM: this.fromAddress.valueAsString,
      MAIL_SES_CONFIGURATION_SET: names.mailConfigurationSet,
    };
  }

  /**
   * Lets a task role send email: ses:SendEmail only, only from the configured
   * address (whether SES verified it as an address or by its domain), only
   * through the configuration set. Only the services that send email get it.
   */
  grantSend(role: iam.IRole): void {
    const stack = Stack.of(this.configurationSet);
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [
          stack.formatArn({ service: "ses", resource: "configuration-set", resourceName: this.configurationSet.configurationSetName }),
          stack.formatArn({ service: "ses", resource: "identity", resourceName: "*" }),
        ],
        conditions: { StringEquals: { "ses:FromAddress": this.fromAddress.valueAsString } },
      }),
    );
  }
}
