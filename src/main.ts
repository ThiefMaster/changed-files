import fs from "fs"
import * as core from "@actions/core"
import * as github from "@actions/github"
import { WebhookPayload } from "@actions/github/lib/interfaces"

class ChangedFiles {
    updated: Array<string> = []
    created: Array<string> = []
    deleted: Array<string> = []

    count(): number {
        return this.updated.length + this.created.length + this.deleted.length
    }
}

async function getChangedFiles(client: github.GitHub, prNumber: number, fileCount: number): Promise<ChangedFiles> {
    const changedFiles = new ChangedFiles()
    const fetchPerPage = 100
    for (let pageIndex = 0; pageIndex * fetchPerPage < fileCount; pageIndex++) {
        const listFilesResponse = await client.pulls.listFiles({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber,
            page: pageIndex,
            per_page: fetchPerPage,
        })

        const pattern = core.getInput("pattern")
        const re = new RegExp(pattern.length ? pattern : ".*")
        listFilesResponse.data
            .filter(f => re.test(f.filename))
            .forEach(f => {
                if (f.status === "added") {
                    changedFiles.created.push(f.filename)
                } else if (f.status === "removed") {
                    changedFiles.deleted.push(f.filename)
                } else if (f.status === "modified") {
                    changedFiles.updated.push(f.filename)
                } else if (f.status === "renamed") {
                    changedFiles.created.push(f.filename)
                    if (re.test(f["previous_filename"])) {
                        changedFiles.deleted.push(f["previous_filename"])
                    }
                }
            })
    }
    return changedFiles
}
async function fetchPr(client: github.GitHub): Promise<WebhookPayload["pull_request"]> {
    const prNumberInput = core.getInput("pr-number")

    // If user provides pull request number, we fetch and return that particular pull request
    if (prNumberInput) {
        const { data: pr } = await client.pulls.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: parseInt(prNumberInput, 10),
        })
        return pr
    }

    // Otherwise, we infer the pull request based on the the event's context
    return github.context.payload.pull_request
}

async function run(): Promise<void> {
    try {
        const token = core.getInput("repo-token", { required: true })
        const client = new github.GitHub(token)
        const pr = await fetchPr(client)

        if (!pr) {
            core.setFailed(`Could not get pull request from context, exiting`)
            return
        }

        const changedFiles = await getChangedFiles(client, pr.number, pr.changed_files)
        core.debug(`Found ${changedFiles.count} changed files for pr #${pr.number}`)

        core.setOutput("files_created", JSON.stringify(changedFiles.created))
        core.setOutput("files_updated", JSON.stringify(changedFiles.updated))
        core.setOutput("files_deleted", JSON.stringify(changedFiles.deleted))

        fs.writeFileSync(`${process.env.HOME}/files_created.json`, JSON.stringify(changedFiles.created), 'utf-8');
        fs.writeFileSync(`${process.env.HOME}/files_updated.json`, JSON.stringify(changedFiles.updated), 'utf-8');
        fs.writeFileSync(`${process.env.HOME}/files_deleted.json`, JSON.stringify(changedFiles.deleted), 'utf-8');
    } catch (error) {
        core.setFailed(error.message)
    }
}

run()
