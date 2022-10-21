import { getInput, setOutput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { Deployment } from '@cloudflare/types';

try {
  const apiToken = getInput("apiToken", { required: true });
  const accountId = getInput("accountId", { required: true });
  const projectName = getInput("projectName", { required: true });
  const directory = getInput("directory", { required: true });
  const gitHubToken = getInput("gitHubToken", { required: false });
  const branch = getInput("branch", { required: false });

  const octokit = getOctokit(gitHubToken);

  const createPagesDeployment = async () => {
    // TODO: Replace this with an API call to wrangler so we can get back a full deployment response object
    await shellac`
    $ export CLOUDFLARE_API_TOKEN="${apiToken}"
    if ${accountId} {
      $ export CLOUDFLARE_ACCOUNT_ID="${accountId}"
    }
  
    $$ npx wrangler@2 pages publish "${directory}" --project-name="${projectName}" --branch="${branch}"
    `;

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const {
      result: [deployment],
    } = (await response.json()) as { result: Deployment[] };

    return deployment;
  };

  const createGitHubDeployment = async () => {
    const deployment = await octokit.rest.repos.createDeployment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.ref,
      auto_merge: false,
      description: "Cloudflare Pages",
      required_contexts: [],
    });

    if (deployment.status === 201) {
      return deployment.data;
    }
  };

  const createGitHubDeploymentStatus = async ({
    id,
    url,
    deploymentId,
    environmentName,
    productionEnvironment,
  }: {
    id: number;
    url: string;
    deploymentId: string;
    environmentName: string;
    productionEnvironment: boolean;
  }) => {
    await octokit.rest.repos.createDeploymentStatus({
      owner: context.repo.owner,
      repo: context.repo.repo,
      deployment_id: id,
      // @ts-ignore
      environment: environmentName,
      environment_url: url,
      production_environment: productionEnvironment,
      log_url: `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/${deploymentId}`,
      description: "Cloudflare Pages",
      state: "success",
    });
  };

  (async () => {
    if (gitHubToken === "") {
      return;
    }

    const gitHubDeployment = await createGitHubDeployment();

    const pagesDeployment = await createPagesDeployment();

    setOutput("id", pagesDeployment.id);
    setOutput("url", pagesDeployment.url);
    setOutput("environment", pagesDeployment.environment);
    setOutput("alias", pagesDeployment.environment === "production" ? pagesDeployment.url : pagesDeployment.aliases[0]);

    const productionEnvironment = pagesDeployment.environment === "production";
    const environmentName = productionEnvironment
      ? "Production"
      // Use the branch alias (staging/walshy-fix-bug)
      : `Preview (${pagesDeployment.aliases[0]})`;

    if (gitHubDeployment) {
      await createGitHubDeploymentStatus({
        id: gitHubDeployment.id,
        url: pagesDeployment.url,
        deploymentId: pagesDeployment.id,
        environmentName,
        productionEnvironment,
      });
    }
  })();
} catch (thrown) {
  setFailed(thrown.message);
}
