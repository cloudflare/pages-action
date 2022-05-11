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
           uses: cloudflare/pages-action@v1.0.0
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: YOUR_ACCOUNT_ID
             projectName: YOUR_PROJECT_NAME
             directory: YOUR_ASSET_DIRECTORY
             gitHubToken: ${{ secrets.GITHUB_TOKEN }}
   ```

1. Replace `YOUR_ACCOUNT_ID`, `YOUR_PROJECT_NAME` and `YOUR_ASSET_DIRECTORY` with the appropriate values to your Pages project.

More information can be found on [our guide for making Direct Upload deployments with continous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#use-github-actions).
