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
const event = JSON.parse(ghEvent) as webhooks.PullRequestAutoMergeEnabledEvent;
const owner = event.repository.owner.login;
const repo = event.repository.name;
const prNumber = event.pull_request.number;

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
  actions.setOutput("approved", "true");
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
  actions.setOutput("approved", "true");
  Deno.exit(0);
}

console.log("Not approved");
actions.setOutput("approved", "false");
