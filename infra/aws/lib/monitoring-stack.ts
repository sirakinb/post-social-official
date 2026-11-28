// One screen for the whole product, and the alarms that go beyond "is it up".
//
// The dashboard (postsocial-overview) shows prod and dev side by side: is it up, how many
// requests and errors, how fast, how hard the API, the worker and the database are working.
// It only reads numbers AWS already keeps, so it costs nothing at this size.
//
// The alarms are for watched environments only (prod). Each sends to the alerts topic when
// it starts and again when it clears:
//   api-errors             the API answered with a server error several times in 5 minutes
//   api-no-healthy-copy    the load balancer has no healthy API container to send to
//   database-storage-low   the database's disk is filling up
//   database-cpu-high      the database's processor has been busy for 15 minutes
// The uptime alarms (lib/uptime-stack.ts) say whether people can reach us; these say why
// not, or that trouble is on its way.
//
// Its own stack, so changing a chart or a limit can never touch a service or the database.
import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import { ACCOUNT, API_ERRORS_BEFORE_ALERT, CLUSTER_NAME, DATABASE_CPU_LIMIT, DATABASE_FREE_GB_LIMIT, ENV_NAMES, REGION, WATCHED, type EnvName } from "./config";
import type { EdgeStack } from "./edge-stack";
import type { ServicesStack } from "./services-stack";
import { uptimeChecks } from "./uptime-stack";

export interface MonitoringStackProps extends StackProps {
  edge: EdgeStack;
  services: Record<EnvName, ServicesStack>;
  // Where each watched environment's alarms send their messages.
  alerts: Partial<Record<EnvName, sns.ITopic>>;
}

const GB = 1024 ** 3;
const FIVE_MINUTES = Duration.minutes(5);

