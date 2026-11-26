// The one public door: a load balancer shared by dev and prod. Each environment's API is
// attached later as a rule on the HTTPS listener, by its own address (api.postsocial.xyz,
// api-dev.postsocial.xyz). Kept in its own stack so deploying an environment can't change it.
import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
import { ENVIRONMENTS } from "./config";

export interface EdgeStackProps extends StackProps {
  vpc: ec2.IVpc;
}

export class EdgeStack extends Stack {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly httpsListener: elbv2.ApplicationListener;
  // The load balancer's firewall group. It may call nothing until a services stack adds a
  // rule for its own API containers.
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    const access = new ec2.SecurityGroup(this, "LoadBalancerAccess", { vpc, description: "Post Social load balancer: web traffic in, API containers out", allowAllOutbound: false });
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      loadBalancerName: "postsocial",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      internetFacing: true,
      securityGroup: access,
      dropInvalidHeaderFields: true,
      deletionProtection: true,
      idleTimeout: Duration.seconds(60),
    });

    // One certificate for both addresses. AWS issues it once the DNS records it asks for
    // exist in Cloudflare; the first deploy waits for that.
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: ENVIRONMENTS.prod.apiDomain,
      subjectAlternativeNames: [ENVIRONMENTS.dev.apiDomain],
      validation: acm.CertificateValidation.fromDns(),
    });

    this.loadBalancer.addListener("Http", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
    });
    // Anything that isn't one of our addresses gets a plain 404.
    this.httpsListener = this.loadBalancer.addListener("Https", {
      port: 443,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: "text/plain", messageBody: "Not found" }),
    });

    this.securityGroup = access;
    acknowledge(access, { id: "AwsSolutions-EC23", reason: "A public load balancer takes web traffic from anywhere, on 80 (redirect) and 443 only." });
    acknowledge(this.loadBalancer, { id: "AwsSolutions-ELB2", reason: "Access logs need their own bucket; the API's own request logs cover us at this size. Revisit with the first security review on AWS." });
  }
}
