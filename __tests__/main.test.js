import {run} from '../src/main'
import * as github from '@actions/github'
import * as core from '@actions/core'

class BigBadError extends Error {
  constructor(message) {
    super(message)
    this.status = 500
  }
}

class AlreadyExistsError extends Error {
  constructor(message) {
    super(message)
    this.status = 422
  }
}

function randomSha1() {
  return Array.from({length: 40}, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

const setOutputMock = jest.spyOn(core, 'setOutput')
const infoMock = jest.spyOn(core, 'info')
const warningMock = jest.spyOn(core, 'warning')
const setFailedMock = jest.spyOn(core, 'setFailed')
const debugMock = jest.spyOn(core, 'debug')

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(core, 'setOutput').mockImplementation(() => {})
  jest.spyOn(core, 'setFailed').mockImplementation(() => {})
  jest.spyOn(core, 'saveState').mockImplementation(() => {})
  jest.spyOn(core, 'info').mockImplementation(() => {})
  jest.spyOn(core, 'debug').mockImplementation(() => {})
  jest.spyOn(core, 'warning').mockImplementation(() => {})
  jest.spyOn(core, 'error').mockImplementation(() => {})
  process.env.INPUT_GITHUB_TOKEN = 'faketoken'
  process.env.INPUT_CI_REQUIRED = 'true'
  process.env.INPUT_PR_TITLE = 'Combined PRs'
  process.env.INPUT_PR_BODY_HEADER = '# Combined PRs ➡️📦⬅️'
  process.env.INPUT_REVIEW_REQUIRED = 'false'
  process.env.INPUT_COMBINE_BRANCH_NAME = 'combined-prs-branch'
  process.env.INPUT_BRANCH_PREFIX = 'dependabot'
  process.env.INPUT_IGNORE_LABEL = 'nocombine'
  process.env.INPUT_SELECT_LABEL = ''
  process.env.INPUT_REQUIRED_SOURCE_BASE = ''
  process.env.GITHUB_REPOSITORY = 'test-owner/test-repo'
  process.env.INPUT_MIN_COMBINE_NUMBER = '2'
  process.env.INPUT_LABELS = ''
  process.env.INPUT_ASSIGNEES = ''
  process.env.INPUT_AUTOCLOSE = 'true'
  process.env.INPUT_UPDATE_BRANCH = 'true'
  process.env.INPUT_CREATE_FROM_SCRATCH = 'false'

  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'dependabot-7'),
          buildPR(8, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        if (params.input?.refUpdates) {
          return {updateRefs: {clientMutationId: null}}
        }
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return buildStatusResponse('REVIEW_REQUIRED', 'SUCCESS')
          case 7:
            return buildStatusResponse(null, null)
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          get: jest.fn().mockResolvedValue({
            data: {node_id: 'test-repository-node-id'}
          }),
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementationOnce(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          })
        }
      }
    }
  })
})

test('successfully runs the action', async () => {
  process.env.INPUT_REVIEW_REQUIRED = 'true'
  expect(await run()).toBe('success')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-1 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-2 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Validating status: FAILURE')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-4 with status FAILURE'
  )
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: null')
  expect(infoMock).toHaveBeenCalledWith(
    'Branch dependabot-5 has no required reviewers - OK'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: question')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: nocombine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-3 with label nocombine because it matches ignore_label'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-6')
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Creating combined PR')
  expect(debugMock).toHaveBeenCalledWith(
    'PR body: # Combined PRs ➡️📦⬅️\n\n✅ The following pull requests have been successfully combined on this PR:\n- Closes #1 Update dependency 1\n- Closes #5 Update dependency 5\n\n⚠️ The following PRs were left out due to merge conflicts:\n- #2 Update dependency 2\n\n> This PR was created by the [`github/combine-prs`](https://github.com/github/combine-prs) action'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Combined PR url: https://github.com/test-owner/test-repo/pull/100'
  )
  expect(infoMock).toHaveBeenCalledWith('Combined PR number: 100')
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith('pr_origin', 'created')
  const client = github.getOctokit.mock.results[0].value
  expect(client.rest.pulls.create).toHaveBeenCalledWith(
    expect.objectContaining({draft: true})
  )
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action when autoclose is disabled', async () => {
  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_AUTOCLOSE = 'false'
  expect(await run()).toBe('success')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-1 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-2 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Validating status: FAILURE')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-4 with status FAILURE'
  )
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: null')
  expect(infoMock).toHaveBeenCalledWith(
    'Branch dependabot-5 has no required reviewers - OK'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: question')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: nocombine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-3 with label nocombine because it matches ignore_label'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-6')
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Creating combined PR')
  expect(debugMock).toHaveBeenCalledWith(
    'PR body: # Combined PRs ➡️📦⬅️\n\n✅ The following pull requests have been successfully combined on this PR:\n- #1 Update dependency 1\n- #5 Update dependency 5\n\n⚠️ The following PRs were left out due to merge conflicts:\n- #2 Update dependency 2\n\n> This PR was created by the [`github/combine-prs`](https://github.com/github/combine-prs) action'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Combined PR url: https://github.com/test-owner/test-repo/pull/100'
  )
  expect(infoMock).toHaveBeenCalledWith('Combined PR number: 100')
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action with the branch_regex option', async () => {
  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_BRANCH_REGEX = '.*penda.*' // match dependabot branches
  expect(await run()).toBe('success')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Branch matched regex: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-1 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Branch matched regex: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-2 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Branch matched regex: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Branch matched regex: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Validating status: FAILURE')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-4 with status FAILURE'
  )
  expect(infoMock).toHaveBeenCalledWith('Branch matched regex: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: null')
  expect(infoMock).toHaveBeenCalledWith(
    'Branch dependabot-5 has no required reviewers - OK'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: question')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: nocombine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-3 with label nocombine because it matches ignore_label'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-6')
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Creating combined PR')
  expect(debugMock).toHaveBeenCalledWith(
    'PR body: # Combined PRs ➡️📦⬅️\n\n✅ The following pull requests have been successfully combined on this PR:\n- Closes #1 Update dependency 1\n- Closes #5 Update dependency 5\n\n⚠️ The following PRs were left out due to merge conflicts:\n- #2 Update dependency 2\n\n> This PR was created by the [`github/combine-prs`](https://github.com/github/combine-prs) action'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Combined PR url: https://github.com/test-owner/test-repo/pull/100'
  )
  expect(infoMock).toHaveBeenCalledWith('Combined PR number: 100')
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('label check does not override CI or review status', async () => {
  process.env.INPUT_SELECT_LABEL = 'please-combine'
  process.env.INPUT_CI_REQUIRED = 'true'
  process.env.INPUT_REVIEW_REQUIRED = 'true'

  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-failed-ci', ['please-combine']),
          buildPR(2, 'dependabot-awaiting-review', ['please-combine'])
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 2:
            return buildStatusResponse('REVIEW_REQUIRED', 'SUCCESS')
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })

  expect(await run()).toBe('No PRs/branches matched criteria')
})

