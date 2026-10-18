import * as core from '@actions/core'
import * as github from '@actions/github'
import {context} from '@actions/github'
import {checkLabels} from './functions/check-labels'
import {checkStatus} from './functions/check-status'

const repoName = 'github/combine-prs'
const repoUrl = 'https://github.com/github/combine-prs'

export async function run() {
  // Get configuration inputs
  const branchPrefix = core.getInput('branch_prefix')
  const branchRegex = core.getInput('branch_regex')
  const mustBeGreen = core.getInput('ci_required') === 'true'
  const mustBeApproved = core.getInput('review_required') === 'true'
  const combineBranchName = core.getInput('combine_branch_name')
  const ignoreLabel = core.getInput('ignore_label')
  const selectLabel = core.getInput('select_label')
  const labels = core.getInput('labels').trim()
  const assignees = core.getInput('assignees').trim()
  const token = core.getInput('github_token', {required: true})
  const prTitle = core.getInput('pr_title', {required: true})
  const prBodyHeader = core.getInput('pr_body_header', {required: true})
  const minCombineNumber = parseInt(
    core.getInput('min_combine_number', {required: true})
  )
  const autoclose = core.getInput('autoclose') === 'true'
  const updateBranch = core.getBooleanInput('update_branch')
  const createFromScratch = core.getBooleanInput('create_from_scratch')

  // check for either prefix or regex
  if (branchPrefix === '' && branchRegex === '') {
    core.setFailed('Must specify either branch_prefix or branch_regex')
    return 'Must specify either branch_prefix or branch_regex'
  }

  // check valid label config
  if (ignoreLabel && selectLabel && ignoreLabel == selectLabel) {
    core.setFailed('ignore_label and select_label cannot have the same value')
    return 'ignore_label and select_label cannot have the same value'
  }

  // Create a octokit GitHub client
  const octokit = github.getOctokit(token)

  // Get all open pull requests in the repository
  const pulls = await octokit.paginate('GET /repos/:owner/:repo/pulls', {
    owner: context.repo.owner,
    repo: context.repo.repo
  })

  // Filter the pull requests by branch prefix and CI status
  let branchesAndPRStrings = []
  let baseBranch = null
  let baseBranchSHA = null
  for (const pull of pulls) {
    const branch = pull['head']['ref']
    core.info('Pull for branch: ' + branch)

    // Check branch with branch_regex
    if (branchRegex !== '') {
      const regex = new RegExp(branchRegex)
      if (regex.test(branch)) {
        core.info('Branch matched regex: ' + branch)
      } else {
        core.info('Branch did not match regex: ' + branch)
        continue
      }
    } else {
      // If no regex, check branch with branch_prefix
      if (branch.startsWith(branchPrefix)) {
        core.info('Branch matched prefix: ' + branch)
      } else {
        continue
      }
    }

    // Check labels
    let statusOK = await checkLabels(pull, branch, selectLabel, ignoreLabel)

    // Check CI status or review status if required
    statusOK =
      statusOK &&
      (await checkStatus(pull, branch, octokit, mustBeGreen, mustBeApproved))

    if (statusOK) {
      core.info('Adding branch to array: ' + branch)
      const prString = `${autoclose ? 'Closes ' : ''}#${pull['number']} ${
        pull['title']
      }`
      branchesAndPRStrings.push({branch, prString})
      baseBranch = pull['base']['ref']
      baseBranchSHA = pull['base']['sha']
    }
  }

  // If no branches match, exit
  if (branchesAndPRStrings.length === 0) {
    core.info('No PRs/branches matched criteria')
    return 'No PRs/branches matched criteria'
  }

  // If not enough branches match given min_combine_number, exit
  if (branchesAndPRStrings.length < minCombineNumber) {
    core.info(
      `Not enough PRs/branches matched criteria to create a combined PR - matched ${branchesAndPRStrings.length} branches/PRs but need ${minCombineNumber} branches/PRs`
    )
    return 'not enough PRs/branches matched criteria to create a combined PR'
  }

  // Refuse to mutate the combined branch when its current PR is ready. A
  // previously created draft still needs independent owner-held proof before
  // a caller may treat its later head as admitted.
  const repositoryName = `${context.repo.owner}/${context.repo.repo}`
  const existingCombinedPRs = pulls.filter(
    pull =>
      pull.head?.ref === combineBranchName &&
      pull.head?.repo?.full_name?.toLowerCase() === repositoryName.toLowerCase()
  )
  if (
    existingCombinedPRs.length > 1 ||
    (existingCombinedPRs.length === 1 &&
      (existingCombinedPRs[0].draft !== true ||
        existingCombinedPRs[0].base?.ref !== baseBranch))
  ) {
    core.setFailed('Combined PR is ambiguous or was not created as a draft')
    return 'failure'
  }
  const existingCombinedPR = existingCombinedPRs[0]
  const existingHeadSha = existingCombinedPR?.head?.sha

  if (existingCombinedPR && !/^[0-9a-f]{40}$/i.test(existingHeadSha ?? '')) {
    core.setFailed('Existing combined PR has no valid head SHA')
    return 'failure'
  }

  async function readCurrentCombinedPR(expectedHeadSha) {
    const refreshed = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: existingCombinedPR.number
    })
    const pr = refreshed.data
    if (
      pr?.number !== existingCombinedPR.number ||
      pr.draft !== true ||
      pr.state !== 'open' ||
      pr.head?.ref !== combineBranchName ||
      pr.head?.repo?.full_name?.toLowerCase() !==
        repositoryName.toLowerCase() ||
      pr.base?.ref !== baseBranch ||
      (expectedHeadSha && pr.head?.sha !== expectedHeadSha)
    ) {
      core.setFailed('Existing combined PR changed or is not draft')
      return null
    }
    return pr
  }

  if (existingCombinedPR && !(await readCurrentCombinedPR(existingHeadSha))) {
    return 'failure'
  }

  let workingRef = combineBranchName
  let combinedHeadAfterScratch
  let expectedCombinedHeadAfterMerge = existingCombinedPR?.head?.sha
  if (createFromScratch) {
    workingRef = combineBranchName + '-working'

    // delete any pre-existing working branch
    try {
      await octokit.rest.git.deleteRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: 'heads/' + workingRef
      })
    } catch (error) {
      // If the branch doesn't exist, that's fine
      // istanbul ignore next
      core.debug(`branch ${workingRef} not found - OK`)
    }

    // create our working branch
    try {
      await octokit.rest.git.createRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: 'refs/heads/' + workingRef,
        sha: baseBranchSHA
      })
    } catch (error) {
      // Otherwise, fail the Action
      core.error(error)
      core.setFailed('Failed to create working branch')
      return 'Failed to create working branch'
    }
  }

  // Create a new branch
  try {
    await octokit.rest.git.createRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'refs/heads/' + combineBranchName,
      sha: baseBranchSHA
    })
  } catch (error) {
    // If the branch already exists, we'll try to merge into it
    if (error.status == 422) {
      if (createFromScratch && !existingCombinedPR) {
        core.setFailed('Combined branch exists without a matching draft PR')
        return 'failure'
      }
      core.warning('Branch already exists - will try to merge into it')
    } else {
      // Otherwise, fail the Action
      core.error(error)
      core.setFailed('Failed to create combined branch')
      return 'Failed to create combined branch'
    }
  }

  // Merge all branches into the new branch
  let combinedPRs = []
  let mergeFailedPRs = []
  for (const {branch, prString} of branchesAndPRStrings) {
    try {
      const mergeResult = await octokit.rest.repos.merge({
        owner: context.repo.owner,
        repo: context.repo.repo,
        base: workingRef,
        head: branch
      })
      if (existingCombinedPR && !createFromScratch) {
        if (
          mergeResult?.status === 201 &&
          /^[0-9a-f]{40}$/i.test(mergeResult.data?.sha ?? '') &&
          mergeResult.data?.parents?.[0]?.sha === expectedCombinedHeadAfterMerge
        ) {
          expectedCombinedHeadAfterMerge = mergeResult.data.sha
        } else if (mergeResult?.status !== 204) {
          core.setFailed(
            'Combined branch merge returned no verifiable head SHA or parent'
          )
          return 'failure'
        }
      }
      core.info('Merged branch ' + branch)
      combinedPRs.push(prString)
    } catch (error) {
      core.warning('Failed to merge branch ' + branch)
      mergeFailedPRs.push(prString.replace('Closes ', ''))
    }
  }

  if (createFromScratch) {
    // Get the updated ref of the working branch
    const {
      data: {object: workingRefObject}
    } = await octokit.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'heads/' + workingRef
    })

    // Replace the combined head only if it still points to the observed SHA.
    const expectedHeadSha = existingHeadSha ?? baseBranchSHA
    if (
      !/^[0-9a-f]{40}$/i.test(expectedHeadSha ?? '') ||
      !/^[0-9a-f]{40}$/i.test(workingRefObject.sha ?? '')
    ) {
      core.setFailed('Combined branch update has no valid head SHA')
      return 'failure'
    }
    try {
      const {data: repository} = await octokit.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo
      })
      if (!repository?.node_id) {
        core.setFailed('Combined branch repository has no node ID')
        return 'failure'
      }
      const result = await octokit.graphql(
        `mutation($input: UpdateRefsInput!) {
          updateRefs(input: $input) { clientMutationId }
        }`,
        {
          input: {
            repositoryId: repository.node_id,
            refUpdates: [
              {
                name: 'refs/heads/' + combineBranchName,
                beforeOid: expectedHeadSha,
                afterOid: workingRefObject.sha,
                force: true
              }
            ]
          }
        }
      )
      if (!result?.updateRefs) {
        core.setFailed('Combined branch conditional update was not confirmed')
        return 'failure'
      }
      combinedHeadAfterScratch = workingRefObject.sha
    } catch (error) {
      core.error(error)
      core.setFailed('Combined branch changed before conditional update')
      return 'failure'
    }

    // Delete the temp working branch
    await octokit.rest.git.deleteRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'heads/' + workingRef
    })
  } else if (existingCombinedPR) {
    const {data: combinedRef} = await octokit.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'heads/' + combineBranchName
    })
    if (combinedRef?.object?.sha !== expectedCombinedHeadAfterMerge) {
      core.setFailed('Combined branch changed after source merges')
      return 'failure'
    }
  }

  // Create a new PR with the combined branch
  core.info('Creating combined PR')
  const combinedPRsString = `- ${combinedPRs.join('\n- ')}`
  let body = `${prBodyHeader}\n\n✅ The following pull requests have been successfully combined on this PR:\n${combinedPRsString}`
  if (mergeFailedPRs.length > 0) {
    const mergeFailedPRsString = `- ${mergeFailedPRs.join('\n- ')}`
    body +=
      '\n\n⚠️ The following PRs were left out due to merge conflicts:\n' +
      mergeFailedPRsString
  }

  body += `\n\n> This PR was created by the [\`${repoName}\`](${repoUrl}) action`

  core.debug('PR body: ' + body)

  let pullRequest
  let prOrigin
  if (existingCombinedPR) {
    const pr = await readCurrentCombinedPR(
      combinedHeadAfterScratch ?? expectedCombinedHeadAfterMerge
    )
    if (!pr) return 'failure'
    await octokit.rest.pulls.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pr.number,
      body: body
    })
    pullRequest = {data: pr}
    prOrigin = 'existing'
  } else {
    try {
      pullRequest = await octokit.rest.pulls.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: prTitle,
        head: combineBranchName,
        base: baseBranch,
        body: body,
        draft: true
      })
    } catch (error) {
      if (
        error?.message?.includes(
          'GitHub Actions is not permitted to create or approve pull requests'
        )
      ) {
        core.warning(
          'https://github.blog/changelog/2022-05-03-github-actions-prevent-github-actions-from-creating-and-approving-pull-requests/'
        )
      }

      core.setFailed(`Failed to create combined PR - ${error}`)
      return 'failure'
    }
    if (pullRequest?.data?.draft !== true) {
      core.setFailed('GitHub did not confirm draft creation')
      return 'failure'
    }
    prOrigin = 'created'
  }

  if (labels !== '') {
    // split and trim labels
    const labelsArray = labels.split(',').map(label => label.trim())

    // add labels to the combined PR if specified
    if (labelsArray.length > 0) {
      core.info(`Adding labels to combined PR: ${labelsArray}`)
      await octokit.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.data.number,
        labels: labelsArray
      })
    }
  }

  if (assignees !== '') {
    // split and trim assignees
    const assigneesArray = assignees.split(',').map(assignee => assignee.trim())

    // add assignees to the combined PR if specified
    if (assigneesArray.length > 0) {
      core.info(`Adding assignees to combined PR: ${assigneesArray}`)
      await octokit.rest.issues.addAssignees({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.data.number,
        assignees: assigneesArray
      })
    }
  }

  // lastly, if the pull request's branch can be updated cleanly, update it
  if (updateBranch === true) {
    core.info('Attempting to update branch')
    try {
      const result = await octokit.rest.pulls.updateBranch({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pullRequest.data.number
      })

      // If the result is not a 202, return an error message and exit
      if (result.status !== 202) {
        throw new Error(
          `Failed to update combined pr branch with the base branch - ${result}`
        )
      }

      core.info('Branch updated')
    } catch (error) {
      core.warning('Failed to update combined pr branch with the base branch')
      core.warning(error)
    }
  }

  // output pull request url
  core.info('Combined PR url: ' + pullRequest.data.html_url)
  core.setOutput('pr_url', pullRequest.data.html_url)

  // output pull request number
  core.info('Combined PR number: ' + pullRequest.data.number)
  core.setOutput('pr_number', pullRequest.data.number)
  core.setOutput('pr_origin', prOrigin)

  return 'success'
}

// Do not run if this is a test
if (process.env.COMBINE_PRS_TEST !== 'true') {
  /* istanbul ignore next */
  run()
}
