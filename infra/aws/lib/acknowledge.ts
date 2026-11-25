// AWS's checklist (cdk-nag) fails the build on every finding. Where we choose differently on
// purpose, the choice is recorded next to the resource with its reason, using this.
import { Validations } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

export function acknowledge(construct: IConstruct, ...findings: { id: string; reason: string }[]) {
  for (const finding of findings) Validations.of(construct).acknowledge(finding);
}
