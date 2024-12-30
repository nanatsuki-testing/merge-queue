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
const event = JSON.parse(ghEvent) as
  | webhooks.PullRequestAutoMergeEnabledEvent
  | webhooks.MergeGroupChecksRequestedEvent;
const owner = event.repository.owner.login;
const repo = event.repository.name;

let prNumber: number;

if (event.action === "auto_merge_enabled") {
  prNumber = event.pull_request.number;
} else {
  const ghRef = Deno.env.get("GH_REF");
  if (!ghRef) {
    actions.setFailed("GH_REF not set");
    Deno.exit(1);
  }

  // https://bufferings.hatenablog.com/entry/2024/02/10/173552#:~:text=%E3%81%93%E3%82%8C%E3%81%8B%E3%82%99%E3%80%81%20on%3A%20merge_group%20%E3%81%9F%E3%82%99%E3%81%A8%E2%86%93%E3%81%93%E3%81%86%E3%81%AA%E3%82%8B
  // refはこのような形式：`refs/heads/gh-readonly-queue/main/pr-9-585e0bea0e4a1d10ce8ba48e5a6fa9615ee6553e`
  const prNumberString = ghRef.match(/pr-(\d+)-/)?.[1];
  if (!prNumberString) {
    actions.setFailed("PR number not found");
    Deno.exit(1);
  }

  prNumber = parseInt(prNumberString);
}

const reviews = await octokit.rest.pulls.listReviews({
  owner,
  repo,
  pull_number: prNumber,
});

const { data: teams } = await octokit.rest.teams.list({
  org: owner,
});
const maintainerTeam = teams.find((t) => t.slug === "maintainer");
if (!maintainerTeam) {
  actions.setFailed("Maintainer team not found");
  Deno.exit(1);
}
const reviewerTeam = teams.find((t) => t.slug === "reviewer");
if (!reviewerTeam) {
  actions.setFailed("Reviewer team not found");
  Deno.exit(1);
}

const { data: maintainers } = await octokit.rest.teams.listMembersInOrg({
  org: owner,
  team_slug: maintainerTeam.slug,
});
const { data: reviewers } = await octokit.rest.teams.listMembersInOrg({
  org: owner,
  team_slug: reviewerTeam.slug,
});

if (maintainers.some((m) => m.login === event.sender.login)) {
  console.log("Force approval: Maintainer requested auto-merge");
  Deno.exit(0);
}

const approveReviews = reviews.data.filter(
  (review) =>
    review.state === "APPROVED" &&
    review.user != null &&
    reviewers.some((r) => r.login === review.user!.login),
);

if (approveReviews.length >= 2) {
  console.log("Approved by 2 reviewers");
  Deno.exit(0);
}

console.log("Not approved");
Deno.exit(1);