test('successfully runs the action with the select_label option', async () => {
  process.env.INPUT_CI_REQUIRED = false // just to reduce needed mocks
  process.env.INPUT_IGNORE_LABEL = 'no-combine'
  process.env.INPUT_SELECT_LABEL = 'please-combine'

  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-random-label', ['some-random-label']),
          buildPR(2, 'dependabot-select-label', [
            'some-random-label',
            'please-combine',
            'another-label'
          ]),
          buildPR(3, 'dependabot-no-labels', []),
          buildPR(4, 'dependabot-both-ignore-and-select', [
            'no-combine',
            'please-combine'
          ]),
          buildPR(5, 'dependabot-only-select', ['please-combine'])
        ]
      }),
      rest: {
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          })
        }
      }
    }
  })

  expect(await run()).toBe('success')

  expect(infoMock).toHaveBeenCalledWith(
    'Checking labels: dependabot-random-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking select_label for: some-random-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-random-label because it does not match select_label'
  )

  expect(infoMock).toHaveBeenCalledWith(
    'Checking labels: dependabot-select-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking select_label for: some-random-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking select_label for: please-combine'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking ignore_label for: some-random-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking ignore_label for: please-combine'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Checking ignore_label for: another-label'
  )
  expect(infoMock).toHaveBeenCalledWith(
    'Adding branch to array: dependabot-select-label'
  )

  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-no-labels')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-no-labels because it does not match select_label'
  )

  expect(infoMock).toHaveBeenCalledWith(
    'Checking labels: dependabot-both-ignore-and-select'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking select_label for: no-combine')
  expect(infoMock).toHaveBeenCalledWith(
    'Checking select_label for: please-combine'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: no-combine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-both-ignore-and-select with label no-combine because it matches ignore_label'
  )
})

test('runs the action and fails to create the combine branch', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [buildPR(1, 'dependabot-1'), buildPR(2, 'dependabot-2')]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockRejectedValueOnce(new BigBadError('Oh no!'))
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })

  expect(await run()).toBe('Failed to create combined branch')
  expect(setFailedMock).toHaveBeenCalledWith('Failed to create combined branch')
})

test('runs the action and finds the combine branch already exists and the PR also exists', async () => {
  const mergedSha = 'c'.repeat(40)
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1'),
          buildPR(2, 'dependabot-2'),
          buildPR(100, 'combined-prs-branch', [], 'main', true)
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        return params.input?.refUpdates
          ? {updateRefs: {clientMutationId: null}}
          : buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockResolvedValue({data: {}}),
          deleteRef: jest.fn().mockResolvedValue({data: {}}),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: mergedSha
              }
            }
          })
        },
        repos: {
          get: jest.fn().mockResolvedValue({
            data: {node_id: 'test-repository-node-id'}
          }),
          merge: jest
            .fn()
            .mockResolvedValueOnce({
              status: 201,
              data: {sha: mergedSha, parents: [{sha: 'a'.repeat(40)}]}
            })
            .mockResolvedValue({status: 204})
        },
        pulls: {
          create: jest.fn(),
          get: jest
            .fn()
            .mockResolvedValueOnce({
              data: buildPR(100, 'combined-prs-branch', [], 'main', true)
            })
            .mockResolvedValueOnce({
              data: buildPR(100, 'combined-prs-branch', [], 'main', true)
            })
            .mockResolvedValueOnce({
              data: {
                ...buildPR(100, 'combined-prs-branch', [], 'main', true),
                head: {
                  ...buildPR(100, 'combined-prs-branch', [], 'main', true).head,
                  sha: mergedSha
                },
                html_url: 'https://github.com/test-owner/test-repo/pull/100'
              }
            }),
          update: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })

  const result = await run()
  expect(setFailedMock.mock.calls).toEqual([])
  expect(result).toBe('success')
  expect(warningMock).not.toHaveBeenCalledWith(
    'Branch already exists - will try to merge into it'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith('pr_origin', 'existing')
  const client = github.getOctokit.mock.results[0].value
  expect(client.rest.pulls.get).toHaveBeenCalledTimes(3)
  expect(client.rest.git.getRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringMatching(/^heads\/combine-prs-working\//)
    })
  )
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
})

