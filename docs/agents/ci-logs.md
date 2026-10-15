# Reading a failed CI job's log while the run is still going

`gh run view <run> --log-failed` refuses while any job of the run is still queued or running, so waiting for it can cost many minutes. A job that has already finished has its log available now:

1. Find the job id: `gh pr checks <pr>` lists each check with a URL ending `/job/<job id>`.
2. Fetch that job's log into a file outside the repo: `gh api repos/Rabaed/rabaedV2.0/actions/jobs/<job id>/logs --allow-escape-sequences > job.log`. Without `--allow-escape-sequences`, `gh` writes only an error line, even when redirected. Strip the colour codes (`sed 's/\x1b\[[0-9;]*m//g'`) and search for `FAIL` or `Error`.

Seam 1 runs as four jobs, `seam 1 (shard 1/4)` to `seam 1 (shard 4/4)`, each with its own Postgres (RP-557). A seam 1 failure is in one of those shards' logs. The job `seam 1 (API as a Member)`, the check the ruleset requires, only reports: it fails when any shard did not pass, and it holds the merged test timing (the total is the slowest shard's time, and each shard's time is listed). To run one shard locally: `pnpm test:seam1 --shard=2/4`.

An "over budget" warning on a seam job (RP-558) means that seam grew past its fixed time budget in `ci.yml`: file a `retro` ticket under RP-12 to split it or speed it up, and don't raise the budget in the same PR.

If the update-screenshots bot comments "These baselines changed again after the bot set them on this PR" (RP-561), a story renders unstably: the bot and CI keep disagreeing and the merge queue will drop the PR. Find the cause of the instability and fix the story; screenshots match exactly, and bringing back a screenshot tolerance needs the product owner. Pixel-diff the two baselines the bot alternated between (their commits are in the PR): in RP-556 one text line had moved exactly 1 pixel up or down with the same glyphs, a baseline rounded to a different whole pixel, while a different glyph would point at font fallback instead. Do not just re-run the label.

If the Update screenshots workflow's `Refuse stories that render differently twice` job fails with "story X renders differently twice (N pixels)" (RP-569), the workflow rendered every story twice and that story's second render did not match its first. Its baseline was not committed; every other changed baseline was. The story, not its baseline, needs fixing: something in it depends on timing or on what ran before (a layout measured a frame late, an animation, a font fallback). Reproduce with `pnpm test:stories:linux --update -t <story>` and then the same command without `--update`; the render job's log names each mismatch, and its `unstable-screenshot-diffs` artifact holds both renders (the first under `first-render/`) and their diff. If that job instead says "The second render failed for more than screenshots", a play function, axe check or hook failed the second time: a flaky story, and nothing was committed.

Screenshots are compared only on Linux CI, so a story failure that passes locally (for example "Could not capture a stable screenshot") shows up only in this log.
