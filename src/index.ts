import {getInput, setFailed, setOutput, summary} from "@actions/core";
import type {Deployment, Project, LogMessage, UnifiedDeploymentLogMessages} from "@cloudflare/types";
import {context, getOctokit} from "@actions/github";
import shellac from "shellac";
import {fetch} from "undici";
import {env} from "process";
import path from "node:path";

type Octokit = ReturnType<typeof getOctokit>;

try {
	const apiToken = getInput("apiToken", { required: true });
	const accountId = getInput("accountId", { required: true });
	const projectName = getInput("projectName", { required: true });
	const directory = getInput("directory", { required: true });
	const gitHubToken = getInput("gitHubToken", { required: false });
	const branch = getInput("branch", { required: false });
	const workingDirectory = getInput("workingDirectory", { required: false });
	const wranglerVersion = getInput("wranglerVersion", { required: false });
	const includeLogs = getInput("includeLogs", {required: false});

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

	const getDeploymentStatus = async({deployment}: {deployment: Deployment}) => {
		const deployStage = deployment.stages.find((stage) => stage.name === "deploy");
		let failure: boolean = false;

		let status = "⚡️  Deployment in progress...";
		if (deployStage?.status === "success") {
			status = "✅  Deploy successful!";
		} else if (deployStage?.status === "failure") {
			status = "🚫  Deployment failed";
		}

		return [failure, status] as const;
	}

	const getDeploymentLogs = async({failure, deployment}: {failure: boolean, deployment: Deployment}) => {
		if (!failure && includeLogs) {
			let messages: LogMessage[] = [];
			return {data: messages, total: 0, includes_container_logs: false} as UnifiedDeploymentLogMessages;
		}

		const deploymentIdentifier = deployment.id

		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentIdentifier}/history/logs`,
			{ headers: { Authorization: `Bearer ${apiToken}` } }
		);
		if (response.status !== 200) {
			console.error(`Cloudflare API returned non-200: ${response.status}`);
			const json = await response.text();
			console.error(`API returned: ${json}`);
			throw new Error("Failed to get Pages Deployment Logs, API returned non-200");
		}

		const {
			result: [logs],
		} = (await response.json()) as { result: UnifiedDeploymentLogMessages };

		return logs;
	}

	const createJobSummary = async ({ deployment, aliasUrl, status, logs }: { deployment: Deployment; aliasUrl: string, status: string, logs: UnifiedDeploymentLogMessages })  => {
		let logLines: string = ''
		if (logs.total > 0 ){
			for (let message of logs.data) {
				logLines = logLines.concat(`${message.ts} ${message.line}\n`)
			}
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
| **Branch Preview URL**: | ${aliasUrl} |

## Logs
${logLines}
      `
			)
			.write();
	};

	(async () => {
		const project = await getProject();

		const productionEnvironment = githubBranch === project.production_branch || branch === project.production_branch;
		const environmentName = `${projectName} (${productionEnvironment ? "Production" : "Preview"})`;

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

		const [failure, pagesDeploymentStatus] = await getDeploymentStatus( {deployment: pagesDeployment});
		const logs: UnifiedDeploymentLogMessages = getDeploymentLogs({failure: failure, deployment: pagesDeployment})

		await createJobSummary( { deployment: pagesDeployment, aliasUrl: alias, status: pagesDeploymentStatus, logs: logs });

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
	})();
} catch (thrown) {
	setFailed(thrown.message);
}