test('keeps default-mode handling of a combined branch without a PR', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.rest.git.createRef = jest
      .fn()
      .mockRejectedValueOnce(new AlreadyExistsError('Reference already exists'))
    return client
  })

  expect(await run()).toBe('success')
  expect(warningMock).toHaveBeenCalledWith(
    'Branch already exists - will try to merge into it'
  )
  expect(client.rest.repos.merge).toHaveBeenCalledWith(
    expect.objectContaining({base: 'combined-prs-branch'})
  )
})

test('rejects an existing PR that becomes ready before its body update', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    client.rest.pulls.get = jest
      .fn()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', false)
      })
    client.rest.repos.merge = jest.fn().mockResolvedValue({status: 204})
    client.rest.git.getRef = jest.fn().mockResolvedValue({
      data: {object: {sha: 'a'.repeat(40)}}
    })
    client.rest.pulls.update = jest.fn()
    return client
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
  expect(setOutputMock).not.toHaveBeenCalledWith('pr_origin', 'existing')
})

async function runDefaultExistingCase(configureClient) {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    client.rest.git.createRef = jest.fn().mockResolvedValue({data: {}})
    client.rest.git.deleteRef = jest.fn().mockResolvedValue({data: {}})
    client.rest.repos.merge = jest
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        data: {sha: 'c'.repeat(40), parents: [{sha: 'a'.repeat(40)}]}
      })
      .mockResolvedValue({status: 204})
    client.rest.git.getRef = jest.fn().mockResolvedValue({
      data: {object: {sha: 'c'.repeat(40)}}
    })
    const after = buildPR(100, 'combined-prs-branch', [], 'main', true)
    after.head.sha = 'c'.repeat(40)
    after.html_url = 'https://github.com/test-owner/test-repo/pull/100'
    client.rest.pulls.get = jest
      .fn()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({data: after})
    client.rest.pulls.update = jest.fn().mockResolvedValue({data: after})
    configureClient(client)
    return client
  })
  return {result: await run(), client}
}

test('rejects a default-mode branch changed after source merges', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.git.getRef.mockResolvedValue({
      data: {object: {sha: 'd'.repeat(40)}}
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Staged combined branch changed after source merges'
  )
  expect(client.rest.pulls.get).toHaveBeenCalledTimes(1)
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('rejects a default-mode PR head changed after ref verification', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    const changed = buildPR(100, 'combined-prs-branch', [], 'main', true)
    changed.head.sha = 'd'.repeat(40)
    client.rest.pulls.get
      .mockReset()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({data: changed})
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('does not publish default-mode staging after its draft becomes ready', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.pulls.get
      .mockReset()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', false)
      })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('preserves a concurrent live branch update during default-mode staging', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    const originalGraphql = client.graphql.getMockImplementation()
    client.graphql.mockImplementation((query, params) => {
      if (params.input?.refUpdates) {
        throw new Error('beforeOid no longer matches')
      }
      return originalGraphql(query, params)
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch changed before conditional update'
  )
  expect(client.rest.repos.merge).toHaveBeenCalledWith(
    expect.objectContaining({
      base: expect.stringMatching(/^combine-prs-working\//)
    })
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('rejects a default-mode merge built on an intervening branch push', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.repos.merge.mockReset().mockResolvedValueOnce({
      status: 201,
      data: {sha: 'c'.repeat(40), parents: [{sha: 'd'.repeat(40)}]}
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch merge returned no verifiable head SHA or parent'
  )
  expect(client.rest.git.getRef).not.toHaveBeenCalled()
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('verifies each parent across consecutive default-mode merges', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.repos.merge
      .mockReset()
      .mockResolvedValueOnce({
        status: 201,
        data: {sha: 'c'.repeat(40), parents: [{sha: 'a'.repeat(40)}]}
      })
      .mockResolvedValueOnce({
        status: 201,
        data: {sha: 'e'.repeat(40), parents: [{sha: 'c'.repeat(40)}]}
      })
    client.rest.git.getRef.mockResolvedValue({
      data: {object: {sha: 'e'.repeat(40)}}
    })
    const after = buildPR(100, 'combined-prs-branch', [], 'main', true)
    after.head.sha = 'e'.repeat(40)
    client.rest.pulls.get
      .mockReset()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({data: after})
  })

  expect(result).toBe('success')
  expect(client.rest.repos.merge).toHaveBeenCalledTimes(2)
  expect(client.rest.pulls.update).toHaveBeenCalledTimes(1)
})

test('rejects a push between consecutive default-mode merges', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.repos.merge
      .mockReset()
      .mockResolvedValueOnce({
        status: 201,
        data: {sha: 'c'.repeat(40), parents: [{sha: 'a'.repeat(40)}]}
      })
      .mockResolvedValueOnce({
        status: 201,
        data: {sha: 'e'.repeat(40), parents: [{sha: 'd'.repeat(40)}]}
      })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch merge returned no verifiable head SHA or parent'
  )
  expect(client.rest.git.getRef).not.toHaveBeenCalled()
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('rejects incomplete default-mode merge evidence', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.repos.merge
      .mockReset()
      .mockResolvedValue({status: 201, data: {}})
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch merge returned no verifiable head SHA or parent'
  )
  expect(client.rest.git.getRef).not.toHaveBeenCalled()
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('rejects a default-mode merge without its parent', async () => {
  const {result, client} = await runDefaultExistingCase(client => {
    client.rest.repos.merge.mockReset().mockResolvedValueOnce({
      status: 201,
      data: {sha: 'c'.repeat(40)}
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch merge returned no verifiable head SHA or parent'
  )
  expect(client.rest.git.getRef).not.toHaveBeenCalled()
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('stages an existing default-mode PR before conditional publication', async () => {
  const {result, client} = await runDefaultExistingCase(() => {})

  expect(result).toBe('success')
  expect(client.rest.git.createRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringMatching(/^refs\/heads\/combine-prs-working\//),
      sha: 'a'.repeat(40)
    })
  )
  expect(client.rest.repos.merge).toHaveBeenCalledWith(
    expect.objectContaining({
      base: expect.stringMatching(/^combine-prs-working\//)
    })
  )
  expect(client.graphql).toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.objectContaining({
      input: expect.objectContaining({
        refUpdates: [
          expect.objectContaining({
            beforeOid: 'a'.repeat(40),
            afterOid: 'c'.repeat(40),
            force: false
          })
        ]
      })
    })
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: client.rest.git.createRef.mock.calls[0][0].ref.replace('refs/', '')
    })
  )
})

test('rejects a PR that becomes ready before any branch change', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    client.rest.pulls.get = jest.fn().mockResolvedValue({
      data: buildPR(100, 'combined-prs-branch', [], 'main', false)
    })
    return client
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
  expect(client.rest.repos.merge).not.toHaveBeenCalled()
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
})

test('rejects a ready combined-head PR with another base before branch changes', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'release', false)
    ])
    return client
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined PR is ambiguous or was not created as a draft'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
  expect(client.rest.repos.merge).not.toHaveBeenCalled()
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
})

test('rejects a creation response that does not confirm draft state', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.rest.pulls.create.mockReset().mockResolvedValue({
      data: {number: 100, draft: false}
    })
    return client
  })

  expect(await run()).toBe('failure')
  expect(client.rest.pulls.create).toHaveBeenCalledWith(
    expect.objectContaining({draft: true})
  )
  expect(setFailedMock).toHaveBeenCalledWith(
    'GitHub did not confirm draft creation'
  )
  expect(setOutputMock).not.toHaveBeenCalledWith('pr_origin', 'created')
})