export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { edge, services, alerts } = props;

    // The numbers AWS keeps for one environment, by the names it files them under.
    const numbers = (envName: EnvName) => {
      const api = { LoadBalancer: edge.loadBalancer.loadBalancerFullName, TargetGroup: services[envName].apiTargets.targetGroupFullName };
      const database = { DBInstanceIdentifier: `postsocial-${envName}` };
      const service = (part: "api" | "worker") => ({ ClusterName: CLUSTER_NAME, ServiceName: `postsocial-${envName}-${part}` });
      const metric = (namespace: string, metricName: string, dimensionsMap: Record<string, string>, statistic: string, label: string, period = FIVE_MINUTES) =>
        new cloudwatch.Metric({ namespace, metricName, dimensionsMap, statistic, label, period });
      return {
        requests: metric("AWS/ApplicationELB", "RequestCount", api, "Sum", "Requests"),
        serverErrors: metric("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", api, "Sum", "Server errors (5xx)"),
        clientErrors: metric("AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", api, "Sum", "Refused or not found (4xx)"),
        typicalTime: metric("AWS/ApplicationELB", "TargetResponseTime", api, "p50", "Typical"),
        slowTime: metric("AWS/ApplicationELB", "TargetResponseTime", api, "p95", "Slowest 5%"),
        healthyCopies: metric("AWS/ApplicationELB", "HealthyHostCount", api, "Minimum", "Healthy API containers", Duration.minutes(1)),
        apiCpu: metric("AWS/ECS", "CPUUtilization", service("api"), "Average", "API processor %"),
        apiMemory: metric("AWS/ECS", "MemoryUtilization", service("api"), "Average", "API memory %"),
        workerCpu: metric("AWS/ECS", "CPUUtilization", service("worker"), "Average", "Worker processor %"),
        workerMemory: metric("AWS/ECS", "MemoryUtilization", service("worker"), "Average", "Worker memory %"),
        databaseCpu: metric("AWS/RDS", "CPUUtilization", database, "Average", "Database processor %"),
        databaseConnections: metric("AWS/RDS", "DatabaseConnections", database, "Maximum", "Open connections"),
        databaseFreeStorage: metric("AWS/RDS", "FreeStorageSpace", database, "Minimum", "Free disk"),
        databaseFreeMemory: metric("AWS/RDS", "FreeableMemory", database, "Minimum", "Free memory"),
      };
    };

    // --- Alarms ------------------------------------------------------------------------
    const alarmNames: string[] = [];
    for (const envName of ENV_NAMES) {
      const topic = alerts[envName];
      if (!topic) continue;
      const n = numbers(envName);
      const alarm = (part: string, says: string, settings: Omit<cloudwatch.AlarmProps, "alarmName" | "alarmDescription">) => {
        const alarmName = `postsocial-${envName}-${part}`;
        const made = new cloudwatch.Alarm(this, `${envName}${part}`, { alarmName, alarmDescription: `Post Social ${envName}: ${says}`, ...settings });
        made.addAlarmAction(new actions.SnsAction(topic));
        made.addOkAction(new actions.SnsAction(topic));
        alarmNames.push(alarmName);
      };
      alarm("api-errors", `The API answered with a server error ${API_ERRORS_BEFORE_ALERT} or more times in 5 minutes. Look in the log group /postsocial/${envName}/api for lines with "status":5.`, {
        metric: n.serverErrors,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        threshold: API_ERRORS_BEFORE_ALERT,
        evaluationPeriods: 1,
        // No number means no errors: AWS only records this one when there is something to count.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm("api-no-healthy-copy", "The load balancer has had no healthy API container for 2 minutes, so every request is failing. Look at the service's events and the API log.", {
        metric: n.healthyCopies,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        threshold: 1,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      alarm("database-storage-low", `The database has less than ${DATABASE_FREE_GB_LIMIT} GB of free disk. AWS grows the disk by itself up to 100 GB; this is the early warning that something is filling it.`, {
        metric: n.databaseFreeStorage,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        threshold: DATABASE_FREE_GB_LIMIT * GB,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm("database-cpu-high", `The database's processor has been above ${DATABASE_CPU_LIMIT}% for 15 minutes. A slow query or a stuck job is the usual cause; slow queries are in the database's own log.`, {
        metric: n.databaseCpu,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        threshold: DATABASE_CPU_LIMIT,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    // --- The overview dashboard --------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, "Overview", { dashboardName: "postsocial-overview", defaultInterval: Duration.hours(24) });
    const graph = (title: string, left: cloudwatch.IMetric[], more: Partial<cloudwatch.GraphWidgetProps> = {}) => new cloudwatch.GraphWidget({ title, left, width: 6, height: 5, leftYAxis: { min: 0 }, ...more });
    const percent = { leftYAxis: { min: 0, max: 100 } };

    // Every alarm of the watched environments in one strip: green, red, or no data yet.
    const watchedAlarms = (Object.keys(WATCHED) as EnvName[]).flatMap((envName) => [
      ...uptimeChecks(envName, WATCHED[envName]!.website).map((check) => `postsocial-${envName}-${check.name}-down`),
      ...alarmNames.filter((name) => name.startsWith(`postsocial-${envName}-`)),
    ]);
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Alarms (each one emails the owner)",
        width: 24,
        height: 3,
        alarms: watchedAlarms.map((name) => cloudwatch.Alarm.fromAlarmArn(this, `Shown${name}`, `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:${name}`)),
      }),
    );

    for (const envName of ENV_NAMES) {
      const n = numbers(envName);
      const watched = WATCHED[envName];
      const up = (check: string) => new cloudwatch.Metric({ namespace: "PostSocial/Uptime", metricName: "Up", dimensionsMap: { Environment: envName, Check: check }, statistic: "Minimum", label: check, period: Duration.minutes(1) });
      dashboard.addWidgets(new cloudwatch.TextWidget({ markdown: `## ${envName === "prod" ? "Prod" : "Dev"}`, width: 24, height: 1, background: cloudwatch.TextWidgetBackground.TRANSPARENT }));
      dashboard.addWidgets(
        watched
          ? graph("Is it up? (1 yes, 0 no)", uptimeChecks(envName, watched.website).map((check) => up(check.name)), { leftYAxis: { min: 0, max: 1 } })
          : graph("Healthy API containers", [n.healthyCopies]),
        graph("Requests", [n.requests]),
        graph("Errors", [n.serverErrors, n.clientErrors]),
        graph("Response time (seconds)", [n.typicalTime, n.slowTime]),
      );
      dashboard.addWidgets(
        graph("API and worker: processor", [n.apiCpu, n.workerCpu], percent),
        graph("API and worker: memory", [n.apiMemory, n.workerMemory], percent),
        graph("Database: processor and connections", [n.databaseCpu], { ...percent, right: [n.databaseConnections], rightYAxis: { min: 0 } }),
        graph("Database: free disk and memory", [n.databaseFreeStorage], { right: [n.databaseFreeMemory], rightYAxis: { min: 0 } }),
      );
    }
  }
}
