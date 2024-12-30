import { Octokit as OctokitCore } from "npm:octokit";
import * as actions from "npm:@actions/core";
import * as webhooks from "npm:@octokit/webhooks-types";

const ghToken = Deno.env.get("GH_TOKEN");
if (!ghToken) {
  actions.setFailed("GH_TOKEN not set");
  Deno.exit(1);
}
const octokit = new OctokitCore({ auth: ghToken });

const ghEvent = Deno.env.get("GH_EVENT");
if (!ghEvent) {
  actions.setFailed("GH_EVENT not set");
  Deno.exit(1);
}
const ghRef = Deno.env.get("GH_REF");
if (!ghRef) {
  actions.setFailed("GH_REF not set");
  Deno.exit(1);
}

const event = JSON.parse(ghEvent) as webhooks.MergeGroupChecksRequestedEvent;
const owner = event.repository.owner.login;
const repo = event.repository.name;
// https://bufferings.hatenablog.com/entry/2024/02/10/173552#:~:text=%E3%81%93%E3%82%8C%E3%81%8B%E3%82%99%E3%80%81%20on%3A%20merge_group%20%E3%81%9F%E3%82%99%E3%81%A8%E2%86%93%E3%81%93%E3%81%86%E3%81%AA%E3%82%8B
// refはこのような形式：`refs/heads/gh-readonly-queue/main/pr-9-585e0bea0e4a1d10ce8ba48e5a6fa9615ee6553e`
const prNumber = ghRef.match(/pr-(\d+)-/)?.[1];
if (!prNumber) {
  actions.setFailed("PR number not found");
  Deno.exit(1);
}

const { data: checks } = await octokit.rest.checks.listForRef({
  owner,
  repo,
  ref: `refs/pull/${prNumber}/head`,
});

let check = checks.check_runs.find((c) => c.name === "approve");
let count = 0;
while (!check && count < 10) {
  console.log("Check not found, retrying...");
  await new Promise((r) => setTimeout(r, 1000));
  const { data: checks } = await octokit.rest.checks.listForRef({
    owner,
    repo,
    ref: `refs/pull/${prNumber}/head`,
  });
  check = checks.check_runs.find((c) => c.name === "approve");
  count++;
}
if (!check) {
  actions.setFailed("Check not found");
  Deno.exit(1);
}

let success = false;
// タイムアウト：20秒
for (let i = 0; i < 20; i++) {
  const { data: job } = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/jobs/{job_id}",
    {
      owner,
      repo,
      job_id: check.id,
    },
  );
  if (job.status === "completed") {
    success = job.conclusion === "success";
    break;
  }
  console.log(`Waiting for job #${check.id} to complete...`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!success) {
  console.log("Approve check did not succeed");
  Deno.exit(1);
}

console.log("Approve check succeeded");