test('runs the action and fails to create a pull request', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [buildPR(1, 'dependabot-1'), buildPR(2, 'dependabot-2')]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest
            .fn()
            .mockRejectedValueOnce(
              new BigBadError(
                'GitHub Actions is not permitted to create or approve pull requests'
              )
            ),
          list: jest.fn().mockReturnValueOnce({
            data: [
              {
                number: 100
              }
            ]
          }),
          update: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })

  expect(await run()).toBe('failure')

  expect(warningMock).toHaveBeenCalledWith(
    'https://github.blog/changelog/2022-05-03-github-actions-prevent-github-actions-from-creating-and-approving-pull-requests/'
  )

  expect(setFailedMock).toHaveBeenCalledWith(
    'Failed to create combined PR - Error: GitHub Actions is not permitted to create or approve pull requests'
  )
})

test('rejects a ready existing combined PR before changing its branch', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1'),
          buildPR(2, 'dependabot-2'),
          buildPR(100, 'combined-prs-branch', [], 'main', false)
        ]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest
            .fn()
            .mockRejectedValueOnce(
              new AlreadyExistsError('Reference already exists')
            ),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest
            .fn()
            .mockRejectedValueOnce(new AlreadyExistsError('PR already exists')),
          list: jest.fn().mockReturnValueOnce({
            data: [
              {
                number: 100,
                state: 'closed'
              }
            ]
          }),
          update: jest.fn().mockReturnValue({
            data: {}
          })
        }
      }
    }
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined PR is ambiguous or was not created as a draft'
  )
  const client = github.getOctokit.mock.results[0].value
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
  expect(client.rest.repos.merge).not.toHaveBeenCalled()
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
})

test('runs the action and only one branch matches criteria', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [buildPR(1, 'dependabot-only-branch')]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      })
    }
  })
  expect(await run()).toBe(
    'not enough PRs/branches matched criteria to create a combined PR'
  )
})

test('runs the action and does not find any branches to merge together', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          {
            number: 1,
            head: {
              ref: 'test-ref'
            }
          }
        ]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        repos: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          }),
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })

  expect(await run()).toBe('No PRs/branches matched criteria')
})

test('runs the action with no prefix or regex set', async () => {
  process.env.INPUT_BRANCH_PREFIX = ''
  process.env.INPUT_BRANCH_REGEX = ''
  expect(await run()).toBe('Must specify either branch_prefix or branch_regex')
})

test('runs the action when select_label and ignore_label have the same value', async () => {
  process.env.INPUT_IGNORE_LABEL = 'some-label'
  process.env.INPUT_SELECT_LABEL = 'some-label'
  expect(await run()).toBe(
    'ignore_label and select_label cannot have the same value'
  )
})

test('ignore_label and select_label can both be empty', async () => {
  process.env.INPUT_IGNORE_LABEL = ''
  process.env.INPUT_SELECT_LABEL = ''
  expect(await run()).toBe('success')
})

