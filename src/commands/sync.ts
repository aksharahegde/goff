import fsp from 'node:fs/promises'
import process from 'node:process'

import { defineCommand } from 'citty'
import { stringify as toYAML } from 'yaml'
import { execaCommandSync } from 'execa'
import consola from 'consola'

import { fetchIssueComments, fetchIssues } from '../api'

const reactionMap = {
  '+1': '👍',
  '-1': '👎',
  'laugh': '😄',
  'hooray': '🎉',
  'confused': '😕',
  'heart': '❤️',
  'rocket': '🚀',
  'eyes': '👀',
}

export const sync = defineCommand({
  meta: {
    description: 'Sync issues into a local `.goff` folder for offline use.',
  },
  args: {
    repo: {
      type: 'string',
      required: false,
    },
    remote: {
      type: 'string',
      default: 'origin',
    },
    closed: {
      type: 'boolean',
      default: false,
    },
  },
  async run({ args }) {
    const syncFolder = args.repo ? `.goff/${args.repo}` : '.goff'

    let repo: string | undefined = args.repo
    if (!repo) {
      try {
        repo = execaCommandSync(`git remote get-url ${args.remote}`).stdout.match(/github\.com[:/]([^/]+\/[^/]+)\.git$/)?.[1]
      }
      catch {}
    }

    if (!repo) {
      consola.error('No repo specified and no GitHub remote found. Please specify a GitHub repo with `--repo org/repo` or run this command in a GitHub repository.')
      process.exit(1)
    }

    // reinitialise the goff folder
    await fsp.rm(syncFolder, { recursive: true, force: true })
    await fsp.mkdir(syncFolder, { recursive: true })

    const issues = await fetchIssues(repo, { closed: args.closed })

    for (const issue of issues) {
      if (issue.pull_request)
        continue
      if (issue.user.login.endsWith('[bot]'))
        continue

      const metadata: IssueMetadata = {
        author: issue.user.login,
        created: issue.created_at,
        updated: issue.updated_at,
      }

      if (args.closed)
        metadata.state = issue.state

      if (issue.labels.length > 0)
        metadata.labels = issue.labels.map(label => label.name)

      const comments = issue.comments > 0 ? await fetchIssueComments(args.repo, issue.number) : []

      for (const key in issue.reactions) {
        const reaction = key as keyof typeof issue['reactions']
        if (reaction in reactionMap && issue.reactions[reaction] > 0) {
          metadata.reactions = metadata.reactions || {}
          metadata.reactions[reactionMap[reaction]] = issue.reactions[reaction]
        }
      }

      const filename: string[] = []
      if (args.closed)
        filename.push(issue.state)

      filename.push(issue.number.toFixed(0).padStart(4, '0'))
      filename.push(issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/, '-').replace(/^-|-$/g, ''))

      await fsp.writeFile(`${syncFolder}/${filename.join('-')}.md`, [
        '---',
        toYAML(metadata).trim(),
        '---',
        '',
        `# ${issue.title}`,
        '',
        issue.body,
        '',
        ...comments.map(comment => `---\n\n## Comment by @${comment.user.login} at ${comment.created_at}\n\n${comment.body}\n\n`),
      ].join('\n'))
    }
  },
})

interface IssueMetadata {
  author: string
  created: string
  updated: string
  state?: 'open' | 'closed'
  labels?: string[]
  reactions?: Record<string, number>
}
