# Reading a failed CI job's log while the run is still going

`gh run view <run> --log-failed` refuses while any job of the run is still queued or running, so waiting for it can cost many minutes. A job that has already finished has its log available now:

1. Find the job id: `gh pr checks <pr>` lists each check with a URL ending `/job/<job id>`.
2. Fetch that job's log: `gh api repos/Rabaed/rabaedV2.0/actions/jobs/<job id>/logs > job.log` (redirect to a file; or pass `--allow-escape-sequences` to print it, because `gh` refuses terminal escape sequences otherwise). Search the file for `FAIL` or `Error`. Do not commit it.

Screenshots are compared only on Linux CI, so a story failure that passes locally (for example "Could not capture a stable screenshot") shows up only in this log.