test('successfully runs the action and sets labels', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return buildStatusResponse('REVIEW_REQUIRED', 'SUCCESS')
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementationOnce(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-1 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-2 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Validating status: FAILURE')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-4 with status FAILURE'
  )
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: null')
  expect(infoMock).toHaveBeenCalledWith(
    'Branch dependabot-5 has no required reviewers - OK'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: question')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: nocombine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-3 with label nocombine because it matches ignore_label'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-6')
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Creating combined PR')
  expect(debugMock).toHaveBeenCalledWith(
    'PR body: # Combined PRs ➡️📦⬅️\n\n✅ The following pull requests have been successfully combined on this PR:\n- Closes #1 Update dependency 1\n- Closes #5 Update dependency 5\n\n⚠️ The following PRs were left out due to merge conflicts:\n- #2 Update dependency 2\n\n> This PR was created by the [`github/combine-prs`](https://github.com/github/combine-prs) action'
  )

  expect(infoMock).toHaveBeenCalledWith(
    `Adding labels to combined PR: label1,label2,label3`
  )

  expect(infoMock).toHaveBeenCalledWith(
    'Combined PR url: https://github.com/test-owner/test-repo/pull/100'
  )
  expect(infoMock).toHaveBeenCalledWith('Combined PR number: 100')
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action and sets labels when one PR has no CI defined', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementationOnce(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-1 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: APPROVED')
  expect(infoMock).toHaveBeenCalledWith('Branch dependabot-2 is approved')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Pull for branch: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Validating status: FAILURE')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-4 with status FAILURE'
  )
  expect(infoMock).toHaveBeenCalledWith('Branch matched prefix: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking green status: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Validating status: SUCCESS')
  expect(infoMock).toHaveBeenCalledWith('Validating review decision: null')
  expect(infoMock).toHaveBeenCalledWith(
    'Branch dependabot-5 has no required reviewers - OK'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: question')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-1')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Adding branch to array: dependabot-2')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-3')
  expect(infoMock).toHaveBeenCalledWith('Checking ignore_label for: nocombine')
  expect(infoMock).toHaveBeenCalledWith(
    'Discarding dependabot-3 with label nocombine because it matches ignore_label'
  )
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-4')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Checking labels: dependabot-6')
  expect(infoMock).toHaveBeenCalledWith(
    'No status check(s) associated with branch: dependabot-6'
  )

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-5')
  expect(infoMock).toHaveBeenCalledWith('Creating combined PR')
  expect(debugMock).toHaveBeenCalledWith(
    'PR body: # Combined PRs ➡️📦⬅️\n\n✅ The following pull requests have been successfully combined on this PR:\n- Closes #1 Update dependency 1\n- Closes #5 Update dependency 5\n- Closes #6 Update dependency 6\n\n⚠️ The following PRs were left out due to merge conflicts:\n- #2 Update dependency 2\n\n> This PR was created by the [`github/combine-prs`](https://github.com/github/combine-prs) action'
  )

  expect(infoMock).toHaveBeenCalledWith(
    `Adding labels to combined PR: label1,label2,label3`
  )

  expect(infoMock).toHaveBeenCalledWith(
    'Combined PR url: https://github.com/test-owner/test-repo/pull/100'
  )
  expect(infoMock).toHaveBeenCalledWith('Combined PR number: 100')
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action and sets labels when one PR has no CI defined and the update_branch logic fails', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementation(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          }),
          updateBranch: jest.fn().mockImplementation(() => {
            throw new Error('updateBranch error')
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to update combined pr branch with the base branch'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action and sets labels when one PR has no CI defined and the update_branch logic fails due to a non 202 status code', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementation(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          }),
          updateBranch: jest.fn().mockReturnValueOnce({
            status: 500
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to update combined pr branch with the base branch'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('successfully runs the action and updates the pull request branch', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementation(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          }),
          updateBranch: jest.fn().mockReturnValueOnce({
            status: 202
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

async function runScratchCase(configureClient) {
  process.env.INPUT_CREATE_FROM_SCRATCH = 'true'
  process.env.INPUT_UPDATE_BRANCH = 'false'
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.rest.git.createRef = jest.fn().mockResolvedValue({data: {}})
    client.rest.git.deleteRef = jest.fn().mockResolvedValue({data: {}})
    client.rest.git.getRef = jest.fn().mockResolvedValue({
      data: {object: {sha: 'c'.repeat(40)}}
    })
    configureClient(client)
    return client
  })
  return {result: await run(), client}
}

test('successfully runs the action and uses a fresh pull request branch', async () => {
  const createRef = jest.fn().mockReturnValueOnce({
    data: {}
  })
  const updateRef = jest.fn().mockReturnValueOnce({
    data: {}
  })
  const sha = randomSha1()
  const getRef = jest.fn().mockReturnValueOnce({
    data: {
      object: {
        sha
      }
    }
  })
  const deleteRef = jest.fn().mockReturnValueOnce({
    data: {}
  })

  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        if (params.input?.refUpdates) {
          return {updateRefs: {clientMutationId: null}}
        }
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef,
          updateRef,
          getRef,
          deleteRef
        },
        repos: {
          get: jest.fn().mockResolvedValue({
            data: {node_id: 'test-repository-node-id'}
          }),
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementation(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          }),
          updateBranch: jest.fn().mockReturnValueOnce({
            status: 202
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_CREATE_FROM_SCRATCH = 'true'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')

  expect(createRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringMatching(/^refs\/heads\/combine-prs-working\//)
    })
  )
  expect(getRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringMatching(/^heads\/combine-prs-working\//)
    })
  )
  const client = github.getOctokit.mock.results[0].value
  expect(updateRef).not.toHaveBeenCalled()
  expect(client.graphql).toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.objectContaining({
      input: {
        repositoryId: 'test-repository-node-id',
        refUpdates: [
          {
            name: 'refs/heads/combined-prs-branch',
            beforeOid: 'b'.repeat(40),
            afterOid: sha,
            force: true
          }
        ]
      }
    })
  )
  expect(deleteRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringMatching(/^heads\/combine-prs-working\//)
    })
  )

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('rejects a discovered combined PR without a valid head SHA', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    const combined = buildPR(100, 'combined-prs-branch', [], 'main', true)
    delete combined.head.sha
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      combined
    ])
    return client
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR has no valid head SHA'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('rejects a changed combined PR head before branch work', async () => {
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    const changed = buildPR(100, 'combined-prs-branch', [], 'main', true)
    changed.head.sha = 'd'.repeat(40)
    client.rest.pulls.get = jest.fn().mockResolvedValue({data: changed})
    return client
  })

  expect(await run()).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('does not replace a scratch branch without a matching draft PR', async () => {
  const {result, client} = await runScratchCase(client => {
    client.rest.git.createRef
      .mockResolvedValueOnce({data: {}})
      .mockRejectedValueOnce(new AlreadyExistsError('Branch exists'))
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch exists without a matching draft PR'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
})

test('rejects a scratch replacement with an invalid expected SHA', async () => {
  const {result, client} = await runScratchCase(client => {
    const sources = [buildPR(1, 'dependabot-1'), buildPR(2, 'dependabot-2')]
    for (const source of sources) source.base.sha = 'invalid'
    client.paginate.mockReturnValue(sources)
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch update has no valid head SHA'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
})

test('rejects a scratch replacement with an invalid working SHA', async () => {
  const {result} = await runScratchCase(client => {
    client.rest.git.getRef.mockResolvedValue({
      data: {object: {sha: 'invalid'}}
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch update has no valid head SHA'
  )
})

test('rejects a scratch replacement without a repository node ID', async () => {
  const {result, client} = await runScratchCase(client => {
    client.rest.repos.get.mockResolvedValue({data: {}})
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch repository has no node ID'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
})

test('rejects a scratch replacement without mutation confirmation', async () => {
  const {result, client} = await runScratchCase(client => {
    const originalGraphql = client.graphql.getMockImplementation()
    client.graphql.mockImplementation((query, params) =>
      params.input?.refUpdates ? {} : originalGraphql(query, params)
    )
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch conditional update was not confirmed'
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
})

test('preserves a concurrent scratch branch update', async () => {
  const {result, client} = await runScratchCase(client => {
    const originalGraphql = client.graphql.getMockImplementation()
    client.graphql.mockImplementation((query, params) => {
      if (params.input?.refUpdates) {
        throw new Error('beforeOid no longer matches')
      }
      return originalGraphql(query, params)
    })
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Combined branch changed before conditional update'
  )
  expect(client.rest.git.updateRef).not.toHaveBeenCalled()
  expect(client.rest.pulls.create).not.toHaveBeenCalled()
})

test('keeps an existing draft after a conditional scratch replacement', async () => {
  const {result, client} = await runScratchCase(client => {
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    const before = buildPR(100, 'combined-prs-branch', [], 'main', true)
    const after = buildPR(100, 'combined-prs-branch', [], 'main', true)
    after.head.sha = 'c'.repeat(40)
    after.html_url = 'https://github.com/test-owner/test-repo/pull/100'
    client.rest.pulls.get = jest
      .fn()
      .mockResolvedValueOnce({data: before})
      .mockResolvedValueOnce({data: before})
      .mockResolvedValueOnce({data: after})
    client.rest.pulls.update = jest.fn().mockResolvedValue({data: after})
  })

  expect(result).toBe('success')
  expect(client.graphql).toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.objectContaining({
      input: expect.objectContaining({
        refUpdates: [expect.objectContaining({beforeOid: 'a'.repeat(40)})]
      })
    })
  )
  expect(client.rest.pulls.update).toHaveBeenCalledTimes(1)
  expect(setOutputMock).toHaveBeenCalledWith('pr_origin', 'existing')
})

test('does not publish a scratch branch after its draft becomes ready', async () => {
  const {result, client} = await runScratchCase(client => {
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    client.rest.pulls.get = jest
      .fn()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValue({
        data: buildPR(100, 'combined-prs-branch', [], 'main', false)
      })
    client.rest.pulls.update = jest.fn()
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('does not publish a scratch branch after its draft is retargeted', async () => {
  const {result, client} = await runScratchCase(client => {
    client.paginate.mockReturnValue([
      buildPR(1, 'dependabot-1'),
      buildPR(2, 'dependabot-2'),
      buildPR(100, 'combined-prs-branch', [], 'main', true)
    ])
    client.rest.pulls.get = jest
      .fn()
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'main', true)
      })
      .mockResolvedValueOnce({
        data: buildPR(100, 'combined-prs-branch', [], 'release', true)
      })
    client.rest.pulls.update = jest.fn()
  })

  expect(result).toBe('failure')
  expect(setFailedMock).toHaveBeenCalledWith(
    'Existing combined PR changed or is not draft'
  )
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
  expect(client.rest.pulls.update).not.toHaveBeenCalled()
})

test('successfully runs the action and uses the existing pull request branch', async () => {
  const createRef = jest.fn().mockReturnValueOnce({
    data: {}
  })
  const updateRef = jest.fn().mockReturnValueOnce({
    data: {}
  })
  const sha = randomSha1()
  const getRef = jest.fn().mockReturnValueOnce({
    data: {
      object: {
        sha
      }
    }
  })
  const deleteRef = jest.fn().mockReturnValueOnce({
    data: {}
  })

  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2'),
          buildPR(3, 'dependabot-3', ['nocombine']),
          buildPR(4, 'dependabot-4'),
          buildPR(5, 'dependabot-5'),
          buildPR(6, 'dependabot-6'),
          buildPR(7, 'fix-package')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return {
              repository: {
                pullRequest: {
                  reviewDecision: null,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: null
                        }
                      }
                    ]
                  }
                }
              }
            }
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef,
          updateRef,
          getRef,
          deleteRef
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest
            .fn()
            .mockReturnValueOnce({
              data: {
                merged: true
              }
            })
            .mockImplementation(() => {
              throw new Error('merge error')
            })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          }),
          updateBranch: jest.fn().mockReturnValueOnce({
            status: 202
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_CREATE_FROM_SCRATCH = 'false'
  process.env.INPUT_LABELS = 'label1,label2, label3'
  expect(await run()).toBe('success')

  expect(createRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: expect.stringContaining('refs/heads/combined-prs-branch')
    })
  )
  expect(getRef).not.toHaveBeenCalled()
  expect(updateRef).not.toHaveBeenCalled()
  expect(deleteRef).not.toHaveBeenCalled()

  expect(infoMock).toHaveBeenCalledWith('Merged branch dependabot-1')
  expect(warningMock).toHaveBeenCalledWith(
    'Failed to merge branch dependabot-2'
  )
  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
  expect(setOutputMock).toHaveBeenCalledWith(
    'pr_url',
    'https://github.com/test-owner/test-repo/pull/100'
  )
})

test('runs the action and fails to create a working branch', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [buildPR(1, 'dependabot-1'), buildPR(2, 'dependabot-2')]
      }),
      graphql: jest.fn().mockImplementation(() => {
        return buildStatusResponse('APPROVED', 'SUCCESS')
      }),
      rest: {
        issues: {
          createComment: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          deleteRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          createRef: jest.fn().mockRejectedValueOnce(new BigBadError('Oh no!'))
        },
        repos: {
          merge: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {}
          })
        }
      }
    }
  })
  process.env.INPUT_CREATE_FROM_SCRATCH = 'true'

  expect(await run()).toBe('Failed to create working branch')
  expect(setFailedMock).toHaveBeenCalledWith('Failed to create working branch')
})

