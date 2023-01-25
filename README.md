# Cloudflare Pages GitHub Action

GitHub Action for creating Cloudflare Pages deployments, using the new [Direct Upload](https://developers.cloudflare.com/pages/platform/direct-upload/) feature and [Wrangler](https://developers.cloudflare.com/pages/platform/direct-upload/#wrangler-cli) integration.

## Usage

1. Create an API token in the Cloudflare dashboard with the "Cloudflare Pages — Edit" permission.
1. Add that API token as a secret to your GitHub repository, `CLOUDFLARE_API_TOKEN`.
1. Create a `.github/workflows/publish.yml` file in your repository:

   ```yml
   on: [push]

   jobs:
     publish:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         deployments: write
       name: Publish to Cloudflare Pages
       steps:
         - name: Checkout
           uses: actions/checkout@v3

         # Run a build step here if your project requires

         - name: Publish to Cloudflare Pages
           uses: cloudflare/pages-action@v1
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: YOUR_ACCOUNT_ID
             projectName: YOUR_PROJECT_NAME
             directory: YOUR_ASSET_DIRECTORY
             # Optional: Enable this if you want to have GitHub Deployments triggered
             gitHubToken: ${{ secrets.GITHUB_TOKEN }}
   ```

1. Replace `YOUR_ACCOUNT_ID`, `YOUR_PROJECT_NAME` and `YOUR_ASSET_DIRECTORY` with the appropriate values to your Pages project.

### Get account ID

To find your account ID, log in to the Cloudflare dashboard > select your zone in Account Home > find your account ID in Overview under **API** on the right-side menu. If you have not added a zone, add one by selecting **Add site** . You can purchase a domain from [Cloudflare’s registrar](https://developers.cloudflare.com/registrar/).

If you do not have a zone registered to your account, you can also get your account ID from the `pages.dev` URL. E.g: `https://dash.cloudflare.com/<ACCOUNT_ID>/pages`

### Generate an API Token

To generate an API token:

1. Log in to the Cloudflare dashboard.
2. Select My Profile from the dropdown menu of your user icon on the top right of your dashboard.
3. Select API Tokens > Create Token.
4. Under Custom Token, select Get started.
5. Name your API Token in the Token name field.
6. Under Permissions, select Account, Cloudflare Pages and Edit:
7. Select Continue to summary > Create Token.

More information can be found on [our guide for making Direct Upload deployments with continous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#use-github-actions).

### Specifying a branch

The branch name is used by Cloudflare Pages to determine if the deployment is production or preview. Read more about
[git branch build controls](https://developers.cloudflare.com/pages/platform/branch-build-controls/#branch-build-controls).

If you are in a Git workspace, Wrangler will automatically pull the branch information for you. You can override this
manually by adding the argument `branch: YOUR_BRANCH_NAME`.

### Specifying a working directory

By default Wrangler will run in the root package directory. If your app lives in a monorepo and you want to run Wrangler from its directory, add `workingDirectory: YOUR_PACKAGE_DIRECTORY`.

## Outputs

| Name          | Description                                         |
| ------------- | --------------------------------------------------- |
| `id`          | The ID of the pages deployment                      |
| `url`         | The URL of the pages deployment                     |
| `alias`       | The alias if it exists otherwise the deployment URL |
| `environment` | The environment that was deployed to                |
