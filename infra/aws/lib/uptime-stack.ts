// The uptime check for an environment: is the website up, does the API answer through it,
// and is the publishing worker alive.
//
// A small function asks all three every minute and records each answer as a number (1 up,
// 0 down). One alarm per check sends a message to the alerts topic when its number has been
// 0, or missing, for three minutes in a row, and another when it recovers. Missing counts as
// down on purpose: if the check itself stops running, that is an alert too.
//
// It runs in AWS because GitHub runs this repository's schedules a few times a day at best
// (seen 2026-11-27). The GitHub check (.github/workflows/uptime.yml) stays as a second
// opinion from outside AWS: this one lives in the same region as the API, so an outage of
// the whole region could silence it.
//
// Its own stack, so changing the check can never touch a service or the database.
import path from "node:path";
import { type CfnElement, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
import { ENVIRONMENTS, UPTIME_MINUTES_BEFORE_ALERT, type EnvName } from "./config";

export interface UptimeStackProps extends StackProps {
  envName: EnvName;
  // The public website of this environment, with no slash at the end.
  website: string;
  // Where the alarms send their messages (lib/backup-stack.ts owns the topic).
  alerts: sns.ITopic;
}

export type UptimeCheck = { name: string; url: string; mustContain?: string; says: string };

// What is asked, and what the alert says in plain words when it fails.
export const uptimeChecks = (envName: EnvName, website: string): UptimeCheck[] => [
  { name: "website", url: `${website}/`, says: "The website does not answer." },
  // The same path people's agents use: through the website to the API.
  { name: "api", url: `${website}/api/v1/openapi.json`, says: "The API does not answer through the website." },
  // The worker has no address of its own. It writes a sign of life to the database every
  // half minute and the API reports it; this also fails when the API or the database is down.
  {
    name: "worker",
    url: `https://${ENVIRONMENTS[envName].apiDomain}/readyz/worker`,
    mustContain: '"ok":true',
    says: "The publishing worker has shown no sign of life for 5 minutes, or the API or the database behind it is down. Scheduled posts are not going out.",
  },
];

export class UptimeStack extends Stack {
  constructor(scope: Construct, id: string, props: UptimeStackProps) {
    super(scope, id, props);
    const { envName, website, alerts } = props;
    const name = `postsocial-${envName}-uptime`;
    const checks = uptimeChecks(envName, website);

    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/postsocial/${envName}/uptime`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    // The function may write its own log and nothing else: it holds no keys and sits outside
    // our network, so it sees only what anyone on the internet sees.
    const role = new iam.Role(this, "Role", { roleName: name, assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com") });
    const logStreams = `${logGroup.logGroupArn}:*`;
    role.addToPolicy(new iam.PolicyStatement({ sid: "WriteItsOwnLog", actions: ["logs:CreateLogStream", "logs:PutLogEvents"], resources: [logStreams] }));

    const checker = new lambda.Function(this, "Checker", {
      functionName: name,
      description: `Asks the ${envName} website, API and worker whether they are up, every minute`,
      runtime: lambda.Runtime.NODEJS_26_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/uptime")),
      memorySize: 128,
      timeout: Duration.seconds(30),
      role,
      logGroup,
      environment: {
        ENVIRONMENT: envName,
        CHECKS: JSON.stringify(checks.map(({ name: check, url, mustContain }) => ({ name: check, url, ...(mustContain ? { mustContain } : {}) }))),
      },
    });
    const everyMinute = new events.Rule(this, "EveryMinute", { ruleName: name, description: `Run the ${envName} uptime check`, schedule: events.Schedule.rate(Duration.minutes(1)) });
    // No retries: the next minute is the retry.
    everyMinute.addTarget(new targets.LambdaFunction(checker, { retryAttempts: 0 }));

    for (const check of checks) {
      const alarm = new cloudwatch.Alarm(this, `${check.name}Down`, {
        alarmName: `postsocial-${envName}-${check.name}-down`,
        alarmDescription: `Post Social ${envName}: ${check.says} Checked every minute at ${check.url}. What each check answered is in the log group ${logGroup.logGroupName}.`,
        metric: new cloudwatch.Metric({
          namespace: "PostSocial/Uptime",
          metricName: "Up",
          dimensionsMap: { Environment: envName, Check: check.name },
          statistic: "Minimum",
          period: Duration.minutes(1),
        }),
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        threshold: 1,
        evaluationPeriods: UPTIME_MINUTES_BEFORE_ALERT,
        datapointsToAlarm: UPTIME_MINUTES_BEFORE_ALERT,
        // A check that stopped running is as bad as a check that fails.
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      alarm.addAlarmAction(new actions.SnsAction(alerts));
      alarm.addOkAction(new actions.SnsAction(alerts));
      // Made after the schedule, so the first numbers are already arriving.
      alarm.node.addDependency(everyMinute);
    }

    acknowledge(role, { id: `AwsSolutions-IAM5[Resource::<${this.getLogicalId(logGroup.node.defaultChild as CfnElement)}.Arn>:*]`, reason: "Every stream in the function's own log group: stream names are made up by AWS for each run." });
  }
}