test('successfully runs the action and sets assignees', async () => {
  jest.spyOn(github, 'getOctokit').mockImplementation(() => {
    return {
      paginate: jest.fn().mockImplementation(() => {
        return [
          buildPR(1, 'dependabot-1', ['question']),
          buildPR(2, 'dependabot-2')
        ]
      }),
      graphql: jest.fn().mockImplementation((_query, params) => {
        switch (params.pull_number) {
          case 1:
          case 2:
          case 3:
            return buildStatusResponse('APPROVED', 'SUCCESS')
          case 4:
            return buildStatusResponse('APPROVED', 'FAILURE')
          case 5:
            return buildStatusResponse(null, 'SUCCESS')
          case 6:
            return buildStatusResponse('REVIEW_REQUIRED', 'SUCCESS')
          default:
            throw new Error(
              `params.pull_number of ${params.pull_number} is not configured.`
            )
        }
      }),
      rest: {
        issues: {
          addAssignees: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          addLabels: jest.fn().mockReturnValueOnce({
            data: {}
          })
        },
        git: {
          createRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          updateRef: jest.fn().mockReturnValueOnce({
            data: {}
          }),
          getRef: jest.fn().mockReturnValueOnce({
            data: {
              object: {
                sha: randomSha1()
              }
            }
          })
        },
        repos: {
          // mock the first value of merge to be a success and the second to be an exception
          merge: jest.fn().mockReturnValueOnce({
            data: {
              merged: true
            }
          })
        },
        pulls: {
          create: jest.fn().mockReturnValueOnce({
            data: {
              number: 100,
              draft: true,
              html_url: 'https://github.com/test-owner/test-repo/pull/100'
            }
          })
        }
      }
    }
  })

  process.env.INPUT_REVIEW_REQUIRED = 'true'
  process.env.INPUT_ASSIGNEES = 'octocat ,another-user,  kolossal'
  expect(await run()).toBe('success')

  expect(infoMock).toHaveBeenCalledWith(
    `Adding assignees to combined PR: octocat,another-user,kolossal`
  )

  expect(setOutputMock).toHaveBeenCalledWith('pr_number', 100)
})

