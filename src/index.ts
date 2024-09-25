import { getInput, setOutput, setFailed, summary } from "@actions/core";
import type { Project, Deployment } from "@cloudflare/types";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { env } from "process";
import path from "node:path";
import { generateURL } from "./generateAlias";

type Octokit = ReturnType<typeof getOctokit>;

try {
	const apiToken = getInput("apiToken", { required: true });
	const accountId = getInput("accountId", { required: true });
	const projectName = getInput("projectName", { required: true });
	const directory = getInput("directory", { required: true });
	const gitHubToken = getInput("gitHubToken", { required: false });
	const branch = getInput("branch", { required: false });
	const production_branch = getInput("productionBranch", { required: true });
	const workingDirectory = getInput("workingDirectory", { required: false });
	const wranglerVersion = getInput("wranglerVersion", { required: false });
	const setProductionBranch = async (): Promise<{ before_branch: string, current_branch: string }> => {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
			{
				headers: {
					Authorization: `Bearer ${apiToken}`,
					"Content-Type": "application/json",
				},
				method: "PATCH",
				body: JSON.stringify({
					production_branch: production_branch,
				}),
			}
		);
		const json: any = await response.json();
		if (response.status !== 200) {
			console.error(`Cloudflare API returned non-200: ${response.status}`);
			const json = await response.text();
			console.error(`API returned: ${json}`);
			throw new Error("Failed to set production branch, API returned non-200");
		}
		return { before_branch: json.result.latest_deployment.production_branch, current_branch: json.result.production_branch };
	}

	const getProject = async () => {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
			{ headers: { Authorization: `Bearer ${apiToken}` } }
		);
		if (response.status !== 200) {
			console.error(`Cloudflare API returned non-200: ${response.status}`);
			const json = await response.text();
			console.error(`API returned: ${json}`);
			throw new Error("Failed to get Pages project, API returned non-200");
		}

		const { result } = (await response.json()) as { result: Project | null };
		if (result === null) {
			throw new Error("Failed to get Pages project, project does not exist. Check the project name or create it!");
		}

		return result;
	};

	const createPagesDeployment = async () => {
		// TODO: Replace this with an API call to wrangler so we can get back a full deployment response object
		await shellac.in(path.join(process.cwd(), workingDirectory))`
    $ export CLOUDFLARE_API_TOKEN="${apiToken}"
    if ${accountId} {
      $ export CLOUDFLARE_ACCOUNT_ID="${accountId}"
    }
  
    $$ npx wrangler@${wranglerVersion} pages publish "${directory}" --project-name="${projectName}" --branch="${branch}"
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

	const githubBranch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;

	const createGitHubDeployment = async (octokit: Octokit, productionEnvironment: boolean, environment: string) => {
		const deployment = await octokit.rest.repos.createDeployment({
			owner: context.repo.owner,
			repo: context.repo.repo,
			ref: githubBranch || context.ref,
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
		octokit: Octokit;
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
			auto_inactive: false,
		});
	};

	const createJobSummary = async ({ deployment, aliasUrl }: { deployment: Deployment; aliasUrl: string | undefined }) => {
		const deployStage = deployment.stages.find((stage) => stage.name === "deploy");

		let status = "⚡️  Deployment in progress...";
		if (deployStage?.status === "success") {
			status = "✅  Deploy successful!";
		} else if (deployStage?.status === "failure") {
			status = "🚫  Deployment failed";
		}
		await summary
			.addRaw(
				`
# Deploying with Cloudflare Pages

| Name                    | Result |
| ----------------------- | - |
| **Last commit:**        | \`${deployment.deployment_trigger.metadata.commit_hash.substring(0, 8)}\` |
| **Status**:             | ${status} |
| **Preview URL**:        | ${deployment.url} |
| **Branch Preview URL**: | ${aliasUrl ? aliasUrl : "This URL was not generated because the branch is the production branch."} |
      `
			)
			.write();
	};

	(async () => {
		const { before_branch, current_branch } = await setProductionBranch();
		const project = await getProject();

		const productionEnvironment = githubBranch === project.production_branch || branch === project.production_branch;
		const environmentName = `${projectName} (${productionEnvironment ? "Production" : "Preview"})`;

		let gitHubDeployment: Awaited<ReturnType<typeof createGitHubDeployment>>;

		if (gitHubToken && gitHubToken.length) {
			const octokit = getOctokit(gitHubToken);
			gitHubDeployment = await createGitHubDeployment(octokit, productionEnvironment, environmentName);
		}

		const pagesDeployment = await createPagesDeployment();

		let alias = "";

		if (branch != production_branch) {
			alias = generateURL(branch, pagesDeployment.url);
		}

		setOutput("id", pagesDeployment.id);
		setOutput("url", pagesDeployment.url);
		setOutput("environment", pagesDeployment.environment);

		setOutput("alias", alias);

		await createJobSummary({ deployment: pagesDeployment, aliasUrl: alias });

		if (gitHubDeployment) {
			const octokit = getOctokit(gitHubToken);

			await createGitHubDeploymentStatus({
				id: gitHubDeployment.id,
				url: pagesDeployment.url,
				deploymentId: pagesDeployment.id,
				environmentName,
				productionEnvironment,
				octokit,
			});
		}

		if (before_branch !== current_branch) {
			await summary.addRaw(`Production branch change from ${before_branch} to ${current_branch} succeeded!`).write();
		}
	})();
} catch (thrown) {
	setFailed(thrown.message);
}
