import { getInput, setOutput, setFailed, summary } from "@actions/core";
import type { Project, Deployment } from '@cloudflare/types';
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { env } from "process";

type Octokit = ReturnType<typeof getOctokit>;

try {
  const apiToken = getInput("apiToken", { required: true });
  const accountId = getInput("accountId", { required: true });
  const projectName = getInput("projectName", { required: true });
  const directory = getInput("directory", { required: true });
  const gitHubToken = getInput("gitHubToken", { required: false });
  const branch = getInput("branch", { required: false });

  const getProject = async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const { result } = await response.json() as { result: Project | null };
    return result;
  }
  
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

  const createGitHubDeployment = async (octokit: Octokit, productionEnvironment: boolean, environment: string) => {
    const deployment = await octokit.rest.repos.createDeployment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.ref,
      auto_merge: false,
      description: "Cloudflare Pages",
      required_contexts: [],
      environment,
      production_environment: productionEnvironment,
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
    octokit,
  }: {
    octokit: Octokit,
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

  const createJobSummary = async (
    {
      project,
      deployment,
      aliasUrl,
    }:
    {
      project: Project;
      deployment: Deployment;
      aliasUrl: string;
    }
  ) => {
    console.log(deployment.stages);
    const deployStage = deployment.stages.find((stage) => stage.name === 'deploy');
    
    let status = '⚡️  Deployment in progress...';
    if (deployStage?.status === 'success') {
      status = '✅  Deploy successful!';
    } else if (deployStage?.status === 'failure') {
      status = '🚫  Deployment failed';
    }

    await summary
      .addRaw(`
# Deploying with Cloudflare Pages

| Name                    | Result |
| ----------------------- | - |
| **Last commit:**        | \`${deployment.deployment_trigger.metadata.commit_hash.substring(0, 8)}\` |
| **Status**:             | ${status} |
| **Preview URL**:        | ${deployment.url} |
| **Branch Preview URL**: | ${aliasUrl} |
      `)
      .write();
  }

  (async () => {
    const project = await getProject();
    if (!project) throw new Error('Unable to find pages project')

    const githubBranch = env.GITHUB_REF_NAME;
    const productionEnvironment = githubBranch === project.production_branch;
    const environmentName = productionEnvironment ? "Production" : `Preview: (${githubBranch})`;

    let gitHubDeployment: Awaited<ReturnType<typeof createGitHubDeployment>>;

    if (gitHubToken && gitHubToken.length) {
      const octokit = getOctokit(gitHubToken);
      gitHubDeployment = await createGitHubDeployment(octokit, productionEnvironment, environmentName);
    }

    const pagesDeployment = await createPagesDeployment();
    setOutput("id", pagesDeployment.id);
    setOutput("url", pagesDeployment.url);
    setOutput("environment", pagesDeployment.environment);

    let alias = pagesDeployment.url;
    if (!productionEnvironment && pagesDeployment.aliases && pagesDeployment.aliases.length > 0) {
      alias = pagesDeployment.aliases[0];
    }
    setOutput("alias", alias);

    await createJobSummary({ project, deployment: pagesDeployment, aliasUrl: alias });

    if (gitHubDeployment) {
      const octokit = getOctokit(gitHubToken);

      await createGitHubDeploymentStatus({
        id: gitHubDeployment.id,
        url: pagesDeployment.url,
        deploymentId: pagesDeployment.id,
        environmentName,
        productionEnvironment,
        octokit
      });
    }
  })();
} catch (thrown) {
  setFailed(thrown.message);
}