async function runRequiredSourceBaseCase(configure = () => {}) {
  process.env.INPUT_REQUIRED_SOURCE_BASE = 'develop'
  process.env.INPUT_CI_REQUIRED = 'false'
  process.env.INPUT_UPDATE_BRANCH = 'false'
  const original = github.getOctokit.getMockImplementation()
  let client
  github.getOctokit.mockImplementation(() => {
    client = original()
    const sources = [
      buildPR(1, 'dependabot-1', [], 'develop'),
      buildPR(2, 'dependabot-2', [], 'develop')
    ]
    client.paginate.mockReturnValue(sources)
    client.rest.pulls.get = jest.fn(({pull_number}) => ({
      data: sources.find(source => source.number === pull_number)
    }))
    client.rest.repos.merge = jest.fn().mockResolvedValue({status: 204})
    client.rest.git.getRef = jest.fn().mockResolvedValue({
      data: {object: {sha: 'c'.repeat(40)}}
    })
    client.rest.git.deleteRef = jest.fn().mockResolvedValue({})
    configure(client, sources)
    return client
  })
  const result = await run()
  return {result, client}
}

test('required source base excludes a wrong-base PR before branch work', async () => {
  const {result, client} = await runRequiredSourceBaseCase((_, sources) => {
    sources[1].base.ref = 'release'
  })
  expect(result).toBe(
    'not enough PRs/branches matched criteria to create a combined PR'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base excludes a newly drafted source', async () => {
  const {result, client} = await runRequiredSourceBaseCase((_, sources) => {
    sources[1].draft = true
  })
  expect(result).toBe(
    'not enough PRs/branches matched criteria to create a combined PR'
  )
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base rejects a selected source without a repository head', async () => {
  const {result, client} = await runRequiredSourceBaseCase((_, sources) => {
    sources[0].head.sha = 'invalid'
  })
  expect(result).toBe('failure')
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base rejects a selected source from another repository', async () => {
  const {result, client} = await runRequiredSourceBaseCase((_, sources) => {
    sources[0].head.repo.full_name = 'another/repository'
  })
  expect(result).toBe('failure')
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base merges observed SHAs only after source revalidation', async () => {
  const {result, client} = await runRequiredSourceBaseCase()
  expect(result).toBe('success')
  expect(client.rest.pulls.get).toHaveBeenCalledTimes(4)
  expect(client.rest.repos.merge).toHaveBeenCalledTimes(2)
  expect(client.rest.repos.merge).toHaveBeenCalledWith(
    expect.objectContaining({head: 'a'.repeat(40)})
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
  expect(client.graphql).toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
})

test('required source base blocks retarget before creating a branch', async () => {
  const {result, client} = await runRequiredSourceBaseCase(
    (mockClient, sources) => {
      const retargeted = {...sources[0], base: {ref: 'release'}}
      mockClient.rest.pulls.get.mockResolvedValueOnce({data: retargeted})
    }
  )
  expect(result).toBe('failure')
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
  expect(client.rest.repos.merge).not.toHaveBeenCalled()
})

test('required source base blocks retarget before publishing the combined head', async () => {
  const {result, client} = await runRequiredSourceBaseCase(
    (mockClient, sources) => {
      const retargeted = {...sources[0], base: {ref: 'release'}}
      mockClient.rest.pulls.get
        .mockResolvedValueOnce({data: sources[0]})
        .mockResolvedValueOnce({data: sources[1]})
        .mockResolvedValueOnce({data: retargeted})
    }
  )
  expect(result).toBe('failure')
  expect(client.rest.repos.merge).toHaveBeenCalledTimes(2)
  expect(client.graphql).not.toHaveBeenCalledWith(
    expect.stringContaining('updateRefs'),
    expect.anything()
  )
  expect(client.rest.git.deleteRef).toHaveBeenCalledTimes(1)
})

test('required source base blocks a changed source head or exclusion label', async () => {
  const changed = await runRequiredSourceBaseCase((client, sources) => {
    const moved = {
      ...sources[0],
      head: {...sources[0].head, sha: 'd'.repeat(40)}
    }
    client.rest.pulls.get.mockResolvedValueOnce({data: moved})
  })
  expect(changed.result).toBe('failure')
  expect(changed.client.rest.git.createRef).not.toHaveBeenCalled()
  const excluded = await runRequiredSourceBaseCase((client, sources) => {
    const labeled = {...sources[0], labels: [{name: 'nocombine'}]}
    client.rest.pulls.get.mockResolvedValueOnce({data: labeled})
  })
  expect(excluded.result).toBe('failure')
  expect(excluded.client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base blocks a newly drafted or retitled source', async () => {
  const drafted = await runRequiredSourceBaseCase((client, sources) => {
    client.rest.pulls.get.mockResolvedValueOnce({
      data: {...sources[0], draft: true}
    })
  })
  expect(drafted.result).toBe('failure')
  expect(drafted.client.rest.git.createRef).not.toHaveBeenCalled()
  const retitled = await runRequiredSourceBaseCase((client, sources) => {
    client.rest.pulls.get.mockResolvedValueOnce({
      data: {...sources[0], title: 'WIP'}
    })
  })
  expect(retitled.result).toBe('failure')
  expect(retitled.client.rest.git.createRef).not.toHaveBeenCalled()
})

test('required source base fails closed when a source read fails', async () => {
  const {result, client} = await runRequiredSourceBaseCase(mockClient => {
    mockClient.rest.pulls.get.mockRejectedValueOnce(new Error('unavailable'))
  })
  expect(result).toBe('failure')
  expect(client.rest.git.createRef).not.toHaveBeenCalled()
})

function buildStatusResponse(reviewDecision, ciStatus) {
  return {
    repository: {
      pullRequest: {
        reviewDecision: reviewDecision,
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: ciStatus
                }
              }
            }
          ]
        }
      }
    }
  }
}

function buildPR(number, head, labels = [], base = null, draft = false) {
  return {
    number: number,
    title: `Update dependency ${number}`,
    state: 'open',
    draft,
    head: {
      ref: head,
      sha: 'a'.repeat(40),
      repo: {full_name: 'test-owner/test-repo'}
    },
    base: {
      ref: base ?? 'main',
      sha: 'b'.repeat(40)
    },
    labels: labels.map(labelName => {
      return {name: labelName}
    })
  }
}
