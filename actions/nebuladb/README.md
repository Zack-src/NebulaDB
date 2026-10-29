# NebulaDB GitHub Action

Runs one [`nebuladb` CLI](../../packages/cli/README.md) command against your instance from a workflow: lint the
schema, check the databases for drift, plan a deployment or run it. It only speaks HTTP to the instance's
[public API](../../docs/public-api.md), so it works whatever the instance stores its data in.

```yaml
name: Schema
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: your-org/NebulaDB/actions/nebuladb@main
        with:
          command: lint
          url: https://nebula.example.com
          api-key: ${{ secrets.NEBULADB_API_KEY }}
          project: ${{ vars.NEBULADB_PROJECT }}
      - uses: your-org/NebulaDB/actions/nebuladb@main
        with:
          command: drift-check
          url: https://nebula.example.com
          api-key: ${{ secrets.NEBULADB_API_KEY }}
          project: ${{ vars.NEBULADB_PROJECT }}

  deploy:
    needs: check
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production # a protection rule here is the human gate
    steps:
      - uses: actions/checkout@v4 # only if resolutions-file is in the repository
      - uses: your-org/NebulaDB/actions/nebuladb@main
        with:
          command: deploy
          url: https://nebula.example.com
          api-key: ${{ secrets.NEBULADB_API_KEY }}
          project: ${{ vars.NEBULADB_PROJECT }}
          connection: ${{ vars.NEBULADB_CONNECTION }}
          confirm-name: Production
```

## Offline checks and a pull-request comment

`lint-file` and `diff` run on DBML files of your repository: no `url`, `api-key` or `project`, and nothing leaves
the runner. With `comment: true` the result is posted as **one** pull-request comment, found again by a hidden
marker (`<!-- nebuladb-action:<comment-tag> -->`) and edited in place on every push instead of adding new ones.

```yaml
on: pull_request
permissions:
  contents: read
  pull-requests: write # for the comment
jobs:
  schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # base-ref reads the file at the base branch
      - uses: your-org/NebulaDB/actions/nebuladb@main
        with:
          command: lint-file
          file: db/schema.dbml
          fail-on: warning
          comment: "true"
      - uses: your-org/NebulaDB/actions/nebuladb@main
        if: always()
        with:
          command: diff
          file: db/schema.dbml
          base-ref: origin/${{ github.base_ref }}
          comment: "true"
```

Each step keeps its own comment (`comment-tag` defaults to the command). Posting is best effort: on a fork's pull
request the token is read-only, so the step warns and keeps the CLI's exit code. Outside a pull request the
comment is skipped. The offline commands need `cli-version: source` (the default), which builds the CLI and the
DBML engine from the action's checkout (`npm ci` for the CLI's workspace, then `tsc`).

## Inputs

| Input                | Needed for              | Meaning                                                                               |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `command`            | always                  | `lint`, `lint-file`, `diff`, `drift-check`, `deploy-plan` or `deploy`                 |
| `url`                | all but offline         | The instance's address                                                                |
| `api-key`            | all but offline         | An API key, from a secret ([scopes](../../packages/cli/README.md#configuration))      |
| `project`            | all but offline         | The project's id                                                                      |
| `file`               | `lint-file`, `diff`     | The DBML file to lint, or the new version to compare                                  |
| `base-file`          | `diff`                  | The old version, a file in the workspace                                              |
| `base-ref`           | `diff`                  | Or a ref to read `file` from as the old version (needs `fetch-depth: 0`)              |
| `fail-on-changes`    | `diff`                  | `true` fails the step when the files differ                                           |
| `comment`            | any                     | `true` posts or updates one sticky pull-request comment (`pull-requests: write`)      |
| `comment-tag`        | any                     | Names the sticky comment; defaults to the command                                     |
| `pr-number`          | any                     | The pull request to comment on; defaults to the triggering one                        |
| `github-token`       | any                     | Token for the comment; defaults to `github.token`                                     |
| `connection`         | `deploy-plan`, `deploy` | The connection's id                                                                   |
| `confirm-name`       | `deploy`                | The connection's exact name, which the production stage asks for                      |
| `resolutions-file`   | `deploy-plan`, `deploy` | A JSON file answering the deployment's risks. Nothing is ever answered for you        |
| `fail-on`            | `lint`, `lint-file`     | `error` (default) or `warning`                                                        |
| `ignore-unreachable` | `drift-check`           | `true` to not fail on a database that could not be read                               |
| `no-backup`          | `deploy`                | `true` asks the server not to back up first; the production stage may still insist    |
| `insecure`           | any                     | `true` allows a plain `http://` address to a host other than localhost                |
| `cli-version`        | any                     | `source` (default) builds the CLI from the action's own checkout; else an npm version |

## Outputs

| Output      | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `result`    | Path of the command's JSON result                                                                    |
| `exit-code` | `0` done, `1` refused or a check found something, `2` usage, `3` instance unreachable or key refused |

The step fails with the CLI's exit code, so a lint error, a drift or a refused deployment stops the job. The
CLI's output is also written to the job summary.

## Good to know

- The key goes to the CLI through its environment only: never as an argument, and the CLI never prints it.
- `deploy` sends exactly what the inputs say. A risk on the production stage without an answer in
  `resolutions-file` is refused (`DESTRUCTIVE_CHANGE_UNRESOLVED`) and listed; `deploy-plan` lists the keys to answer.
- A stage protected by a review (`DEPLOYMENT_REVIEW_REQUIRED`) needs the review requested and approved in the app first.
- `cli-version: source` installs TypeScript from npm on the runner to compile the CLI (about ten seconds); pin an
  npm version instead once the package is published.
- `run.test.sh` checks what the script hands to the CLI: `bash actions/nebuladb/run.test.sh`.
