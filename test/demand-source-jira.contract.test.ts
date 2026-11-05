import { describe } from "vitest";
import { createJiraDemandSource } from "../src/jira-demand-source.js";
import { describeDemandSourceContract } from "./demand-source.contract.js";

const project = process.env.TEST_JIRA_PROJECT;
const assignee = process.env.TEST_JIRA_ASSIGNEE;
const existingCardKey = process.env.TEST_JIRA_CARD;
const transitionFrom = process.env.TEST_JIRA_TRANSITION_FROM;
const transitionTo = process.env.TEST_JIRA_TRANSITION_TO;

if (project && assignee && existingCardKey) {
  const p = project;
  const a = assignee;
  const k = existingCardKey;
  describeDemandSourceContract("JiraDemandSource (real - opt-in)", () => {
    const source = createJiraDemandSource({
      project: p,
      assignee: a,
    });

    return {
      source,
      project: p,
      assignee: a,
      existingCardKey: k,
      transition:
        transitionFrom && transitionTo
          ? {
              fromStatus: transitionFrom,
              toStatus: transitionTo,
            }
          : undefined,
    };
  });
} else {
  describe.skip("Contrato DemandSource: JiraDemandSource (real - opt-in)", () => {
    // Pulado na CI e por padrão.
    // Para rodar manualmente fora da CI contra um projeto sandbox:
    // TEST_JIRA_PROJECT=SANDBOX TEST_JIRA_ASSIGNEE=seu-id TEST_JIRA_CARD=SANDBOX-1 npm test
  });
}
